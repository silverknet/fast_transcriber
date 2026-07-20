<script lang="ts">
  import { computePeaks, drawPeaksToCanvas } from '$lib/audio/peaks'
  import { waveformBlockBucketCount } from '$lib/audio/waveformBlocks'

  type SectionBand = { startFrac: number; endFrac: number; label: string; index: number }

  let {
    buffer,
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
    onSeekFraction,
  } = $props<{
    buffer: AudioBuffer | null
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
    onSeekFraction: (frac: number) => void
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

  $effect(() => {
    if (!canvas || !buffer || waveWidth <= 0) return
    const peaks = computePeaks(buffer, 0, buffer.duration, waveformBlockBucketCount(waveWidth))
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.strokeStyle = color
    drawPeaksToCanvas(canvas, peaks, waveWidth, height)
  })

  function seekFromPointer(e: MouseEvent) {
    if (!waveWrap || durationSec <= 0) return
    const rect = waveWrap.getBoundingClientRect()
    onSeekFraction(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }

  function seekBy(delta: number) {
    onSeekFraction(Math.max(0, Math.min(1, playheadFrac + delta)))
  }
</script>

<div
  bind:this={waveWrap}
  class="bg-muted/30 relative min-w-0 cursor-pointer overflow-hidden rounded-[var(--radius)] {className}"
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
      style="left: {band.startFrac * 100}%; width: {(band.endFrac - band.startFrac) *
        100}%; border-left: 1px solid color-mix(in oklch, var(--foreground) 16%, transparent); {band.index %
        2 ===
      0
        ? 'background: color-mix(in oklch, var(--foreground) 7%, transparent);'
        : ''}"
    ></div>
  {/each}

  {#if buffer}
    <canvas bind:this={canvas} class="absolute inset-0 z-[1]"></canvas>
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
        class="text-foreground/65 pointer-events-none absolute top-1 truncate pl-1 text-[9px] font-black uppercase leading-none tracking-wide"
        style="left: {band.startFrac * 100}%; max-width: {(band.endFrac - band.startFrac) * 100}%"
      >{band.label}</span>
    {/each}
  {/if}
</div>
