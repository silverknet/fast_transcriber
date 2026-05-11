<script lang="ts">
  /**
   * Per-song "Set" panel rendered inside an expanded `ProjectSongCard`.
   *
   * Assumes the parent already called `loadProjectSongIntoEditor(entry.id)`
   * so the global `songMap` / `audioSession` stores hold this song. Bound
   * folder = `<projectFolder>/<entry.folder>/` (the song's own subdir).
   *
   * Mirrors the existing `/set` route: Stem Splitter (Demucs) + Stem Slots
   * (folder-file binding) + per-song `.als` export.
   */
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import StemSlotList, { type LoadedStemInfo } from '$lib/components/StemSlotList.svelte'
  import StemSplitter from '$lib/components/StemSplitter.svelte'
  import {
    ensureAbletonProjectFolder,
    getDirectoryHandleByPath,
    readFileFromHandle,
    scanAudioFiles,
    writeFileToHandle,
  } from '$lib/client/folderHandle'
  import { generateAbletonSetXml, type StemClip } from '$lib/export/abletonSet'
  import { gzipString } from '$lib/export/gzip'
  import { finalizeStemJobToSong, SONG_ALS_FILENAME } from '$lib/project/commit'
  import type { ProjectSongEntry } from '$lib/project/types'
  import { audioSession } from '$lib/stores/audioSession'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project as projectStore } from '$lib/stores/project'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { removeJob, type StemJobEntry } from '$lib/stores/stemJobs'

  let { entry, projectFolderHandle } = $props<{
    entry: ProjectSongEntry
    projectFolderHandle: FileSystemDirectoryHandle
  }>()

  // ── Folder + stem state (scoped to this song) ──────────────────────────────

  let songFolderHandle = $state<FileSystemDirectoryHandle | null>(null)
  let folderFiles = $state<string[]>([])
  let folderError = $state('')

  type LoadedStem = { file: File; clip: StemClip }
  let stems = $state<Map<string, LoadedStem>>(new Map())

  /** This panel only renders when the parent says this song is the active one. */
  let isThisSongActive = $derived(
    $projectStore.editingMode === 'project-song' && $projectStore.activeSongId === entry.id,
  )

  async function decodeStem(file: File, relativePath: string): Promise<LoadedStem> {
    const ctx = new AudioContext()
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer())
      return {
        file,
        clip: { fileName: file.name, relativePath, durationSec: buf.duration, sampleRate: buf.sampleRate },
      }
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  async function refreshFolderListing() {
    if (!songFolderHandle) return
    try {
      folderFiles = await scanAudioFiles(songFolderHandle)
    } catch (e) {
      folderError = e instanceof Error ? e.message : 'Could not scan folder'
    }
  }

  async function autoResolveStemRefs() {
    const sm = get(songMap)
    if (!sm?.stemRefs || !songFolderHandle) return
    for (const [name, relPath] of Object.entries(sm.stemRefs)) {
      if (stems.has(name)) continue
      try {
        const file = await readFileFromHandle(songFolderHandle, relPath)
        const decoded = await decodeStem(file, relPath)
        stems = new Map(stems).set(name, decoded)
      } catch {
        /* file missing — UI will show "not found" */
      }
    }
  }

  async function assignStem(stemName: string, relativePath: string) {
    if (!songFolderHandle) return
    try {
      const file = await readFileFromHandle(songFolderHandle, relativePath)
      const decoded = await decodeStem(file, relativePath)
      stems = new Map(stems).set(stemName, decoded)
      patchSongMap((m) => ({
        ...m,
        stemRefs: { ...m.stemRefs, [stemName]: relativePath },
      }))
    } catch (e) {
      folderError = e instanceof Error ? e.message : `Could not load ${relativePath}`
    }
  }

  function removeStem(stemName: string) {
    const next = new Map(stems)
    next.delete(stemName)
    stems = next
    patchSongMap((m) => {
      const refs = { ...m.stemRefs }
      delete refs[stemName]
      return { ...m, stemRefs: refs }
    })
  }

  /** Surface stems as the `LoadedStemInfo` shape `StemSlotList` expects. */
  let loadedForList = $derived.by(() => {
    const out = new Map<string, LoadedStemInfo>()
    for (const [name, s] of stems) {
      out.set(name, { relativePath: s.clip.relativePath, durationSec: s.clip.durationSec })
    }
    return out
  })

  onMount(() => {
    void (async () => {
      try {
        songFolderHandle = await getDirectoryHandleByPath(projectFolderHandle, entry.folder)
        await refreshFolderListing()
        await autoResolveStemRefs()
      } catch (e) {
        folderError = e instanceof Error ? e.message : 'Could not open song folder'
      }
    })()
  })

  // ── Stem-job finalization ──────────────────────────────────────────────────

  /**
   * Closure-captured finalizer passed into StemSplitter. Runs when the
   * sidecar's job reaches `done` — even if the user has collapsed this
   * card by then, the project folder + entry are still in scope.
   *
   * The heavy lifting (fetch, write, .smap merge, cache refresh, release)
   * lives in `finalizeStemJobToSong`; this wrapper handles the
   * is-active-song path (where we should also patch the live songMap so
   * the editor sees fresh refs immediately).
   */
  async function finalizeStemJob(job: StemJobEntry) {
    const ps = get(projectStore)
    const isActive = ps.activeSongId === entry.id

    const { errors } = await finalizeStemJobToSong({
      projectFolderHandle,
      entry,
      jobId: job.jobId,
      files: job.files,
    })

    if (errors.length > 0) {
      folderError = errors[0] ?? null
    }

    // The shared finalizer wrote .smap on disk + refreshed metadataByFolder.
    // If this song is also loaded into the live editor stores, mirror the
    // change into songMap so the UI doesn't lag behind disk.
    if (isActive) {
      const fresh = get(projectStore).metadataByFolder[entry.folder]
      if (fresh?.stemRefs) {
        patchSongMap((m) => ({
          ...m,
          stemRefs: { ...m.stemRefs, ...fresh.stemRefs },
        }))
      }
    }

    // Drop the now-finalized job from the local store so the UI returns to idle.
    removeJob(job.jobId)

    // If this panel is still mounted, refresh the visible folder listing.
    await refreshFolderListing()
    await autoResolveStemRefs()
  }

  // ── Ableton .als export (per song) ─────────────────────────────────────────

  let exportStatus = $state<'idle' | 'generating' | 'done' | 'error'>('idle')
  let exportMsg = $state('')

  async function exportAls() {
    const sm = get(songMap)
    if (!sm) {
      exportStatus = 'error'
      exportMsg = 'Song not loaded'
      return
    }
    if (!songFolderHandle) {
      exportStatus = 'error'
      exportMsg = 'Song folder not bound'
      return
    }
    exportStatus = 'generating'
    exportMsg = 'Building .als…'
    try {
      const stemClips = new Map<string, StemClip>()
      for (const [name, s] of stems) stemClips.set(name, s.clip)
      const xml = generateAbletonSetXml(sm, { title: sm.metadata.title, stems: stemClips })
      const blob = await gzipString(xml)
      await ensureAbletonProjectFolder(songFolderHandle)
      await writeFileToHandle(songFolderHandle, SONG_ALS_FILENAME, blob)
      exportStatus = 'done'
      exportMsg = `Saved ${SONG_ALS_FILENAME}`
    } catch (e) {
      exportStatus = 'error'
      exportMsg = e instanceof Error ? e.message : 'Export failed'
    }
  }
</script>

<div class="border-foreground/30 bg-muted/20 border-t-2 px-4 py-4 space-y-4">
  {#if !isThisSongActive}
    <p class="text-muted-foreground text-sm">Loading song…</p>
  {:else}
    {#if folderError}
      <p class="text-destructive text-xs" role="status">{folderError}</p>
    {/if}

    <StemSplitter
      songId={entry.id}
      audioFile={$audioSession.file}
      folderHandle={songFolderHandle}
      desktopReachable={$desktopCompanionStatus.reachable}
      finalizeJob={(j) => finalizeStemJob(j)}
    />

    <section class="border-foreground border-2 p-4 space-y-3">
      <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stems</h3>
      <StemSlotList
        folderHandle={songFolderHandle}
        {folderFiles}
        stemRefs={$songMap?.stemRefs}
        loaded={loadedForList}
        onAssign={assignStem}
        onRemove={removeStem}
      />
      {#if stems.size > 0}
        <p class="text-muted-foreground text-xs">{stems.size} of 5 stems loaded</p>
      {/if}
    </section>

    <section class="border-foreground border-2 p-4 space-y-2">
      <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ableton Live Export</h3>
      <div class="flex flex-wrap items-center gap-3">
        <Button class="" onclick={() => void exportAls()} disabled={exportStatus === 'generating'}>
          {exportStatus === 'generating' ? 'Generating…' : `Save ${SONG_ALS_FILENAME}`}
        </Button>
        {#if exportMsg}
          <p
            class="text-xs {exportStatus === 'error'
              ? 'text-destructive'
              : exportStatus === 'done'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'}"
            role="status"
          >
            {exportMsg}
          </p>
        {/if}
      </div>
    </section>
  {/if}
</div>
