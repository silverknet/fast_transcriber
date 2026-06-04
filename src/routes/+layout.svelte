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
  import {
    probeDesktopCompanion,
    probeDesktopPythonHealth,
    probeDesktopSetupStatus,
  } from '$lib/client/desktopBeacon'
  import { startProjectAutosave, stopProjectAutosave } from '$lib/client/projectAutosave'
  import {
    ACTIVE_SONG_ID_KEY,
    loadProjectSongIntoEditor,
    tryRestoreLastProject,
  } from '$lib/project/commit'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { classifySidecarVersion } from '$lib/desktop/minSidecarVersion'
  import { songMap } from '$lib/stores/songMap'
  import { analyzingState } from '$lib/stores/analyzingState'
  import { userStore } from '$lib/stores/user'
  import { getSupabaseBrowserClient } from '$lib/client/supabase/browserClient'
  import { invalidateAll } from '$app/navigation'

  // Server-resolved layout data (includes `user` from +layout.server.ts).
  // Using `<slot />` below for parent-content rendering — Svelte 5 still
  // accepts it for now; the slot→snippet migration is a separate task.
  let { data } = $props<{
    data: {
      user: { id: string; email: string | null; name: string | null; avatarUrl: string | null } | null
    }
  }>()

  // Mirror the server-resolved user into the global store on every nav.
  // SvelteKit re-runs `+layout.server.ts` on every navigation, so this
  // stays current as the cookie state changes.
  $effect(() => {
    userStore.set(data.user)
  })

  let companionPollId: ReturnType<typeof setInterval> | null = null
  let activeSongUnsub: (() => void) | null = null
  let authUnsub: (() => void) | null = null

  async function pollDesktopCompanion() {
    const r = await probeDesktopCompanion()
    // Python deps health is only worth checking when the sidecar
    // itself is reachable — there's no point asking python questions
    // of a dead beacon. Sidecar caches the health internally so the
    // 12s poll cadence only triggers fresh Python spawns once per minute.
    let pythonHealth: 'unknown' | 'installing' | 'ok' | 'broken' = 'unknown'
    let brokenChecks: { name: string; ok: boolean; error?: string }[] = []
    let setup: {
      running: boolean
      overall: number
      stages: import('$lib/client/desktopBeacon').DesktopSetupStage[]
      lastError: string | null
    } | null = null
    if (r.ok) {
      const health = await probeDesktopPythonHealth()
      if (health) {
        if (health.installing) {
          pythonHealth = 'installing'
        } else {
          pythonHealth = health.ok ? 'ok' : 'broken'
          brokenChecks = health.checks.filter((c) => !c.ok)
        }
      }
      // Always pull setup state — even when health says 'ok' the page
      // wants to know if anything was just installed (recent stages
      // can show a "Done" toast). Cheap call, no Python spawned.
      const s = await probeDesktopSetupStatus()
      if (s) {
        setup = {
          running: s.running,
          overall: s.overall,
          stages: s.stages,
          lastError: s.lastError,
        }
      }
    }
    desktopCompanionStatus.set({
      reachable: r.ok,
      version: r.version,
      versionStatus: classifySidecarVersion(r.version),
      lastCheckedAt: new Date().toISOString(),
      lastError: r.error,
      pythonHealth,
      brokenChecks,
      setup,
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
      // Never yank the user away from the auth flow — they came here for
      // a reason and an auto-restore should not steal focus from sign-in
      // or the OAuth callback round-trip.
      const onAuthRoute = here === '/login' || here?.startsWith('/auth')
      if (onAuthRoute) return
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

    // Subscribe to client-side Supabase auth events (sign-in via OAuth
    // callback, sign-out, token refresh) and re-run the server load so
    // `data.user` reflects the new state without a full page reload.
    // The `$effect` above will then mirror the new user into `userStore`.
    try {
      const sb = getSupabaseBrowserClient()
      const { data: { subscription } } = sb.auth.onAuthStateChange(() => {
        void invalidateAll()
      })
      authUnsub = () => subscription.unsubscribe()
    } catch {
      // Supabase env not configured — fine, app keeps working signed-out.
    }

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
      authUnsub?.()
      authUnsub = null
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

  // Hide AppMenuBar + ProjectContextBar on full-page routes that have
  // their own self-contained chrome: /download (sidecar install CTA),
  // /welcome (landing), /login, /pending. These pages should fill the
  // viewport without the app's regular menus floating on top.
  let bareRouteIds = ['/download', '/welcome', '/login', '/pending']
  let onBareRoute = $derived(bareRouteIds.includes($page.route?.id ?? ''))
  let showChrome = $derived(!onBareRoute)

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
    if (status.lastCheckedAt === null) return // no probe yet
    const here = $page.route?.id
    // Don't yank the user away from the public / auth / pending pages —
    // they don't need the sidecar yet, and a redirect to /download would
    // skip the landing entirely on first visit.
    if (here === '/download') return
    if (here === '/welcome' || here === '/login' || here === '/pending') return
    if (here?.startsWith('/auth')) return
    // Four reasons to lock the user to /download:
    //   1. Sidecar unreachable (no companion running)
    //   2. Sidecar reachable but its version is below the web app's
    //      minimum — user needs to install a newer build
    //   3. Sidecar reachable but its Python deps are missing (broken)
    //   4. Auto-setup is currently installing deps — show the progress
    //      UI on /download instead of letting the user wander into the
    //      app where analyze endpoints will fail.
    if (
      !status.reachable ||
      status.versionStatus === 'outdated' ||
      status.pythonHealth === 'broken' ||
      status.pythonHealth === 'installing'
    ) {
      void goto('/download')
    }
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
