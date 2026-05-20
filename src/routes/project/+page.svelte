<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { get } from 'svelte/store'
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
  import CopyFromCloudDialog from '$lib/components/CopyFromCloudDialog.svelte'
  import { Cloud, ListPlus, Plus, RefreshCw } from '@lucide/svelte'
  import {
    importSmapToProject,
    loadProjectSongIntoEditor,
    metadataLiteFromSongMap,
    moveProjectSong,
    refreshProjectInfo,
    removeSongFromProject,
    renameProject,
    setSongHidden,
    tryRestoreLastProject,
  } from '$lib/project/commit'
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

  let smapImportInput = $state<HTMLInputElement | undefined>()
  let copyFromCloudOpen = $state(false)

  /** Single-song expansion: the id of the song whose Set panel is open. */
  let expandedSongId = $state<string | null>(null)

  /** Refresh button state. */
  let refreshing = $state(false)
  let refreshMsg = $state('')
  let refreshMsgTitle = $state('')

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
        // Songs are collapsed by default — the overview is the point of
        // this view. Only auto-expand when the URL says so.
        const url = get(page).url
        const wantExpand = url.searchParams.get('expand')
        const songs = $project.data?.songs ?? []
        if (wantExpand && songs.some((s) => s.id === wantExpand)) {
          expandedSongId = wantExpand
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

  async function onToggleExpand(songId: string) {
    actionError = ''
    if (expandedSongId === songId) {
      expandedSongId = null
      return
    }
    try {
      await loadProjectSongIntoEditor(songId)
      expandedSongId = songId
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Could not load song'
    }
  }

  async function onMoveSong(entry: ProjectSongEntry, delta: -1 | 1) {
    actionError = ''
    try {
      await moveProjectSong(entry.id, delta)
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Reorder failed'
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

  function onAddCloud() {
    actionError = ''
    copyFromCloudOpen = true
  }

  let songs = $derived($project.data?.songs ?? [])
</script>

<main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
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

    {#if songs.length === 0}
      <div class="border-foreground/40 border-2 border-dashed p-8 text-center">
        <p class="text-muted-foreground text-sm">No songs yet. Add the first one below.</p>
      </div>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each songs as entry, index (entry.id)}
          <ProjectSongCard
            {entry}
            metadata={$project.metadataByFolder[entry.folder]}
            canMoveUp={index > 0}
            canMoveDown={index < songs.length - 1}
            isExpanded={expandedSongId === entry.id}
            onToggleExpand={() => void onToggleExpand(entry.id)}
            onMoveUp={() => void onMoveSong(entry, -1)}
            onMoveDown={() => void onMoveSong(entry, 1)}
            onEdit={() => void onEditSong(entry.id)}
            onToggleHidden={() => void onToggleHidden(entry)}
            onRemove={() => askRemove(entry)}
            onExport={() => void askExport(entry)}
          />
        {/each}
      </ul>
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
          <DropdownMenuItem class="cursor-pointer" onclick={onAddCloud}>
            <Cloud class="mr-2 size-4" aria-hidden="true" />
            Copy from cloud…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

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

<CopyFromCloudDialog bind:open={copyFromCloudOpen} />
