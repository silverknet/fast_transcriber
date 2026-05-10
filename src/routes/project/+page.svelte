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
  import ProjectSongRow from '$lib/components/ProjectSongRow.svelte'
  import RemoveSongDialog from '$lib/components/RemoveSongDialog.svelte'
  import CopyFromCloudDialog from '$lib/components/CopyFromCloudDialog.svelte'
  import { Cloud, ListPlus, Plus } from '@lucide/svelte'
  import {
    importSmapToProject,
    loadProjectSongIntoEditor,
    metadataLiteFromSongMap,
    moveProjectSong,
    PROJECT_HANDLE_KEY,
    removeSongFromProject,
    renameProject,
    setSongHidden,
    tryRestoreActiveProject,
  } from '$lib/project/commit'
  import { loadFolderHandle } from '$lib/client/folderHandle'
  import { project } from '$lib/stores/project'
  import { readSmapJsonOnly } from '$lib/songmap/persist'
  import type { ProjectSongEntry } from '$lib/project/types'

  let restoring = $state(true)
  let restoreError = $state('')
  let actionError = $state('')
  let renameInput = $state('')

  let removeDialogOpen = $state(false)
  let removeTarget = $state<{ id: string; title: string } | null>(null)

  let smapImportInput = $state<HTMLInputElement | undefined>()
  let copyFromCloudOpen = $state(false)

  $effect(() => {
    if ($project.data) renameInput = $project.data.name
  })

  onMount(() => {
    if (!browser) return
    void (async () => {
      try {
        if ($project.data && $project.folderHandle) {
          // Already loaded — use as-is.
          return
        }
        const handle = await loadFolderHandle(PROJECT_HANDLE_KEY)
        const data = await tryRestoreActiveProject(handle)
        if (!data) {
          restoreError = 'No active project. Use File → Open Project to pick one.'
        }
      } catch (e) {
        restoreError = e instanceof Error ? e.message : 'Failed to restore project.'
      } finally {
        restoring = false
      }
    })()
  })

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
      // Need the full bytes (including audio chunk) — but readSmapJsonOnly
      // already validated structure. Pass the raw bytes through to the
      // project so the audio chunk is preserved.
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
      <p class="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Project</p>
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
      <p class="text-muted-foreground mt-2 text-xs">
        {songs.length} song{songs.length === 1 ? '' : 's'}
      </p>
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
          <ProjectSongRow
            {entry}
            metadata={$project.metadataByFolder[entry.folder]}
            canMoveUp={index > 0}
            canMoveDown={index < songs.length - 1}
            onMoveUp={() => void onMoveSong(entry, -1)}
            onMoveDown={() => void onMoveSong(entry, 1)}
            onEdit={() => void onEditSong(entry.id)}
            onToggleHidden={() => void onToggleHidden(entry)}
            onRemove={() => askRemove(entry)}
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

<CopyFromCloudDialog bind:open={copyFromCloudOpen} />
