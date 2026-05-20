<script lang="ts">
  /**
   * One track lane in the multi-track mixer. Layout:
   *
   *   [ name ] [ M ][ S ] [ vol slider ] [ waveform canvas + playhead ]
   *
   * Waveform is drawn once per buffer (downsampled to canvas width). The
   * playhead line is overlaid via absolute positioning so we don't repaint
   * the canvas on every rAF tick.
   */
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { computePeaks, drawPeaksToCanvas } from '$lib/audio/peaks'

  let {
    label,
    buffer,
    volume,
    muted,
    soloed,
    positionSec,
    durationSec,
    color = '#7c3aed',
    onVolumeChange,
    onToggleMuted,
    onToggleSoloed,
    onSeekFraction,
  } = $props<{
    label: string
    buffer: AudioBuffer | null
    volume: number
    muted: boolean
    soloed: boolean
    /** Mix-timeline playhead, seconds. */
    positionSec: number
    /** Mix-timeline total length, seconds. */
    durationSec: number
    /** Waveform stroke color. */
    color?: string
    onVolumeChange: (v: number) => void
    onToggleMuted: () => void
    onToggleSoloed: () => void
    /** Fraction is 0..1 relative to mix duration. */
    onSeekFraction: (frac: number) => void
  }>()

  let canvas = $state<HTMLCanvasElement | undefined>()
  let waveWrap = $state<HTMLDivElement | undefined>()
  let waveWidth = $state(0)
  const WAVE_HEIGHT = 44

  /** This lane's buffer duration; may be shorter than mix duration. */
  let bufferDur = $derived(buffer ? buffer.duration : 0)
  /** Where this lane's audio ends, expressed as a fraction of mix duration. */
  let endFrac = $derived(durationSec > 0 ? bufferDur / durationSec : 0)
  let playheadFrac = $derived(durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0)

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
    const peaks = computePeaks(buffer, 0, buffer.duration, waveWidth)
    const ctx2 = canvas.getContext('2d')
    if (ctx2) ctx2.strokeStyle = color
    drawPeaksToCanvas(canvas, peaks, waveWidth, WAVE_HEIGHT)
  })

  function onWaveClick(e: MouseEvent) {
    if (!waveWrap || durationSec <= 0) return
    const rect = waveWrap.getBoundingClientRect()
    const x = e.clientX - rect.left
    const frac = Math.max(0, Math.min(1, x / rect.width))
    onSeekFraction(frac)
  }
</script>

<div class="border-foreground/30 bg-background flex items-center gap-2 border-2 px-2 py-1.5">
  <!-- Name -->
  <div class="w-28 shrink-0 min-w-0">
    <div class="truncate text-xs font-semibold">{label}</div>
    <div class="text-muted-foreground font-mono text-[10px] truncate">
      {buffer ? `${buffer.duration.toFixed(1)}s` : '—'}
    </div>
  </div>

  <!-- M / S -->
  <div class="flex shrink-0 gap-0.5">
    <Button
      variant={muted ? 'default' : 'outline'}
      size="sm"
      class="h-7 w-7 p-0 font-mono text-[11px]"
      onclick={onToggleMuted}
      aria-label="Mute"
      title="Mute"
    >
      M
    </Button>
    <Button
      variant={soloed ? 'default' : 'outline'}
      size="sm"
      class="h-7 w-7 p-0 font-mono text-[11px] {soloed ? 'bg-amber-500 hover:bg-amber-500/90' : ''}"
      onclick={onToggleSoloed}
      aria-label="Solo"
      title="Solo"
    >
      S
    </Button>
  </div>

  <!-- Volume -->
  <input
    type="range"
    min="0"
    max="1.5"
    step="0.01"
    value={volume}
    oninput={(e) => onVolumeChange(parseFloat((e.currentTarget as HTMLInputElement).value))}
    class="w-28 shrink-0 accent-foreground"
    aria-label="{label} volume"
    title="Volume {Math.round(volume * 100)}%"
  />
  <span class="text-muted-foreground w-9 shrink-0 text-right font-mono text-[10px] tabular-nums">
    {Math.round(volume * 100)}%
  </span>

  <!-- Waveform + playhead -->
  <div
    bind:this={waveWrap}
    class="bg-muted/30 relative min-w-0 flex-1 cursor-pointer"
    style="height: {WAVE_HEIGHT}px"
    onclick={onWaveClick}
    onkeydown={(e) => {
      if (e.key === 'ArrowLeft') onSeekFraction(Math.max(0, playheadFrac - 0.02))
      else if (e.key === 'ArrowRight') onSeekFraction(Math.min(1, playheadFrac + 0.02))
      else if (e.key === 'Home') onSeekFraction(0)
    }}
    role="slider"
    tabindex="0"
    aria-label="Seek {label}"
    aria-valuemin="0"
    aria-valuemax={durationSec || 0}
    aria-valuenow={positionSec}
  >
    {#if buffer}
      <canvas bind:this={canvas} class="absolute inset-0"></canvas>
      <!-- Boundary line where this buffer ends on the mix timeline -->
      {#if endFrac < 1}
        <div
          class="bg-foreground/30 pointer-events-none absolute top-0 bottom-0 w-px"
          style="left: {endFrac * 100}%"
        ></div>
      {/if}
      <!-- Playhead -->
      <div
        class="bg-rose-500 pointer-events-none absolute top-0 bottom-0 w-px"
        style="left: {playheadFrac * 100}%"
      ></div>
    {:else}
      <div class="text-muted-foreground flex h-full items-center justify-center text-[10px]">
        loading…
      </div>
    {/if}
  </div>
</div>
