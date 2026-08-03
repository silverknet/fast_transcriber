<script lang="ts">
  /**
   * One track lane in the multi-track mixer. Layout:
   *
   *   [ ⠿ ] [ name ] [ M ][ S ] [ live button ] [ vol slider ] [ waveform ]
   *
   * Rows are separated by a single hairline rather than each being boxed — a
   * stack of bordered cards reads as many objects; a ruled list reads as one
   * mixer. Selection shows as a left accent bar + tinted row instead, so it
   * stays obvious without reintroducing the box.
   *
   * Waveform drawing/resizing is centralized in `WaveformCanvas` so the
   * mixer lanes and stage waveform keep the same block rendering behavior.
   */
  import { Button } from '$lib/components/ui/button'
  import WaveformCanvas from '$lib/components/WaveformCanvas.svelte'
  import type { MidiVisual } from '$lib/audio/mixerEngine'
  import { GripVertical, Lock } from '@lucide/svelte'
  import ChannelEqPopover from '$lib/components/ChannelEqPopover.svelte'
  import type { ChannelEq } from '$lib/audio/channelEq'

  let {
    label,
    buffer,
    volume,
    matchGainDb = 0,
    muted,
    soloed,
    positionSec,
    durationSec,
    color = '#7c3aed',
    sectionBands = [],
    showSectionLabels = false,
    activeSectionId = null,
    onVolumeChange,
    onToggleMuted,
    onToggleSoloed,
    onSeekFraction,
    onSectionSelect,
    selected = false,
    onSelect,
    liveSlot,
    liveSlotOptions = [],
    onLiveSlotChange,
    pinned = false,
    reorderable = false,
    dragging = false,
    dropTarget = false,
    onDragStartLane,
    onDragOverLane,
    onDropLane,
    onDragEndLane,
    eq,
    onEqChange,
    isInstrument = false,
    sourceDurationSec = 0,
    midiVisual = null,
  } = $props<{
    label: string
    buffer: AudioBuffer | null
    volume: number
    /**
     * Automatic loudness-match gain in dB, applied BEFORE this fader. Shown so
     * a stem that is louder than its fader suggests explains itself instead of
     * looking like the mixer ignoring you.
     */
    matchGainDb?: number
    muted: boolean
    soloed: boolean
    /** Mix-timeline playhead, seconds. */
    positionSec: number
    /** Mix-timeline total length, seconds. */
    durationSec: number
    /** Waveform stroke color. */
    color?: string
    /** Song sections as mix-timeline fractions [0..1], drawn as shaded bands. */
    sectionBands?: { id?: string; startFrac: number; endFrac: number; label: string; index: number; color?: string }[]
    /** Draw section labels — only the top lane sets this true. */
    showSectionLabels?: boolean
    /** Highlight the section currently scoped in the machine editor. */
    activeSectionId?: string | null
    onVolumeChange: (v: number) => void
    onToggleMuted: () => void
    onToggleSoloed: () => void
    /** Fraction is 0..1 relative to mix duration. */
    onSeekFraction: (frac: number) => void
    /** When supplied, waveform section clicks select a machine section. */
    onSectionSelect?: (sectionId: string) => void
    /** Selected lanes are outlined; the mixer shows the matching editor. */
    selected?: boolean
    /** Absent = this lane isn't selectable (no editor behind it). */
    onSelect?: () => void
    /**
     * Which live BUTTON this track is on. Several tracks may name the same slot
     * — one press then moves them all. Absent `onLiveSlotChange` hides the
     * picker entirely, so lanes that shouldn't be re-linked simply don't offer it.
     */
    liveSlot?: string
    liveSlotOptions?: { value: string; label: string }[]
    onLiveSlotChange?: (value: string) => void
    /** MIDI lanes are played live and have no waveform to draw. */
    isInstrument?: boolean
    /** Mix-timeline length, from the buffer or the instrument's part. */
    sourceDurationSec?: number
    /** A MIDI lane draws its pattern here instead of a waveform. */
    midiVisual?: MidiVisual | null
    /** Fixed at the top (the original mix) — shown tinted, with a lock. */
    pinned?: boolean
    /** Drag-to-reorder is available for this lane. */
    reorderable?: boolean
    /** This lane is the one currently being dragged. */
    dragging?: boolean
    /** A dragged lane is hovering over this one. */
    dropTarget?: boolean
    onDragStartLane?: () => void
    onDragOverLane?: () => void
    onDropLane?: () => void
    onDragEndLane?: () => void
    /** This channel's EQ. Absent handler = no EQ button on this lane. */
    eq?: ChannelEq
    onEqChange?: (next: ChannelEq | undefined) => void
  }>()

  const WAVE_HEIGHT = 44

  /** This lane's buffer duration; may be shorter than mix duration. */
  let bufferDur = $derived(buffer ? buffer.duration : sourceDurationSec)
  /** Where this lane's audio ends, expressed as a fraction of mix duration. */
  let endFrac = $derived(durationSec > 0 ? bufferDur / durationSec : 0)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex items-center gap-2 border-b px-2 py-1.5 transition-colors
    {pinned ? 'bg-foreground/[0.06] border-foreground/25' : 'border-foreground/15'}
    {selected ? 'bg-foreground/10' : ''}
    {dragging ? 'opacity-40' : ''}
    {dropTarget ? 'border-t-foreground border-t-2' : ''}"
  ondragover={(e) => {
    if (!onDragOverLane) return
    e.preventDefault() // required, or the drop never fires
    onDragOverLane()
  }}
  ondrop={(e) => {
    if (!onDropLane) return
    e.preventDefault()
    onDropLane()
  }}
>
  <!-- Selected lanes get an accent bar instead of a border box. -->
  {#if selected}
    <span class="bg-foreground absolute inset-y-0 left-0 w-[3px]" aria-hidden="true"></span>
  {/if}

  <!-- Drag handle. The pinned original shows a lock in the same slot so the
       rows stay aligned and it's clear WHY it can't move. -->
  {#if reorderable}
    <span
      class="text-muted-foreground hover:text-foreground shrink-0 cursor-grab active:cursor-grabbing"
      draggable="true"
      role="button"
      tabindex="-1"
      aria-label="Reorder {label}"
      title="Drag to reorder"
      ondragstart={(e) => {
        // Firefox refuses to start a drag without payload.
        e.dataTransfer?.setData('text/plain', label)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        onDragStartLane?.()
      }}
      ondragend={() => onDragEndLane?.()}
    >
      <GripVertical class="size-3.5" aria-hidden="true" />
    </span>
  {:else}
    <span
      class="text-muted-foreground/50 shrink-0"
      title={pinned ? 'The original mix stays at the top' : undefined}
    >
      {#if pinned}
        <Lock class="size-3" aria-hidden="true" />
      {:else}
        <span class="block size-3.5" aria-hidden="true"></span>
      {/if}
    </span>
  {/if}

  <!-- Name. Selectable only when there's an editor behind the lane. -->
  {#if onSelect}
    <button
      type="button"
      class="w-28 shrink-0 min-w-0 rounded-[var(--radius)] px-1 py-0.5 text-left transition-colors hover:bg-foreground/10"
      aria-pressed={selected}
      onclick={() => onSelect?.()}
      title="Edit {label}"
    >
      <div class="truncate text-xs font-semibold">{label}</div>
      <div class="text-muted-foreground truncate font-mono text-[10px]">
        {#if buffer}{buffer.duration.toFixed(1)}s{:else if isInstrument}MIDI · {sourceDurationSec.toFixed(
            1,
          )}s{:else}—{/if}
      </div>
    </button>
  {:else}
    <div class="w-28 shrink-0 min-w-0">
      <div class="truncate text-xs font-semibold">{label}</div>
      <div class="text-muted-foreground truncate font-mono text-[10px]">
        {#if buffer}{buffer.duration.toFixed(1)}s{:else if isInstrument}MIDI · {sourceDurationSec.toFixed(
            1,
          )}s{:else}—{/if}
      </div>
    </div>
  {/if}

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

  <!-- Channel EQ — an insert on this lane only, not a bus. -->
  {#if onEqChange}
    <ChannelEqPopover {label} {eq} onChange={onEqChange} />
  {/if}

  <!-- Which live button toggles this track. Several tracks can share one. -->
  {#if onLiveSlotChange}
    <select
      class="border-foreground/30 bg-background h-7 w-[4.5rem] shrink-0 rounded-[var(--radius)] border px-1 text-[11px] font-bold"
      value={liveSlot ?? 'none'}
      onchange={(e) => onLiveSlotChange?.((e.currentTarget as HTMLSelectElement).value)}
      aria-label="{label} live button"
      title="Which live button turns {label} on and off. Link several tracks to the same button to move them together."
    >
      {#each liveSlotOptions as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  {/if}

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
  <!-- ALWAYS rendered, fixed width: a column that appears only on some rows
       makes every row a different width and the strip stops lining up. -->
  <span
    class="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums {Math.abs(matchGainDb) < 0.1
      ? 'opacity-0'
      : matchGainDb > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-amber-600 dark:text-amber-400'}"
    title={Math.abs(matchGainDb) < 0.1
      ? ''
      : `Loudness matching is ${matchGainDb > 0 ? 'lifting' : 'lowering'} this stem by ${Math.abs(matchGainDb).toFixed(1)} dB before your fader. Turn it off in Project settings → Project sound.`}
    aria-hidden={Math.abs(matchGainDb) < 0.1}
  >
    {matchGainDb > 0 ? '+' : ''}{matchGainDb.toFixed(1)}
  </span>

  <!-- A MIDI lane has no buffer BY DESIGN — it is played live, not decoded — so
       it must not sit on the canvas's "loading..." state, which reads as broken. -->
  <WaveformCanvas
    class="flex-1"
    {buffer}
    {color}
    height={WAVE_HEIGHT}
    {positionSec}
    {durationSec}
    {sectionBands}
    {showSectionLabels}
    {activeSectionId}
    bufferEndFraction={!isInstrument && endFrac < 1 ? endFrac : null}
    label={`Seek ${label}`}
    {midiVisual}
    loadingLabel="loading..."
    playheadClass="bg-rose-500 pointer-events-none absolute top-0 bottom-0 z-[2] w-px"
    {onSeekFraction}
    {onSectionSelect}
  />
</div>
