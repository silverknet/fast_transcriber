<script lang="ts">
  import { computePeaks, drawPeaksToCanvas } from '$lib/audio/peaks'
  import { waveformBlockBucketCount } from '$lib/audio/waveformBlocks'

  let {
    buffer,
    color = '#f97316',
    positionSec,
    durationSec,
    sectionBands = [],
    onSeekFraction,
  } = $props<{
    buffer: AudioBuffer | null
    color?: string
    positionSec: number
    durationSec: number
    sectionBands?: { startFrac: number; endFrac: number; label: string; index: number }[]
    onSeekFraction: (frac: number) => void
  }>()

  const WAVE_HEIGHT = 92

  let canvas = $state<HTMLCanvasElement | undefined>()
  let waveWrap = $state<HTMLDivElement | undefined>()
  let waveWidth = $state(0)

  let playheadFrac = $derived(durationSec > 0 ? Math.max(0, Math.min(1, positionSec / durationSec)) : 0)

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
    drawPeaksToCanvas(canvas, peaks, waveWidth, WAVE_HEIGHT)
  })

  function seekFromPointer(e: MouseEvent) {
    if (!waveWrap || durationSec <= 0) return
    const rect = waveWrap.getBoundingClientRect()
    onSeekFraction(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }
</script>

<div
  bind:this={waveWrap}
  class="bg-muted/35 ring-foreground/10 relative w-full cursor-pointer overflow-hidden rounded-[var(--radius)] ring-1"
  style="height: {WAVE_HEIGHT}px"
  onclick={seekFromPointer}
  onkeydown={(e) => {
    if (e.key === 'ArrowLeft') onSeekFraction(Math.max(0, playheadFrac - 0.02))
    else if (e.key === 'ArrowRight') onSeekFraction(Math.min(1, playheadFrac + 0.02))
    else if (e.key === 'Home') onSeekFraction(0)
  }}
  role="slider"
  tabindex="0"
  aria-label="Playback waveform"
  aria-valuemin="0"
  aria-valuemax={durationSec || 0}
  aria-valuenow={positionSec}
>
  {#each sectionBands as band (band.index)}
    <div
      class="pointer-events-none absolute top-0 bottom-0"
      style="left: {band.startFrac * 100}%; width: {(band.endFrac - band.startFrac) *
        100}%; border-left: 1px solid color-mix(in oklch, var(--foreground) 18%, transparent); {band.index %
        2 ===
      0
        ? 'background: color-mix(in oklch, var(--foreground) 6%, transparent);'
        : ''}"
    ></div>
  {/each}

  {#if buffer}
    <canvas bind:this={canvas} class="absolute inset-0"></canvas>
    <div
      class="bg-primary pointer-events-none absolute top-0 bottom-0 w-1 rounded-full"
      style="left: calc({playheadFrac * 100}% - 2px)"
    ></div>
  {:else}
    <div class="text-muted-foreground flex h-full items-center justify-center text-sm font-bold">
      Loading waveform...
    </div>
  {/if}

  {#each sectionBands as band (band.index)}
    <span
      class="text-foreground/60 pointer-events-none absolute top-2 truncate text-[10px] font-black uppercase"
      style="left: {band.startFrac * 100}%; max-width: {(band.endFrac - band.startFrac) *
        100}%; padding-left: 6px;"
    >{band.label}</span>
  {/each}
</div>
