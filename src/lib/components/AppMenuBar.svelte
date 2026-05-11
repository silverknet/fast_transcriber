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
  import { saveServerAutosaveNow } from '$lib/client/serverAutosave'
  import {
    getCurrentProject,
    saveCloudProject,
  } from '$lib/client/projectsCloud'
  import LoadProjectDialog from '$lib/components/LoadProjectDialog.svelte'
  import { songMapToMusicXml } from '$lib/export/musicxml'
  import { renderLeadSheetPdf } from '$lib/export/pdfLeadSheet'
  import { hydrateRestorableSong } from '$lib/stores/restorableSong'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { serverAutosaveStatus } from '$lib/stores/serverAutosaveStatus'
  import { songMap } from '$lib/stores/songMap'
  import {
    project as projectStore,
    closeProject,
    markEditingStandalone,
  } from '$lib/stores/project'
  import {
    createProjectOnDisk,
    openProjectFromHandle,
  } from '$lib/project/commit'
  import { clearFullAppSongState } from '$lib/stores/restorableSong'
  import {
    clearFolderHandle,
    ensurePermission,
    forgetRecentProject,
    listRecentProjects,
    type RecentProjectEntry,
  } from '$lib/client/folderHandle'
  import { PROJECT_HANDLE_KEY } from '$lib/project/commit'
  import { onMount } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Cloud from '@lucide/svelte/icons/cloud'
  import Monitor from '@lucide/svelte/icons/monitor'
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
  let loadProjectDialogOpen = $state(false)
  let importInput = $state<HTMLInputElement | undefined>()
  let debugOpen = $state(false)
  let cloudConnected = $derived($serverAutosaveStatus.enabled && !$serverAutosaveStatus.lastError)
  let lastCheckedLabel = $derived(
    $serverAutosaveStatus.lastCheckedAt ? $serverAutosaveStatus.lastCheckedAt.slice(11, 19) : '--:--:--',
  )
  let lastSavedLabel = $derived(
    $serverAutosaveStatus.lastSavedAt ? $serverAutosaveStatus.lastSavedAt.slice(11, 19) : '--:--:--',
  )
  let currentProjectName = $derived.by(() => {
    if (!browser) return null
    try {
      const raw = localStorage.getItem('barbro_current_project')
      if (!raw) return null
      return (JSON.parse(raw) as { name?: string }).name ?? null
    } catch {
      return null
    }
  })

  let cloudStatusTitle = $derived.by(() => {
    const times = ` · checked ${lastCheckedLabel} · saved ${lastSavedLabel}`
    if ($serverAutosaveStatus.saving) return `Cloud: saving…${times}`
    if (cloudConnected) return `Cloud: connected${times}`
    return `Cloud: disconnected${$serverAutosaveStatus.lastError ? ` (${$serverAutosaveStatus.lastError})` : ''}${times}`
  })

  let desktopConnected = $derived($desktopCompanionStatus.reachable)
  let desktopCheckedLabel = $derived(
    $desktopCompanionStatus.lastCheckedAt ? $desktopCompanionStatus.lastCheckedAt.slice(11, 19) : '--:--:--',
  )
  let desktopStatusTitle = $derived.by(() => {
    const ping = ` · ping ${desktopCheckedLabel}`
    if (desktopConnected) {
      const v = $desktopCompanionStatus.version
      return v ? `Desktop app: connected (v${v})${ping}` : `Desktop app: connected${ping}`
    }
    return `Desktop app: not running${$desktopCompanionStatus.lastError ? ` (${$desktopCompanionStatus.lastError})` : ''}${ping}`
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
    const current = getCurrentProject()
    const r = await saveCloudProject(current?.id)
    if (!r.ok) menuError = r.error ?? 'Cloud save failed'
  }

  function onRestoreFromServer() {
    menuError = ''
    loadProjectDialogOpen = true
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
    // Loading a standalone .smap clears any project-song editing context.
    markEditingStandalone()
    await goto('/edit')
  }

  // ── Project actions ───────────────────────────────────────────────────────
  const hasFsApi = browser && typeof (window as any).showDirectoryPicker === 'function'

  async function onNewProject() {
    menuError = ''
    if (!hasFsApi) {
      menuError = 'New Project needs a Chromium browser (File System Access API).'
      return
    }
    let parent: FileSystemDirectoryHandle
    try {
      parent = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
    } catch {
      return
    }
    const name = window.prompt(
      `Project name (a new folder will be created inside "${parent.name}"):`,
      'Untitled Project',
    )
    if (name === null) return
    try {
      await createProjectOnDisk(parent, name)
      await refreshRecents()
      await goto('/project')
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'Could not create project'
    }
  }

  async function onOpenProject() {
    menuError = ''
    if (!hasFsApi) {
      menuError = 'Open Project needs a Chromium browser (File System Access API).'
      return
    }
    let dir: FileSystemDirectoryHandle
    try {
      dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
    } catch {
      return
    }
    try {
      await openProjectFromHandle(dir)
      await refreshRecents()
      await goto('/project')
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'Could not open project'
    }
  }

  async function onBackToProject() {
    await goto('/project')
  }

  // ── Recent projects ───────────────────────────────────────────────────────
  let recentProjects = $state<RecentProjectEntry[]>([])

  async function refreshRecents() {
    if (!browser) return
    try {
      recentProjects = await listRecentProjects()
    } catch {
      recentProjects = []
    }
  }

  async function onOpenRecent(entry: RecentProjectEntry) {
    menuError = ''
    try {
      const granted = await ensurePermission(entry.handle)
      if (!granted) {
        menuError = `Permission denied for "${entry.name}". Pick the folder again via Open Project.`
        return
      }
      await openProjectFromHandle(entry.handle)
      await refreshRecents()
      await goto('/project')
    } catch (e) {
      // Stale handle / folder gone — drop from recents and surface the error.
      await forgetRecentProject(entry.id).catch(() => {})
      await refreshRecents()
      menuError = e instanceof Error ? e.message : `Could not open "${entry.name}"`
    }
  }

  function formatRecentAge(iso: string): string {
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const diffSec = Math.max(0, (Date.now() - t) / 1000)
    if (diffSec < 60) return 'just now'
    const min = Math.floor(diffSec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const days = Math.floor(hr / 24)
    if (days < 7) return `${days}d ago`
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  onMount(() => {
    void refreshRecents()
  })

  /** Project open on disk (manifest + folder handle). */
  let isInProjectMode = $derived($projectStore.data !== null)

  /**
   * Logo target: in project mode the project view is home; otherwise fall
   * back to the song editor if a song's loaded, else the import page.
   */
  let logoHref = $derived(
    isInProjectMode ? '/project' : $songMap && $audioSession.file ? '/edit' : '/',
  )
  let logoAria = $derived(
    isInProjectMode
      ? `BarBro — back to project ${$projectStore.data?.name ?? ''}`
      : $songMap && $audioSession.file
        ? 'BarBro — back to editor'
        : 'BarBro — import audio',
  )

  async function onCloseProject() {
    menuError = ''
    closeProject()
    // Drop any song that was loaded via the project so the user starts
    // fresh on / rather than ambiguously in /edit pointing at a project song.
    clearFullAppSongState()
    // Forget the IDB-saved active-project handle so a reload doesn't put
    // the user back into the project they just exited. The Recent Projects
    // list survives — re-entering is one click away.
    await clearFolderHandle(PROJECT_HANDLE_KEY)
    await goto('/', { replaceState: true })
  }
</script>

<header
  class="bg-background border-foreground fixed top-0 right-0 left-0 z-50 flex flex-wrap items-center gap-2 border-b-2 px-3 py-1.5 text-sm"
  aria-label="Application"
  data-app-menu
>
  <a
    href={logoHref}
    class="text-foreground hover:text-foreground flex shrink-0 items-center gap-2 py-1 pr-2 transition-colors"
    aria-label={logoAria}
  >
    <span
      class="bg-muted text-foreground inline-flex size-8 items-center justify-center border-2 border-foreground"
      aria-hidden="true"
    >
      <Music class="size-4" strokeWidth={2} />
    </span>
    <span class="hidden font-semibold tracking-tight sm:inline">BarBro</span>
  </a>

  <div class="flex flex-1 flex-wrap items-center gap-1.5">
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
        {#if isInProjectMode}
          <!-- In project mode: project actions are the focus; standalone-only
               flows (Open Song, Load from cloud) would conflict with the
               project's setlist and are hidden until the user Close Projects. -->
          <DropdownMenuItem class="cursor-pointer" onclick={onBackToProject}>
            Back to Project
          </DropdownMenuItem>
          <DropdownMenuItem
            class="cursor-pointer"
            onclick={() => {
              void onExportFull()
            }}
          >
            Save current song (.smap)…
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
          <div class="bg-foreground/15 my-1 h-px" role="separator"></div>
          <DropdownMenuItem
            class="cursor-pointer"
            onclick={() => {
              void onSaveToServer()
            }}
          >
            {currentProjectName ? `Save to cloud — "${currentProjectName}"` : 'Save current song to cloud'}
          </DropdownMenuItem>
          <div class="bg-foreground/15 my-1 h-px" role="separator"></div>
          <DropdownMenuItem class="cursor-pointer" onclick={() => void onCloseProject()}>
            Close Project
          </DropdownMenuItem>
        {:else}
          <DropdownMenuItem
            class="cursor-pointer"
            onclick={() => {
              void onExportFull()
            }}
          >
            Save Song (.smap)…
          </DropdownMenuItem>
          <DropdownMenuItem
            class="cursor-pointer"
            onclick={() => {
              importInput?.click()
            }}
          >
            Open Song (.smap)…
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
          <div class="bg-foreground/15 my-1 h-px" role="separator"></div>
          <DropdownMenuItem class="cursor-pointer" onclick={onNewProject}>
            New Project…
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer" onclick={onOpenProject}>
            Open Project…
          </DropdownMenuItem>
          {#if recentProjects.length > 0}
            <div class="text-muted-foreground px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider">
              Recent
            </div>
            {#each recentProjects as r (r.id)}
              <DropdownMenuItem
                class="cursor-pointer"
                onclick={() => void onOpenRecent(r)}
              >
                <div class="flex w-full items-center justify-between gap-3">
                  <span class="truncate">{r.name}</span>
                  <span class="text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums">
                    {formatRecentAge(r.lastOpenedAt)}
                  </span>
                </div>
              </DropdownMenuItem>
            {/each}
          {/if}
          <div class="bg-foreground/15 my-1 h-px" role="separator"></div>
          <DropdownMenuItem
            class="cursor-pointer"
            onclick={() => {
              void onSaveToServer()
            }}
          >
            {currentProjectName ? `Save to cloud — "${currentProjectName}"` : 'Save to cloud'}
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer" onclick={onRestoreFromServer}>
            Load from cloud…
          </DropdownMenuItem>
        {/if}
        <DropdownMenuItem class="cursor-pointer" onclick={() => goto('/download')}>
          Download desktop app…
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
    <a
      href="/download"
      class="inline-flex size-8 items-center justify-center border-2 no-underline {desktopConnected
        ? 'border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200'
        : 'border-muted-foreground/50 bg-muted/40 text-muted-foreground hover:border-foreground/40 hover:bg-muted/60'}"
      title={desktopStatusTitle}
      aria-label={desktopStatusTitle}
    >
      <Monitor class="size-4" aria-hidden="true" />
    </a>
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
    {#if !isInProjectMode}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="h-8"
        onclick={() => goto('/set')}
        title="Experimental: export Ableton Live set"
      >
        Set ⚗
      </Button>
    {/if}
    {#if import.meta.env.DEV}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="h-8 opacity-50"
        onclick={() => goto('/analyzing?preview')}
      >
        ∿
      </Button>
      <Button type="button" variant="outline" size="sm" class="h-8 opacity-50" onclick={() => goto('/texttospeech')}>
        TTS
      </Button>
    {/if}
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

<LoadProjectDialog bind:open={loadProjectDialogOpen} />

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
