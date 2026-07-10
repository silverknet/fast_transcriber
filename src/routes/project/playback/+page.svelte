<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import MixerView from '$lib/components/MixerView.svelte'
  import { Button } from '$lib/components/ui/button'
  import { formatSongKeyLabel } from '$lib/chords'
  import { loadProjectSongIntoEditor, refreshProjectInfo } from '$lib/project/commit'
  import { project as projectStore } from '$lib/stores/project'
  import { songMap } from '$lib/stores/songMap'
  import { ArrowLeft, Maximize2, Minimize2, Music4, Play, RefreshCw } from '@lucide/svelte'

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
  let refreshing = $state(false)
  let fullscreen = $state(false)
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
      await loadProjectSongIntoEditor(songId)
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
  <div class="flex min-h-dvh flex-col gap-3 px-3 py-3 lg:px-4">
    <header class="flex shrink-0 flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" class="h-9 gap-1.5" onclick={backToProject}>
        <ArrowLeft class="size-4" aria-hidden="true" />
        Project
      </Button>
      <div class="min-w-0 flex-1">
        <p class="text-muted-foreground text-[10px] font-black uppercase tracking-wide">Live playback</p>
        <h1 class="truncate text-2xl font-black leading-none sm:text-3xl">{projectName}</h1>
      </div>
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

        <section class="min-h-0 overflow-y-auto rounded-[var(--radius)] border-2 border-foreground bg-background p-3">
          <div class="mb-3 flex flex-wrap items-center gap-2">
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

          {#if hasLoadedSong}
            <MixerView initialPlaybackMode lockPlaybackMode liveMode />
          {:else}
            <div class="grid min-h-[45dvh] place-items-center text-muted-foreground">
              <p class="font-mono text-sm">{loadingSongId ? 'Loading song…' : 'Select a song'}</p>
            </div>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</main>
