<script lang="ts">
  /**
   * Read-only phone LIVE stage — a non-scrolling, balanced performance view fed
   * entirely by values the mixer already derives (chord row, karaoke lyrics,
   * stage waveform, transport). No editing, no mixer controls. Rendered by
   * `MixerView` when `liveMode && $isNarrow`; the desktop stage is untouched.
   *
   * Layout (top → bottom, no scroll): slim waveform · current + next-3 chord row ·
   * karaoke lyrics (the only flexible/centered area) · play-pause + stop.
   */
  import MixerStageWaveform from './MixerStageWaveform.svelte'
  import Play from '@lucide/svelte/icons/play'
  import Pause from '@lucide/svelte/icons/pause'
  import Square from '@lucide/svelte/icons/square'
  import type { ChordRowItem } from '$lib/audio/upcomingChords'

  type LyricWord = { text: string; startSec: number }
  type LyricLine = { words: LyricWord[]; startSec: number }

  let {
    chordRow = [],
    lyricLines = [],
    currentLyricIdx = -1,
    lyricsSongTime = 0,
    waveBuffer = null,
    positionSec = 0,
    durationSec = 0,
    sectionBands = [],
    onSeekFraction,
    isPlaying = false,
    onPlayPause,
    onStop,
  } = $props<{
    chordRow: ChordRowItem[]
    lyricLines: LyricLine[]
    currentLyricIdx: number
    lyricsSongTime: number
    waveBuffer: AudioBuffer | null
    positionSec: number
    durationSec: number
    sectionBands?: { startFrac: number; endFrac: number; label: string; index: number; color?: string }[]
    onSeekFraction: (frac: number) => void
    isPlaying: boolean
    onPlayPause: () => void
    onStop: () => void
  }>()

  // Sticky active word: the last word of the current line that has started
  // (mirrors the mixer's karaoke highlight, kept local so this stays decoupled).
  function activeWordIdx(line: LyricLine, t: number): number {
    let idx = -1
    for (let i = 0; i < line.words.length; i++) {
      if (line.words[i]!.startSec <= t) idx = i
      else break
    }
    return idx
  }

  const prevLine = $derived(currentLyricIdx > 0 ? lyricLines[currentLyricIdx - 1] : null)
  const curLine = $derived(currentLyricIdx >= 0 ? (lyricLines[currentLyricIdx] ?? null) : null)
  const nextLine = $derived(lyricLines[currentLyricIdx + 1] ?? null)
  const activeIdx = $derived(curLine ? activeWordIdx(curLine, lyricsSongTime) : -1)
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="live-stage-mobile">
  <!-- Waveform (slim, top) -->
  <div class="shrink-0">
    <MixerStageWaveform buffer={waveBuffer} {positionSec} {durationSec} {sectionBands} {onSeekFraction} />
  </div>

  <!-- Chord row: current big + next 3 (reads left→right like a timeline) -->
  <div class="flex shrink-0 items-end justify-center gap-3 overflow-hidden px-3 py-4 whitespace-nowrap">
    {#if chordRow.length > 0}
      {#each chordRow as c, i (c.id + ':' + i)}
        <div class="flex flex-col items-center {c.isCurrent ? '' : 'opacity-55'}">
          <span
            class="{c.isCurrent ? 'text-4xl sm:text-5xl' : 'text-lg'} font-black leading-none tabular-nums"
            data-current={c.isCurrent}>{c.label}</span
          >
          {#if c.isCurrent}
            <div class="bg-muted mt-2 h-1.5 w-16 overflow-hidden rounded-full">
              <div class="bg-primary h-full transition-[width] duration-100" style="width: {c.progressPct}%"></div>
            </div>
          {/if}
        </div>
      {/each}
    {:else}
      <span class="text-muted-foreground text-3xl font-black">—</span>
    {/if}
  </div>

  <!-- Karaoke lyrics: the flexible, centered middle -->
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
    aria-label="Lyrics"
    aria-live="polite"
  >
    {#if lyricLines.length > 0}
      <div class="text-muted-foreground/50 w-full truncate text-base">
        {prevLine ? prevLine.words.map((w) => w.text).join(' ') : ' '}
      </div>
      <div class="text-3xl font-black leading-snug">
        {#if curLine}
          {#each curLine.words as w, wi (wi)}<span
              class={wi === activeIdx
                ? 'bg-primary text-primary-foreground rounded px-1'
                : wi < activeIdx
                  ? 'text-foreground/50'
                  : activeIdx === -1
                    ? 'text-foreground/70'
                    : 'text-foreground'}>{w.text}</span
            >{#if wi < curLine.words.length - 1}{' '}{/if}{/each}
        {:else if nextLine}
          <span class="text-muted-foreground">{nextLine.words.map((w) => w.text).join(' ')}</span>
        {/if}
      </div>
      <div class="text-muted-foreground/80 w-full truncate text-base">
        {curLine && nextLine ? nextLine.words.map((w) => w.text).join(' ') : ' '}
      </div>
    {:else}
      <p class="text-muted-foreground font-mono text-sm">No lyrics for this song.</p>
    {/if}
  </div>

  <!-- Transport: play/pause + stop (big touch targets) -->
  <div class="border-foreground/10 flex shrink-0 items-center justify-center gap-8 border-t-2 py-4">
    <button
      type="button"
      class="border-foreground bg-primary text-primary-foreground grid size-16 place-items-center rounded-full border-2 transition-transform active:scale-95"
      onclick={onPlayPause}
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {#if isPlaying}<Pause class="size-7" />{:else}<Play class="size-7 translate-x-0.5" />{/if}
    </button>
    <button
      type="button"
      class="border-foreground bg-card grid size-14 place-items-center rounded-full border-2 transition-transform active:scale-95"
      onclick={onStop}
      aria-label="Stop"
    >
      <Square class="size-6" />
    </button>
  </div>
</div>
