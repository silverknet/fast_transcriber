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
  import { songMapToMusicXml } from '$lib/export/musicxml'
  import { renderLeadSheetPdf } from '$lib/export/pdfLeadSheet'
  import { hydrateRestorableSong } from '$lib/stores/restorableSong'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { songMap } from '$lib/stores/songMap'
  import {
    project as projectStore,
    closeProject,
    markEditingStandalone,
  } from '$lib/stores/project'
  import {
    clearLastProjectPath,
    createProjectOnDisk,
    dropRecentProjectPath,
    openProjectByPath,
    readRecentProjectPaths,
  } from '$lib/project/commit'
  import { pickFolderViaDesktop } from '$lib/client/desktopBridge'
  import { clearFullAppSongState } from '$lib/stores/restorableSong'
  import { onMount } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import LogIn from '@lucide/svelte/icons/log-in'
  import Monitor from '@lucide/svelte/icons/monitor'
  import Moon from '@lucide/svelte/icons/moon'
  import Music from '@lucide/svelte/icons/music'
  import Sun from '@lucide/svelte/icons/sun'
  import { userStore } from '$lib/stores/user'

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

  /**
   * Project mode is desktop-only. The sidecar's native picker returns the
   * absolute OS path, and that path is the project's canonical identity —
   * the web app never touches the filesystem directly for project I/O.
   */
  async function onNewProject() {
    menuError = ''
    if (!$desktopCompanionStatus.reachable) {
      menuError = 'Desktop client unreachable — install/start BarBro desktop to manage projects.'
      return
    }
    const pick = await pickFolderViaDesktop({
      title: 'Pick the folder that will contain the new project',
    })
    if (!pick.ok) {
      if ('cancelled' in pick) return
      menuError = pick.error ?? 'Could not open picker'
      return
    }
    const name = window.prompt(
      `Project name (a new folder will be created inside the chosen location):`,
      'Untitled Project',
    )
    if (name === null) return
    try {
      await createProjectOnDisk(pick.path, name)
      refreshRecents()
      await goto('/project')
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'Could not create project'
    }
  }

  async function onOpenProject() {
    menuError = ''
    if (!$desktopCompanionStatus.reachable) {
      menuError = 'Desktop client unreachable — install/start BarBro desktop to manage projects.'
      return
    }
    const pick = await pickFolderViaDesktop({ title: 'Open a BarBro project folder' })
    if (!pick.ok) {
      if ('cancelled' in pick) return
      menuError = pick.error ?? 'Could not open picker'
      return
    }
    try {
      await openProjectByPath(pick.path)
      refreshRecents()
      await goto('/project')
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'Could not open project'
    }
  }

  async function onBackToProject() {
    await goto('/project')
  }

  // ── Recent projects ───────────────────────────────────────────────────────

  type RecentEntry = { path: string; label: string }

  let recentProjects = $state<RecentEntry[]>([])

  function pathLabel(p: string): string {
    const ix = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
    return ix === -1 ? p : p.slice(ix + 1)
  }

  function refreshRecents() {
    if (!browser) return
    recentProjects = readRecentProjectPaths().map((p) => ({ path: p, label: pathLabel(p) }))
  }

  async function onOpenRecent(entry: RecentEntry) {
    menuError = ''
    if (!$desktopCompanionStatus.reachable) {
      menuError = 'Desktop client unreachable — start BarBro desktop and try again.'
      return
    }
    try {
      await openProjectByPath(entry.path)
      refreshRecents()
      await goto('/project')
    } catch (e) {
      // Project folder gone or unreadable — drop from recents.
      dropRecentProjectPath(entry.path)
      refreshRecents()
      menuError = e instanceof Error ? e.message : `Could not open "${entry.label}"`
    }
  }

  onMount(() => {
    refreshRecents()
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
    // Forget the last-opened project so a reload doesn't put the user back
    // into the project they just exited. The Recent Projects list survives
    // — re-entering is one click away.
    clearLastProjectPath()
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
            {#each recentProjects as r (r.path)}
              <DropdownMenuItem
                class="cursor-pointer"
                onclick={() => void onOpenRecent(r)}
              >
                <div class="flex w-full min-w-0 flex-col gap-0">
                  <span class="truncate font-medium">{r.label}</span>
                  <span class="text-muted-foreground truncate font-mono text-[10px]">{r.path}</span>
                </div>
              </DropdownMenuItem>
            {/each}
          {/if}
        {/if}
        <DropdownMenuItem class="cursor-pointer" onclick={() => goto('/download')}>
          Download desktop app…
        </DropdownMenuItem>
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
    <!--
      Auth chip: signed-in users get an avatar/initial linking to /account;
      signed-out users get a small "Sign in" link. Compact on purpose — the
      header is busy. Full account UI lives at /account.
    -->
    {#if $userStore}
      {@const initial = ($userStore.name?.[0] ?? $userStore.email?.[0] ?? '?').toUpperCase()}
      <a
        href="/account"
        class="border-foreground inline-flex size-8 shrink-0 items-center justify-center border-2 no-underline"
        title={$userStore.name ?? $userStore.email ?? 'Account'}
        aria-label="Account"
      >
        {#if $userStore.avatarUrl}
          <img src={$userStore.avatarUrl} alt="" class="size-full object-cover" referrerpolicy="no-referrer" />
        {:else}
          <span class="text-xs font-black">{initial}</span>
        {/if}
      </a>
    {:else}
      <a
        href="/login"
        class="border-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 border-2 px-2 text-xs font-semibold uppercase tracking-wider no-underline"
        title="Sign in"
      >
        <LogIn class="size-3.5" aria-hidden="true" />
        Sign in
      </a>
    {/if}
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
        onclick={() => {
          debugOpen = true
        }}
      >
        JSON
      </Button>
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
