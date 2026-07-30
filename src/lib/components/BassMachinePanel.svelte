<script lang="ts">
  /**
   * The bass machine editor — the drum machine's sibling.
   *
   * Same shape: a section strip for the arrangement, a style list, and knobs
   * that inherit from the song unless a section overrides them. The controls
   * differ because a bass line has different dials — there's no fills knob or
   * kit, but there IS an octave, and the notes come from the chords.
   *
   * Nothing here stores notes. Every control writes settings into
   * `sm.bassMachine`; the line is regenerated from those plus the harmony, so
   * editing a chord immediately changes what the bass plays.
   */
  import { Guitar, RotateCcw, Trash2 } from '@lucide/svelte'
  import SectionStrip from '$lib/components/SectionStrip.svelte'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { BASS_STYLES, bassComplexityForKind } from '$lib/songmap/bassPatterns'
  import { normalizeBassTone, type BassTone } from '$lib/audio/bassTone'
  import {
    DEFAULT_BASS_SOUND_ID,
    bassSound,
    bassSoundGroups,
  } from '$lib/audio/bassSounds'
  import type { BassMachine, BassMachineSection, BassStyleId, Section } from '$lib/songmap/types'

  let { onChanged }: { onChanged?: () => void } = $props()

  const DEFAULT_LOUDNESS = 0.5

  const machine = $derived<BassMachine | null>($songMap?.bassMachine ?? null)
  const sections = $derived<Section[]>(
    [...($songMap?.sections ?? [])].sort(
      (a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex,
    ),
  )
  const totalBars = $derived($songMap?.timeline.bars.length ?? 0)
  const chordCount = $derived($songMap?.harmony.length ?? 0)

  let scope = $state<string>('song')
  const scopeValid = $derived(scope === 'song' || sections.some((s) => s.id === scope))
  const activeScope = $derived(scopeValid ? scope : 'song')
  const activeSection = $derived<Section | null>(
    activeScope === 'song' ? null : (sections.find((s) => s.id === activeScope) ?? null),
  )
  const override = $derived<BassMachineSection | undefined>(
    activeSection ? machine?.perSection?.[activeSection.id] : undefined,
  )

  const effStyle = $derived<BassStyleId>(override?.style ?? machine?.style ?? 'roots')
  const effComplexity = $derived<number>(
    override?.complexity ??
      machine?.complexity ??
      (activeSection ? bassComplexityForKind(activeSection.kind) : 0.5),
  )
  const effLoudness = $derived<number>(override?.loudness ?? machine?.loudness ?? DEFAULT_LOUDNESS)
  const effOctave = $derived<number>(override?.octave ?? machine?.octave ?? 0)
  const muted = $derived<boolean>(override?.muted ?? false)
  const sectionHasOverride = $derived(!!override && Object.keys(override).length > 0)

  // ── Writes ────────────────────────────────────────────────────────────────

  function updateMachine(fn: (m: BassMachine) => BassMachine): void {
    patchSongMap((sm) => (sm.bassMachine ? { ...sm, bassMachine: fn(sm.bassMachine) } : sm))
    onChanged?.()
  }

  function setValue<K extends keyof BassMachineSection>(
    key: K,
    value: BassMachineSection[K],
  ): void {
    const sectionId = activeSection?.id
    updateMachine((m) => {
      if (!sectionId) {
        if (key === 'muted') return m // per-section only
        return { ...m, [key]: value } as BassMachine
      }
      const next = { ...(m.perSection ?? {}) }
      next[sectionId] = { ...next[sectionId], [key]: value }
      return { ...m, perSection: next }
    })
  }

  function clearSectionOverride(): void {
    const sectionId = activeSection?.id
    if (!sectionId) return
    updateMachine((m) => {
      const next = { ...(m.perSection ?? {}) }
      delete next[sectionId]
      return { ...m, perSection: Object.keys(next).length ? next : undefined }
    })
  }


  function removeTrack(): void {
    patchSongMap((sm) => {
      const { bassMachine: _drop, ...rest } = sm
      return rest
    })
    scope = 'song'
    onChanged?.()
  }

  function toggleEnabled(): void {
    updateMachine((m) => ({ ...m, enabled: !m.enabled }))
  }

  // ── Section strip display ─────────────────────────────────────────────────

  function styleLabel(id: BassStyleId): string {
    return BASS_STYLES.find((s) => s.id === id)?.label ?? id
  }
  function sectionStyle(s: Section): BassStyleId {
    return machine?.perSection?.[s.id]?.style ?? machine?.style ?? 'roots'
  }
  function sectionOverridden(s: Section): boolean {
    const o = machine?.perSection?.[s.id]
    return !!o && Object.keys(o).length > 0
  }
  function sectionMuted(s: Section): boolean {
    return machine?.perSection?.[s.id]?.muted === true
  }

  // ── Sound ────────────────────────────────────────────────────────────────
  // The voice is song-wide: one bass player, one bass. Only the PART changes
  // per section, which is why this lives outside the scope-aware setValue().

  const soundId = $derived(machine?.sound ?? DEFAULT_BASS_SOUND_ID)
  const selectedSound = $derived(bassSound(soundId))
  /** A sampled instrument has no oscillators to shape, so its knobs are the
   *  few that still apply. */
  const isSampled = $derived(selectedSound.kind === 'sample')
  /** Knob values: the user's overrides on top of the SOUND's own patch. */
  const tone = $derived<BassTone>(
    normalizeBassTone({
      ...(selectedSound.kind === 'synth' ? selectedSound.tone : {}),
      ...machine?.tone,
    }),
  )
  /** Which preset the current tone matches exactly, if any. */

  function setTone(patch: Partial<BassTone>): void {
    updateMachine((m) => ({ ...m, tone: normalizeBassTone({ ...tone, ...patch }) }))
  }

  const OCTAVES: { value: number; label: string }[] = [
    { value: -1, label: '−1' },
    { value: 0, label: '0' },
    { value: 1, label: '+1' },
  ]
</script>

<section class="border-foreground/15 bg-background rounded-[var(--radius)] border-2 p-2">
  <header class="mb-2 flex items-center gap-2">
    <Guitar class="size-4 shrink-0" />
    <h3 class="grow text-sm font-bold">Bass Machine</h3>
    {#if machine}
      <button
        type="button"
        class="inline-flex h-7 items-center rounded-[var(--radius)] border-2 px-2 text-xs font-bold transition-colors {machine.enabled
          ? 'border-foreground bg-foreground text-background'
          : 'border-foreground/40 bg-background text-muted-foreground'}"
        onclick={toggleEnabled}
        aria-pressed={machine.enabled}
        title="Silence the track without losing its settings"
      >
        {machine.enabled ? 'On' : 'Off'}
      </button>
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 px-1.5 text-xs font-bold"
        onclick={removeTrack}
        title="Delete the bass machine track"
      >
        <Trash2 class="size-3.5" />
      </button>
    {/if}
  </header>

  {#if !machine}
    <!-- Creation lives in the mixer's "+ Add track" menu; this panel only ever
         renders for a lane that already exists, so this is a safety net. -->
    <p class="text-muted-foreground text-xs">No bass machine track on this song.</p>
  {:else}
    <div class="mb-2">
      <SectionStrip
        {sections}
        {totalBars}
        {activeScope}
        ariaLabel="Bass sections"
        onSelect={(next) => (scope = next)}
        subtitleFor={(s) => (sectionMuted(s) ? 'silent' : styleLabel(sectionStyle(s)))}
        overriddenFor={sectionOverridden}
        mutedFor={sectionMuted}
      />
    </div>

    <div class="mb-2 flex flex-wrap items-center gap-1.5">
      <span class="text-muted-foreground text-[11px] font-bold uppercase">
        Editing {activeSection ? activeSection.label : 'whole song'}
      </span>
      {#if activeSection && sectionHasOverride}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 px-1.5 text-[11px] font-bold"
          onclick={clearSectionOverride}
          title="Drop this section's own settings and follow the song again"
        >
          <RotateCcw class="size-3" /> Follow song
        </button>
      {/if}
      {#if activeSection}
        <label class="ml-auto inline-flex items-center gap-1.5 text-xs font-bold">
          <input
            type="checkbox"
            class="accent-foreground size-3.5"
            checked={muted}
            onchange={(e) => setValue('muted', e.currentTarget.checked)}
          />
          Silent here
        </label>
      {/if}
    </div>

    <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Style</span>
        <div class="flex max-w-[18rem] flex-wrap gap-1" role="radiogroup" aria-label="Bass style">
          {#each BASS_STYLES as s (s.id)}
            <button
              type="button"
              role="radio"
              aria-checked={effStyle === s.id}
              class="rounded-[var(--radius)] border-2 px-2 py-1 text-xs font-bold transition-colors {effStyle ===
              s.id
                ? 'border-foreground bg-foreground text-background'
                : 'border-foreground/25 bg-background hover:border-foreground/50'}"
              onclick={() => setValue('style', s.id)}
            >
              {s.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Busyness</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          class="accent-foreground w-28"
          value={effComplexity}
          oninput={(e) => setValue('complexity', Number(e.currentTarget.value))}
          aria-label="Complexity"
        />
        <span class="text-muted-foreground text-[10px]">{Math.round(effComplexity * 100)}%</span>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Level</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          class="accent-foreground w-28"
          value={effLoudness}
          oninput={(e) => setValue('loudness', Number(e.currentTarget.value))}
          aria-label="Loudness"
        />
        <span class="text-muted-foreground text-[10px]">{Math.round(effLoudness * 100)}%</span>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Octave</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Octave">
          {#each OCTAVES as o (o.value)}
            <button
              type="button"
              role="radio"
              aria-checked={effOctave === o.value}
              class="rounded-[var(--radius)] border-2 px-2 py-1 text-xs font-bold transition-colors {effOctave ===
              o.value
                ? 'border-foreground bg-foreground text-background'
                : 'border-foreground/25 bg-background hover:border-foreground/50'}"
              onclick={() => setValue('octave', o.value)}
            >
              {o.label}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- The VOICE. Song-wide — one bass player, one bass. -->
    <div class="border-foreground/10 mt-2 border-t-2 pt-2">
      <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Sound</span>
        <select
          class="border-foreground/30 bg-background h-7 rounded-[var(--radius)] border-2 px-1.5 text-xs font-bold"
          value={soundId}
          onchange={(e) => updateMachine((m) => ({ ...m, sound: e.currentTarget.value }))}
          aria-label="Bass sound"
        >
          {#each bassSoundGroups() as g (g.group)}
            <optgroup label={g.group}>
              {#each g.sounds as snd (snd.id)}
                <option value={snd.id}>{snd.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        {#if machine.tone}
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 px-1.5 text-[11px] font-bold"
            onclick={() => updateMachine(({ tone: _drop, ...m }) => m)}
            title="Back to this sound's own settings"
          >
            <RotateCcw class="size-3" /> Reset knobs
          </button>
        {/if}
      </div>

      <div class="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label class="flex flex-col gap-1 text-[11px] font-bold">
          <span class="text-muted-foreground uppercase">Tone</span>
          <input
            type="range"
            min="80"
            max="4000"
            step="10"
            class="accent-foreground w-32"
            value={tone.cutoffHz}
            oninput={(e) => setTone({ cutoffHz: Number(e.currentTarget.value) })}
            aria-label="Filter cutoff"
          />
          <span class="text-muted-foreground font-normal">{Math.round(tone.cutoffHz)} Hz</span>
        </label>

        {#if !isSampled}
        <label class="flex flex-col gap-1 text-[11px] font-bold">
          <span class="text-muted-foreground uppercase">Bite</span>
          <input
            type="range"
            min="0"
            max="4"
            step="0.1"
            class="accent-foreground w-24"
            value={tone.resonance}
            oninput={(e) => setTone({ resonance: Number(e.currentTarget.value) })}
            aria-label="Resonance"
          />
          <span class="text-muted-foreground font-normal">{tone.resonance.toFixed(1)}</span>
        </label>
        {/if}

        <label class="flex flex-col gap-1 text-[11px] font-bold">
          <span class="text-muted-foreground uppercase">Grit</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="accent-foreground w-24"
            value={tone.drive}
            oninput={(e) => setTone({ drive: Number(e.currentTarget.value) })}
            aria-label="Drive"
          />
          <span class="text-muted-foreground font-normal">{Math.round(tone.drive * 100)}%</span>
        </label>

        <label class="flex flex-col gap-1 text-[11px] font-bold">
          <span class="text-muted-foreground uppercase">Decay</span>
          <input
            type="range"
            min="0.02"
            max="1.2"
            step="0.02"
            class="accent-foreground w-24"
            value={tone.decay}
            oninput={(e) => setTone({ decay: Number(e.currentTarget.value) })}
            aria-label="Decay"
          />
          <span class="text-muted-foreground font-normal">{tone.decay.toFixed(2)}s</span>
        </label>
      </div>
    </div>

    <p class="text-muted-foreground mt-2 text-[11px]">
      {#if chordCount === 0}
        No chords yet — the bass plays from your chords, so write some and it'll follow them.
      {:else}
        Playing from {chordCount} chord{chordCount === 1 ? '' : 's'}. Slash chords play their bass
        note; N.C. stays silent.
      {/if}
    </p>
  {/if}
</section>
