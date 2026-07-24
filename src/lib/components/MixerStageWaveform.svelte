<script lang="ts">
  import WaveformCanvas from '$lib/components/WaveformCanvas.svelte'

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
    sectionBands?: { startFrac: number; endFrac: number; label: string; index: number; color?: string }[]
    onSeekFraction: (frac: number) => void
  }>()

  const WAVE_HEIGHT = 92

</script>

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
