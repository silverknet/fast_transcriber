<script lang="ts">
  import WaveformCanvas from '$lib/components/WaveformCanvas.svelte'

  let {
    buffer,
    color = 'var(--foreground)',
    positionSec,
    durationSec,
    sectionBands = [],
    endPositionSec = null,
    onSeekFraction,
  } = $props<{
    buffer: AudioBuffer | null
    color?: string
    positionSec: number
    durationSec: number
    sectionBands?: { startFrac: number; endFrac: number; label: string; index: number; color?: string }[]
    /** Programmed early ending on the mixer timeline. Null means natural song end. */
    endPositionSec?: number | null
    onSeekFraction: (frac: number) => void
  }>()

  const WAVE_HEIGHT = 92
  const endFraction = $derived(
    endPositionSec != null && durationSec > 0
      ? Math.max(0, Math.min(1, endPositionSec / durationSec))
      : null,
  )

</script>

<div class="relative h-[92px] w-full shrink-0">
  <WaveformCanvas
    class="ring-foreground/10 w-full bg-muted/35 ring-1"
    {buffer}
    {color}
    height={WAVE_HEIGHT}
    {positionSec}
    {durationSec}
    {sectionBands}
    showSectionLabels={true}
    label="Playback waveform"
    playheadClass="bg-primary pointer-events-none absolute top-0 bottom-0 z-[2] w-1 rounded-full"
    {onSeekFraction}
  />
  {#if endFraction !== null && endFraction < 0.997}
    <div
      class="pointer-events-none absolute inset-y-0 z-[4] w-1 bg-[var(--studio-orange)] shadow-[0_0_8px_color-mix(in_oklch,var(--studio-orange)_70%,transparent)]"
      style={`left: ${endFraction * 100}%`}
      aria-hidden="true"
    ></div>
    <span
      class="pointer-events-none absolute bottom-1 z-[5] -translate-x-full rounded-sm bg-[var(--studio-orange)] px-1 py-0.5 text-[9px] font-black leading-none text-[var(--studio-ink)]"
      style={`left: ${endFraction * 100}%`}
    >END</span>
  {/if}
</div>
