<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import '../app.css'
  import { beforeNavigate, goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { get } from 'svelte/store'
  import AppMenuBar from '$lib/components/AppMenuBar.svelte'
  import ProjectContextBar from '$lib/components/ProjectContextBar.svelte'
  import { page } from '$app/stores'
  import { project as projectStore } from '$lib/stores/project'
  import { probeDesktopCompanion } from '$lib/client/desktopBeacon'
  import { startProjectAutosave, stopProjectAutosave } from '$lib/client/projectAutosave'
  import {
    ACTIVE_SONG_ID_KEY,
    loadProjectSongIntoEditor,
    tryRestoreLastProject,
  } from '$lib/project/commit'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { songMap } from '$lib/stores/songMap'
  import { analyzingState } from '$lib/stores/analyzingState'

  let companionPollId: ReturnType<typeof setInterval> | null = null
  let activeSongUnsub: (() => void) | null = null

  async function pollDesktopCompanion() {
    const r = await probeDesktopCompanion()
    desktopCompanionStatus.set({
      reachable: r.ok,
      version: r.version,
      lastCheckedAt: new Date().toISOString(),
      lastError: r.error,
    })
  }

  function isAnalyzed(sm: typeof $songMap): boolean {
    if (!sm) return false
    return sm.metadata.analyzed ?? sm.timeline.bars.length > 0
  }

  /**
   * Restore the last-opened project (and its active song, if any). The
   * project is identified by `localStorage[barbro::lastProjectPath]` and
   * re-hydrated via the desktop sidecar. Silent on failure — sidecar may
   * be offline, project folder may be gone, etc.
   *
   * Landing route after a successful restore:
   *  - had an active song that loaded into the editor → `/edit`
   *  - otherwise, if we were sitting on the import page (`/`) → `/project`
   *  - any other route stays put (user explicitly nav'd there).
   */
  async function restoreLastProjectIfAny(pendingActiveSongId: string | null) {
    if (get(projectStore).data) return
    try {
      const restored = await tryRestoreLastProject()
      if (!restored) return
      let openedSong = false
      if (
        pendingActiveSongId &&
        restored.songs.some((s) => s.id === pendingActiveSongId) &&
        !get(songMap)
      ) {
        await loadProjectSongIntoEditor(pendingActiveSongId)
        openedSong = true
      }
      const here = get(page).route?.id
      if (openedSong && here !== '/edit') {
        await goto('/edit', { replaceState: true })
      } else if (!openedSong && here === '/') {
        await goto('/project', { replaceState: true })
      }
    } catch {
      /* silent — user can re-open from the File menu */
    }
  }

  onMount(() => {
    if (!browser) return
    void pollDesktopCompanion()
    companionPollId = setInterval(() => void pollDesktopCompanion(), 12_000)
    startProjectAutosave()

    // Read pending active-song id BEFORE attaching the subscriber so its
    // synchronous initial emit doesn't overwrite localStorage.
    let pendingActiveSongId: string | null = null
    try {
      pendingActiveSongId = localStorage.getItem(ACTIVE_SONG_ID_KEY)
    } catch {
      pendingActiveSongId = null
    }
    void restoreLastProjectIfAny(pendingActiveSongId)

    let firstEmit = true
    activeSongUnsub = projectStore.subscribe((state) => {
      if (firstEmit) {
        firstEmit = false
        return
      }
      try {
        if (state.activeSongId) {
          localStorage.setItem(ACTIVE_SONG_ID_KEY, state.activeSongId)
        } else if (state.data === null) {
          // Project fully closed — clear active song too.
          localStorage.removeItem(ACTIVE_SONG_ID_KEY)
        }
      } catch {
        /* localStorage may be disabled */
      }
    })
  })

  onDestroy(() => {
    if (browser) {
      if (companionPollId != null) {
        clearInterval(companionPollId)
        companionPollId = null
      }
      activeSongUnsub?.()
      activeSongUnsub = null
      stopProjectAutosave()
    }
  })

  beforeNavigate((nav) => {
    if (!nav.to) return
    const dest = nav.to.url.pathname
    if (dest !== '/') return
    if (nav.to.url.searchParams.has('project')) return
    const sm = get(songMap)
    if (!sm) return
    if (isAnalyzed(sm)) {
      nav.cancel()
      goto('/edit', { replaceState: true })
    }
  })

  // The /download page is shown ONLY when the sidecar is unreachable — none
  // of the AppMenuBar / ProjectContextBar actions can work without the
  // sidecar, so hide them there to keep the page focused on a single CTA.
  let onDownloadRoute = $derived($page.route?.id === '/download')
  let showChrome = $derived(!onDownloadRoute)

  // Padding offset: AppMenuBar is fixed (~3rem) and ProjectContextBar adds
  // another ~2.5rem on top when active. Page content lives under both.
  let showProjectBar = $derived(
    $projectStore.data !== null && $page.route?.id !== '/project',
  )

  /**
   * Redirect to `/download` whenever the sidecar isn't reachable — the
   * desktop sidecar is required for almost every feature (stems, project
   * I/O, analyzers), so showing a "stuck" UI when it's offline is worse
   * than a hard route push that surfaces install/start instructions.
   *
   * Gate on `lastCheckedAt` so we never redirect on the first frame
   * (before the initial probe has completed). Skip when already on the
   * download page to avoid a navigation loop. The 12 s poll continues to
   * fire on `/download`; once the sidecar wakes up the user navigates
   * back manually (or via in-page CTAs).
   */
  $effect(() => {
    if (!browser) return
    const status = $desktopCompanionStatus
    if (status.reachable) return
    if (status.lastCheckedAt === null) return // no probe yet
    const here = $page.route?.id
    if (here === '/download') return
    void goto('/download')
  })
</script>

<svelte:head>
  <title>BarBro</title>
  <meta name="description" content="BarBro — bar-first songs, beats, and cues." />
</svelte:head>

<div class="relative min-h-dvh overflow-x-hidden overscroll-x-none font-sans">
  {#if showChrome}
    <div class="relative z-30">
      <AppMenuBar />
      <ProjectContextBar />
    </div>
  {/if}
  <!-- AppMenuBar (3rem) + optional project context bar (2.5rem). Bare on /download. -->
  <div class={!showChrome ? '' : showProjectBar ? 'pt-[5.25rem]' : 'pt-12'}>
    <slot />
  </div>
</div>
