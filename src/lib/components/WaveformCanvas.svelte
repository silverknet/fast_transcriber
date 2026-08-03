<script lang="ts">
  import { computePeaks, drawPeaksToCanvas } from '$lib/audio/peaks'
  import { waveformBlockBucketCount } from '$lib/audio/waveformBlocks'
  import { themeTick } from '$lib/stores/theme'
  import type { MidiVisual } from '$lib/audio/mixerEngine'

  type SectionBand = {
    id?: string
    startFrac: number
    endFrac: number
    label: string
    index: number
    color?: string
  }

  let {
    buffer,
    midiVisual = null,
    color = '#f97316',
    height,
    positionSec,
    durationSec,
    sectionBands = [],
    showSectionLabels = false,
    bufferEndFraction = null,
    label = 'Waveform',
    loadingLabel = 'Loading waveform...',
    playheadClass = 'bg-primary pointer-events-none absolute top-0 bottom-0 z-[2] w-px',
    class: className = '',
    activeSectionId = null,
    onSeekFraction,
    onSectionSelect,
  } = $props<{
    buffer: AudioBuffer | null
    /** Draw a MIDI pattern instead of a waveform (a lane has one or the other). */
    midiVisual?: MidiVisual | null
    color?: string
    height: number
    positionSec: number
    durationSec: number
    sectionBands?: SectionBand[]
    showSectionLabels?: boolean
    bufferEndFraction?: number | null
    label?: string
    loadingLabel?: string
    playheadClass?: string
    class?: string
    /** Highlight one arrangement section; used by machine lanes. */
    activeSectionId?: string | null
    onSeekFraction: (frac: number) => void
    /** When present, clicking a section selects it instead of seeking. */
    onSectionSelect?: (sectionId: string) => void
  }>()

  let canvas = $state<HTMLCanvasElement | undefined>()
  let waveWrap = $state<HTMLDivElement | undefined>()
  let waveWidth = $state(0)
  let playheadFrac = $derived(durationSec > 0 ? Math.max(0, Math.min(1, positionSec / durationSec)) : 0)
  let safeBufferEndFraction = $derived(
    bufferEndFraction == null ? null : Math.max(0, Math.min(1, bufferEndFraction)),
  )

  $effect(() => {
    if (!waveWrap) return
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0)
      if (w > 0 && w !== waveWidth) waveWidth = w
    })
    ro.observe(waveWrap)
    return () => ro.disconnect()
  })

  /**
   * Draw a MIDI part as a compact drum grid: one row per voice, kick lowest,
   * each hit a tick whose height and opacity follow its velocity. Far more
   * readable at 44 px than a waveform would be, and it shows the groove, the
   * fills and where a section changes feel.
   */
  function drawMidi(cv: HTMLCanvasElement, visual: MidiVisual): void {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    cv.width = Math.max(1, Math.floor(waveWidth * dpr))
    cv.height = Math.max(1, Math.floor(height * dpr))
    cv.style.width = `${waveWidth}px`
    cv.style.height = `${height}px`
    const c = cv.getContext('2d')
    if (!c) return
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, waveWidth, height)
    if (durationSec <= 0 || visual.rows <= 0) return

    const stroke = getComputedStyle(cv).color
    const rowH = height / visual.rows
    // Faint row guides so an empty voice still reads as a lane, not a gap.
    c.strokeStyle = stroke
    c.globalAlpha = 0.1
    c.lineWidth = 1
    for (let r = 1; r < visual.rows; r++) {
      const y = Math.round(r * rowH) + 0.5
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(waveWidth, y)
      c.stroke()
    }

    c.fillStyle = stroke
    const tickW = Math.max(1.5, Math.min(3, waveWidth / 600))
    for (const h of visual.hits) {
      const x = (h.timeSec / durationSec) * waveWidth
      if (x < -2 || x > waveWidth + 2) continue
      // row 0 at the BOTTOM
      const top = height - (h.row + 1) * rowH
      const g = Math.max(0, Math.min(1, h.gain))
      const barH = Math.max(1.5, rowH * (0.35 + 0.6 * g))
      c.globalAlpha = 0.45 + 0.55 * g
      c.fillRect(x - tickW / 2, top + (rowH - barH) / 2, tickW, barH)
    }
    c.globalAlpha = 1
  }

  $effect(() => {
    void $themeTick // redraw when light/dark flips — canvas holds concrete pixels
    if (!canvas || waveWidth <= 0) return
    if (!buffer) {
      if (midiVisual) drawMidi(canvas, midiVisual)
      return
    }
    const peaks = computePeaks(buffer, 0, buffer.duration, waveformBlockBucketCount(waveWidth))
    const ctx = canvas.getContext('2d')
    // Resolve the stroke from the canvas's own computed `color` (set to `color`
    // below) so a CSS token like `var(--foreground)` becomes a concrete,
    // theme-correct rgb the canvas can paint.
    if (ctx) ctx.strokeStyle = getComputedStyle(canvas).color
    drawPeaksToCanvas(canvas, peaks, waveWidth, height)
  })

  function bandAtFraction(frac: number): SectionBand | null {
    const clamped = Math.max(0, Math.min(1, frac))
    return (
      sectionBands.find((band, i) => {
        if (!band.id) return false
        const isLast = i === sectionBands.length - 1
        return clamped >= band.startFrac && (clamped < band.endFrac || isLast)
      }) ?? null
    )
  }

  function seekFromPointer(e: MouseEvent) {
    if (!waveWrap || durationSec <= 0) return
    const rect = waveWrap.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const band = onSectionSelect ? bandAtFraction(frac) : null
    if (band?.id) {
      onSectionSelect?.(band.id)
      return
    }
    onSeekFraction(frac)
  }

  function seekBy(delta: number) {
    onSeekFraction(Math.max(0, Math.min(1, playheadFrac + delta)))
  }
</script>

<div
  bind:this={waveWrap}
  class="bg-muted/30 relative min-w-0 overflow-hidden rounded-[var(--radius)] {onSectionSelect
    ? 'cursor-crosshair'
    : 'cursor-pointer'} {className}"
  style="height: {height}px"
  onclick={seekFromPointer}
  onkeydown={(e) => {
    if (e.key === 'ArrowLeft') seekBy(-0.02)
    else if (e.key === 'ArrowRight') seekBy(0.02)
    else if (e.key === 'Home') onSeekFraction(0)
  }}
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin="0"
  aria-valuemax={durationSec || 0}
  aria-valuenow={positionSec}
>
  {#each sectionBands as band (band.index)}
    <div
      class="pointer-events-none absolute top-0 bottom-0"
      style="left: {band.startFrac * 100}%; width: {(band.endFrac - band.startFrac) * 100}%; background: {band.id &&
      band.id === activeSectionId
        ? `color-mix(in oklch, ${band.color ?? 'var(--foreground)'} 24%, transparent)`
        : band.color
        ? `color-mix(in oklch, ${band.color} 13%, transparent)`
        : band.index % 2 === 0
          ? 'color-mix(in oklch, var(--foreground) 4%, transparent)'
          : 'transparent'};"
    ></div>
    {#if band.id && band.id === activeSectionId}
      <div
        class="border-foreground/45 pointer-events-none absolute top-0 bottom-0 z-[1] border-y-2"
        style="left: {band.startFrac * 100}%; width: {(band.endFrac - band.startFrac) * 100}%;"
      ></div>
    {/if}
  {/each}

  {#if buffer || midiVisual}
    <canvas bind:this={canvas} class="absolute inset-0 z-[1]" style="color: {color}"></canvas>
    {#if safeBufferEndFraction !== null && safeBufferEndFraction < 1}
      <div
        class="bg-foreground/30 pointer-events-none absolute top-0 bottom-0 z-[2] w-px"
        style="left: {safeBufferEndFraction * 100}%"
      ></div>
    {/if}
    <div class={playheadClass} style="left: {playheadFrac * 100}%"></div>
  {:else}
    <div class="text-muted-foreground flex h-full items-center justify-center text-[10px] font-bold">
      {loadingLabel}
    </div>
  {/if}

  {#if showSectionLabels}
    {#each sectionBands as band (band.index)}
      <span
        class="text-foreground/90 bg-background/75 pointer-events-none absolute top-1 z-[3] truncate rounded-sm px-1 py-0.5 text-[9px] font-black uppercase leading-none tracking-wide backdrop-blur-[2px]"
        style="left: {band.startFrac * 100}%; max-width: {(band.endFrac - band.startFrac) *
          100}%; text-shadow: 0 0 3px var(--background), 0 0 4px var(--background);"
      >{band.label}</span>
    {/each}
  {/if}
</div>
