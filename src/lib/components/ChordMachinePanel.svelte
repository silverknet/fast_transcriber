<script lang="ts">
  /**
   * The chords / arp machine editor — the drum and bass machines' sibling.
   *
   * One deliberate difference from those two: these settings are NOT stored on
   * the song. They live in `chordJam`, the same runtime the Chords tab drives,
   * persisted per-device to localStorage. That is what "the same knobs as the
   * chord tab" means — set the sound once and both surfaces agree, rather than
   * having a mixer copy that silently diverges from the tab copy.
   *
   * The consequence, which is worth knowing: there are no per-section overrides
   * here (the drum and bass machines get those from `.smap`), and the settings
   * do not sync to collaborators.
   */
  import { Music4, Trash2, Waves } from '@lucide/svelte'
  import SynthKnobs from '$lib/components/editor/SynthKnobs.svelte'
  import { chordJam, JAM_OCT_MAX, JAM_OCT_MIN } from '$lib/audio/chordJam.svelte'
  import { CHORD_PLAYBACK_INSTRUMENT_NAMES } from '$lib/audio/chordPlayback'
  import { ARP_DIRECTIONS, ARP_DIRECTION_LABELS, ARP_RATES } from '$lib/audio/chordArp'
  import type { ChordMachineVoice } from '$lib/audio/chordMachineTrack'

  let {
    voice,
    onChanged,
    onRemove,
  }: { voice: ChordMachineVoice; onChanged?: () => void; onRemove?: () => void } = $props()

  const isArp = $derived(voice === 'arp')
  const title = $derived(isArp ? 'Arp' : 'Chords')

  /**
   * Every edit goes through here: push the settings into the synths, persist
   * them, then let the mixer re-schedule the lane. `syncSettings` is the jam's
   * own one-way door to the non-reactive audio sinks.
   */
  function changed(): void {
    chordJam.syncSettings()
    onChanged?.()
  }

  const octave = $derived(isArp ? chordJam.arpOctave : chordJam.keysOctave)
  function nudgeOctave(delta: number): void {
    const next = Math.max(JAM_OCT_MIN, Math.min(JAM_OCT_MAX, octave + delta))
    if (isArp) chordJam.arpOctave = next
    else chordJam.keysOctave = next
    changed()
  }

  const volume = $derived(isArp ? chordJam.arpVolume : chordJam.keysVolume)
  function setVolume(v: number): void {
    if (isArp) chordJam.arpVolume = v
    else chordJam.keysVolume = v
    changed()
  }

  /**
   * Dropping the lane is the mixer's business, not the jam's: the Chords tab's
   * own preview switch must keep working after you remove the track here. The
   * knobs persist either way, so adding it back brings the same sound.
   */
  function removeTrack(): void {
    onRemove?.()
  }

  const SELECT_CLASS =
    'border-foreground/30 bg-background rounded-[var(--radius)] border px-1.5 py-0.5 text-xs font-bold'
  const LABEL_CLASS = 'text-muted-foreground text-[10px] tracking-wider uppercase'
  const STEP_CLASS =
    'border-foreground/40 hover:bg-muted disabled:opacity-40 rounded-[var(--radius)] border px-1.5 leading-none'

  let showTone = $state(false)
</script>

<section>
  <header class="mb-2 flex items-center gap-2">
    {#if isArp}
      <Waves class="size-4 shrink-0" />
    {:else}
      <Music4 class="size-4 shrink-0" />
    {/if}
    <h3 class="grow text-sm font-bold">{title}</h3>
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 px-1.5 text-xs font-bold"
      onclick={removeTrack}
      title={`Remove the ${title.toLowerCase()} track`}
    >
      <Trash2 class="size-3.5" />
    </button>
  </header>

  <p class="text-muted-foreground mb-2 text-[11px]">
    {isArp
      ? 'Arpeggiates your chords. Plays whatever the Chords tab shows, so editing a chord changes the line.'
      : 'Plays your chords as held blocks. Follows the Chords tab, so editing a chord changes what you hear.'}
    These knobs are shared with the Chords tab and saved on this device.
  </p>

  <div class="mb-2 flex flex-wrap items-center gap-2">
    {#if isArp}
      <label class="inline-flex items-center gap-1.5 font-bold" title="Arp direction">
        <span class={LABEL_CLASS}>Dir</span>
        <select
          class={SELECT_CLASS}
          value={chordJam.arpDirection}
          onchange={(e) => {
            chordJam.arpDirection = e.currentTarget.value as (typeof ARP_DIRECTIONS)[number]
            changed()
          }}
          aria-label="Arp direction"
        >
          {#each ARP_DIRECTIONS as d (d)}
            <option value={d}>{ARP_DIRECTION_LABELS[d]}</option>
          {/each}
        </select>
      </label>
      <label class="inline-flex items-center gap-1.5 font-bold" title="Arp rate">
        <span class={LABEL_CLASS}>Rate</span>
        <select
          class={SELECT_CLASS}
          value={chordJam.arpRate}
          onchange={(e) => {
            chordJam.setArpRate(e.currentTarget.value as (typeof ARP_RATES)[number])
            changed()
          }}
          aria-label="Arp rate"
        >
          {#each ARP_RATES as r (r)}
            <option value={r}>{r}</option>
          {/each}
        </select>
      </label>
      <label
        class="inline-flex items-center gap-1.5 font-bold"
        title="How many octaves the figure climbs before repeating"
      >
        <span class={LABEL_CLASS}>Oct span</span>
        <select
          class={SELECT_CLASS}
          value={chordJam.arpOctaves}
          onchange={(e) => {
            chordJam.arpOctaves = Number(e.currentTarget.value)
            changed()
          }}
          aria-label="Arp octave span"
        >
          {#each [1, 2, 3, 4] as n (n)}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>
      <label class="inline-flex items-center gap-1.5 font-bold" title="Shuffle the off-beats">
        <span class={LABEL_CLASS}>Swing</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={chordJam.arpSwing}
          oninput={(e) => {
            chordJam.arpSwing = Number(e.currentTarget.value)
            changed()
          }}
          class="w-16 accent-[var(--studio-orange)]"
          aria-label="Arp swing"
        />
      </label>
    {:else}
      <label class="inline-flex items-center gap-1.5 font-bold" title="Sound">
        <span class={LABEL_CLASS}>Sound</span>
        <select
          class={SELECT_CLASS}
          value={chordJam.keysInstrument}
          onchange={(e) => {
            chordJam.selectKeysInstrument(e.currentTarget.value)
            changed()
          }}
          aria-label="Chord sound"
        >
          {#each CHORD_PLAYBACK_INSTRUMENT_NAMES as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <span class="inline-flex items-center gap-1 font-bold" title="Shift up or down an octave">
      <span class={LABEL_CLASS}>Oct</span>
      <button
        type="button"
        class={STEP_CLASS}
        onclick={() => nudgeOctave(-1)}
        disabled={octave <= JAM_OCT_MIN}
        aria-label="Octave down"
      >
        −
      </button>
      <span class="w-6 text-center font-mono text-xs tabular-nums">
        {octave > 0 ? `+${octave}` : octave}
      </span>
      <button
        type="button"
        class={STEP_CLASS}
        onclick={() => nudgeOctave(1)}
        disabled={octave >= JAM_OCT_MAX}
        aria-label="Octave up"
      >
        +
      </button>
    </span>

    <label class="inline-flex items-center gap-1.5 font-bold" title="Voice level">
      <span class={LABEL_CLASS}>Vol</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        oninput={(e) => setVolume(Number(e.currentTarget.value))}
        class="w-16 accent-[var(--studio-orange)]"
        aria-label="Volume"
      />
    </label>

    <button
      type="button"
      class="border-foreground/40 hover:bg-muted rounded-[var(--radius)] border px-2 py-0.5 text-xs font-bold {showTone
        ? 'bg-foreground text-background'
        : ''}"
      onclick={() => (showTone = !showTone)}
      aria-pressed={showTone}
    >
      {isArp ? 'Arp tone' : 'Chord tone'}
    </button>
  </div>

  {#if showTone}
    {#if isArp}
      <SynthKnobs bind:patch={chordJam.arpPatch} onchanged={changed} />
    {:else}
      <SynthKnobs bind:patch={chordJam.keysPatch} onchanged={changed} />
    {/if}
  {/if}
</section>
