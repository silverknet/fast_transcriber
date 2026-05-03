<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import { trimAudioFileToWav } from '$lib/audio/trimAudio'
  import { analyzingState } from '$lib/stores/analyzingState'
  import { songMap, patchSongMap } from '$lib/stores/songMap'
  import { mergeAnalysisIntoSongMap } from '$lib/songmap/merge'
  import { setAnalyzingSpin } from '$lib/stores/uiAnimations'
  import type { AnalyzeResponse } from '$lib/server/analysis/contracts'

  let status = $state<'running' | 'done' | 'error'>('running')
  let errorMsg = $state('')

  // ── Dot-grid canvas ──────────────────────────────────────────────────────
  let canvas = $state<HTMLCanvasElement>()

  // ~0.75 cm at 96 dpi; dot radius varies ±1.5 px around a 2 px base (max ~3.5 px ≈ 0.18 cm diameter)
  const SPACING = 19
  const BASE_R  = 2.7
  const AMP     = 1.8

  $effect(() => {
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dpr  = window.devicePixelRatio || 1
    let cssW = 0
    let cssH = 0
    let rafId = 0

    function resize() {
      dpr  = window.devicePixelRatio || 1
      cssW = canvas!.offsetWidth
      cssH = canvas!.offsetHeight
      canvas!.width  = Math.round(cssW * dpr)
      canvas!.height = Math.round(cssH * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    function frame() {
      rafId = requestAnimationFrame(frame)
      const t = performance.now() / 1000

      ctx!.clearRect(0, 0, cssW, cssH)

      const dark = document.documentElement.classList.contains('dark')
      ctx!.fillStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.13)'

      const cols = Math.ceil(cssW / SPACING) + 1
      const rows = Math.ceil(cssH / SPACING) + 1

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * SPACING
          const y = row * SPACING

          // Two overlapping waves for a more organic feel
          const wave =
            Math.sin(x * 0.016 - t * 4.6) * 0.65 +
            Math.sin(x * 0.009 + y * 0.011 - t * 1.6) * 0.35

          const r = BASE_R + wave * AMP
          if (r <= 0.3) continue

          ctx!.beginPath()
          ctx!.arc(x, y, r, 0, Math.PI * 2)
          ctx!.fill()
        }
      }
    }

    rafId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  })

  // ── Analysis ─────────────────────────────────────────────────────────────
  import { page } from '$app/stores'

  const preview = browser && $page.url.searchParams.has('preview')

  onMount(() => {
    if (!browser || preview) return
    void run()
  })

  async function run() {
    const state = get(analyzingState)
    const sm = get(songMap)

    if (!state || !sm?.audio) {
      await goto('/')
      return
    }

    const trim = sm.audio.trim
    setAnalyzingSpin(true)

    try {
      const { file: trimmedWav } = await trimAudioFileToWav(
        state.hqFile,
        trim.startSec,
        trim.endSec,
      )

      const form = new FormData()
      form.set('file', trimmedWav, trimmedWav.name)

      const res = await fetch('/api/analyze', { method: 'POST', body: form })
      let data: AnalyzeResponse
      try {
        data = (await res.json()) as AnalyzeResponse
      } catch {
        throw new Error('Invalid response from server')
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.ok === false ? data.error : 'Analysis failed')
      }

      const fragment = {
        bars:  data.songMap.timeline.bars,
        beats: data.songMap.timeline.beats,
        bpm:   data.songMap.metadata.bpm,
      }

      const patched = patchSongMap((current) => {
        const merged = mergeAnalysisIntoSongMap(current, fragment)
        return {
          ...merged,
          metadata: {
            ...merged.metadata,
            ...(fragment.bpm !== undefined ? { bpm: fragment.bpm } : {}),
            analyzed: true,
          },
        }
      })

      if (!patched.ok) throw new Error(patched.errors.join('; '))

      analyzingState.set(null)
      status = 'done'
      await goto('/edit')
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Analysis failed. Please try again.'
      status = 'error'
    } finally {
      setAnalyzingSpin(false)
    }
  }

  async function retry() {
    status = 'running'
    errorMsg = ''
    await run()
  }

  function cancel() {
    analyzingState.set(null)
    void goto('/')
  }
</script>

<!-- Dot-grid background -->
<canvas
  bind:this={canvas}
  class="fixed inset-0 -z-10 h-full w-full pointer-events-none"
  aria-hidden="true"
></canvas>

<main
  class="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16"
>
  {#if status === 'running'}
    <div class="flex flex-col items-center gap-6 text-center">
      <div
        class="border-muted-foreground/30 border-t-foreground/80 size-16 animate-spin rounded-full border-4"
      ></div>
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-black tracking-tight">Analyzing</h1>
        <p class="text-muted-foreground text-sm">
          Detecting beats and bars from your audio. This takes a few seconds.
        </p>
      </div>
    </div>
  {:else if status === 'error'}
    <div
      class="brutalist-shadow border-foreground bg-background w-full max-w-md border-2 p-8 text-center"
    >
      <h1 class="mb-3 text-xl font-black">Analysis failed</h1>
      <p class="text-muted-foreground mb-6 text-sm">{errorMsg}</p>
      <div class="flex justify-center gap-3">
        <Button class="" variant="default" onclick={retry}>Try again</Button>
        <Button class="" variant="outline" onclick={cancel}>Back to import</Button>
      </div>
    </div>
  {/if}
</main>
