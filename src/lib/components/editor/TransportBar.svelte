<script lang="ts">
  import { transport } from '$lib/audio/transport.svelte'
  import { formatTime } from '$lib/audio/formatTime'
  import { audioSession } from '$lib/stores/audioSession'
  import { songMap, patchSongMap } from '$lib/stores/songMap'
  import { cuePlaybackMuted, withCuePlaybackMuted } from '$lib/songmap/cueTracks'
  import { Pause, Play, SlidersHorizontal, Square } from '@lucide/svelte'

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
  const clickEnabled = $derived(onOverview ? !!mixerControls?.clickOn : transport.playWithClick)
  const cuesEnabled = $derived($songMap ? !cuePlaybackMuted($songMap) : false)
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
    class="flex flex-wrap items-center gap-2 font-mono"
    role="group"
    aria-label="Transport"
  >
    <button
      type="button"
      class="inline-flex size-9 items-center justify-center rounded-full bg-[var(--studio-orange)] text-[var(--studio-ink)] shadow-[0_2px_6px_rgba(0,0,0,0.24)] transition-[transform,filter,opacity] hover:-translate-y-px hover:brightness-105 active:translate-y-0 disabled:opacity-35"
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
      class="text-muted-foreground hover:bg-foreground/10 hover:text-foreground inline-flex size-8 items-center justify-center rounded-full transition-colors disabled:opacity-35"
      onclick={doStop}
      disabled={!canTransport}
      aria-label="Stop"
      title="Stop and go to selection start"
    >
      <Square class="size-3.5 fill-current" aria-hidden="true" />
    </button>
    <span class="min-w-[8.5rem] text-sm font-bold tabular-nums">
      <span class="text-[var(--studio-orange)]">{formatTime(posSec)}</span>
      <span class="text-muted-foreground">/ {formatTime(durSec)}</span>
    </span>

    <span class="bg-foreground/15 mx-1 h-5 w-px" aria-hidden="true"></span>

    <label
      class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-black uppercase tracking-wide transition-colors"
      title="Play clicks alongside the audio (and count-in if configured)"
    >
      <input
        type="checkbox"
        checked={clickEnabled}
        onchange={(e) =>
          onOverview
            ? mixerControls?.setClick(e.currentTarget.checked)
            : (transport.playWithClick = e.currentTarget.checked)}
        disabled={!canTransport}
        class="sr-only"
      />
      <span>Click</span>
      <span
        class="relative h-4 w-7 rounded-full transition-colors {clickEnabled
          ? 'bg-[var(--studio-orange)]'
          : 'bg-foreground/15'}"
        aria-hidden="true"
      >
        <span
          class="absolute top-0.5 size-3 rounded-full bg-background shadow-sm transition-transform {clickEnabled
            ? 'translate-x-3'
            : 'translate-x-0.5'}"
        ></span>
      </span>
    </label>
    <!--
      Cues, beside Click — the same per-song switch every surface reads.
      Unlike the click (whose engine differs per tab), the cue flag is ONE
      `mixState` field, so this writes the shared helper and the overview
      mixer / live mode follow reactively.
    -->
    <label
      class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-black uppercase tracking-wide transition-colors"
      title="Play the spoken cues (section names, counts) alongside the song"
    >
      <input
        type="checkbox"
        checked={$songMap ? !cuePlaybackMuted($songMap) : false}
        onchange={(e) => {
          const on = e.currentTarget.checked
          patchSongMap((m) => withCuePlaybackMuted(m, !on))
        }}
        disabled={!$songMap}
        class="sr-only"
      />
      <span>Cues</span>
      <span
        class="relative h-4 w-7 rounded-full transition-colors {cuesEnabled
          ? 'bg-[var(--studio-orange)]'
          : 'bg-foreground/15'}"
        aria-hidden="true"
      >
        <span
          class="absolute top-0.5 size-3 rounded-full bg-background shadow-sm transition-transform {cuesEnabled
            ? 'translate-x-3'
            : 'translate-x-0.5'}"
        ></span>
      </span>
    </label>
    <!-- Song / click volume + click-sync calibration. Rebuilt here (was
         duplicated inside the editor WaveformPlayer toolbar) so it binds to the
         single transport engine and isn't lost when the waveform chrome is
         hidden. -->
    <details
      class="relative shrink-0 {editMode === 'overview' ? 'pointer-events-none opacity-40' : ''}"
    >
      <summary
        class="text-muted-foreground hover:bg-foreground/10 hover:text-foreground inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-full transition-colors marker:content-none [&::-webkit-details-marker]:hidden"
        title="Song / click volume and click-sync calibration"
        aria-label="Song and click levels"
      >
        <SlidersHorizontal class="size-4" aria-hidden="true" />
      </summary>
      <div
        class="border-foreground/15 bg-popover text-popover-foreground absolute right-0 top-10 z-30 flex w-72 flex-col gap-3 rounded-[var(--radius)] border p-3 shadow-lg"
        role="dialog"
        aria-label="Volume and click sync"
      >
        <div class="grid grid-cols-[2.75rem_1fr_3rem] items-center gap-x-2 gap-y-2 text-[10px] font-black uppercase tracking-wide">
          <span class="text-muted-foreground">Click</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            bind:value={transport.clickVolume}
            class="accent-[var(--studio-orange)] w-full cursor-pointer"
            aria-label="Click volume"
          />
          <span class="text-muted-foreground text-right font-mono tabular-nums">{transport.clickVolume.toFixed(1)}×</span>

          <span class="text-muted-foreground">Song</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            bind:value={transport.songVolume}
            class="accent-[var(--studio-orange)] w-full cursor-pointer"
            aria-label="Song volume"
          />
          <span class="text-muted-foreground text-right font-mono tabular-nums">{Math.round(transport.songVolume * 100)}%</span>
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
              class="text-muted-foreground hover:text-foreground disabled:opacity-40 px-1.5 py-0.5 font-black uppercase tracking-wider"
            >
              Reset
            </button>
            <label class="flex cursor-pointer items-center gap-1.5 uppercase tracking-wider">
              <input type="checkbox" bind:checked={transport.debugClickTiming} class="size-3" />
              <span class="text-muted-foreground">Log to console</span>
            </label>
          </div>
        </div>
      </div>
    </details>
  </div>
{/if}
