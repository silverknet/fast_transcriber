<script lang="ts">
  /**
   * App menu: shadcn dropdowns (File / Edit / View) + debug JSON dialog.
   */
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { get } from 'svelte/store'
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
  import NewProjectDialog from '$lib/components/NewProjectDialog.svelte'
  import CloudSyncPill from '$lib/components/CloudSyncPill.svelte'
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
  import { MODE_LABEL, MODE_TAGLINE } from '$lib/stores/appMode'
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
  import Shield from '@lucide/svelte/icons/shield'
  import Sun from '@lucide/svelte/icons/sun'
  import { page } from '$app/stores'
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
  let newProjectDialogOpen = $state(false)

  function openNewProjectDialog() {
    if (!$desktopCompanionStatus.reachable) {
      menuError = 'Desktop client unreachable — install/start BarBro desktop to manage projects.'
      return
    }
    newProjectDialogOpen = true
  }
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
  // Explicit MODE badge: which mode am I in, and which audio am I hearing? The
  // desktop symbol is promoted from a plain status dot into a labelled badge.
  let modeLabel = $derived(desktopConnected ? MODE_LABEL.studio : MODE_LABEL.collab)
  let modeTooltip = $derived(
    `${desktopConnected ? MODE_TAGLINE.studio : MODE_TAGLINE.collab} · ${desktopStatusTitle}`,
  )

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
    // Drop any song that was loaded via the project so we don't land in /edit
    // pointing at a now-closed project song.
    clearFullAppSongState()
    // Forget the last-opened project so a reload doesn't put the user back
    // into the project they just exited. The Recent Projects list survives
    // — re-entering is one click away.
    clearLastProjectPath()
    // Land on the project hub (open/create/recent), NOT the legacy single-song
    // import page — "closing a project" should mean "back to my projects".
    await goto('/project', { replaceState: true })
  }

  /**
   * POST to /logout (the endpoint at `src/routes/logout/+server.ts` that
   * clears the Supabase session cookies) then full-reload to /welcome so
   * the root layout's user-store + access gate re-evaluate from scratch.
   */
  async function onSignOut() {
    menuError = ''
    try {
      const res = await fetch('/logout', { method: 'POST' })
      if (!res.ok) {
        menuError = `Sign out failed (HTTP ${res.status}).`
        return
      }
    } catch (e) {
      menuError = e instanceof Error ? e.message : 'Sign out failed.'
      return
    }
    // Hard navigation so SSR re-runs with no session.
    window.location.assign('/welcome')
  }
</script>

<header
  class="app-menu text-sm"
  aria-label="Application"
  data-app-menu
>
  <a
    href={logoHref}
    class="app-menu-brand"
    aria-label={logoAria}
  >
    <!-- BAR / BRO wordmark doubles as the home / project link. -->
    <span class="logo-mark" aria-label="BarBro">
      <span>BARBRO</span>
    </span>
  </a>

  <div class="app-menu-primary">
    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <button type="button" class="chrome-button" {...props}>
            File
            <ChevronDown class="size-3.5 opacity-60" aria-hidden="true" />
          </button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[12rem]">
        {#if isInProjectMode}
          <DropdownMenuItem class="cursor-pointer" onclick={() => void onBackToProject()}>
            Back to project
          </DropdownMenuItem>
          <div class="bg-foreground/15 my-1 h-px" role="separator"></div>
          <!-- Switch projects without closing first: opening/creating another
               project just replaces the current one. -->
          <DropdownMenuItem class="cursor-pointer" onclick={openNewProjectDialog}>
            New project…
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer" onclick={() => void onOpenProject()}>
            Open project…
          </DropdownMenuItem>
          <div class="bg-foreground/15 my-1 h-px" role="separator"></div>
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
            Close project
          </DropdownMenuItem>
        {:else}
          <!--
            Project-only mode. The .smap-as-document workflow (Save Song,
            Open Song, standalone musicxml/pdf exports) is retired — every
            song lives inside a project now. The remaining no-project-open
            entries are just the create/open project actions.
          -->
          <DropdownMenuItem class="cursor-pointer" onclick={openNewProjectDialog}>
            New project…
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer" onclick={() => void onOpenProject()}>
            Open project…
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

  <div class="app-menu-actions">
    <CloudSyncPill />
    <a
      href="/download"
      class="chrome-icon chrome-mode {desktopConnected ? 'is-connected' : 'is-browser'}"
      title={modeTooltip}
      aria-label={modeTooltip}
    >
      <Monitor class="size-4" aria-hidden="true" />
      <span class="mode-label">{modeLabel}</span>
    </a>
    <button
      type="button"
      class="chrome-icon"
      onclick={toggleDarkMode}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {#if dark}
        <Sun class="size-4" />
      {:else}
        <Moon class="size-4" />
      {/if}
    </button>
    <!--
      Admin shortcut — only renders when the layout server flagged the
      current user as admin. Hidden for everyone else (link doesn't even
      exist in the DOM, so curious users can't crawl their way in).
    -->
    {#if $page.data?.isAdmin}
      <a
        href="/admin/access"
        class="chrome-link"
        title="Admin: access requests"
      >
        <Shield class="size-3.5" aria-hidden="true" />
        Admin
      </a>
    {/if}
    <!--
      Auth chip: signed-in users get an avatar/initial linking to /account;
      signed-out users get a small "Sign in" link. Compact on purpose — the
      header is busy. Full account UI lives at /account.
    -->
    {#if $userStore}
      {@const initial = ($userStore.name?.[0] ?? $userStore.email?.[0] ?? '?').toUpperCase()}
      <!-- Account menu: avatar trigger + dropdown with the account link
           plus a Sign out item that POSTs to /logout. Lets users sign out
           without hunting for it inside /account. -->
      <DropdownMenu>
        <DropdownMenuTrigger>
          {#snippet child({ props })}
            <button
              type="button"
              class="chrome-avatar"
              title={$userStore.name ?? $userStore.email ?? 'Account'}
              aria-label="Account menu"
              {...props}
            >
              {#if $userStore.avatarUrl}
                <img src={$userStore.avatarUrl} alt="" class="size-full object-cover" referrerpolicy="no-referrer" />
              {:else}
                <span class="text-xs font-black">{initial}</span>
              {/if}
            </button>
          {/snippet}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-[12rem]">
          <div class="px-2 pt-1 pb-1.5 text-[11px] leading-tight">
            <div class="truncate font-semibold">
              {$userStore.name ?? $userStore.email ?? 'Signed in'}
            </div>
            {#if $userStore.name && $userStore.email}
              <div class="text-muted-foreground truncate">{$userStore.email}</div>
            {/if}
          </div>
          <DropdownMenuItem class="cursor-pointer" onclick={() => goto('/account')}>
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer" onclick={() => void onSignOut()}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    {:else}
      <a
        href="/login"
        class="chrome-link"
        title="Sign in"
      >
        <LogIn class="size-3.5" aria-hidden="true" />
        Sign in
      </a>
    {/if}
    {#if !isInProjectMode}
      <button
        type="button"
        class="chrome-button"
        onclick={() => goto('/set')}
        title="Experimental: export Ableton Live set"
      >
        Set ⚗
      </button>
    {/if}
    {#if import.meta.env.DEV}
      <button
        type="button"
        class="chrome-button is-dev"
        onclick={() => {
          debugOpen = true
        }}
      >
        JSON
      </button>
      <button
        type="button"
        class="chrome-button is-dev"
        onclick={() => goto('/analyzing?preview')}
      >
        ∿
      </button>
      <button type="button" class="chrome-button is-dev" onclick={() => goto('/texttospeech')}>
        TTS
      </button>
    {/if}
  </div>

  {#if menuError}
    <p class="app-menu-error text-destructive truncate text-xs" role="status">{menuError}</p>
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
    <DialogHeader class="">
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

<NewProjectDialog bind:open={newProjectDialogOpen} onCreated={() => refreshRecents()} />

<style>
  /*
   * Plain chrome-scale wordmark. Keep it quiet; the orange belongs to the
   * system accent line, not to a chunky logo treatment.
   * Kept here (not in a shared component) so the menubar stays a single file
   * you can scan top-to-bottom.
   */
  .app-menu {
    --chrome-edge: color-mix(in oklch, var(--foreground) 42%, transparent);
    --chrome-hover: color-mix(in oklch, var(--studio-orange) 16%, var(--card));
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.5rem;
    row-gap: 0.35rem;
    min-height: 2rem;
    padding: 0.2rem 0.75rem;
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--card);
    color: var(--foreground);
  }

  .app-menu-brand {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    color: var(--foreground);
    text-decoration: none;
  }

  .app-menu-primary,
  .app-menu-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.4rem;
  }

  .app-menu-primary {
    justify-content: flex-start;
  }

  .app-menu-actions {
    justify-content: flex-end;
  }

  .logo-mark {
    display: inline-flex;
    align-items: center;
    font-size: 1.35rem;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0;
    color: var(--foreground);
  }

  .chrome-icon,
  .chrome-link,
  .chrome-avatar,
  .chrome-button {
    display: inline-flex;
    height: 1.6rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--foreground);
    font: inherit;
    line-height: 1;
    text-decoration: none;
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }

  .chrome-icon,
  .chrome-avatar {
    width: 1.6rem;
    overflow: hidden;
  }

  .chrome-link {
    padding: 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .chrome-button {
    padding: 0 0.55rem;
    cursor: pointer;
    font-size: 0.8125rem;
    font-weight: 800;
  }

  .chrome-button.is-dev {
    opacity: 0.68;
  }

  .chrome-icon:hover,
  .chrome-link:hover,
  .chrome-avatar:hover,
  .chrome-avatar[aria-expanded='true'],
  .chrome-button:hover,
  .chrome-button[aria-expanded='true'] {
    border-color: var(--foreground);
    background: var(--chrome-hover);
    color: var(--foreground);
  }

  .chrome-icon.is-connected {
    border-color: color-mix(in oklch, #047857 72%, var(--foreground));
    background: color-mix(in oklch, #6ee7b7 22%, var(--card));
    color: var(--foreground);
  }

  /* The desktop symbol promoted to a labelled MODE badge (Desktop·HD vs
     Browser·cloud) — the at-a-glance answer to "which mode + which audio". */
  .chrome-icon.chrome-mode {
    width: auto;
    overflow: visible;
    padding: 0 0.5rem;
    gap: 0.3rem;
  }
  .chrome-mode .mode-label {
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  /* Browser mode: distinct amber tint so it never reads as the desktop state. */
  .chrome-icon.is-browser {
    border-color: color-mix(in oklch, #b45309 60%, var(--foreground));
    background: color-mix(in oklch, #fcd34d 20%, var(--card));
    color: var(--foreground);
  }

  @media (max-width: 920px) {
    /* Tight nav: keep the badge to its icon; the tooltip still names the mode. */
    .chrome-mode .mode-label {
      display: none;
    }
    .chrome-icon.chrome-mode {
      width: 1.6rem;
      padding: 0;
    }
  }

  .app-menu-error {
    grid-column: 1 / -1;
    max-width: 42rem;
  }

  @media (max-width: 920px) {
    .app-menu {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.45rem 0.75rem;
    }

    .app-menu-primary {
      justify-content: flex-end;
    }

    .app-menu-actions {
      grid-column: 1 / -1;
      justify-content: flex-start;
      overflow-x: auto;
      padding-bottom: 0.05rem;
    }
  }

  @media (max-width: 640px) {
    .app-menu {
      padding: 0.45rem 0.5rem 0.65rem;
    }

    .logo-mark {
      font-size: 1.3rem;
    }
  }
</style>
