<script lang="ts">
  /**
   * One track lane in the multi-track mixer. Layout:
   *
   *   [ name ] [ M ][ S ] [ vol slider ] [ waveform canvas + playhead ]
   *
   * Waveform drawing/resizing is centralized in `WaveformCanvas` so the
   * mixer lanes and stage waveform keep the same block rendering behavior.
   */
  import { Button } from '$lib/components/ui/button'
  import WaveformCanvas from '$lib/components/WaveformCanvas.svelte'

  let {
    label,
    buffer,
    volume,
    muted,
    soloed,
    positionSec,
    durationSec,
    color = '#7c3aed',
    sectionBands = [],
    showSectionLabels = false,
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
    /** Song sections as mix-timeline fractions [0..1], drawn as shaded bands. */
    sectionBands?: { startFrac: number; endFrac: number; label: string; index: number }[]
    /** Draw section labels — only the top lane sets this true. */
    showSectionLabels?: boolean
    onVolumeChange: (v: number) => void
    onToggleMuted: () => void
    onToggleSoloed: () => void
    /** Fraction is 0..1 relative to mix duration. */
    onSeekFraction: (frac: number) => void
  }>()

  const WAVE_HEIGHT = 44

  /** This lane's buffer duration; may be shorter than mix duration. */
  let bufferDur = $derived(buffer ? buffer.duration : 0)
  /** Where this lane's audio ends, expressed as a fraction of mix duration. */
  let endFrac = $derived(durationSec > 0 ? bufferDur / durationSec : 0)
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

  <WaveformCanvas
    class="flex-1"
    {buffer}
    {color}
    height={WAVE_HEIGHT}
    {positionSec}
    {durationSec}
    {sectionBands}
    {showSectionLabels}
    bufferEndFraction={endFrac < 1 ? endFrac : null}
    label={`Seek ${label}`}
    loadingLabel="loading..."
    playheadClass="bg-rose-500 pointer-events-none absolute top-0 bottom-0 z-[2] w-px"
    {onSeekFraction}
  />
</div>
