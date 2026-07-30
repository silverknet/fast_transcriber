<script lang="ts">
  import { transport } from '$lib/audio/transport.svelte'
  import { formatTime } from '$lib/audio/formatTime'
  import { audioSession } from '$lib/stores/audioSession'
  import { Pause, Play, Square } from '@lucide/svelte'

  type EditMode = 'overview' | 'grid' | 'sections' | 'chords' | 'cue' | 'lyrics' | 'leadsheet'

  export type MixerControls = {
    canPlay: boolean
    isPlaying: boolean
    positionSec: number
    durationSec: number
    playPause: () => void
    stop: () => void
    restart: () => void
    clickOn: boolean
    setClick: (on: boolean) => void
  }

  let {
    editMode,
    mixerControls = null,
  }: { editMode: EditMode; mixerControls?: MixerControls | null } = $props()

  // On Overview the MIXER owns playback (its own engine), so these controls
  // drive IT. Everywhere else they drive the shell transport. One button, one
  // engine sounding — never both.
  const onOverview = $derived(editMode === 'overview')
  const isPlaying = $derived(onOverview ? !!mixerControls?.isPlaying : transport.isPlaying)
  const canTransport = $derived(onOverview ? !!mixerControls?.canPlay : transport.ready)
  const posSec = $derived(onOverview ? (mixerControls?.positionSec ?? 0) : transport.songTimeSec)
  const durSec = $derived(onOverview ? (mixerControls?.durationSec ?? 0) : transport.durationSec)
  const doPlayPause = () => (onOverview ? mixerControls?.playPause() : transport.togglePlay())
  const doStop = () => (onOverview ? mixerControls?.stop() : transport.stop())
</script>

<!-- Persistent transport — rendered ONCE, above every editing panel, so a
     single play button keeps the song playing continuously as the user
     switches tabs (grid → sections → chords → cue → lyrics → lead sheet).
     Exception: on Overview, `MixerView` owns playback via its own engine, so
     these controls are disabled to avoid two engines sounding at once.
     TODO(M1b-next): fold mixer+live onto the shared transport. -->
{#if $audioSession.file}
  <div
    class="flex flex-wrap items-center gap-3 font-mono"
    role="group"
    aria-label="Transport"
  >
    <button
      type="button"
      class="border-foreground inline-flex h-9 w-9 items-center justify-center border-2 transition-colors disabled:opacity-40 {isPlaying
        ? 'bg-[var(--studio-orange)] text-background'
        : 'hover:bg-foreground hover:text-background'}"
      onclick={doPlayPause}
      disabled={!canTransport}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      title={isPlaying ? 'Pause' : 'Play'}
    >
      {#if isPlaying}
        <Pause class="size-4" aria-hidden="true" />
      {:else}
        <Play class="size-4" aria-hidden="true" />
      {/if}
    </button>
    <button
      type="button"
      class="border-foreground hover:bg-foreground hover:text-background inline-flex h-9 w-9 items-center justify-center border-2 transition-colors disabled:opacity-40"
      onclick={doStop}
      disabled={!canTransport}
      aria-label="Stop"
      title="Stop and go to selection start"
    >
      <Square class="size-4" aria-hidden="true" />
    </button>
    <span class="text-sm font-bold tabular-nums">
      <span class="text-[var(--studio-orange)]">{formatTime(posSec)}</span>
      <span class="text-muted-foreground">/ {formatTime(durSec)}</span>
    </span>
    <label
      class="border-foreground/40 hover:bg-foreground/5 ml-auto inline-flex cursor-pointer items-center gap-1.5 border-2 px-2 py-1 text-xs"
      title="Play clicks alongside the audio (and count-in if configured)"
    >
      <input
        type="checkbox"
        checked={onOverview ? !!mixerControls?.clickOn : transport.playWithClick}
        onchange={(e) =>
          onOverview
            ? mixerControls?.setClick(e.currentTarget.checked)
            : (transport.playWithClick = e.currentTarget.checked)}
        disabled={!canTransport}
        class="accent-foreground size-3.5"
      />
      <span class="font-bold uppercase tracking-wider">Click</span>
    </label>
    <!-- Song / click volume + click-sync calibration. Rebuilt here (was
         duplicated inside the editor WaveformPlayer toolbar) so it binds to the
         single transport engine and isn't lost when the waveform chrome is
         hidden. -->
    <details
      class="relative shrink-0 {editMode === 'overview' ? 'pointer-events-none opacity-40' : ''}"
    >
      <summary
        class="border-foreground/40 hover:bg-foreground/5 inline-flex cursor-pointer list-none items-center gap-1 border-2 px-2 py-1 text-xs font-bold uppercase tracking-wider marker:content-none [&::-webkit-details-marker]:hidden"
        title="Song / click volume and click-sync calibration"
      >
        Vol
      </summary>
      <div
        class="border-foreground bg-background absolute right-0 top-9 z-30 flex w-64 flex-col gap-4 border-2 px-4 py-3 shadow-lg"
        role="dialog"
        aria-label="Volume and click sync"
      >
        <div class="flex items-end justify-around gap-4">
          <div class="flex flex-col items-center gap-1">
            <span class="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">Click</span>
            <div class="relative h-24 w-6">
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                bind:value={transport.clickVolume}
                class="accent-foreground absolute left-1/2 top-1/2 h-2 w-24 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer"
                aria-label="Click volume"
              />
            </div>
            <span class="text-muted-foreground font-mono text-[10px] tabular-nums">{transport.clickVolume.toFixed(1)}×</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <span class="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">Song</span>
            <div class="relative h-24 w-6">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                bind:value={transport.songVolume}
                class="accent-foreground absolute left-1/2 top-1/2 h-2 w-24 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer"
                aria-label="Song volume"
              />
            </div>
            <span class="text-muted-foreground font-mono text-[10px] tabular-nums">{Math.round(transport.songVolume * 100)}%</span>
          </div>
        </div>
        <!-- Click sync calibration: default 0 is correct after routing audio +
             clicks through the same Web Audio context; the slider is a fine-tune
             escape hatch for unusual output chains. Snaps to zero in the ±2 ms
             detent. Saved per device. -->
        <div class="border-foreground/10 flex flex-col gap-2 border-t pt-3">
          <div class="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wider">
            <span class="text-muted-foreground">Click sync</span>
            <span
              class="font-mono tabular-nums {transport.clickOffsetSec === 0 ? 'text-muted-foreground' : 'text-foreground'}"
            >
              {transport.clickOffsetSec === 0 ? '0 ms' : `${transport.clickOffsetSec > 0 ? '+' : ''}${(transport.clickOffsetSec * 1000).toFixed(0)} ms`}
            </span>
          </div>
          <input
            type="range"
            min="-0.05"
            max="0.05"
            step="0.001"
            value={transport.clickOffsetSec}
            oninput={(e) => {
              const raw = Number((e.currentTarget as HTMLInputElement).value)
              transport.clickOffsetSec = Math.abs(raw) < 0.002 ? 0 : raw
            }}
            ondblclick={() => (transport.clickOffsetSec = 0)}
            class="accent-foreground w-full cursor-pointer"
            aria-label="Click offset (seconds, ±50ms; snaps to zero inside ±2 ms; double-click to reset)"
          />
          <div class="flex items-center justify-between gap-2 text-[10px]">
            <button
              type="button"
              onclick={() => (transport.clickOffsetSec = 0)}
              disabled={transport.clickOffsetSec === 0}
              class="border-foreground/40 hover:bg-foreground/5 disabled:opacity-40 border px-1.5 py-0.5 uppercase tracking-wider"
            >
              Reset
            </button>
            <label class="flex cursor-pointer items-center gap-1.5 uppercase tracking-wider">
              <input type="checkbox" bind:checked={transport.debugClickTiming} class="size-3" />
              <span class="text-muted-foreground">Log to console</span>
            </label>
          </div>
          <p class="text-muted-foreground text-[10px] leading-snug">
            Leave at 0 — engine targets perfect sync with the waveform. Only
            nudge if clicks feel off through specific headphones / speakers; the
            value is saved per device.
          </p>
        </div>
      </div>
    </details>
    {#if editMode === 'overview'}
      <span class="text-muted-foreground w-full text-[11px] sm:w-auto">Mixer controls playback here</span>
    {/if}
  </div>
{/if}
