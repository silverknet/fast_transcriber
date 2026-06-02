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
  import { AlertTriangle, FolderSearch, Loader2 } from '@lucide/svelte'
  import { audioSession } from '$lib/stores/audioSession'
  import {
    readProjectSongAsset,
    relinkProjectSongAudio,
  } from '$lib/client/desktopProjectFs'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { project } from '$lib/stores/project'
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

  /** Stamp `audio.originalPath`/`fileName` into the SongMap so reload finds the file. */
  function stampPath(relPath: string, fileName: string): void {
    patchSongMap((m: SongMap): SongMap => ({
      ...m,
      audio: m.audio
        ? { ...m.audio, originalPath: relPath, fileName }
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
      stampPath(r.relPath, r.fileName)
      await loadRelinkedFile(r.relPath, r.fileName)
      status = 'idle'
    } catch (e) {
      status = 'error'
      errorMsg = e instanceof Error ? e.message : 'Could not load relinked audio'
    }
  }

  /** Mismatch modal — proceed with the new file but do NOT overwrite originalSha256. */
  async function useAnyway(): Promise<void> {
    const m = mismatch
    if (!m) return
    mismatch = null
    status = 'loading'
    try {
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
  class="border-foreground bg-destructive/10 mx-auto flex w-full max-w-6xl flex-col gap-3 border-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
  role="alert"
  aria-live="polite"
>
  <div class="flex items-start gap-3">
    <AlertTriangle class="text-destructive size-5 shrink-0 mt-0.5" aria-hidden="true" />
    <div class="min-w-0">
      <div class="text-sm font-bold">Audio file missing</div>
      <div class="text-muted-foreground mt-0.5 text-xs">
        BarBro can't find <span class="font-mono">{$songMap?.audio?.originalPath ?? '—'}</span>
        for this song. Locate the original audio to enable playback, the mixer, and analyzers.
      </div>
      {#if errorMsg}
        <div class="text-destructive mt-1 text-xs">{errorMsg}</div>
      {/if}
    </div>
  </div>
  <div class="flex shrink-0 items-center gap-2">
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
