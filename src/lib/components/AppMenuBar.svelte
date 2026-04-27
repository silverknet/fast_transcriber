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
  import { songMapToMusicXml } from '$lib/export/musicxml'
  import { renderLeadSheetPdf } from '$lib/export/pdfLeadSheet'
  import { hydrateRestorableSong } from '$lib/stores/restorableSong'
  import { serverAutosaveStatus } from '$lib/stores/serverAutosaveStatus'
  import { songMap } from '$lib/stores/songMap'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Cloud from '@lucide/svelte/icons/cloud'
  import Moon from '@lucide/svelte/icons/moon'
  import Music from '@lucide/svelte/icons/music'
  import Sun from '@lucide/svelte/icons/sun'

  let dark = $state(browser && document.documentElement.classList.contains('dark'))

  function toggleDarkMode() {
    dark = !dark
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('barbro-theme', dark ? 'dark' : 'light')
    } catch {}
  }

  if (browser) {
    try {
      const saved = localStorage.getItem('barbro-theme')
      if (saved === 'dark') {
        dark = true
        document.documentElement.classList.add('dark')
      } else if (saved === 'light') {
        dark = false
        document.documentElement.classList.remove('dark')
      }
    } catch {}
  }

  let menuError = $state('')
  let importInput = $state<HTMLInputElement | undefined>()
  let debugOpen = $state(false)
  let cloudConnected = $derived($serverAutosaveStatus.enabled && !$serverAutosaveStatus.lastError)
  let lastCheckedLabel = $derived(
    $serverAutosaveStatus.lastCheckedAt ? $serverAutosaveStatus.lastCheckedAt.slice(11, 19) : '--:--:--',
  )
  let lastSavedLabel = $derived(
    $serverAutosaveStatus.lastSavedAt ? $serverAutosaveStatus.lastSavedAt.slice(11, 19) : '--:--:--',
  )
  let cloudStatusTitle = $derived.by(() => {
    if ($serverAutosaveStatus.saving) return 'Cloud: saving...'
    if (cloudConnected) return 'Cloud: connected'
    return `Cloud: disconnected${$serverAutosaveStatus.lastError ? ` (${$serverAutosaveStatus.lastError})` : ''}`
  })

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

  async function onExportMusicXml() {
    menuError = ''
    if (!browser) return
    const sm = get(songMap)
    if (!sm) {
      menuError = 'Nothing to export — open or import a song first.'
      return
    }
    try {
      const xml = songMapToMusicXml(sm)
      const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' })
      const name = `${safeExportBasename(sm.metadata.title)}.musicxml`
      downloadBlob(blob, name)
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'MusicXML export failed'
    }
  }

  async function onExportPdf() {
    menuError = ''
    if (!browser) return
    const sm = get(songMap)
    if (!sm) {
      menuError = 'Nothing to export — open or import a song first.'
      return
    }
    try {
      const blob = await renderLeadSheetPdf(sm)
      const name = `${safeExportBasename(sm.metadata.title)}.pdf`
      downloadBlob(blob, name)
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'PDF export failed'
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
  class="bg-background border-foreground fixed top-0 right-0 left-0 z-50 flex flex-wrap items-center gap-2 border-b-2 px-3 py-1.5 text-sm"
  aria-label="Application"
  data-app-menu
>
  <a
    href={$songMap && $audioSession.file ? '/edit' : '/'}
    class="text-foreground hover:text-foreground flex shrink-0 items-center gap-2 py-1 pr-2 transition-colors"
    aria-label={$songMap && $audioSession.file ? 'BarBro — back to editor' : 'BarBro — import audio'}
  >
    <span
      class="bg-muted text-foreground inline-flex size-8 items-center justify-center border-2 border-foreground"
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
          Save project (.smap)…
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            void onExportMusicXml()
          }}
        >
          Export as lead sheet (.musicxml)…
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            void onExportPdf()
          }}
        >
          Export as PDF…
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            importInput?.click()
          }}
        >
          Open project…
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            void onSaveToServer()
          }}
        >
          Save to cloud
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer"
          onclick={() => {
            void onRestoreFromServer()
          }}
        >
          Load from cloud…
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
        <DropdownMenuItem class="cursor-not-allowed opacity-50" disabled>Undo (coming soon)</DropdownMenuItem>
        <DropdownMenuItem class="cursor-not-allowed opacity-50" disabled>Redo (coming soon)</DropdownMenuItem>
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
        <DropdownMenuItem class="cursor-not-allowed opacity-50" disabled>Zoom controls (coming soon)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  <div class="ml-auto flex shrink-0 items-center gap-2">
    <span
      class="inline-flex size-8 items-center justify-center border-2 {cloudConnected
        ? 'border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200'
        : 'border-rose-600 bg-rose-100 text-rose-800 dark:border-rose-300 dark:bg-rose-950 dark:text-rose-200'} {$serverAutosaveStatus.saving
        ? 'animate-pulse'
        : ''}"
      title={cloudStatusTitle}
      aria-label={cloudStatusTitle}
    >
      <Cloud class="size-4" aria-hidden="true" />
    </span>
    <span
      class="text-muted-foreground hidden max-w-[14rem] truncate font-mono text-[10px] tabular-nums sm:inline"
      title="Cloud check and latest autosave time"
    >
      chk {lastCheckedLabel} · save {lastSavedLabel}
    </span>
    <Button
      type="button"
      variant="outline"
      size="icon"
      class="size-8"
      onclick={toggleDarkMode}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {#if dark}
        <Sun class="size-4" />
      {:else}
        <Moon class="size-4" />
      {/if}
    </Button>
    <Button
      type="button"
      variant="outline"
      size="sm"
      class="h-8"
      onclick={() => {
        debugOpen = true
      }}
    >
      Inspect JSON
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
      <DialogTitle>Project JSON</DialogTitle>
      <DialogDescription>
        Live song map and audio session metadata. Audio bytes are not shown here.
      </DialogDescription>
    </DialogHeader>
    <pre
      class="border-foreground/10 bg-muted/20 text-foreground/90 max-h-[min(60vh,32rem)] overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words"
    >{debugJsonText}</pre>
  </DialogContent>
</Dialog>
