<script lang="ts">
  /**
   * App menu: shadcn dropdowns (File / Edit / View) + debug JSON dialog.
   */
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu'
  import {
    downloadBlob,
    exportRestorableStateAsSmapBlob,
    parseImportedProjectFile,
    safeExportBasename,
  } from '$lib/songmap/persist'
  import { restorableSongState } from '$lib/songmap/session'
  import { audioSession } from '$lib/stores/audioSession'
  import { loadServerAutosave, saveServerAutosaveNow } from '$lib/client/serverAutosave'
  import { hydrateRestorableSong } from '$lib/stores/restorableSong'
  import { serverAutosaveStatus } from '$lib/stores/serverAutosaveStatus'
  import { songMap } from '$lib/stores/songMap'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Music from '@lucide/svelte/icons/music'

  let menuError = $state('')
  let importInput = $state<HTMLInputElement | undefined>()
  let debugOpen = $state(false)

  const debugJsonText = $derived.by(() => {
    const sm = $songMap
    const sess = $audioSession
    const payload = {
      songMap: sm,
      audioSession: {
        name: sess.name,
        startSec: sess.startSec,
        endSec: sess.endSec,
        file: sess.file
          ? {
              name: sess.file.name,
              size: sess.file.size,
              type: sess.file.type,
            }
          : null,
      },
    }
    return JSON.stringify(payload, null, 2)
  })

  async function onExportFull() {
    menuError = ''
    if (!browser) return
    const sm = get(songMap)
    if (!sm) {
      menuError = 'Nothing to export — open or import a song first.'
      return
    }
    const sess = get(audioSession)
    const state = restorableSongState(sm, sess.file, undefined)
    try {
      const blob = await exportRestorableStateAsSmapBlob(state)
      const name = `${safeExportBasename(sm.metadata.title)}.smap`
      downloadBlob(blob, name)
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'Export failed'
    }
  }

  async function onSaveToServer() {
    menuError = ''
    const r = await saveServerAutosaveNow()
    if (!r.ok) menuError = r.error ?? 'Server save failed'
  }

  async function onRestoreFromServer() {
    menuError = ''
    const r = await loadServerAutosave()
    if (!r.ok) {
      menuError = r.error ?? 'Restore failed'
      return
    }
    await goto('/edit')
  }

  async function onImportPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    menuError = ''
    const result = await parseImportedProjectFile(file)
    if (!result.ok) {
      menuError = result.error
      return
    }
    hydrateRestorableSong(result.state)
    await goto('/edit')
  }
</script>

<header
  class="border-foreground/10 bg-foreground/5 fixed top-0 right-0 left-0 z-50 flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-sm shadow-sm backdrop-blur-xl"
  aria-label="Application"
  data-app-menu
>
  <a
    href={$songMap && $audioSession.file ? '/edit' : '/'}
    class="text-foreground/95 hover:text-foreground flex shrink-0 items-center gap-2 rounded-lg py-1 pr-2 transition-colors"
    aria-label={$songMap && $audioSession.file ? 'BarBro — back to editor' : 'BarBro — import audio'}
  >
    <span
      class="border-foreground/15 bg-muted/30 text-violet-400/95 inline-flex size-8 items-center justify-center rounded-lg border shadow-sm"
      aria-hidden="true"
    >
      <Music class="size-4" strokeWidth={2} />
    </span>
    <span class="hidden font-semibold tracking-tight sm:inline">BarBro</span>
  </a>

  <div class="flex flex-1 flex-wrap items-center gap-1">
    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" class="h-8 gap-1 px-2.5" {...props}>
            File
            <ChevronDown class="size-3.5 opacity-60" aria-hidden="true" />
          </Button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[12rem]">
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            void onExportFull()
          }}
        >
          Export full state…
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            importInput?.click()
          }}
        >
          Import full state…
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            void onSaveToServer()
          }}
        >
          Save to server
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            void onRestoreFromServer()
          }}
        >
          Restore from server…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" class="h-8 gap-1 px-2.5" {...props}>
            Edit
            <ChevronDown class="size-3.5 opacity-60" aria-hidden="true" />
          </Button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[10rem]">
        <DropdownMenuItem class="cursor-not-allowed opacity-50" disabled>Undo</DropdownMenuItem>
        <DropdownMenuItem class="cursor-not-allowed opacity-50" disabled>Redo</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" class="h-8 gap-1 px-2.5" {...props}>
            View
            <ChevronDown class="size-3.5 opacity-60" aria-hidden="true" />
          </Button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[10rem]">
        <DropdownMenuItem class="cursor-not-allowed opacity-50" disabled>More tools later</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  <div class="ml-auto flex shrink-0 items-center gap-2">
    {#if $serverAutosaveStatus.enabled}
      <span class="text-muted-foreground hidden max-w-[10rem] truncate text-[10px] sm:inline" title="Anonymous session autosave (fingerprint + DB)">
        {#if $serverAutosaveStatus.saving}
          Saving…
        {:else if $serverAutosaveStatus.lastSavedAt}
          Saved {$serverAutosaveStatus.lastSavedAt.slice(11, 19)}
        {:else}
          Autosave on
        {/if}
      </span>
    {/if}
    <Button
      type="button"
      variant="outline"
      size="sm"
      class="h-8"
      onclick={() => {
        debugOpen = true
      }}
    >
      Debug JSON
    </Button>
  </div>

  {#if menuError}
    <p class="text-destructive w-full max-w-md truncate text-xs sm:w-auto" role="status">{menuError}</p>
  {/if}

  <input
    bind:this={importInput}
    type="file"
    class="sr-only"
    accept=".smap,.json,application/json"
    aria-label="Import song bundle"
    onchange={onImportPicked}
  />
</header>

<Dialog bind:open={debugOpen}>
  <DialogContent
    class="flex max-h-[85vh] w-full max-w-[min(56rem,calc(100%-2rem))] flex-col gap-3 p-4 sm:max-w-[min(56rem,calc(100%-2rem))]"
    showCloseButton={true}
  >
    <DialogHeader>
      <DialogTitle>App state (JSON)</DialogTitle>
      <DialogDescription>
        In-memory <code class="text-foreground/90">songMap</code> plus audio session metadata. Raw audio bytes are not
        included.
      </DialogDescription>
    </DialogHeader>
    <pre
      class="border-foreground/10 bg-muted/20 text-foreground/90 max-h-[min(60vh,32rem)] overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words"
    >{debugJsonText}</pre>
  </DialogContent>
</Dialog>
