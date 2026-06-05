<script lang="ts">
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { AlertTriangle, FolderSearch, Loader2, Package, EyeOff } from '@lucide/svelte'
  import { audioSession } from '$lib/stores/audioSession'
  import {
    readProjectSongAsset,
    relinkProjectSongAudio,
  } from '$lib/client/desktopProjectFs'
  import {
    pickOpenFileViaDesktop,
    importHydrationPackViaDesktop,
  } from '$lib/client/desktopBridge'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { project } from '$lib/stores/project'
  import { loadProjectSongIntoEditor } from '$lib/project/commit'
  import type { SongMap } from '$lib/songmap'

  /** Truncate a hex hash for display. */
  function shortSha(hex: string | undefined): string {
    if (!hex) return '—'
    return hex.slice(0, 12)
  }

  /** UI state for the relink flow. */
  type Status = 'idle' | 'picking' | 'loading' | 'error'

  let status = $state<Status>('idle')
  let errorMsg = $state('')

  /** Mismatch modal — set once we have a relinked file with a wrong SHA. */
  let mismatch = $state<null | {
    relPath: string
    fileName: string
    newSha: string
    expectedSha: string | undefined
  }>(null)

  const expectedSha = $derived<string | undefined>($songMap?.audio?.originalSha256)

  /**
   * After a relink, load the file into the editor session. Used by both the
   * matching-SHA path and the user-confirmed "Use anyway" path.
   */
  async function loadRelinkedFile(relPath: string, fileName: string): Promise<void> {
    const snap = get(project)
    if (!snap.osPath || !snap.activeSongFolder) {
      throw new Error('No active song in project')
    }
    const got = await readProjectSongAsset(snap.osPath, snap.activeSongFolder, relPath)
    if (!got.ok) throw new Error(got.error)
    const sm = get(songMap)
    const mime = sm?.audio?.mimeType ?? 'audio/*'
    const file = new File([got.blob], fileName, { type: mime })
    audioSession.set({
      file,
      name: fileName,
      startSec: sm?.audio?.trim?.startSec ?? 0,
      endSec: sm?.audio?.trim?.endSec ?? sm?.audio?.durationSec ?? 0,
    })
  }

  /**
   * Stamp `audio.originalPath` / `fileName` plus the identity bundle
   * (sampleRate, channels, fileSize, durationSec) that the sidecar
   * returned at relink time. Phase 3 added those identity fields so
   * cloud collab can match audio by content rather than path — every
   * relink is also a chance to backfill them on legacy songs.
   */
  function stampPath(
    relPath: string,
    fileName: string,
    identity: {
      fileSize?: number
      durationSec?: number
      sampleRate?: number
      channels?: number
    } = {},
  ): void {
    patchSongMap((m: SongMap): SongMap => ({
      ...m,
      audio: m.audio
        ? {
            ...m.audio,
            originalPath: relPath,
            fileName,
            ...(identity.fileSize !== undefined ? { fileSize: identity.fileSize } : {}),
            ...(identity.durationSec !== undefined ? { durationSec: identity.durationSec } : {}),
            ...(identity.sampleRate !== undefined ? { sampleRate: identity.sampleRate } : {}),
            ...(identity.channels !== undefined ? { channels: identity.channels } : {}),
          }
        : m.audio,
    }))
  }

  async function locate(): Promise<void> {
    const snap = get(project)
    if (!snap.osPath || !snap.activeSongFolder) {
      errorMsg = 'No active project song'
      status = 'error'
      return
    }
    const sm = get(songMap)
    const defaultName = sm?.audio?.fileName
    status = 'picking'
    errorMsg = ''
    let r
    try {
      r = await relinkProjectSongAudio(snap.osPath, snap.activeSongFolder, defaultName)
    } catch (e) {
      status = 'error'
      errorMsg = e instanceof Error ? e.message : 'Relink failed'
      return
    }
    if (!r.ok) {
      if ('cancelled' in r) {
        status = 'idle'
        return
      }
      status = 'error'
      errorMsg = r.error
      return
    }

    // SHA check. If the SongMap doesn't carry an expected hash (legacy file),
    // treat the relinked content as canonical.
    if (expectedSha && r.sha256 !== expectedSha) {
      mismatch = {
        relPath: r.relPath,
        fileName: r.fileName,
        newSha: r.sha256,
        expectedSha,
      }
      status = 'idle'
      return
    }

    status = 'loading'
    try {
      stampPath(r.relPath, r.fileName, {
        fileSize: r.fileSize,
        durationSec: r.durationSec,
        sampleRate: r.sampleRate,
        channels: r.channels,
      })
      await loadRelinkedFile(r.relPath, r.fileName)
      status = 'idle'
    } catch (e) {
      status = 'error'
      errorMsg = e instanceof Error ? e.message : 'Could not load relinked audio'
    }
  }

  /**
   * Import a hydration pack and try to fill the missing audio from
   * it. After import we re-run the song-load flow so reconcile picks
   * up the freshly-extracted audio file.
   */
  async function importPack(): Promise<void> {
    const snap = get(project)
    if (!snap.osPath || !snap.activeSongId) {
      errorMsg = 'No active project song'
      status = 'error'
      return
    }
    status = 'picking'
    errorMsg = ''
    const pick = await pickOpenFileViaDesktop({
      title: 'Import hydration package',
      filters: [{ name: 'BarBro hydration package', extensions: ['zip'] }],
    })
    if (!pick.ok) {
      if (!('cancelled' in pick)) {
        errorMsg = pick.error ?? 'Could not open file picker'
        status = 'error'
        return
      }
      status = 'idle'
      return
    }
    status = 'loading'
    try {
      const result = await importHydrationPackViaDesktop({
        projectPath: snap.osPath,
        packPath: pick.path,
      })
      if (!result.ok) throw new Error(result.error)
      // Re-load this song. Reconcile in loadProjectSongIntoEditor will
      // catch the freshly-extracted audio by sha and stamp the path.
      await loadProjectSongIntoEditor(snap.activeSongId)
      status = 'idle'
    } catch (e) {
      status = 'error'
      errorMsg = e instanceof Error ? e.message : 'Hydration import failed'
    }
  }

  /**
   * User chose to keep working without audio (chord chart, sections,
   * metadata edits still function). Banner stops rendering this
   * session — cleared on next song load.
   */
  function ignoreForSession(): void {
    audioSession.update((s) => ({ ...s, missingAudioIgnored: true }))
  }

  /** Mismatch modal — proceed with the new file but do NOT overwrite originalSha256. */
  async function useAnyway(): Promise<void> {
    const m = mismatch
    if (!m) return
    mismatch = null
    status = 'loading'
    try {
      // No identity bundle here — the user knowingly accepted a
      // mismatched file, so we don't backfill sr/channels/fileSize from
      // it (those would suggest the cloud's expected_audio matches when
      // it doesn't). Path + fileName only.
      stampPath(m.relPath, m.fileName)
      await loadRelinkedFile(m.relPath, m.fileName)
      status = 'idle'
    } catch (e) {
      status = 'error'
      errorMsg = e instanceof Error ? e.message : 'Could not load relinked audio'
    }
  }
</script>

<div
  class="border-foreground bg-destructive/10 mx-auto flex w-full max-w-6xl flex-col gap-3 border-2 px-4 py-3"
  role="alert"
  aria-live="polite"
>
  <div class="flex items-start gap-3">
    <AlertTriangle class="text-destructive size-5 shrink-0 mt-0.5" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <div class="text-sm font-bold">Audio file missing</div>
      <div class="text-muted-foreground mt-0.5 text-xs">
        BarBro can't find the audio for this song.
      </div>
      {#if $songMap?.audio}
        {@const a = $songMap.audio}
        <dl class="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          {#if a.fileName}
            <dt class="text-muted-foreground font-semibold uppercase tracking-wider">File</dt>
            <dd class="font-mono break-all">{a.fileName}</dd>
          {/if}
          {#if a.durationSec}
            <dt class="text-muted-foreground font-semibold uppercase tracking-wider">Duration</dt>
            <dd class="font-mono tabular-nums">{a.durationSec.toFixed(1)} s</dd>
          {/if}
          {#if a.originalSha256 ?? a.sha256}
            <dt class="text-muted-foreground font-semibold uppercase tracking-wider">SHA</dt>
            <dd class="font-mono">{shortSha(a.originalSha256 ?? a.sha256)}…</dd>
          {/if}
        </dl>
      {/if}
      {#if errorMsg}
        <div class="text-destructive mt-1 text-xs">{errorMsg}</div>
      {/if}
    </div>
  </div>
  <div class="flex flex-wrap items-center justify-end gap-2">
    <Button
      type="button"
      size="sm"
      class="h-8 gap-2 text-xs font-bold"
      onclick={locate}
      disabled={status === 'picking' || status === 'loading'}
    >
      {#if status === 'picking' || status === 'loading'}
        <Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
      {:else}
        <FolderSearch class="size-3.5" aria-hidden="true" />
      {/if}
      {status === 'picking' ? 'Choose…' : status === 'loading' ? 'Loading…' : 'Locate audio file'}
    </Button>
    <Button
      type="button"
      size="sm"
      variant="outline"
      class="h-8 gap-2 text-xs font-bold"
      onclick={importPack}
      disabled={status === 'picking' || status === 'loading'}
    >
      <Package class="size-3.5" aria-hidden="true" />
      Import hydration pack
    </Button>
    <Button
      type="button"
      size="sm"
      variant="ghost"
      class="h-8 gap-2 text-xs"
      onclick={ignoreForSession}
      disabled={status === 'picking' || status === 'loading'}
    >
      <EyeOff class="size-3.5" aria-hidden="true" />
      Ignore for this session
    </Button>
  </div>
</div>

<Dialog open={mismatch !== null} onOpenChange={(v: boolean) => { if (!v) mismatch = null }}>
  <DialogContent class="max-w-md">
    <DialogHeader>
      <DialogTitle>This file doesn't match the original</DialogTitle>
      <DialogDescription>
        The file you picked doesn't match the audio BarBro originally analyzed for this song.
        Beat times, sections, and chords may be off.
      </DialogDescription>
    </DialogHeader>

    {#if mismatch}
      <dl class="text-xs grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 font-mono">
        <dt class="text-muted-foreground">Original</dt>
        <dd>{shortSha(mismatch.expectedSha)}…</dd>
        <dt class="text-muted-foreground">This file</dt>
        <dd>{shortSha(mismatch.newSha)}…</dd>
      </dl>
    {/if}

    <DialogFooter class="">
      <Button class="" variant="outline" onclick={() => (mismatch = null)}>Cancel</Button>
      <Button class="" onclick={useAnyway}>Use anyway</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
