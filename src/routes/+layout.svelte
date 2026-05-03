<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import '../app.css'
  import { beforeNavigate, goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { get } from 'svelte/store'
  import AppMenuBar from '$lib/components/AppMenuBar.svelte'
  import { loadServerAutosave, startServerAutosave, stopServerAutosave } from '$lib/client/serverAutosave'
  import { songMap } from '$lib/stores/songMap'
  import { analyzingState } from '$lib/stores/analyzingState'

  let { data } = $props<{ data: { savedSessionId: string | null } }>()

  let restoringSession = $state(false)

  function isAnalyzed(sm: typeof $songMap): boolean {
    if (!sm) return false
    return sm.metadata.analyzed ?? sm.timeline.bars.length > 0
  }

  function currentRoute(): '/' | '/analyzing' | '/edit' {
    const sm = get(songMap)
    const as = get(analyzingState)
    if (!sm) return '/'
    if (as) return '/analyzing'
    if (isAnalyzed(sm)) return '/edit'
    return '/'
  }

  onMount(() => {
    if (!browser) return
    startServerAutosave()
    if (isAnalyzed(get(songMap))) return
    if (!data.savedSessionId) return
    restoringSession = true
    void (async () => {
      const r = await loadServerAutosave()
      restoringSession = false
      if (!r.ok) return
      const sm = get(songMap)
      if (sm && isAnalyzed(sm)) {
        await goto('/edit', { replaceState: true })
      }
      // If not analyzed, stay on '/' — import page will show the unanalyzed state
    })()
  })

  onDestroy(() => {
    if (browser) stopServerAutosave()
  })

  beforeNavigate((nav) => {
    if (!nav.to) return
    const dest = nav.to.url.pathname
    if (dest !== '/') return
    const sm = get(songMap)
    if (!sm) return
    // If analyzed, block going back to / (would lose session)
    if (isAnalyzed(sm)) {
      nav.cancel()
      goto('/edit', { replaceState: true })
    }
    // If not analyzed, allow going to / freely
  })
</script>

<svelte:head>
  <title>BarBro</title>
  <meta name="description" content="BarBro — bar-first songs, beats, and cues." />
</svelte:head>

<div class="relative min-h-dvh overflow-x-hidden overscroll-x-none font-sans">
  <div class="relative z-30">
    <AppMenuBar />
  </div>
  <!-- Fixed header (~3rem); keep page content below it -->
  <div class="pt-12">
    {#if restoringSession}
      <div class="text-muted-foreground px-4 pt-3 text-sm">Restoring your session...</div>
    {/if}
    <slot />
  </div>
</div>
