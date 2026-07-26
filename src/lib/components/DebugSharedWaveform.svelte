<script lang="ts">
  /**
   * Debug-only INTERACTIVE waveform + navigation, meant to be rendered ONCE and
   * shared across every edit tab. The visible window (`viewStart`/`viewEnd`, in
   * seconds) is bindable, so it's owned by the page and persists across tab
   * switches — zoom into a section on Chords, switch to Grid, same view.
   *
   * Real interactivity: zoom (buttons + wheel at cursor), pan (drag on the main
   * lane), and a minimap whose window you can drag. Deterministic mock peaks —
   * no audio. Not used in the shipping app.
   */
  import { sectionKindColor } from '$lib/songmap/sectionColors'

  type Sec = { kind: string; label: string; from: number; to: number }

  let {
    sections = [],
    bars = 96,
    durationSec = 180,
    playheadSec = 34,
    viewStart = $bindable(0),
    viewEnd = $bindable(durationSec),
  }: {
    sections?: Sec[]
    bars?: number
    durationSec?: number
    playheadSec?: number
    viewStart?: number
    viewEnd?: number
  } = $props()

  const MIN_WINDOW = 1.5 // seconds — deepest zoom
  const secPerBar = $derived(durationSec / bars)

  // Deterministic mock peaks (0..1), one per ~120ms.
  const N = 1500
  const PEAKS = Array.from({ length: N }, (_, i) => {
    const s = Math.sin(i * 0.14) * Math.sin(i * 0.031 + 1.3)
    const env = 0.32 + 0.68 * Math.abs(Math.sin(i * 0.006))
    return 0.1 + 0.9 * Math.abs(s) * env
  })
  const peakAt = (sec: number) => PEAKS[Math.max(0, Math.min(N - 1, Math.floor((sec / durationSec) * N)))]!
  const sectionAt = (sec: number) => {
    const bar = sec / secPerBar + 1
    return sections.find((s) => bar >= s.from && bar <= s.to)
  }
  const bandColor = (sec: number) => {
    const s = sectionAt(sec)
    return s ? sectionKindColor(s.kind) : 'var(--muted-foreground)'
  }

  const clampWindow = (a: number, b: number) => {
    let lo = a
    let hi = b
    if (hi - lo < MIN_WINDOW) hi = lo + MIN_WINDOW
    if (lo < 0) {
      hi -= lo
      lo = 0
    }
    if (hi > durationSec) {
      lo -= hi - durationSec
      hi = durationSec
    }
    return [Math.max(0, lo), Math.min(durationSec, hi)] as const
  }

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  const barOf = (sec: number) => Math.floor(sec / secPerBar) + 1

  function zoomBy(factor: number, centerSec?: number) {
    const c = centerSec ?? (viewStart + viewEnd) / 2
    const w = (viewEnd - viewStart) * factor
    const f = (c - viewStart) / (viewEnd - viewStart)
    ;[viewStart, viewEnd] = clampWindow(c - w * f, c + w * (1 - f))
  }
  const zoomIn = () => zoomBy(0.6)
  const zoomOut = () => zoomBy(1 / 0.6)
  const fitAll = () => ([viewStart, viewEnd] = [0, durationSec])

  // ── Canvas drawing (main + minimap) ──
  let mainCanvas = $state<HTMLCanvasElement | null>(null)
  let miniCanvas = $state<HTMLCanvasElement | null>(null)
  let mainW = $state(800)
  const H = 128
  const MINI_H = 40

  function paint(canvas: HTMLCanvasElement, w: number, h: number, from: number, to: number, faded: boolean) {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.floor(w * dpr))
    canvas.height = Math.floor(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const mid = h * 0.5
    const span = to - from
    for (let x = 0; x < w; x++) {
      const sec = from + (x / w) * span
      const p = peakAt(sec)
      const amp = p * (h * 0.42)
      ctx.strokeStyle = colorForSec(sec, faded)
      ctx.globalAlpha = faded ? 0.6 : 0.9
      ctx.beginPath()
      ctx.moveTo(x + 0.5, mid - amp)
      ctx.lineTo(x + 0.5, mid + amp)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  let styleEl: HTMLElement | null = null
  function resolveVar(v: string): string {
    if (!v.startsWith('var(')) return v
    if (!styleEl) return '#888'
    const name = v.slice(4, -1).trim()
    return getComputedStyle(styleEl).getPropertyValue(name).trim() || '#888'
  }
  function colorForSec(sec: number, faded: boolean): string {
    const c = bandColor(sec)
    return c.startsWith('var(') ? resolveVar(c) : c
  }

  // Redraw whenever the window, size, or theme changes.
  $effect(() => {
    // deps
    viewStart
    viewEnd
    mainW
    if (mainCanvas) paint(mainCanvas, mainW, H, viewStart, viewEnd, false)
    if (miniCanvas) paint(miniCanvas, mainW, MINI_H, 0, durationSec, true)
  })

  // Track main lane width.
  $effect(() => {
    if (!mainCanvas) return
    const ro = new ResizeObserver((entries) => {
      mainW = Math.max(1, Math.floor(entries[0]!.contentRect.width))
    })
    ro.observe(mainCanvas)
    return () => ro.disconnect()
  })

  // ── Pointer: pan on main, zoom on wheel, drag window on minimap ──
  function secFromMainX(clientX: number): number {
    if (!mainCanvas) return viewStart
    const r = mainCanvas.getBoundingClientRect()
    const f = (clientX - r.left) / r.width
    return viewStart + f * (viewEnd - viewStart)
  }
  function onMainPointerDown(e: PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const s0 = viewStart
    const e0 = viewEnd
    const secPerPx = (viewEnd - viewStart) / (mainCanvas?.getBoundingClientRect().width || mainW)
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - startX) * secPerPx
      ;[viewStart, viewEnd] = clampWindow(s0 - d, e0 - d)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12, secFromMainX(e.clientX))
  }
  function onMiniPointerDown(e: PointerEvent) {
    e.preventDefault()
    const jumpTo = (clientX: number) => {
      if (!miniCanvas) return
      const r = miniCanvas.getBoundingClientRect()
      const c = ((clientX - r.left) / r.width) * durationSec
      const w = viewEnd - viewStart
      ;[viewStart, viewEnd] = clampWindow(c - w / 2, c + w / 2)
    }
    jumpTo(e.clientX)
    const move = (ev: PointerEvent) => jumpTo(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const winLeftPct = $derived((viewStart / durationSec) * 100)
  const winWidthPct = $derived(((viewEnd - viewStart) / durationSec) * 100)
  const playheadPct = $derived(
    playheadSec >= viewStart && playheadSec <= viewEnd
      ? ((playheadSec - viewStart) / (viewEnd - viewStart)) * 100
      : null,
  )
  const zoomLabel = $derived(`${(durationSec / (viewEnd - viewStart)).toFixed(1)}×`)
</script>

<div class="swf" bind:this={styleEl}>
  <!-- toolbar -->
  <div class="swf-bar">
    <div class="swf-transport">
      <button class="tbtn" aria-label="Play">▶</button>
      <button class="tbtn" aria-label="Stop">■</button>
    </div>
    <span class="swf-view">bars {barOf(viewStart)}–{barOf(viewEnd)} · {fmt(viewStart)}–{fmt(viewEnd)}</span>
    <span class="swf-spacer"></span>
    <div class="swf-zoom">
      <button class="zbtn" onclick={zoomOut} aria-label="Zoom out">−</button>
      <span class="zlabel">{zoomLabel}</span>
      <button class="zbtn" onclick={zoomIn} aria-label="Zoom in">+</button>
      <button class="zbtn fit" onclick={fitAll} aria-label="Fit whole song">Fit</button>
    </div>
  </div>

  <!-- main lane -->
  <div class="swf-main">
    <canvas
      bind:this={mainCanvas}
      class="swf-canvas"
      style:height="{H}px"
      onpointerdown={onMainPointerDown}
      onwheel={onWheel}
    ></canvas>
    {#if playheadPct !== null}
      <div class="swf-playhead" style:left="{playheadPct}%"></div>
    {/if}
    <!-- section band overlay -->
    <div class="swf-bands">
      {#each sections as s (s.label + s.from)}
        {@const from = (s.from - 1) * secPerBar}
        {@const to = s.to * secPerBar}
        {#if to > viewStart && from < viewEnd}
          <span
            class="swf-band"
            style:left="{((Math.max(from, viewStart) - viewStart) / (viewEnd - viewStart)) * 100}%"
            style:width="{((Math.min(to, viewEnd) - Math.max(from, viewStart)) / (viewEnd - viewStart)) * 100}%"
            style:--c={sectionKindColor(s.kind)}
          >
            <span class="swf-band-label">{s.label}</span>
          </span>
        {/if}
      {/each}
    </div>
  </div>

  <!-- minimap -->
  <div class="swf-mini">
    <canvas bind:this={miniCanvas} class="swf-canvas" style:height="{MINI_H}px" onpointerdown={onMiniPointerDown}
    ></canvas>
    <div class="swf-window" style:left="{winLeftPct}%" style:width="{winWidthPct}%"></div>
  </div>
</div>

<style>
  .swf {
    border: 2px solid var(--foreground);
    border-radius: var(--radius);
    background: var(--background);
    box-shadow: 3px 3px 0 var(--brutalist-shadow-color);
    overflow: hidden;
    user-select: none;
  }
  .swf-bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklch, var(--foreground) 12%, transparent);
    background: var(--muted);
  }
  .swf-transport {
    display: flex;
    gap: 0.25rem;
  }
  .tbtn {
    width: 1.7rem;
    height: 1.7rem;
    border: 0;
    border-radius: var(--radius);
    background: var(--foreground);
    color: var(--background);
    font-size: 0.7rem;
    cursor: pointer;
  }
  .tbtn:hover {
    background: var(--studio-orange);
    color: #1a1a1a;
  }
  .swf-view {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .swf-spacer {
    flex: 1;
  }
  .swf-zoom {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .zbtn {
    min-width: 1.7rem;
    height: 1.7rem;
    padding: 0 0.5rem;
    border: 1px solid color-mix(in oklch, var(--foreground) 25%, transparent);
    border-radius: var(--radius);
    background: var(--background);
    color: var(--foreground);
    font-weight: 900;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .zbtn:hover {
    background: var(--foreground);
    color: var(--background);
  }
  .zbtn.fit {
    font-size: 0.72rem;
    font-weight: 800;
  }
  .zlabel {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted-foreground);
    min-width: 2.4rem;
    text-align: center;
  }
  .swf-main {
    position: relative;
    cursor: grab;
  }
  .swf-main:active {
    cursor: grabbing;
  }
  .swf-canvas {
    display: block;
    width: 100%;
    touch-action: none;
  }
  .swf-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--studio-orange);
    pointer-events: none;
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--studio-orange) 22%, transparent);
  }
  .swf-bands {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 15px;
    pointer-events: none;
  }
  .swf-band {
    position: absolute;
    bottom: 0;
    height: 15px;
    display: flex;
    align-items: center;
    padding-left: 0.25rem;
    background: color-mix(in oklch, var(--c) 26%, transparent);
    border-left: 2px solid var(--c);
    overflow: hidden;
  }
  .swf-band-label {
    font-size: 0.54rem;
    font-weight: 900;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--foreground);
    opacity: 0.75;
  }
  .swf-mini {
    position: relative;
    border-top: 1px solid color-mix(in oklch, var(--foreground) 12%, transparent);
    background: color-mix(in oklch, var(--foreground) 4%, var(--background));
    cursor: pointer;
  }
  .swf-window {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in oklch, var(--studio-orange) 18%, transparent);
    border: 1px solid var(--studio-orange);
    border-radius: 2px;
    pointer-events: none;
  }
</style>
