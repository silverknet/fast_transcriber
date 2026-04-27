<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import '../app.css'
  import { beforeNavigate, goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import AppMenuBar from '$lib/components/AppMenuBar.svelte'
  import { loadServerAutosave, startServerAutosave, stopServerAutosave } from '$lib/client/serverAutosave'
  import { hasActiveSongSession } from '$lib/stores/restorableSong'
  import { beatPulse, uiAnimations } from '$lib/stores/beatPulse'

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
  <!-- Backgrounds in their own layer so `overflow-hidden` never clips `fixed` blob blurs (Chrome/macOS). -->
  <div class="pointer-events-none absolute inset-0 overflow-hidden">
    <div class="absolute inset-0 bg-gradient-to-b from-zinc-950 via-[#07060d] to-black"></div>
    <div
      class="absolute inset-0 bg-[radial-gradient(ellipse_85%_55%_at_50%_-15%,rgba(124,58,237,0.22),transparent)]"
    ></div>
    <div
      class="absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_100%_45%,rgba(56,189,248,0.1),transparent)]"
    ></div>
    <div
      class="absolute inset-0 bg-[radial-gradient(ellipse_45%_38%_at_5%_85%,rgba(99,102,241,0.14),transparent)]"
    ></div>
  </div>

  <!--
    Outer: fixed anchor only (never `transform` — that breaks some browsers’ fixed + child paint).
    Inner: optional slow spin while analyzing. Intro orbits stay on the three leaf wrappers.
    Remount intro: bump `uiAnimations.blobOrbit.n` (see `triggerUiAnimation('blobOrbit')`).
  -->
  {#key $uiAnimations.blobOrbit.n}
    <div
      class="pointer-events-none fixed left-1/2 top-1/2 z-0 h-0 w-0 overflow-visible"
      aria-hidden="true"
    >
      <div
        class="pointer-events-none relative h-0 w-0 origin-top-left {$uiAnimations.analyzingSpin === true
          ? 'barbro-blob-analyze-spin'
          : ''}"
      >
        <div
          class="barbro-blob-orbit pointer-events-none"
          style="--θ: -52deg; --r: 38vmin; --r0: 11vmin;"
        >
          <div
            class="pointer-events-none absolute left-0 top-0 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-[42%] bg-gradient-to-br from-violet-500/35 via-fuchsia-500/10 to-transparent blur-3xl"
          ></div>
        </div>
        <div
          class="barbro-blob-orbit barbro-blob-orbit--delay-1 pointer-events-none"
          style="--θ: 92deg; --r: 41vmin; --r0: 12vmin;"
        >
          <div
            class="pointer-events-none absolute left-0 top-0 size-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-[38%] bg-gradient-to-tl from-sky-400/30 via-cyan-500/8 to-transparent blur-3xl"
          ></div>
        </div>
        <div
          class="barbro-blob-orbit barbro-blob-orbit--delay-2 pointer-events-none"
          style="--θ: 192deg; --r: 36vmin; --r0: 10.5vmin;"
        >
          <div
            class="pointer-events-none absolute left-0 top-0 h-[26rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-[45%] bg-gradient-to-tr from-indigo-500/28 via-violet-400/10 to-transparent blur-3xl"
          ></div>
        </div>
      </div>
    </div>
  {/key}

  {#key $beatPulse.n}
    {#if $beatPulse.n > 0}
      <div
        class="barbro-beat-pulse-layer pointer-events-none fixed inset-0 z-[1]"
        data-accent={$beatPulse.accent ? 'true' : 'false'}
        aria-hidden="true"
      ></div>
    {/if}
  {/key}

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
