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
  import { loadServerAutosave, startServerAutosave, stopServerAutosave } from '$lib/client/serverAutosave'
  import { startProjectAutosave, stopProjectAutosave } from '$lib/client/projectAutosave'
  import {
    ACTIVE_SONG_ID_KEY,
    loadProjectSongIntoEditor,
    tryRestoreLastProject,
  } from '$lib/project/commit'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { songMap } from '$lib/stores/songMap'
  import { analyzingState } from '$lib/stores/analyzingState'

  let { data } = $props<{ data: { savedSessionId: string | null } }>()

  let restoringSession = $state(false)
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
   */
  async function restoreLastProjectIfAny(pendingActiveSongId: string | null) {
    if (get(projectStore).data) return
    try {
      const restored = await tryRestoreLastProject()
      if (!restored) return
      if (
        pendingActiveSongId &&
        restored.songs.some((s) => s.id === pendingActiveSongId) &&
        !get(songMap)
      ) {
        await loadProjectSongIntoEditor(pendingActiveSongId)
      }
    } catch {
      /* silent — user can re-open from the File menu */
    }
  }

  onMount(() => {
    if (!browser) return
    void pollDesktopCompanion()
    companionPollId = setInterval(() => void pollDesktopCompanion(), 12_000)
    startServerAutosave()
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

    // Server-side song autosave restoration. Wrapped in try/finally so the
    // indicator always clears even on errors.
    if (isAnalyzed(get(songMap))) return
    if (!data.savedSessionId) return
    restoringSession = true
    void (async () => {
      try {
        const r = await loadServerAutosave()
        if (!r.ok) return
        const sm = get(songMap)
        if (sm && isAnalyzed(sm)) {
          await goto('/edit', { replaceState: true })
        }
      } catch {
        /* swallow */
      } finally {
        restoringSession = false
      }
    })()
  })

  onDestroy(() => {
    if (browser) {
      if (companionPollId != null) {
        clearInterval(companionPollId)
        companionPollId = null
      }
      activeSongUnsub?.()
      activeSongUnsub = null
      stopServerAutosave()
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

  // Padding offset: AppMenuBar is fixed (~3rem) and ProjectContextBar adds
  // another ~2.5rem on top when active. Page content lives under both.
  let showProjectBar = $derived(
    $projectStore.data !== null && $page.route?.id !== '/project',
  )
</script>

<svelte:head>
  <title>BarBro</title>
  <meta name="description" content="BarBro — bar-first songs, beats, and cues." />
</svelte:head>

<div class="relative min-h-dvh overflow-x-hidden overscroll-x-none font-sans">
  <div class="relative z-30">
    <AppMenuBar />
    <ProjectContextBar />
  </div>
  <!-- Fixed header (~3rem) + optional project context bar (~2.5rem). -->
  <div class={showProjectBar ? 'pt-[5.25rem]' : 'pt-12'}>
    {#if restoringSession}
      <div class="text-muted-foreground px-4 pt-3 text-sm">Restoring your session...</div>
    {/if}
    <slot />
  </div>
</div>
