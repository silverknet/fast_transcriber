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
  import type { SongMap } from '$lib/songmap'

  let status = $state<'running' | 'done' | 'error'>('running')
  let errorMsg = $state('')

  // ── Dot-grid canvas ──────────────────────────────────────────────────────
  let canvas = $state<HTMLCanvasElement>()

  // ── 3D "fabric" grid ────────────────────────────────────────────────────
  // A flat lattice of nodes, each given a Z, projected through a tiny pinhole
  // camera. A couple of Gaussian "metal balls" roll across the sheet and pull
  // it toward the camera — like watching a stretched fabric from below while
  // something heavy rolls on top: the dented region bulges out and magnifies.
  //
  //   world node   : (x, y, z)          z = CAM_D − bump(x, y, t)
  //   projection   : s = CAM_D / z       screenX = cx + x·s,  screenY = cy + y·s
  //   bump lowers z  ⇒  s > 1  ⇒  that patch spreads out + its dots grow.
  const CELL = 40 // grid spacing in world units (≈ px on the flat baseline)
  const CAM_D = 1000 // depth of the flat sheet; doubles as the focal length
  const BUMP_A = 430 // how far a ball pulls the sheet toward the camera
  const BUMP_SIGMA = 150 // ball footprint (world units)
  const OVERSCAN = 1.4 // extra lattice past the screen so magnified edges stay covered
  const BASE_R = 1.5 // dot radius on the flat baseline

  $effect(() => {
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dpr = window.devicePixelRatio || 1
    let cssW = 0
    let cssH = 0
    let rafId = 0
    let cols = 0
    let rows = 0
    let halfW = 0
    let halfH = 0
    let px = new Float32Array(0)
    let py = new Float32Array(0)
    let pr = new Float32Array(0)

    function resize() {
      dpr = window.devicePixelRatio || 1
      cssW = canvas!.offsetWidth
      cssH = canvas!.offsetHeight
      canvas!.width = Math.round(cssW * dpr)
      canvas!.height = Math.round(cssH * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Lattice sized to cover the (over-scanned) viewport in world units.
      halfW = (cssW / 2) * OVERSCAN
      halfH = (cssH / 2) * OVERSCAN
      cols = Math.max(2, Math.ceil((halfW * 2) / CELL) + 1)
      rows = Math.max(2, Math.ceil((halfH * 2) / CELL) + 1)
      const n = cols * rows
      px = new Float32Array(n)
      py = new Float32Array(n)
      pr = new Float32Array(n)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    function frame() {
      rafId = requestAnimationFrame(frame)
      const t = performance.now() / 1000

      ctx!.clearRect(0, 0, cssW, cssH)
      const dark = document.documentElement.classList.contains('dark')
      const cx = cssW / 2
      const cy = cssH / 2

      // Two heavy balls rolling on independent, slowly-wandering paths.
      const b1x = Math.sin(t * 0.34) * halfW * 0.62
      const b1y = Math.cos(t * 0.27) * halfH * 0.55
      const b2x = Math.cos(t * 0.23 + 1.3) * halfW * 0.5
      const b2y = Math.sin(t * 0.31 + 0.6) * halfH * 0.62
      const inv2s2 = 1 / (2 * BUMP_SIGMA * BUMP_SIGMA)

      // Project every node. z shrinks under a ball → s magnifies that patch.
      for (let j = 0; j < rows; j++) {
        const wy = j * CELL - halfH
        for (let i = 0; i < cols; i++) {
          const wx = i * CELL - halfW
          const dx1 = wx - b1x
          const dy1 = wy - b1y
          const dx2 = wx - b2x
          const dy2 = wy - b2y
          const bump =
            BUMP_A * Math.exp(-(dx1 * dx1 + dy1 * dy1) * inv2s2) +
            BUMP_A * 0.85 * Math.exp(-(dx2 * dx2 + dy2 * dy2) * inv2s2)
          const s = CAM_D / (CAM_D - bump)
          const idx = j * cols + i
          px[idx] = cx + wx * s
          py[idx] = cy + wy * s
          pr[idx] = BASE_R * s * s // grow faster than linear so the bump pops
        }
      }

      // Mesh: one path, uniform faint stroke — the deformation itself sells 3D.
      ctx!.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)'
      ctx!.lineWidth = 1
      ctx!.beginPath()
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const idx = j * cols + i
          if (i < cols - 1) {
            ctx!.moveTo(px[idx], py[idx])
            ctx!.lineTo(px[idx + 1], py[idx + 1])
          }
          if (j < rows - 1) {
            ctx!.moveTo(px[idx], py[idx])
            ctx!.lineTo(px[idx + cols], py[idx + cols])
          }
        }
      }
      ctx!.stroke()

      // Nodes: radius grows toward the camera for a depth pop.
      ctx!.fillStyle = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)'
      for (let idx = 0; idx < px.length; idx++) {
        const r = pr[idx]
        if (r <= 0.25) continue
        ctx!.beginPath()
        ctx!.arc(px[idx], py[idx], r, 0, Math.PI * 2)
        ctx!.fill()
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
  import { restorableSongState } from '$lib/songmap/session'
  import { audioSession } from '$lib/stores/audioSession'
  import { project as projectStore } from '$lib/stores/project'
  import { commitNewSongToProject, updateActiveProjectSong } from '$lib/project/commit'
  import { analyzeDownbeatsViaDesktop } from '$lib/client/desktopBridge'
  import { beatsToSongMap } from '$lib/analysis/beatsToSongMap'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'

  const preview = browser && $page.url.searchParams.has('preview')
  const isProjectFlow = browser && $page.url.searchParams.has('project')

  onMount(() => {
    if (!browser || preview) return
    void run()
  })

  async function run() {
    const state = get(analyzingState)
    const sm = get(songMap)
    const hqFile = state?.hqFile ?? get(audioSession).file

    if (!hqFile || !sm?.audio) {
      await goto('/')
      return
    }

    const trim = sm.audio.trim
    setAnalyzingSpin(true)

    try {
      // Diagnostic — every "no beats detected" report we've gotten has
      // boiled down to one of: zero-length trim, missing hqFile, or a
      // sidecar problem. Log all three so we can read the cause off
      // the browser console without guessing.
      console.info('[analyze] trim:', trim, 'hqFile:', {
        name: hqFile.name,
        size: hqFile.size,
        type: hqFile.type,
      })
      const { file: trimmedWav } = await trimAudioFileToWav(
        hqFile,
        trim.startSec,
        trim.endSec,
      )
      console.info('[analyze] trimmed WAV bytes:', trimmedWav.size, 'duration:', trim.endSec - trim.startSec, 's')
      if (trimmedWav.size < 50_000) {
        throw new Error(
          `The trimmed audio is only ${trimmedWav.size} bytes — the trim range may be empty (start ${trim.startSec.toFixed(1)}s → end ${trim.endSec.toFixed(1)}s). Go back, drag the trim handles to cover at least 10 seconds of audible audio, and try again.`,
        )
      }

      // Analysis runs exclusively through the desktop sidecar — the
      // root layout redirects unreachable-sidecar sessions to /download
      // before they can ever reach this route, so we only need a single
      // happy path. Any sidecar error throws cleanly to the user.
      if (!get(desktopCompanionStatus).reachable) {
        throw new Error('BarBro Desktop isn’t running. Start it and reload.')
      }
      const r = await analyzeDownbeatsViaDesktop(trimmedWav)
      if (!r.ok) {
        throw new Error(`Analysis failed: ${r.error ?? 'unknown error'}`)
      }
      const analyzedSongMap: SongMap = beatsToSongMap({
        filename: trimmedWav.name,
        durationSec: Math.max(0, trim.endSec - trim.startSec),
        mimeType: trimmedWav.type || 'audio/wav',
        beats: r.beats,
      })

      const fragment = {
        bars:  analyzedSongMap.timeline.bars,
        beats: analyzedSongMap.timeline.beats,
        bpm:   analyzedSongMap.metadata.bpm,
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

      // Project-flow persist before navigating to /edit, so the analyzed map
      // is on disk regardless of autosave timing.
      if (isProjectFlow && get(projectStore).data) {
        const ps = get(projectStore)
        const sm2 = get(songMap)
        if (!sm2) throw new Error('Internal: songMap missing after analysis')
        const sess = get(audioSession)
        const state = restorableSongState(sm2, sess.file ?? null)
        // An existing project song (audio attached via the row's "Add audio")
        // already owns a folder + manifest entry — update it in place.
        // Calling commitNewSongToProject here would duplicate the song and
        // leave the original unanalyzed, so re-opening it re-triggers analysis
        // forever. Only a brand-new song (from the import flow, no active
        // project song) needs a fresh folder allocated.
        const isExistingSong =
          ps.editingMode === 'project-song' &&
          !!ps.activeSongFolder &&
          !!ps.activeSongId &&
          (ps.data?.songs.some(
            (e) => e.folder === ps.activeSongFolder && e.id === ps.activeSongId,
          ) ??
            false)
        try {
          if (isExistingSong) {
            await updateActiveProjectSong(state)
          } else {
            await commitNewSongToProject(state)
          }
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : 'Could not save song into project')
        }
      }

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

<!-- 3D fabric-grid background. z-0 (not -z-10) so it sits ABOVE the app-frame's
     opaque background but below the page content (main is z-10). -->
<canvas
  bind:this={canvas}
  class="fixed inset-0 z-0 h-full w-full pointer-events-none"
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
