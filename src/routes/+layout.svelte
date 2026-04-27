<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import '../app.css'
  import { beforeNavigate, goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import AppMenuBar from '$lib/components/AppMenuBar.svelte'
  import { loadServerAutosave, startServerAutosave, stopServerAutosave } from '$lib/client/serverAutosave'
  import { hasActiveSongSession } from '$lib/stores/restorableSong'

  let { data } = $props<{ data: { savedSessionId: string | null } }>()

  let restoringSession = $state(false)

  onMount(() => {
    if (!browser) return
    startServerAutosave()
    if (hasActiveSongSession()) return
    if (!data.savedSessionId) return
    restoringSession = true
    void (async () => {
      const r = await loadServerAutosave()
      restoringSession = false
      if (r.ok && hasActiveSongSession()) {
        await goto('/edit', { replaceState: true })
      }
    })()
  })

  onDestroy(() => {
    if (browser) stopServerAutosave()
  })

  /**
   * The import landing route must not replace an in-memory project casually.
   * Block client navigations to `/` while a song is loaded; keep the app on the editor.
   */
  beforeNavigate((nav) => {
    if (!nav.to) return
    if (nav.to.url.pathname !== '/') return
    if (!hasActiveSongSession()) return
    nav.cancel()
    goto('/edit', { replaceState: true })
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
