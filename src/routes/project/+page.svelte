<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { Button } from '$lib/components/ui/button'
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu'
  import ProjectSongCard from '$lib/components/ProjectSongCard.svelte'
  import RemoveSongDialog from '$lib/components/RemoveSongDialog.svelte'
  import ExportBackingTrackDialog from '$lib/components/ExportBackingTrackDialog.svelte'
  import SetlistExportDialog from '$lib/components/SetlistExportDialog.svelte'
  import StemsDialog from '$lib/components/StemsDialog.svelte'
  import { ListPlus, Plus, RefreshCw, Music4 } from '@lucide/svelte'
  import {
    exportProjectSetAls,
    preflightProjectSetlist,
    type SetlistPreflightStatus,
  } from '$lib/export/setlist'
  import { safeExportBasename } from '$lib/songmap/persist'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import {
    importSmapToProject,
    loadProjectSongIntoEditor,
    metadataLiteFromSongMap,
    refreshProjectInfo,
    removeSongFromProject,
    renameProject,
    setSongHidden,
    setSongOrder,
    tryRestoreLastProject,
  } from '$lib/project/commit'
  import { dndzone } from 'svelte-dnd-action'
  import { STEM_TRACKS } from '$lib/export/abletonSet'
  import { listJobsViaDesktop } from '$lib/client/desktopBridge'
  import { hydrateFromSidecar } from '$lib/stores/stemJobs'
  import { project } from '$lib/stores/project'
  import { readSmapJsonOnly } from '$lib/songmap/persist'
  import { songMap } from '$lib/stores/songMap'
  import type { ProjectSongEntry } from '$lib/project/types'

  let restoring = $state(true)
  let restoreError = $state('')
  let actionError = $state('')
  let renameInput = $state('')

  let removeDialogOpen = $state(false)
  let removeTarget = $state<{ id: string; title: string } | null>(null)

  let exportDialogOpen = $state(false)
  let exportTarget = $state<{ folder: string; title: string } | null>(null)

  let stemsDialogOpen = $state(false)
  let stemsTarget = $state<ProjectSongEntry | null>(null)

  let smapImportInput = $state<HTMLInputElement | undefined>()

  /** Refresh button state. */
  let refreshing = $state(false)
  let refreshMsg = $state('')
  let refreshMsgTitle = $state('')

  /** Setlist .als export state. */
  let setlistExportStatus = $state<'idle' | 'preflight' | 'generating' | 'done' | 'error'>('idle')
  let setlistExportMsg = $state('')
  let setlistPreflight = $state<SetlistPreflightStatus | null>(null)
  let setlistExportOpen = $state(false)

  function openSetlistExport() {
    const proj = $project.data
    if (!proj) return
    setlistExportMsg = ''
    setlistPreflight = preflightProjectSetlist(proj, $project.metadataByFolder)
    setlistExportStatus = 'preflight'
    setlistExportOpen = true
  }

  async function runSetlistExport() {
    const proj = $project.data
    const osPath = $project.osPath
    if (!proj || !osPath) {
      setlistExportStatus = 'error'
      setlistExportMsg = 'Project path unavailable.'
      return
    }
    setlistExportStatus = 'generating'
    setlistExportMsg = 'Building setlist .als…'
    const filename = `${safeExportBasename(proj.name)}.als`
    const res = await exportProjectSetAls({
      projectPath: osPath,
      project: proj,
      metadataByFolder: $project.metadataByFolder,
      filename,
    })
    if (res.ok) {
      setlistExportStatus = 'done'
      setlistExportMsg = `Wrote ${filename} (${(res.alsBytes / 1024).toFixed(1)} KB) to the project folder.`
    } else {
      setlistExportStatus = 'error'
      setlistExportMsg = res.error
    }
  }

  function closeSetlistExport() {
    if (setlistExportStatus === 'generating') return
    setlistExportOpen = false
  }

  async function onRefreshProject() {
    if (refreshing) return
    refreshing = true
    refreshMsg = ''
    refreshMsgTitle = ''
    try {
      const r = await refreshProjectInfo()
      if (r.errors.length > 0) {
        refreshMsg = `${r.updatedSongs} song(s) updated · ${r.errors.length} error(s)`
        refreshMsgTitle = r.errors.join('; ')
      } else if (r.updatedSongs === 0) {
        refreshMsg = 'Up to date'
        refreshMsgTitle = 'No new stem files detected in song folders.'
      } else {
        refreshMsg = `${r.updatedSongs} song(s) updated`
        refreshMsgTitle = `Re-scanned project folders for stems and metadata.`
      }
    } catch (e) {
      refreshMsg = 'Refresh failed'
      refreshMsgTitle = e instanceof Error ? e.message : 'Refresh failed'
    } finally {
      refreshing = false
    }
  }

  $effect(() => {
    if ($project.data) renameInput = $project.data.name
  })

  onMount(() => {
    if (!browser) return
    void (async () => {
      try {
        if (!$project.data || !$project.osPath) {
          const data = await tryRestoreLastProject()
          if (!data) {
            restoreError = 'No active project. Use File → Open Project to pick one.'
            return
          }
        } else {
          // Already loaded — pull fresh info so any stems that landed while
          // we were elsewhere appear right away.
          await refreshProjectInfo()
        }
        // Hydrate the in-flight sidecar jobs into the store so the active
        // job pill renders. We no longer need to "finalize" anything — the
        // sidecar wrote stems straight into the project folder, and
        // `refreshProjectInfo` above already mirrored those into the manifest.
        await hydrateSidecarJobs()
      } catch (e) {
        restoreError = e instanceof Error ? e.message : 'Failed to restore project.'
      } finally {
        restoring = false
      }
    })()
  })

  async function hydrateSidecarJobs() {
    const sidecarJobs = await listJobsViaDesktop()
    if (sidecarJobs.length > 0) hydrateFromSidecar(sidecarJobs)
  }

  function commitNameRename() {
    if (!$project.data) return
    const next = renameInput.trim()
    if (!next || next === $project.data.name) return
    void renameProject(next).catch((e) => {
      actionError = e instanceof Error ? e.message : 'Rename failed'
    })
  }

  async function onEditSong(songId: string) {
    actionError = ''
    try {
      await loadProjectSongIntoEditor(songId)
      await goto('/edit')
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Could not open song'
    }
  }

  async function onOpenStems(entry: ProjectSongEntry) {
    actionError = ''
    try {
      // Load the song so $songMap (and therefore audio.originalPath) reflects
      // this entry by the time StemsDialog renders the splitter.
      if ($project.activeSongId !== entry.id) {
        await loadProjectSongIntoEditor(entry.id)
      }
      stemsTarget = entry
      stemsDialogOpen = true
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Could not load song'
    }
  }

  /**
   * Local mirror of the project store's `songs` list that drag-and-drop can
   * mutate during a drag (`consider`) and on drop (`finalize`). When the
   * underlying store changes (refresh, add, remove) we re-sync — but never
   * mid-drag, since svelte-dnd-action owns the array during the gesture.
   */
  let dragSongs = $state<ProjectSongEntry[]>([])
  let isDragging = $state(false)
  $effect(() => {
    const next = $project.data?.songs ?? []
    if (isDragging) return // owned by the drag in flight
    dragSongs = [...next]
  })

  function onDndConsider(e: CustomEvent<{ items: ProjectSongEntry[] }>) {
    isDragging = true
    dragSongs = e.detail.items
  }

  async function onDndFinalize(e: CustomEvent<{ items: ProjectSongEntry[] }>) {
    dragSongs = e.detail.items
    actionError = ''
    // Keep `isDragging` true until the manifest write resolves. Otherwise the
    // sync $effect re-mirrors the store before our commit lands, briefly
    // reverting the list to its pre-drop order (the visual "snap-back" bug).
    try {
      await setSongOrder(dragSongs.map((s) => s.id))
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Reorder failed'
    } finally {
      isDragging = false
    }
  }

  async function onToggleHidden(entry: ProjectSongEntry) {
    actionError = ''
    try {
      await setSongHidden(entry.id, !entry.hidden)
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Hide toggle failed'
    }
  }

  function askRemove(entry: ProjectSongEntry) {
    const title = $project.metadataByFolder[entry.folder]?.title ?? entry.folder
    removeTarget = { id: entry.id, title }
    removeDialogOpen = true
  }

  async function askExport(entry: ProjectSongEntry) {
    const title = $project.metadataByFolder[entry.folder]?.title ?? entry.folder
    // Load the song into the editor so its SongMap is available for
    // synthesising the click track on the fly. Cheap if it's already active.
    if ($project.activeSongId !== entry.id) {
      try {
        await loadProjectSongIntoEditor(entry.id)
      } catch (e) {
        actionError = e instanceof Error ? e.message : 'Could not load song for export'
        return
      }
    }
    exportTarget = { folder: entry.folder, title }
    exportDialogOpen = true
  }

  async function onRemoveConfirmed(deleteFiles: boolean) {
    if (!removeTarget) return
    const id = removeTarget.id
    removeTarget = null
    actionError = ''
    try {
      const r = await removeSongFromProject(id, { deleteFiles })
      if (deleteFiles && !r.filesRemoved) {
        actionError = 'Song removed from project, but files could not be deleted from disk.'
      }
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Remove failed'
    }
  }

  function onAddCreateNew() {
    void goto('/?project=1')
  }

  function onAddImportLocal() {
    smapImportInput?.click()
  }

  async function onSmapPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    actionError = ''
    try {
      const sp = await readSmapJsonOnly(file)
      const meta = metadataLiteFromSongMap(sp.songMap)
      await importSmapToProject(file, meta)
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Import failed'
    }
  }

  let songs = $derived($project.data?.songs ?? [])
</script>

<main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
  {#if restoring}
    <p class="text-muted-foreground text-sm">Restoring project…</p>
  {:else if !$project.data}
    <div class="brutalist-shadow border-foreground bg-background border-2 p-6 text-center">
      <h1 class="mb-2 text-xl font-black">No project open</h1>
      <p class="text-muted-foreground mb-4 text-sm">{restoreError}</p>
      <div class="flex justify-center gap-3">
        <Button class="" onclick={() => goto('/')}>Single song mode</Button>
      </div>
    </div>
  {:else}
    <header class="border-foreground border-b-2 pb-4">
      <input
        type="text"
        class="border-foreground/0 bg-transparent w-full border-b-2 pb-1 text-3xl font-black tracking-tight focus:border-foreground focus:outline-none"
        placeholder="Untitled project"
        bind:value={renameInput}
        onblur={commitNameRename}
        onkeydown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
        }}
      />
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <p class="text-muted-foreground text-xs">
          {songs.length} song{songs.length === 1 ? '' : 's'}
        </p>
        <Button
          variant="outline"
          size="sm"
          class="ml-auto gap-1"
          disabled={refreshing}
          onclick={() => void onRefreshProject()}
          title="Re-scan every song folder for stems and metadata changes"
        >
          <RefreshCw class="size-3.5 {refreshing ? 'animate-spin' : ''}" aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {#if refreshMsg}
        <p class="text-muted-foreground mt-1 truncate text-xs" role="status" title={refreshMsgTitle || refreshMsg}>
          {refreshMsg}
        </p>
      {/if}
    </header>

    {#if actionError}
      <p class="text-destructive text-sm" role="status">{actionError}</p>
    {/if}

    {#if dragSongs.length === 0}
      <div class="border-foreground/40 border-2 border-dashed p-8 text-center">
        <p class="text-muted-foreground text-sm">No songs yet. Add the first one below.</p>
      </div>
    {:else}
      <div class="flex flex-col">
        <!--
          Sticky column header. Single-letter stem labels with full names in
          `title` for hover (the rows below are dots only, so the letter is
          enough to anchor the column visually).
        -->
        <div
          class="song-row-grid border-foreground bg-muted text-muted-foreground sticky top-0 z-10 h-8 items-center gap-2 border-2 px-2 text-[10px] font-semibold uppercase tracking-wider"
          role="row"
        >
          <span aria-hidden="true"></span>
          <span class="truncate text-center" title="Setlist position">#</span>
          <span class="truncate">Song</span>
          <span class="truncate">Key</span>
          <span class="truncate text-right">BPM</span>
          {#each STEM_TRACKS as t (t.name)}
            <span class="truncate text-center" title={t.name === 'FX' ? 'Other' : t.name}>
              {t.name === 'FX' ? 'O' : t.name.charAt(0)}
            </span>
          {/each}
          <span class="truncate text-center" title="Cue track">C</span>
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </div>

        <!--
          Drag-and-drop reorderable list. svelte-dnd-action uses `id` on each
          item by default, which ProjectSongEntry already provides. We mirror
          the store into `dragSongs` so the action can mutate it during the
          gesture; the commit happens in `onDndFinalize`.
        -->
        <ul
          use:dndzone={{ items: dragSongs, flipDurationMs: 260, dropTargetStyle: {} }}
          onconsider={(e) => onDndConsider(e as CustomEvent<{ items: ProjectSongEntry[] }>)}
          onfinalize={(e) => onDndFinalize(e as CustomEvent<{ items: ProjectSongEntry[] }>)}
          class="mt-1 flex flex-col gap-1"
        >
          {#each dragSongs as entry, index (entry.id)}
            <ProjectSongCard
              {entry}
              position={index + 1}
              metadata={$project.metadataByFolder[entry.folder]}
              onEdit={() => void onEditSong(entry.id)}
              onOpenStems={() => void onOpenStems(entry)}
              onToggleHidden={() => void onToggleHidden(entry)}
              onRemove={() => askRemove(entry)}
              onExport={() => void askExport(entry)}
            />
          {/each}
        </ul>
      </div>
    {/if}

    <div class="border-foreground border-2 p-4">
      <DropdownMenu>
        <DropdownMenuTrigger>
          {#snippet child({ props })}
            <Button class="w-full gap-2" {...props}>
              <Plus class="size-4" aria-hidden="true" />
              Add song
            </Button>
          {/snippet}
        </DropdownMenuTrigger>
        <DropdownMenuContent class="min-w-[14rem]">
          <DropdownMenuItem class="cursor-pointer" onclick={onAddCreateNew}>
            <ListPlus class="mr-2 size-4" aria-hidden="true" />
            Create new song
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer" onclick={onAddImportLocal}>
            Import local .smap…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    {#if songs.length > 0}
      <div class="border-foreground/40 flex items-center gap-3 border-2 border-dashed px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold">Setlist · Ableton Live 12</p>
          <p class="text-muted-foreground text-[11px]">
            One .als with a scene per song. Click track is re-rendered fresh on every export.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0 gap-1"
          disabled={!$desktopCompanionStatus.reachable}
          onclick={openSetlistExport}
          title={!$desktopCompanionStatus.reachable
            ? 'Setlist export needs the BarBro desktop client running.'
            : 'Open the export dialog'}
        >
          <Music4 class="size-3.5" aria-hidden="true" />
          Export .als
        </Button>
      </div>
    {/if}

    <input
      bind:this={smapImportInput}
      type="file"
      class="sr-only"
      accept=".smap"
      onchange={onSmapPicked}
    />
  {/if}
</main>

<RemoveSongDialog
  bind:open={removeDialogOpen}
  songTitle={removeTarget?.title ?? ''}
  onConfirm={onRemoveConfirmed}
/>

<ExportBackingTrackDialog
  bind:open={exportDialogOpen}
  projectPath={$project.osPath}
  songFolder={exportTarget?.folder ?? null}
  songTitle={exportTarget?.title ?? ''}
  metadata={exportTarget ? $project.metadataByFolder[exportTarget.folder] : undefined}
  songMap={$songMap}
/>

<StemsDialog bind:open={stemsDialogOpen} entry={stemsTarget} />

<SetlistExportDialog
  bind:open={setlistExportOpen}
  preflight={setlistPreflight}
  status={setlistExportStatus}
  message={setlistExportMsg}
  onConfirm={() => void runSetlistExport()}
  onClose={closeSetlistExport}
/>

<!--
  `:global` puts this class in the document's stylesheet so it stays in scope
  for the dragged-row shadow that `svelte-dnd-action` lifts out of the dndzone
  (the shadow's CSS-variable inheritance is lost when it's reparented under
  <body>). The header and every row share this template so columns line up
  even mid-drag.
    handle (24) | # (24) | title (1fr) | key (80) | bpm (40) | 5× stem (28) |
    cue (28) | edit (32) | ⋮ (32)
-->
<style>
  :global(.song-row-grid) {
    display: grid;
    grid-template-columns:
      1.5rem
      1.5rem
      minmax(0, 1fr)
      5rem
      2.5rem
      repeat(5, 1.75rem)
      1.75rem
      2rem
      2rem;
  }
</style>
