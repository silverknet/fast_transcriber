<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import MixerView from '$lib/components/MixerView.svelte'
  import { Button } from '$lib/components/ui/button'
  import { formatSongKeyLabel } from '$lib/chords'
  import { loadProjectSongIntoEditor, refreshProjectInfo } from '$lib/project/commit'
  import { loadCloudSongIntoEditor } from '$lib/client/browserCloudProject'
  import { project as projectStore, isBrowserCloudProject } from '$lib/stores/project'
  import { songMap } from '$lib/stores/songMap'
  import { ArrowLeft, HelpCircle, ListMusic, Maximize2, Minimize2, Music4, Play, RefreshCw } from '@lucide/svelte'
  import ApcKey25Guide from '$lib/components/ApcKey25Guide.svelte'
  import { isNarrow } from '$lib/stores/viewport'

  type SetlistItem = {
    id: string
    folder: string
    title: string
    artist: string
    keyLabel: string
    bpmLabel: string
  }

  let loadingSongId = $state<string | null>(null)
  let loadError = $state('')
  let showGuide = $state(false)
  let refreshing = $state(false)
  let fullscreen = $state(false)
  /** Phone-only setlist sheet (the "corner menu" to switch songs). */
  let songMenuOpen = $state(false)
  let attemptedAutoLoadKey = ''

  const projectName = $derived($projectStore.data?.name?.trim() || 'Project')
  const setlistItems = $derived.by<SetlistItem[]>(() => {
    const project = $projectStore.data
    if (!project) return []
    return project.songs
      .filter((entry) => !entry.hidden)
      .map((entry) => {
        const meta = $projectStore.metadataByFolder[entry.folder]
        return {
          id: entry.id,
          folder: entry.folder,
          title: meta?.title?.trim() || 'Untitled song',
          artist: meta?.artist?.trim() || '',
          keyLabel: meta?.keyDetail ? formatSongKeyLabel(meta.keyDetail) : 'No key',
          bpmLabel: meta?.bpm != null ? `${Math.round(meta.bpm)}` : '—',
        }
      })
  })
  const activeSongId = $derived($projectStore.activeSongId)
  const activeIndex = $derived(setlistItems.findIndex((item) => item.id === activeSongId))
  const activeItem = $derived(activeIndex >= 0 ? setlistItems[activeIndex] : null)
  const upcomingItem = $derived(activeIndex >= 0 ? setlistItems[activeIndex + 1] ?? null : setlistItems[0] ?? null)
  const hasProject = $derived(!!$projectStore.data)
  const hasLoadedSong = $derived(!!activeSongId && !!$songMap)

  async function openSong(songId: string) {
    if (!songId || loadingSongId === songId) return
    loadingSongId = songId
    loadError = ''
    try {
      // Collab (browser-cloud) mode has no local folder (`osPath` is null), so
      // the disk loader would throw "No active project". Route through the
      // cloud loader instead — same path the project page uses to open a song.
      if (isBrowserCloudProject(get(projectStore))) {
        const r = await loadCloudSongIntoEditor(songId)
        if (!r.ok) loadError = r.error
      } else {
        await loadProjectSongIntoEditor(songId)
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      loadingSongId = null
    }
  }

  async function refreshProject() {
    refreshing = true
    loadError = ''
    try {
      await refreshProjectInfo()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      refreshing = false
    }
  }

  async function toggleFullscreen() {
    if (!browser) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    }
  }

  // Guarded exit: live performers must not drop out of the set on an accidental
  // tap. First press arms ("Tap again to exit"); a second within 3s leaves.
  let exitArmed = $state(false)
  let exitTimer: ReturnType<typeof setTimeout> | null = null
  function requestExit() {
    if (exitArmed) {
      if (exitTimer) clearTimeout(exitTimer)
      void goto('/project')
      return
    }
    exitArmed = true
    exitTimer = setTimeout(() => (exitArmed = false), 3000)
  }

  function backToProject() {
    void goto('/project')
  }

  $effect(() => {
    const project = $projectStore.data
    if (!project || setlistItems.length === 0 || loadingSongId) return
    const targetId = activeSongId ?? setlistItems[0]!.id
    const key = `${project.id}:${targetId}:${hasLoadedSong ? 'loaded' : 'empty'}`
    if (hasLoadedSong && activeSongId === targetId) return
    if (attemptedAutoLoadKey === key) return
    attemptedAutoLoadKey = key
    void openSong(targetId)
  })

  onMount(() => {
    if (!browser) return
    const onFullscreenChange = () => {
      fullscreen = !!document.fullscreenElement
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    fullscreen = !!document.fullscreenElement
    const project = get(projectStore).data
    if (project) void refreshProject()

    // Live stage view: keep the screen awake for the whole set. The OS drops
    // wake locks when the tab is hidden — re-acquire on return.
    let wakeLock: { release(): Promise<void> } | null = null
    const acquireWakeLock = async () => {
      try {
        const wl = (
          navigator as Navigator & {
            wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> }
          }
        ).wakeLock
        if (!wl) return
        wakeLock = await wl.request('screen')
      } catch {
        /* denied (battery saver etc.) — non-fatal */
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquireWakeLock()
    }
    void acquireWakeLock()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('visibilitychange', onVisibility)
      void wakeLock?.release().catch(() => {})
    }
  })
</script>

<svelte:head>
  <title>{projectName} · Live Playback · BarBro</title>
</svelte:head>

<main class="live-playback-page min-h-dvh bg-background text-foreground">
  <div class="flex flex-col gap-3 px-3 py-3 lg:px-4 {$isNarrow ? 'h-dvh overflow-hidden' : 'min-h-dvh'}">
    <header class="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        variant={exitArmed ? 'default' : 'outline'}
        size="sm"
        class="h-9 gap-1.5"
        onclick={requestExit}
        title="Leave live playback"
      >
        <ArrowLeft class="size-4" aria-hidden="true" />
        {exitArmed ? 'Tap again to exit' : 'Project'}
      </Button>
      <div class="min-w-0 flex-1">
        <p class="text-muted-foreground text-[10px] font-black uppercase tracking-wide">Live playback</p>
        <h1 class="truncate text-2xl font-black leading-none sm:text-3xl">{projectName}</h1>
      </div>
      {#if !$isNarrow}
        <Button
          variant="outline"
          size="sm"
          class="h-9 gap-1.5"
          onclick={() => void refreshProject()}
          disabled={refreshing}
        >
          <RefreshCw class="size-4 {refreshing ? 'animate-spin' : ''}" aria-hidden="true" />
          Refresh
        </Button>
        <Button
          variant={showGuide ? 'default' : 'outline'}
          size="sm"
          class="h-9 gap-1.5"
          onclick={() => (showGuide = !showGuide)}
          title="How to drive live mode with keys + the APC Key 25"
        >
          <HelpCircle class="size-4" aria-hidden="true" />
          Controls
        </Button>
      {/if}
      <Button variant="outline" size="sm" class="h-9 gap-1.5" onclick={() => void toggleFullscreen()}>
        {#if fullscreen}
          <Minimize2 class="size-4" aria-hidden="true" />
          Window
        {:else}
          <Maximize2 class="size-4" aria-hidden="true" />
          Fullscreen
        {/if}
      </Button>
    </header>

    {#if showGuide}
      <section class="border-foreground bg-card flex flex-col gap-4 border-2 p-4 sm:flex-row" aria-label="Live controls guide">
        <div class="flex-1">
          <h2 class="mb-2 text-sm font-black uppercase tracking-wide">Keyboard</h2>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {#each [['Space', 'Play / pause'], ['S', 'Stop (back to start)'], ['← / →', 'Previous / next song'], ['R', 'Replay section once (press again to cancel)'], ['L', 'Loop section on/off'], ['1–8', 'Toggle stems']] as [key, action] (key)}
              <dt class="font-mono font-black"><kbd class="border-foreground/40 rounded border px-1.5 py-0.5 text-xs">{key}</kbd></dt>
              <dd class="text-muted-foreground self-center">{action}</dd>
            {/each}
          </dl>
        </div>
        <div class="flex-1">
          <h2 class="mb-2 text-sm font-black uppercase tracking-wide">APC Key 25</h2>
          <ApcKey25Guide />
        </div>
      </section>
    {/if}

    {#if loadError}
      <p class="border-destructive/40 bg-destructive/10 text-destructive rounded-[var(--radius)] border px-3 py-2 text-sm" role="status">
        {loadError}
      </p>
    {/if}

    {#if !hasProject}
      <section class="grid min-h-[60dvh] place-items-center rounded-[var(--radius)] border-2 border-foreground/20 bg-muted/30 p-6 text-center">
        <div class="max-w-sm space-y-3">
          <Music4 class="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
          <h2 class="text-2xl font-black">No project open</h2>
          <Button class="" onclick={backToProject}>Open project</Button>
        </div>
      </section>
    {:else if setlistItems.length === 0}
      <section class="grid min-h-[60dvh] place-items-center rounded-[var(--radius)] border-2 border-foreground/20 bg-muted/30 p-6 text-center">
        <div class="max-w-sm space-y-3">
          <Music4 class="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
          <h2 class="text-2xl font-black">No visible songs</h2>
          <Button class="" variant="outline" onclick={backToProject}>Back to project</Button>
        </div>
      </section>
    {:else}
      <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
        {#if !$isNarrow}
        <aside class="min-h-0 overflow-hidden rounded-[var(--radius)] border-2 border-foreground bg-card">
          <div class="border-b-2 border-foreground px-3 py-2">
            <div class="text-muted-foreground text-[10px] font-black uppercase tracking-wide">
              Setlist
            </div>
            <div class="font-mono text-xs font-bold tabular-nums">
              {activeIndex >= 0 ? activeIndex + 1 : 0} / {setlistItems.length}
            </div>
          </div>
          <ol class="max-h-[calc(100dvh-8rem)] overflow-y-auto">
            {#each setlistItems as item, index (item.id)}
              <li>
                <button
                  type="button"
                  class="grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 border-b border-foreground/10 px-3 py-2 text-left transition-colors {item.id === activeSongId
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted/60'}"
                  onclick={() => void openSong(item.id)}
                  disabled={loadingSongId === item.id}
                >
                  <span class="font-mono text-xs font-black tabular-nums">{index + 1}</span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-black">{item.title}</span>
                    <span class="block truncate font-mono text-[11px] opacity-75">
                      {item.keyLabel} · {item.bpmLabel} BPM{item.artist ? ` · ${item.artist}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ol>
        </aside>
        {/if}

        <section class="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius)] border-2 border-foreground bg-background {$isNarrow ? 'p-0' : 'p-3'}">
          {#if $isNarrow}
            <!-- Corner song-menu: the only chrome on the phone stage. -->
            <div class="flex shrink-0 items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                class="border-foreground bg-card flex min-w-0 flex-1 items-center gap-2 rounded-full border-2 px-3 py-1.5 text-left"
                onclick={() => (songMenuOpen = !songMenuOpen)}
                aria-expanded={songMenuOpen}
                aria-label="Switch song"
              >
                <ListMusic class="size-4 shrink-0" aria-hidden="true" />
                <span class="font-mono text-xs font-black tabular-nums shrink-0">
                  {activeIndex >= 0 ? activeIndex + 1 : 0}/{setlistItems.length}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm font-black">
                  {activeItem?.title ?? 'Select a song'}
                </span>
                {#if loadingSongId}<span class="shrink-0 text-xs">…</span>{/if}
              </button>
            </div>
          {:else}
            <div class="mb-3 flex shrink-0 flex-wrap items-center gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-muted-foreground text-[10px] font-black uppercase tracking-wide">
                  Now
                </p>
                <h2 class="truncate text-3xl font-black leading-none sm:text-4xl">
                  {activeItem?.title ?? 'Loading song'}
                </h2>
              </div>
              {#if upcomingItem}
                <div class="rounded-[var(--radius)] bg-muted/60 px-3 py-2 text-right">
                  <div class="text-muted-foreground text-[10px] font-black uppercase">Next</div>
                  <div class="max-w-52 truncate text-sm font-black">{upcomingItem.title}</div>
                </div>
              {/if}
              {#if loadingSongId}
                <div class="rounded-full bg-muted px-3 py-1 font-mono text-xs font-bold">
                  Loading…
                </div>
              {/if}
            </div>
          {/if}

          {#if hasLoadedSong}
            <MixerView initialPlaybackMode lockPlaybackMode liveMode />
          {:else}
            <div class="grid min-h-[45dvh] place-items-center text-muted-foreground">
              <p class="font-mono text-sm">{loadingSongId ? 'Loading song…' : 'Select a song'}</p>
            </div>
          {/if}
        </section>

        {#if $isNarrow && songMenuOpen}
          <!-- Collapsible song list (closed by default) — tap a song to switch + close. -->
          <div class="fixed inset-0 z-[200]">
            <!-- Backdrop is an interactive button (tap outside to close) sitting
                 BEHIND the panel, so panel taps never reach it — no stopPropagation. -->
            <button
              type="button"
              class="absolute inset-0 bg-black/50"
              aria-label="Close song menu"
              onclick={() => (songMenuOpen = false)}
            ></button>
            <div
              class="border-foreground bg-card absolute inset-x-2 top-2 max-h-[75dvh] overflow-hidden rounded-[var(--radius)] border-2"
            >
              <div class="border-foreground/20 bg-card flex items-center justify-between border-b-2 px-3 py-2">
                <span class="text-xs font-black uppercase tracking-wide">Songs</span>
                <button type="button" class="text-muted-foreground px-2 text-sm font-black" onclick={() => (songMenuOpen = false)} aria-label="Close">✕</button>
              </div>
              <ol class="max-h-[calc(75dvh-2.5rem)] overflow-y-auto">
                {#each setlistItems as item, index (item.id)}
                  <li>
                    <button
                      type="button"
                      class="grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 border-b border-foreground/10 px-3 py-3 text-left {item.id === activeSongId ? 'bg-primary text-primary-foreground' : 'active:bg-muted/60'}"
                      onclick={() => {
                        songMenuOpen = false
                        void openSong(item.id)
                      }}
                      disabled={loadingSongId === item.id}
                    >
                      <span class="font-mono text-xs font-black tabular-nums">{index + 1}</span>
                      <span class="min-w-0">
                        <span class="block truncate text-sm font-black">{item.title}</span>
                        <span class="block truncate font-mono text-[11px] opacity-75">
                          {item.keyLabel} · {item.bpmLabel} BPM{item.artist ? ` · ${item.artist}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ol>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</main>
