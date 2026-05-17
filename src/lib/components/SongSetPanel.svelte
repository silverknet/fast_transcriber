<script lang="ts">
  /**
   * Per-song "Set" panel rendered inside an expanded `ProjectSongCard`.
   *
   * Assumes the parent already called `loadProjectSongIntoEditor(entry.id)`
   * so the global `songMap` / `audioSession` stores hold this song.
   *
   * Stems flow: the desktop sidecar reads `<projectPath>/<songFolder>/song.smap`
   * and writes results into `<projectPath>/<songFolder>/stems/`. No audio bytes
   * cross HTTP. The web side just hands the sidecar the two paths via
   * [`StemSplitter`](./StemSplitter.svelte) and refreshes project info on done.
   *
   * The previous folder-handle-based slot-binding UI and inline `.als` export
   * were moved out of this panel as part of the v2 sidecar-mediated refactor;
   * they will return via dedicated sidecar endpoints in a follow-up.
   */
  import { STEM_TRACKS } from '$lib/export/abletonSet'
  import StemSplitter from '$lib/components/StemSplitter.svelte'
  import { refreshProjectInfo, SONG_SMAP_FILENAME } from '$lib/project/commit'
  import type { ProjectSongEntry } from '$lib/project/types'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project as projectStore } from '$lib/stores/project'
  import { songMap } from '$lib/stores/songMap'

  let { entry } = $props<{ entry: ProjectSongEntry }>()

  /** This panel only renders when the parent says this song is the active one. */
  let isThisSongActive = $derived(
    $projectStore.editingMode === 'project-song' && $projectStore.activeSongId === entry.id,
  )

  const projectOsPath = $derived($projectStore.osPath)

  const inputPath = $derived(
    projectOsPath ? `${projectOsPath}/${entry.folder}/${SONG_SMAP_FILENAME}` : null,
  )
  const outputDir = $derived(
    projectOsPath ? `${projectOsPath}/${entry.folder}/stems` : null,
  )
  const inputLabel = $derived(
    $songMap?.metadata.title ? `${$songMap.metadata.title}.smap` : SONG_SMAP_FILENAME,
  )

  /** Stem status badges from the metadata cache (updated by refreshProjectInfo). */
  type StemStatus = { name: string; present: boolean }
  const stemBadges = $derived<StemStatus[]>(
    STEM_TRACKS.map((t) => {
      const refs = $projectStore.metadataByFolder[entry.folder]?.stemRefs ?? {}
      return { name: t.name, present: !!refs[t.name] }
    }),
  )

  /**
   * Called when the sidecar emits `done` for a stems job. Re-pull project
   * info so the badges and song.smap stemRefs reflect what's actually on
   * disk now.
   */
  async function onJobDone() {
    await refreshProjectInfo()
  }
</script>

<div class="border-foreground/30 bg-muted/20 border-t-2 px-4 py-4 space-y-4">
  {#if !isThisSongActive}
    <p class="text-muted-foreground text-sm">Loading song…</p>
  {:else if !projectOsPath || !$desktopCompanionStatus.reachable}
    <p class="text-amber-700 dark:text-amber-300 text-sm">
      Stems need the BarBro desktop client to be running. Start the desktop app to manage stems for this song.
    </p>
  {:else}
    <StemSplitter
      songId={entry.id}
      {inputPath}
      {outputDir}
      {inputLabel}
      desktopReachable={$desktopCompanionStatus.reachable}
      finalizeJob={onJobDone}
    />

    <section class="border-foreground border-2 p-4 space-y-2">
      <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stem status</h3>
      <ul class="flex flex-wrap gap-x-3 gap-y-1.5 text-xs font-mono">
        {#each stemBadges as b (b.name)}
          <li class="inline-flex items-center gap-1.5">
            <span
              class="size-1.5 shrink-0 rounded-full {b.present ? 'bg-emerald-500' : 'bg-foreground/20'}"
              aria-hidden="true"
            ></span>
            <span class:text-muted-foreground={!b.present}>{b.name}</span>
          </li>
        {/each}
      </ul>
      <p class="text-muted-foreground text-[11px]">
        Stems are written by the desktop client into <code class="font-mono">{entry.folder}/stems/</code>.
        Run the splitter above or drop WAV files in the folder manually, then hit Refresh on the project page.
      </p>
    </section>
  {/if}
</div>
