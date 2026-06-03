<script lang="ts">
  /**
   * "Stems" dialog: hosts the [`StemSplitter`](./StemSplitter.svelte) for the
   * currently loaded project song. Replaces the old expandable in-row panel
   * so it stops fighting drag-and-drop in the project list.
   *
   * Parent (`routes/project/+page.svelte`) loads the song into the editor
   * (`loadProjectSongIntoEditor`) before flipping `open` so `$songMap` is the
   * songMap for `entry.id` by the time we render the splitter.
   *
   * Audio path resolution: v2 songs store playable audio at
   * `<song>/<songMap.audio.originalPath>` (typically `audio/<filename>`).
   * The `.smap` itself no longer carries an audio chunk, so we must hand
   * the sidecar that file path — not the `.smap` path.
   *
   * Layout: the DialogHeader (with title + close button) stays fixed at the
   * top; the body scrolls inside a capped-height wrapper so the splitter's
   * progress + log can grow without spilling off the viewport.
   */
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import StemSplitter from '$lib/components/StemSplitter.svelte'
  import { STEM_PRESET_PRIORITY, type StemName } from '$lib/client/desktopBridge'
  import { refreshProjectInfo } from '$lib/project/commit'
  import type { ProjectSongEntry } from '$lib/project/types'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project as projectStore } from '$lib/stores/project'
  import { songMap } from '$lib/stores/songMap'

  const DEMUCS_STEMS: StemName[] = ['vocals', 'drums', 'bass', 'other']
  type PresetSlug = 'best' | 'balanced' | 'preview' | 'legacy'

  let {
    open = $bindable(false),
    entry,
  } = $props<{
    open: boolean
    /** Target song; null when the dialog is dormant. */
    entry: ProjectSongEntry | null
  }>()

  /** True when the global songMap store holds the song we were asked to render. */
  const isThisSongActive = $derived(
    !!entry &&
      $projectStore.editingMode === 'project-song' &&
      $projectStore.activeSongId === entry.id,
  )

  const projectOsPath = $derived($projectStore.osPath)
  const audioRel = $derived($songMap?.audio?.originalPath ?? null)

  /**
   * Absolute OS path to the playable audio file. v2 layout: `audio/<filename>`
   * under the song folder. Null until the song is loaded AND the SongMap
   * actually records an `audio.originalPath` (legacy / web-only smaps don't).
   */
  const inputPath = $derived(
    isThisSongActive && projectOsPath && entry && audioRel
      ? `${projectOsPath}/${entry.folder}/${audioRel}`
      : null,
  )
  const outputDir = $derived(
    projectOsPath && entry ? `${projectOsPath}/${entry.folder}/stems` : null,
  )
  const inputLabel = $derived($songMap?.audio?.fileName ?? audioRel ?? null)

  const songTitle = $derived(
    (entry && $projectStore.metadataByFolder[entry.folder]?.title) ||
      entry?.folder ||
      'song',
  )

  /**
   * For each Demucs stem, the highest-quality preset slug it currently exists
   * at on disk (or null if missing). Walks `stemsByPreset` in priority order
   * so the first hit wins.
   */
  const currentQualityByStem = $derived.by<Partial<Record<StemName, PresetSlug | null>>>(() => {
    const out: Partial<Record<StemName, PresetSlug>> = {}
    if (!entry) return out
    const sets = $projectStore.metadataByFolder[entry.folder]?.stemsByPreset
    if (!sets) return out
    for (const slug of STEM_PRESET_PRIORITY) {
      const files = sets[slug]
      if (!files) continue
      for (const filename of files) {
        const base = filename.toLowerCase().replace(/\.[^.]+$/, '')
        if (DEMUCS_STEMS.includes(base as StemName) && !out[base as StemName]) {
          out[base as StemName] = slug as PresetSlug
        }
      }
    }
    return out
  })

  async function onJobDone() {
    await refreshProjectInfo()
  }
</script>

<Dialog bind:open>
  <!--
    DialogContent renders fixed/centered. We cap its overall height to ~90vh
    and let an inner wrapper scroll — that way the title + close button stay
    pinned while a long progress log can scroll inside.
  -->
  <!--
    flex flex-col overrides DialogContent's default `grid`, so the inner body's
    `flex-1 min-h-0 overflow-y-auto` actually triggers scroll instead of the
    whole dialog growing to fit its children.
  -->
  <DialogContent class="max-w-xl max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0">
    <DialogHeader class="border-foreground/20 shrink-0 border-b px-4 pt-4 pb-3">
      <DialogTitle class="pr-8 truncate">Stems — {songTitle}</DialogTitle>
    </DialogHeader>

    <!--
      `overflow-x-hidden` (in addition to the per-fieldset `min-w-0` inside
      StemSplitter) is the belt against any stray un-truncated child trying
      to push the body wider than the dialog and producing an x scrollbar.
    -->
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">
      {#if !entry}
        <p class="text-muted-foreground text-sm">No song selected.</p>
      {:else if !isThisSongActive}
        <p class="text-muted-foreground text-sm">Loading song…</p>
      {:else if !projectOsPath || !$desktopCompanionStatus.reachable}
        <p class="text-amber-700 dark:text-amber-300 text-sm">
          Stems need the BarBro desktop client to be running. Start the desktop
          app to manage stems for this song.
        </p>
      {:else if !inputPath}
        <p class="text-amber-700 dark:text-amber-300 text-sm">
          This song's <code class="font-mono">.smap</code> doesn't reference a playable
          audio file on disk yet. Open the song in Edit and use the relink banner
          to point it at the source, then try again.
        </p>
      {:else}
        <StemSplitter
          songId={entry.id}
          {inputPath}
          {outputDir}
          {inputLabel}
          {currentQualityByStem}
          desktopReachable={$desktopCompanionStatus.reachable}
          finalizeJob={onJobDone}
          chromeless
        />
      {/if}
    </div>
  </DialogContent>
</Dialog>
