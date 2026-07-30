<script lang="ts">
  /**
   * The drum machine editor — BarBro's Drummer track.
   *
   * Modelled on Logic's Drummer Editor: a style list on the left, an XY pad
   * for Simple↔Complex / Soft↔Loud in the middle, a fills knob on the right.
   *
   * Logic edits ONE REGION at a time, so the section strip along the top is
   * the arrangement itself — each section sized by its bar count and split
   * exactly the way `generateDrumGroove` blocks the song, so what you click is
   * what plays. Click a section to edit only that part; "Whole song" sets the
   * defaults everything else inherits.
   *
   * Nothing here stores drum events. Every control writes settings into
   * `sm.drumMachine`, and the part is regenerated from them, so edits to bars,
   * beats or section boundaries stay reflected in what you hear.
   */
  import { Drum, RotateCcw, Trash2 } from '@lucide/svelte'
  import SectionStrip from '$lib/components/SectionStrip.svelte'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { DRUM_STYLES, complexityForKind } from '$lib/songmap/drumPatterns'
  import { DRUM_KITS, type DrumKitId } from '$lib/audio/drumKits'
  import type {
    DrumClass,
    DrumMachine,
    DrumMachineSection,
    DrumPulseVoice,
    DrumStyleId,
    DrumVoiceToggles,
    Section,
  } from '$lib/songmap/types'

  let { onChanged }: { onChanged?: () => void } = $props()

  const DEFAULT_LOUDNESS = 0.5
  const DEFAULT_FILLS = 0.5

  const machine = $derived<DrumMachine | null>($songMap?.drumMachine ?? null)
  const sections = $derived<Section[]>(
    [...($songMap?.sections ?? [])].sort(
      (a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex,
    ),
  )

  /** 'song' = the whole-song defaults; otherwise a Section.id. */
  let scope = $state<string>('song')
  // A section can be deleted while selected — fall back rather than edit a ghost.
  const scopeValid = $derived(scope === 'song' || sections.some((s) => s.id === scope))
  const activeScope = $derived(scopeValid ? scope : 'song')
  const activeSection = $derived<Section | null>(
    activeScope === 'song' ? null : (sections.find((s) => s.id === activeScope) ?? null),
  )
  const override = $derived<DrumMachineSection | undefined>(
    activeSection ? machine?.perSection?.[activeSection.id] : undefined,
  )

  // ── Effective values ──────────────────────────────────────────────────────
  // Each control shows what you'd HEAR at this scope: the section's own value
  // if set, else the song value, else (complexity only) the section kind's
  // default. That last step is why an untouched song already follows its
  // arrangement — choruses busier than verses, intros thin.

  const effStyle = $derived<DrumStyleId>(override?.style ?? machine?.style ?? 'rock')
  const effComplexity = $derived<number>(
    override?.complexity ??
      machine?.complexity ??
      (activeSection ? complexityForKind(activeSection.kind) : 0.5),
  )
  const effLoudness = $derived<number>(
    override?.loudness ?? machine?.loudness ?? DEFAULT_LOUDNESS,
  )
  const effFills = $derived<number>(override?.fills ?? machine?.fills ?? DEFAULT_FILLS)
  const effPulse = $derived<DrumPulseVoice>(override?.pulse ?? machine?.pulse ?? 'hihat')
  const effVoices = $derived<DrumVoiceToggles>(override?.voices ?? machine?.voices ?? {})
  const muted = $derived<boolean>(override?.muted ?? false)

  const PULSE_OPTIONS: { id: DrumPulseVoice; label: string; hint: string }[] = [
    { id: 'hihat', label: 'Hi-hat', hint: 'Hi-hat drives the groove' },
    { id: 'ride', label: 'Ride', hint: 'Ride drives the groove' },
    { id: 'none', label: 'None', hint: 'No pulse — kick and snare only' },
  ]

  /**
   * Kit pieces you can switch off. The pulse voices are absent on purpose:
   * hi-hat and ride are chosen by the pulse selector, so having a second
   * control that could contradict it would just be confusing.
   */
  const KIT_PIECES: { cls: DrumClass; label: string }[] = [
    { cls: 'kick', label: 'Kick' },
    { cls: 'snare', label: 'Snare' },
    { cls: 'tom', label: 'Toms' },
    { cls: 'cymbal', label: 'Crash' },
  ]

  function voiceOn(cls: DrumClass): boolean {
    return effVoices[cls] !== false
  }

  function toggleVoice(cls: DrumClass): void {
    // A section's switches replace the song's wholesale (see resolveBlock), so
    // start from whatever is currently in effect rather than an empty object.
    setValue('voices', { ...effVoices, [cls]: !voiceOn(cls) })
  }

  /** Which controls at this scope are inherited rather than set here. */
  const inherited = $derived({
    style: !!activeSection && override?.style === undefined,
    complexity: !!activeSection && override?.complexity === undefined,
    loudness: !!activeSection && override?.loudness === undefined,
    fills: !!activeSection && override?.fills === undefined,
  })
  const sectionHasOverride = $derived(!!override && Object.keys(override).length > 0)

  // ── Writes ────────────────────────────────────────────────────────────────

  function updateMachine(fn: (m: DrumMachine) => DrumMachine): void {
    patchSongMap((sm) => (sm.drumMachine ? { ...sm, drumMachine: fn(sm.drumMachine) } : sm))
    onChanged?.()
  }

  /** Write a control at the current scope — song-wide, or this section only. */
  function setValue<K extends keyof DrumMachineSection>(
    key: K,
    value: DrumMachineSection[K],
  ): void {
    const sectionId = activeSection?.id
    updateMachine((m) => {
      if (!sectionId) {
        // `muted` is per-section only; everything else has a song-wide twin.
        if (key === 'muted') return m
        return { ...m, [key]: value } as DrumMachine
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
      const { drumMachine: _drop, ...rest } = sm
      return rest
    })
    scope = 'song'
    onChanged?.()
  }

  function toggleEnabled(): void {
    updateMachine((m) => ({ ...m, enabled: !m.enabled }))
  }

  // ── XY pad ────────────────────────────────────────────────────────────────
  // X = Simple → Complex, Y = Loud at the top → Soft at the bottom, matching
  // Logic so the muscle memory carries over.

  let padEl = $state<HTMLDivElement | null>(null)
  let dragging = $state(false)

  function applyPad(clientX: number, clientY: number): void {
    if (!padEl) return
    const r = padEl.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    const y = Math.max(0, Math.min(1, (clientY - r.top) / r.height))
    setValue('complexity', Math.round(x * 100) / 100)
    setValue('loudness', Math.round((1 - y) * 100) / 100)
  }

  function onPadPointerDown(e: PointerEvent): void {
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    applyPad(e.clientX, e.clientY)
  }
  function onPadPointerMove(e: PointerEvent): void {
    if (dragging) applyPad(e.clientX, e.clientY)
  }
  function onPadPointerUp(e: PointerEvent): void {
    dragging = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  /** Keyboard access — the pad is a real control, not a mouse-only toy. */
  function onPadKeyDown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.02
    const clamp = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100) / 100
    if (e.key === 'ArrowLeft') setValue('complexity', clamp(effComplexity - step))
    else if (e.key === 'ArrowRight') setValue('complexity', clamp(effComplexity + step))
    else if (e.key === 'ArrowUp') setValue('loudness', clamp(effLoudness + step))
    else if (e.key === 'ArrowDown') setValue('loudness', clamp(effLoudness - step))
    else return
    e.preventDefault()
  }

  const kitId = $derived<DrumKitId>(
    DRUM_KITS.some((k) => k.id === machine?.kit) ? (machine!.kit as DrumKitId) : 'synth',
  )

  const scopeLabel = $derived(activeSection ? activeSection.label : 'the whole song')

  // ── Section strip ─────────────────────────────────────────────────────────
  // Laid out proportionally to bar count and split exactly the way
  // `generateDrumGroove` blocks the song, so what you click is what plays.
  // Bars outside any section are shown inert: they sound, but there's no
  // Section.id to hang an override on.

  const totalBars = $derived($songMap?.timeline.bars.length ?? 0)

  function styleLabel(id: DrumStyleId): string {
    return DRUM_STYLES.find((s) => s.id === id)?.label ?? id
  }
  /** What this section actually plays, inherited or not — the chip's subtitle. */
  function sectionStyle(s: Section): DrumStyleId {
    return machine?.perSection?.[s.id]?.style ?? machine?.style ?? 'rock'
  }
  function sectionOverridden(s: Section): boolean {
    const o = machine?.perSection?.[s.id]
    return !!o && Object.keys(o).length > 0
  }
  function sectionMuted(s: Section): boolean {
    return machine?.perSection?.[s.id]?.muted === true
  }

</script>

<section class="border-foreground/15 bg-background rounded-[var(--radius)] border-2 p-2">
  <header class="mb-2 flex items-center gap-2">
    <Drum class="size-4 shrink-0" />
    <h3 class="grow text-sm font-bold">Drum Machine</h3>
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
        title="Delete the drum machine track"
      >
        <Trash2 class="size-3.5" />
      </button>
    {/if}
  </header>

  {#if !machine}
    <!-- Creation lives in the mixer's "+ Add track" menu; this panel only ever
         renders for a lane that already exists, so this is a safety net. -->
    <p class="text-muted-foreground text-xs">No drum machine track on this song.</p>
  {:else}
    <!-- The arrangement. Click a section to edit just that part — Logic edits
         one Drummer region at a time and this is that, laid out by bar count. -->
    <div class="mb-2">
      <SectionStrip
        {sections}
        {totalBars}
        {activeScope}
        ariaLabel="Drum sections"
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
      <!-- Styles -->
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Style</span>
        <div class="flex max-w-[16rem] flex-wrap gap-1" role="radiogroup" aria-label="Drum style">
          {#each DRUM_STYLES as s (s.id)}
            <button
              type="button"
              role="radio"
              aria-checked={effStyle === s.id}
              class="rounded-[var(--radius)] border-2 px-2 py-0.5 text-xs font-bold transition-colors {effStyle ===
              s.id
                ? 'border-foreground bg-foreground text-background'
                : 'border-foreground/25 bg-background hover:border-foreground/50'}"
              onclick={() => setValue('style', s.id)}
            >
              {s.label}
            </button>
          {/each}
        </div>
        {#if inherited.style && activeSection}
          <span class="text-muted-foreground text-[10px]">from the song</span>
        {/if}
      </div>

      <!-- XY pad -->
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Feel</span>
        <div
          bind:this={padEl}
          role="slider"
          tabindex="0"
          aria-label="Complexity and loudness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(effComplexity * 100)}
          aria-valuetext="{Math.round(effComplexity * 100)}% complex, {Math.round(
            effLoudness * 100,
          )}% loud"
          class="border-foreground/25 focus-visible:ring-foreground/40 relative h-20 w-32 shrink-0 cursor-crosshair touch-none rounded-[var(--radius)] border-2 focus-visible:ring-2 focus-visible:outline-none"
          style="background:
            linear-gradient(to top, color-mix(in oklch, var(--background) 92%, transparent), color-mix(in oklch, var(--studio-orange, #d97706) 22%, transparent)),
            linear-gradient(to right, transparent, color-mix(in oklch, var(--foreground) 10%, transparent));"
          onpointerdown={onPadPointerDown}
          onpointermove={onPadPointerMove}
          onpointerup={onPadPointerUp}
          onpointercancel={onPadPointerUp}
          onkeydown={onPadKeyDown}
        >
          <div
            class="border-foreground bg-background pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow"
            style="left: {effComplexity * 100}%; top: {(1 - effLoudness) * 100}%;"
          ></div>
          <span
            class="text-muted-foreground pointer-events-none absolute bottom-0.5 left-1 text-[10px] font-bold"
            >Simple</span
          >
          <span
            class="text-muted-foreground pointer-events-none absolute right-1 bottom-0.5 text-[10px] font-bold"
            >Complex</span
          >
          <span
            class="text-muted-foreground pointer-events-none absolute top-0.5 left-1 text-[10px] font-bold"
            >Loud</span
          >
        </div>
        {#if activeSection && (inherited.complexity || inherited.loudness)}
          <span class="text-muted-foreground text-[10px]">
            {inherited.complexity && activeSection
              ? `following the ${activeSection.kind} default`
              : 'from the song'}
          </span>
        {/if}
      </div>

      <!-- Fills + kit -->
      <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div class="flex flex-col gap-1">
          <span class="text-muted-foreground text-[11px] font-bold uppercase">Fills</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="accent-foreground w-28"
            value={effFills}
            oninput={(e) => setValue('fills', Number(e.currentTarget.value))}
            aria-label="Fill busyness"
          />
          <span class="text-muted-foreground text-[10px]">
            {effFills === 0 ? 'No fills' : `${Math.round(effFills * 100)}%`}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-muted-foreground text-[11px] font-bold uppercase">Kit</span>
          <select
            class="border-foreground/30 bg-background h-7 rounded-[var(--radius)] border-2 px-1.5 text-xs font-bold"
            value={kitId}
            onchange={(e) =>
              updateMachine((m) => ({ ...m, kit: e.currentTarget.value as DrumKitId }))}
          >
            {#each DRUM_KITS as k (k.id)}
              <option value={k.id}>{k.label}</option>
            {/each}
          </select>
        </div>
        <label class="inline-flex items-center gap-1.5 text-xs font-bold">
          <input
            type="checkbox"
            class="accent-foreground size-3.5"
            checked={machine.crashOnSectionStart !== false}
            onchange={(e) =>
              updateMachine((m) => ({ ...m, crashOnSectionStart: e.currentTarget.checked }))}
          />
          Crash on sections
        </label>
      </div>
    </div>

    <!-- Which voice carries the pulse, and which kit pieces play at all. -->
    <div class="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Driven by</span>
        <div class="flex gap-1" role="radiogroup" aria-label="Pulse voice">
          {#each PULSE_OPTIONS as p (p.id)}
            <button
              type="button"
              role="radio"
              aria-checked={effPulse === p.id}
              class="rounded-[var(--radius)] border-2 px-2 py-1 text-xs font-bold transition-colors {effPulse ===
              p.id
                ? 'border-foreground bg-foreground text-background'
                : 'border-foreground/25 bg-background hover:border-foreground/50'}"
              onclick={() => setValue('pulse', p.id)}
              title={p.hint}
            >
              {p.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Kit pieces</span>
        <div class="flex flex-wrap gap-1">
          {#each KIT_PIECES as piece (piece.cls)}
            <button
              type="button"
              aria-pressed={voiceOn(piece.cls)}
              class="rounded-[var(--radius)] border-2 px-2 py-1 text-xs font-bold transition-colors {voiceOn(
                piece.cls,
              )
                ? 'border-foreground bg-foreground text-background'
                : 'border-foreground/25 bg-background text-muted-foreground line-through'}"
              onclick={() => toggleVoice(piece.cls)}
              title="{voiceOn(piece.cls) ? 'Switch off' : 'Switch on'} the {piece.label.toLowerCase()}"
            >
              {piece.label}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <p class="text-muted-foreground mt-2 text-[11px]">
      {#if sections.length === 0}
        No sections yet — mark some up and the drums will follow them, with fills in between.
      {:else}
        Editing {scopeLabel}. Fills land on the last bar before each new section.
      {/if}
    </p>
  {/if}
</section>
