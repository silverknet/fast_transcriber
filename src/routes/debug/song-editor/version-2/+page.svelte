<script lang="ts">
  /**
   * Song Edit — design prototype, VERSION 2: "Three-pane inspector IDE".
   *
   * A professional, DAW-shaped editor that replaces today's stacked dashboard
   * pages with a fixed three-column frame:
   *
   *   ┌──────┬───────────────────────────────────────────────┐
   *   │      │  TOP STRIP  (transport · waveform-nav readout · │
   *   │ MODE │             save/sync)  — spans center + right   │
   *   │ RAIL ├──────────────────────────────┬─────────────────┤
   *   │  7   │        WORKSPACE (center)     │   INSPECTOR     │
   *   │modes │  waveform modes: shared wave  │  (contextual,   │
   *   │      │  on top + editing surface;    │   reflects the  │
   *   │      │  others: mode's main content  │   selection)    │
   *   └──────┴──────────────────────────────┴─────────────────┘
   *
   * READ-ONLY design study. Controls are visual; the only real interactivity is
   * (a) switching the active mode, (b) selecting an object (bar / section /
   * chord / lyric line / cue) which drives the inspector, and (c) the shared
   * waveform's own zoom/pan. No song data is mutated. Renders UNDER the real app
   * navbar — this file is page CONTENT only.
   */
  import { Button } from '$lib/components/ui/button'
  import HelpHint from '$lib/components/HelpHint.svelte'
  import DebugSharedWaveform from '$lib/components/DebugSharedWaveform.svelte'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import {
    songEditorFixture,
    meta,
    sectionRows,
    barCells,
    lyricLines,
    waveformSections,
    mixerLanes,
    cueRows,
    EDIT_TABS,
    DURATION_SEC,
    fmtTime,
    type EditTabId,
  } from '$lib/debug/songEditorFixture'
  import {
    SlidersHorizontal,
    Grid3x3,
    Layers,
    Music,
    Megaphone,
    Type,
    ScrollText,
    Disc3,
    Play,
    Square,
    RotateCcw,
    Repeat1,
    Volume2,
    Cloud,
    Check,
    Music2,
    Tag,
    Hash,
    Palette,
    Clock,
    Mic,
    Speech,
    Plus,
    Minus,
    Info,
    ListMusic,
    FileMusic,
    Waypoints,
    Printer,
  } from '@lucide/svelte'

  // ── Active mode + selection state (the only "real" interactivity) ──────────
  let mode = $state<EditTabId>('overview')
  let viewStart = $state(0)
  let viewEnd = $state(DURATION_SEC)
  let selectedSectionId = $state(sectionRows[3]!.id) // Chorus (33–48)
  let selectedBarNumber = $state(33)
  let selectedLyricIndex = $state(5)
  let selectedCueSectionId = $state(sectionRows[3]!.id)
  let clickOn = $state(true)

  // ── Geometry helpers ───────────────────────────────────────────────────────
  const secPerBar = DURATION_SEC / meta.bars
  const beatSec = 60 / meta.bpm
  const barOf = (sec: number) => Math.min(meta.bars, Math.floor(sec / secPerBar) + 1)
  const zoomX = $derived(DURATION_SEC / Math.max(0.01, viewEnd - viewStart))

  const MODE_ICON: Record<EditTabId, typeof Play> = {
    overview: SlidersHorizontal,
    grid: Grid3x3,
    sections: Layers,
    chords: Music,
    cue: Megaphone,
    lyrics: Type,
    leadsheet: ScrollText,
  }
  const tabLabel = (id: EditTabId) => EDIT_TABS.find((t) => t.id === id)?.label ?? id
  const usesWaveform = (id: EditTabId) => EDIT_TABS.find((t) => t.id === id)?.usesWaveform ?? false
  // Cue is a timeline mode too: cues live against the audio, so the shared
  // waveform shows above the cue-marker lane (like grid/sections/chords).
  const isWaveMode = $derived(usesWaveform(mode) || mode === 'cue')
  const HeadIcon = $derived(MODE_ICON[mode])

  // Rail grouping — surfaces the "waveform family" (grid/sections/chords/cue),
  // all edited against the shared timeline.
  const RAIL_GROUPS: { label: string; ids: EditTabId[] }[] = [
    { label: 'Mix', ids: ['overview'] },
    { label: 'Timeline', ids: ['grid', 'sections', 'chords', 'cue'] },
    { label: 'Perform', ids: ['lyrics', 'leadsheet'] },
  ]

  // ── Derived selections that feed the inspector ──────────────────────────────
  const selectedSection = $derived(sectionRows.find((s) => s.id === selectedSectionId) ?? sectionRows[0]!)
  const selectedBar = $derived(barCells.find((b) => b.number === selectedBarNumber) ?? barCells[0]!)
  const selectedBarSection = $derived(
    sectionRows.find((s) => selectedBar.number >= s.fromBar && selectedBar.number <= s.toBar) ?? sectionRows[0]!,
  )
  const selectedChord = $derived(songEditorFixture.harmony[selectedBar.number - 1]?.chord)
  const selectedLyric = $derived(lyricLines.find((l) => l.index === selectedLyricIndex) ?? lyricLines[0]!)
  const selectedCue = $derived(cueRows.find((c) => c.id === selectedCueSectionId) ?? cueRows[0]!)

  // Playhead follows the current selection so the waveform + transport agree.
  const playheadSec = $derived(
    mode === 'sections'
      ? (selectedSection.fromBar - 1) * secPerBar + 0.15
      : mode === 'grid' || mode === 'chords'
        ? selectedBar.startSec + 0.15
        : DURATION_SEC * 0.26,
  )

  const sectionOfBar = (n: number) => sectionRows.find((s) => n >= s.fromBar && n <= s.toBar)
  const barGroups = sectionRows.map((s) => ({ section: s, cells: barCells.slice(s.fromBar - 1, s.toBar) }))
  const secDuration = (bars: number) => fmtTime(bars * secPerBar)

  // Focus the shared waveform on a bar range (presentation-only viewport move).
  function focusBars(fromBar: number, toBar: number) {
    const pad = secPerBar
    let lo = Math.max(0, (fromBar - 1) * secPerBar - pad)
    let hi = Math.min(DURATION_SEC, toBar * secPerBar + pad)
    if (hi - lo < 1.5) hi = lo + 1.5
    viewStart = lo
    viewEnd = hi
  }

  // Deterministic mini-waveform for the mixer lanes (the star waveform is the
  // shared DebugSharedWaveform; these are lightweight channel previews).
  function miniWave(seed: number, n = 76): number[] {
    return Array.from({ length: n }, (_, i) => {
      const s = Math.sin(i * 0.21 + seed) * Math.sin(i * 0.052 + seed * 1.7)
      const env = 0.45 + 0.55 * Math.abs(Math.sin(i * 0.02 + seed))
      return 0.12 + 0.88 * Math.abs(s) * env
    })
  }
  const gainPct = (db: number) => Math.round(Math.pow(10, db / 20) * 100)

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const QUALITIES: { id: string; label: string }[] = [
    { id: 'major', label: 'maj' },
    { id: 'minor', label: 'min' },
    { id: '7', label: '7' },
    { id: 'maj7', label: 'maj7' },
    { id: 'min7', label: 'm7' },
    { id: 'sus4', label: 'sus4' },
    { id: 'dim', label: 'dim' },
    { id: 'aug', label: 'aug' },
  ]
  const SECTION_KINDS = ['intro', 'verse', 'preChorus', 'chorus', 'bridge', 'solo', 'outro', 'custom']
  const qualityLabel = (q: string | undefined) => QUALITIES.find((x) => x.id === q)?.label ?? q ?? '—'

  const savedAt = new Date(songEditorFixture.metadata.updatedAt ?? '').toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
</script>

<svelte:head>
  <title>Song editor · v2 Three-pane IDE — BarBro lab</title>
</svelte:head>

<!-- ══════════════ Reusable snippets ══════════════════════════════════════ -->

{#snippet chip(color: string, size = 'size-3')}
  <span class="{size} shrink-0 rounded-[2px] ring-1 ring-foreground/25" style="background-color: {color}"></span>
{/snippet}

{#snippet insHead(title: string)}
  <div
    class="border-foreground/12 text-muted-foreground flex items-center gap-1.5 border-b px-3 pt-3 pb-1.5 text-[10px] font-black uppercase tracking-widest"
  >
    {title}
  </div>
{/snippet}

{#snippet row(label: string, value: string, mono = true)}
  <div class="flex items-baseline justify-between gap-3 px-3 py-[3px]">
    <span class="text-muted-foreground shrink-0 text-[11px]">{label}</span>
    <span class="truncate text-right text-xs font-bold {mono ? 'font-mono tabular-nums' : ''}">{value}</span>
  </div>
{/snippet}

{#snippet fauxToggle(on: boolean, label: string)}
  <span
    class="inline-flex items-center gap-1.5 border-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide {on
      ? 'border-foreground bg-foreground text-background'
      : 'border-foreground/30 text-muted-foreground'}"
  >
    <span class="size-2 rounded-full {on ? 'bg-[var(--studio-orange)]' : 'bg-foreground/25'}"></span>
    {label}
  </span>
{/snippet}

{#snippet miniLane(seed: number, klass: string)}
  <div class="flex h-full w-full items-center gap-px overflow-hidden {klass}" aria-hidden="true">
    {#each miniWave(seed) as a, i (i)}
      <span class="bg-foreground/55 inline-block w-full" style="height: {Math.round(a * 100)}%"></span>
    {/each}
  </div>
{/snippet}

<!-- ══════════════ Page frame ═════════════════════════════════════════════ -->

<div class="v2 flex h-[calc(100dvh-3.5rem)] w-full max-w-none overflow-hidden bg-background text-foreground">
  <!-- ── LEFT: mode rail ─────────────────────────────────────────────────── -->
  <nav
    class="border-foreground bg-card flex w-[88px] shrink-0 flex-col overflow-y-auto border-r-2"
    aria-label="Editor mode"
  >
    <!-- rail header: draft / song monogram, aligns with the top strip -->
    <div class="border-foreground/70 flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 border-b-2">
      <span
        class="grid size-7 place-items-center rounded-[var(--radius)] border-2 border-foreground bg-[var(--studio-orange)] text-[#1a1a1a]"
        title="Active draft"
      >
        <Disc3 class="size-4" aria-hidden="true" />
      </span>
      <span class="text-muted-foreground text-[9px] font-black uppercase tracking-wider">{meta.draftLabel}</span>
    </div>

    {#each RAIL_GROUPS as g (g.label)}
      <div class="text-muted-foreground/70 px-2 pt-2.5 pb-1 text-[8px] font-black uppercase tracking-[0.15em]">
        {g.label}
      </div>
      {#each g.ids as id (id)}
        {@const Icon = MODE_ICON[id]}
        {@const active = mode === id}
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          onclick={() => (mode = id)}
          class="group relative mx-1.5 mb-1 flex flex-col items-center gap-1 rounded-[var(--radius)] px-1 py-2 text-center transition-colors {active
            ? 'bg-foreground text-background'
            : 'text-foreground hover:bg-accent'}"
        >
          {#if active}
            <span class="absolute inset-y-1 -left-1.5 w-1 rounded-full bg-[var(--studio-orange)]"></span>
          {/if}
          <Icon class="size-5" aria-hidden="true" />
          <span class="text-[9.5px] font-bold leading-tight tracking-tight">{tabLabel(id)}</span>
        </button>
      {/each}
    {/each}

    <div class="mt-auto px-1.5 py-2">
      <HelpHint
        label="Editor layout help"
        text="Pick a mode on this rail. The center workspace changes to match; the right inspector always shows details for whatever you have selected. Grid, Sections and Chords share the one waveform at the top."
      />
    </div>
  </nav>

  <!-- ── RIGHT OF RAIL: top strip + (workspace | inspector) ───────────────── -->
  <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <!-- TOP STRIP: transport + waveform-nav readout + save/sync -->
    <div
      class="border-foreground flex h-14 shrink-0 items-center gap-3 border-b-2 px-3"
      style="background: color-mix(in oklch, var(--studio-orange) 6%, var(--muted));"
    >
      <!-- condensed song identity -->
      <div class="flex min-w-0 max-w-[13rem] flex-col leading-none">
        <span class="truncate text-sm font-black tracking-tight">{meta.title}</span>
        <span class="text-muted-foreground truncate text-[11px]">{meta.artist}</span>
      </div>
      <span
        class="border-foreground/25 bg-background hidden shrink-0 items-center gap-1.5 rounded-[var(--radius)] border px-2 py-1 font-mono text-[11px] font-bold tabular-nums sm:inline-flex"
      >
        {meta.bpm} BPM
        <span class="text-muted-foreground/50">·</span>
        {meta.keyLabel}
      </span>

      <!-- transport (predictable: always center-left of the strip) -->
      <div class="ml-1 flex shrink-0 items-center gap-1.5">
        <Button size="sm" class="h-8 gap-1.5 px-3"><Play class="size-4" aria-hidden="true" />Play</Button>
        <Button variant="outline" size="icon-sm" class="h-8 w-8" aria-label="Stop">
          <Square class="size-3.5" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon-sm" class="h-8 w-8" aria-label="Restart">
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon-sm" class="h-8 w-8" aria-label="Loop section">
          <Repeat1 class="size-3.5" aria-hidden="true" />
        </Button>
        <button
          type="button"
          onclick={() => (clickOn = !clickOn)}
          class="ml-0.5 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border-2 px-2 text-[11px] font-bold uppercase tracking-wide {clickOn
            ? 'border-foreground bg-foreground text-background'
            : 'border-foreground/30 text-muted-foreground'}"
          title="Play a click / count-in with the song"
        >
          <Volume2 class="size-3.5" aria-hidden="true" />Click
        </button>
        <span class="ml-1 font-mono text-sm font-bold tabular-nums">{fmtTime(playheadSec)}</span>
        <span class="text-muted-foreground font-mono text-xs tabular-nums">/ {meta.durationLabel}</span>
      </div>

      <div class="flex-1"></div>

      <!-- waveform-nav readout (display; the live control is the waveform) -->
      <div
        class="border-foreground/25 bg-background text-muted-foreground hidden items-center gap-2 rounded-[var(--radius)] border px-2 py-1 font-mono text-[11px] font-bold tabular-nums lg:flex"
        title="Shared waveform viewport"
      >
        <Waypoints class="size-3.5" aria-hidden="true" />
        bars {barOf(viewStart)}–{barOf(viewEnd)}
        <span class="text-muted-foreground/40">·</span>
        {fmtTime(viewStart)}–{fmtTime(viewEnd)}
        <span class="text-muted-foreground/40">·</span>
        {zoomX.toFixed(1)}×
      </div>

      <!-- save / sync (predictable: always far-right corner) -->
      <span
        class="border-foreground bg-background inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border-2 px-2 py-1 text-[11px] font-bold uppercase tracking-wide"
        title="All edits saved locally and synced to the cloud"
      >
        <Check class="size-3.5 text-[color:var(--studio-orange)]" aria-hidden="true" />
        Saved
        <span class="text-muted-foreground/40">·</span>
        <Cloud class="size-3.5" aria-hidden="true" />
        Synced
      </span>
    </div>

    <!-- WORKSPACE + INSPECTOR -->
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <!-- ── CENTER: workspace ──────────────────────────────────────────── -->
      <main class="min-w-0 flex-1 overflow-y-auto">
        <!-- Shared waveform: ONE instance, top of the workspace for the
             timeline family. Its viewport lives in page state, so it persists
             even while you visit non-waveform modes. -->
        {#if isWaveMode}
          <div class="border-foreground/12 bg-muted/30 border-b p-3">
            <DebugSharedWaveform
              bind:viewStart
              bind:viewEnd
              sections={waveformSections}
              bars={meta.bars}
              durationSec={DURATION_SEC}
              {playheadSec}
            />
          </div>
        {/if}

        <div class="p-3 sm:p-4">
          <!-- ─────────────── OVERVIEW (mixer / summary) ─────────────── -->
          {#if mode === 'overview'}
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <h2 class="mr-1 text-sm font-black uppercase tracking-wide">Mixer</h2>
              <span class="border-foreground/20 bg-muted/40 rounded-[var(--radius)] border px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums">
                {mixerLanes.length} tracks
              </span>
              <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{meta.bars} bars · {meta.durationLabel}</span>
              <div class="ml-auto flex items-center gap-2">
                <span class="text-muted-foreground text-[11px] font-bold">Show BarBro Band tools</span>
                <span class="border-foreground/40 relative h-4 w-8 rounded-full border">
                  <span class="bg-foreground/40 absolute left-0.5 top-1/2 size-2.5 -translate-y-1/2 rounded-full"></span>
                </span>
              </div>
            </div>

            <div class="border-foreground overflow-hidden border-2">
              {#each mixerLanes as lane, i (lane.key)}
                <div class="border-foreground/12 flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                  <div class="flex w-40 shrink-0 items-center gap-2">
                    {@render chip(lane.color, 'size-3.5')}
                    <div class="min-w-0">
                      <div class="truncate text-xs font-bold">{lane.label}</div>
                      <div class="text-muted-foreground font-mono text-[10px] tabular-nums">{lane.db.toFixed(1)} dB</div>
                    </div>
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <span
                      class="grid size-7 place-items-center rounded-[var(--radius)] border-2 font-mono text-[11px] font-black {lane.muted
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-foreground/30 text-muted-foreground'}">M</span>
                    <span
                      class="grid size-7 place-items-center rounded-[var(--radius)] border-2 font-mono text-[11px] font-black {lane.solo
                        ? 'border-foreground bg-[var(--studio-orange)] text-[#1a1a1a]'
                        : 'border-foreground/30 text-muted-foreground'}">S</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.01"
                    value={Math.pow(10, lane.db / 20)}
                    class="accent-foreground w-28 shrink-0"
                    aria-label="{lane.label} volume"
                  />
                  <span class="text-muted-foreground w-9 shrink-0 text-right font-mono text-[10px] tabular-nums">{gainPct(lane.db)}%</span>
                  <div class="relative h-9 min-w-0 flex-1">
                    {@render miniLane(i * 3 + 2, lane.muted ? 'opacity-30' : '')}
                    {#if i === 0}
                      {#each sectionRows as s (s.id)}
                        <span
                          class="text-foreground/70 absolute top-0 font-mono text-[8px] font-bold"
                          style="left: calc({((s.fromBar - 1) / meta.bars) * 100}% + 2px)">{s.label}</span>
                      {/each}
                    {/if}
                    <span class="pointer-events-none absolute inset-y-0 z-10 w-px bg-[var(--studio-orange)]" style="left: {(playheadSec / DURATION_SEC) * 100}%"></span>
                  </div>
                </div>
              {/each}
            </div>
            <p class="text-muted-foreground mt-2 text-[11px]">
              Original audio, stems and generated tracks load as aligned lanes. Volume, mute and solo save with the song.
            </p>
          {/if}

          <!-- ─────────────── GRID (bars + beats) ─────────────── -->
          {#if mode === 'grid'}
            <div class="mb-2 flex items-center gap-2">
              <h2 class="text-sm font-black uppercase tracking-wide">Grid</h2>
              <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{meta.bars} bars · {meta.bars * meta.beatsPerBar} beats · {meta.timeSignature}</span>
            </div>
            <!-- bar ruler -->
            <div class="border-foreground overflow-x-auto border-2">
              <div class="flex min-w-max">
                {#each barCells as b (b.number)}
                  {@const active = b.number === selectedBarNumber}
                  <button
                    type="button"
                    onclick={() => (selectedBarNumber = b.number)}
                    class="border-foreground/10 relative h-16 w-8 shrink-0 border-r last:border-r-0 {active ? 'ring-2 ring-inset ring-[var(--studio-orange)]' : ''}"
                    style="background-color: color-mix(in oklch, {b.color} {active ? 34 : b.isSectionStart ? 20 : 12}%, transparent)"
                    title="Bar {b.number}"
                    aria-label="Bar {b.number}"
                  >
                    {#if b.number % 4 === 1}
                      <span class="text-muted-foreground absolute left-1 top-1 font-mono text-[9px] font-bold">{b.number}</span>
                    {/if}
                    {#if b.isSectionStart}
                      <span class="absolute inset-x-0 bottom-0 h-1" style="background-color: {b.color}"></span>
                      <span class="text-foreground/80 absolute inset-x-0 bottom-1.5 truncate px-0.5 text-[7px] font-black uppercase leading-none">{b.sectionLabel}</span>
                    {/if}
                    <!-- beat ticks -->
                    <span class="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-around px-1">
                      {#each Array(meta.beatsPerBar) as _, bi (bi)}
                        <span class="bg-foreground/30 h-2 w-px {bi === 0 ? 'bg-foreground/60 h-3' : ''}"></span>
                      {/each}
                    </span>
                  </button>
                {/each}
              </div>
            </div>

            <!-- selected bar → beat detail -->
            <div class="mt-3">
              <div class="text-muted-foreground mb-1.5 text-[10px] font-black uppercase tracking-widest">Bar {selectedBar.number} · beats</div>
              <div class="grid grid-cols-4 gap-2">
                {#each Array(meta.beatsPerBar) as _, bi (bi)}
                  {@const t = selectedBar.startSec + bi * beatSec}
                  <div class="border-foreground/25 bg-card flex flex-col items-center gap-0.5 border-2 py-3">
                    <span class="font-mono text-lg font-black tabular-nums {bi === 0 ? 'text-[color:var(--studio-orange)]' : ''}">{bi + 1}</span>
                    <span class="text-muted-foreground font-mono text-[10px] tabular-nums">{t.toFixed(2)}s</span>
                    <span class="text-muted-foreground text-[9px] font-bold uppercase">{bi === 0 ? 'downbeat' : 'beat'}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- ─────────────── SECTIONS ─────────────── -->
          {#if mode === 'sections'}
            <div class="mb-2 flex items-center gap-2">
              <h2 class="text-sm font-black uppercase tracking-wide">Sections</h2>
              <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{sectionRows.length} sections</span>
            </div>
            <!-- section map: proportional colored blocks across the song -->
            <div class="border-foreground mb-3 flex h-10 overflow-hidden border-2">
              {#each sectionRows as s (s.id)}
                {@const active = s.id === selectedSectionId}
                <button
                  type="button"
                  onclick={() => (selectedSectionId = s.id)}
                  class="border-background/60 relative flex items-center overflow-hidden border-r px-1.5 text-left last:border-r-0"
                  style="width: {(s.bars / meta.bars) * 100}%; background-color: color-mix(in oklch, {s.color} {active ? 55 : 30}%, transparent)"
                  title="{s.label} · bars {s.fromBar}–{s.toBar}"
                >
                  <span class="truncate text-[9px] font-black uppercase leading-none">{s.label}</span>
                  {#if active}<span class="absolute inset-0 ring-2 ring-inset ring-foreground"></span>{/if}
                </button>
              {/each}
            </div>
            <!-- section list -->
            <div class="border-foreground overflow-hidden border-2">
              {#each sectionRows as s (s.id)}
                {@const active = s.id === selectedSectionId}
                <button
                  type="button"
                  onclick={() => (selectedSectionId = s.id)}
                  class="border-foreground/12 flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 {active ? 'bg-accent' : 'hover:bg-muted/50'}"
                >
                  {@render chip(s.color, 'size-4')}
                  <span class="w-24 shrink-0 truncate text-xs font-black uppercase tracking-wide">{s.label}</span>
                  <span class="text-muted-foreground font-mono text-[11px] tabular-nums">bars {s.fromBar}–{s.toBar}</span>
                  <span class="text-muted-foreground/70 font-mono text-[11px] tabular-nums">{s.bars} bars</span>
                  <span class="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">{secDuration(s.bars)}</span>
                </button>
              {/each}
            </div>
          {/if}

          <!-- ─────────────── CHORDS ─────────────── -->
          {#if mode === 'chords'}
            <div class="mb-2 flex items-center gap-2">
              <h2 class="text-sm font-black uppercase tracking-wide">Chords</h2>
              <span class="text-muted-foreground font-mono text-[11px] tabular-nums">one chord / bar · key {meta.keyLabel}</span>
            </div>
            <div class="border-foreground space-y-3 border-2 p-3">
              {#each barGroups as grp (grp.section.id)}
                <div>
                  <div class="mb-1 flex items-center gap-1.5">
                    {@render chip(grp.section.color, 'size-2.5')}
                    <span class="text-[10px] font-black uppercase tracking-wide">{grp.section.label}</span>
                    <span class="text-muted-foreground font-mono text-[10px] tabular-nums">bars {grp.section.fromBar}–{grp.section.toBar}</span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    {#each grp.cells as b (b.number)}
                      {@const active = b.number === selectedBarNumber}
                      <button
                        type="button"
                        onclick={() => (selectedBarNumber = b.number)}
                        class="relative grid h-10 w-11 place-items-center rounded-[var(--radius)] border-2 font-mono text-sm font-black tabular-nums {active
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-foreground/20 bg-card hover:border-foreground/50'}"
                        title="Bar {b.number}"
                      >
                        {b.chord}
                        <span class="text-muted-foreground/60 absolute left-0.5 top-0 text-[7px] font-bold {active ? 'text-background/60' : ''}">{b.number}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <!-- ─────────────── CUE ─────────────── -->
          {#if mode === 'cue'}
            <div class="mb-2 flex items-center gap-2">
              <h2 class="text-sm font-black uppercase tracking-wide">Cue track</h2>
              <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{cueRows.filter((c) => c.spoken).length} spoken · 1 count-in</span>
            </div>
            <!-- cue timeline: markers at each section start -->
            <div class="border-foreground bg-muted/30 relative mb-3 h-9 overflow-hidden border-2">
              {#each cueRows as c (c.id)}
                <span
                  class="absolute inset-y-0 flex items-center"
                  style="left: {((c.fromBar - 1) / meta.bars) * 100}%"
                  title="{c.label}"
                >
                  <span class="h-full w-0.5" style="background-color: {c.color}"></span>
                  {#if c.spoken}
                    <span class="ml-0.5 grid size-4 -translate-y-2 place-items-center"><Speech class="size-3 text-foreground/70" aria-hidden="true" /></span>
                  {/if}
                </span>
              {/each}
            </div>
            <div class="border-foreground overflow-hidden border-2">
              {#each cueRows as c (c.id)}
                {@const active = c.id === selectedCueSectionId}
                <button
                  type="button"
                  onclick={() => (selectedCueSectionId = c.id)}
                  class="border-foreground/12 flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 {active ? 'bg-accent' : 'hover:bg-muted/50'}"
                >
                  {@render chip(c.color, 'size-3.5')}
                  <span class="w-24 shrink-0 truncate text-xs font-black uppercase tracking-wide">{c.label}</span>
                  {@render fauxToggle(c.spoken, 'Spoken')}
                  {@render fauxToggle(c.countIn, 'Count-in')}
                  <span class="text-muted-foreground ml-auto truncate font-mono text-[11px]">{c.spoken ? `“${c.label}”` : '—'}</span>
                </button>
              {/each}
            </div>
            <div class="mt-3 flex justify-end">
              <Button variant="secondary" size="sm" class="gap-1.5"><Mic class="size-3.5" aria-hidden="true" />Auto-generate cues</Button>
            </div>
          {/if}

          <!-- ─────────────── LYRICS ─────────────── -->
          {#if mode === 'lyrics'}
            <div class="mb-2 flex items-center gap-2">
              <h2 class="text-sm font-black uppercase tracking-wide">Lyrics</h2>
              <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{lyricLines.length} lines · draft {meta.draftLabel}</span>
            </div>
            <div class="grid gap-3 lg:grid-cols-2">
              <div class="flex min-w-0 flex-col">
                <span class="text-muted-foreground mb-1 text-[10px] font-black uppercase tracking-widest">Source text</span>
                <textarea
                  rows="20"
                  spellcheck="false"
                  class="border-foreground bg-card min-h-[26rem] w-full resize-y border-2 px-3 py-2 font-mono text-[13px] leading-relaxed focus:outline-none"
                  >{lyricLines.map((l) => l.text).join('\n')}</textarea
                >
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="text-muted-foreground mb-1 text-[10px] font-black uppercase tracking-widest">Timed lines</span>
                <div class="border-foreground max-h-[26rem] overflow-y-auto border-2">
                  {#each lyricLines as l (l.index)}
                    {@const active = l.index === selectedLyricIndex}
                    {@const sec = sectionOfBar(barOf(l.startSec))}
                    <button
                      type="button"
                      onclick={() => (selectedLyricIndex = l.index)}
                      class="border-foreground/10 flex w-full items-center gap-2.5 border-b px-2.5 py-1.5 text-left last:border-b-0 {active ? 'bg-accent' : 'hover:bg-muted/50'}"
                    >
                      <span class="text-muted-foreground w-9 shrink-0 font-mono text-[10px] tabular-nums">{l.timeLabel}</span>
                      {@render chip(sectionKindColor(sec?.kind), 'size-2')}
                      <span class="truncate text-[13px]">{l.text}</span>
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- ─────────────── LEAD SHEET ─────────────── -->
          {#if mode === 'leadsheet'}
            <div class="mx-auto max-w-3xl">
              <div class="border-foreground/20 mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 pb-3">
                <span class="text-2xl font-black tracking-tight">{meta.title}</span>
                <span class="text-muted-foreground text-sm">{meta.artist}</span>
                <span class="text-muted-foreground ml-auto font-mono text-xs tabular-nums">{meta.keyLabel} · {meta.bpm} BPM · {meta.timeSignature}</span>
              </div>
              <div class="space-y-4">
                {#each barGroups as grp (grp.section.id)}
                  <div class="break-inside-avoid">
                    <div class="mb-1 flex items-center gap-2">
                      {@render chip(grp.section.color, 'size-2.5')}
                      <span class="text-xs font-black uppercase tracking-wide">{grp.section.label}</span>
                      <span class="text-muted-foreground font-mono text-[10px] tabular-nums">bars {grp.section.fromBar}–{grp.section.toBar}</span>
                    </div>
                    <div class="grid grid-cols-4 gap-x-2 gap-y-1 font-mono text-sm font-bold tracking-wide sm:grid-cols-8">
                      {#each grp.cells as b (b.number)}
                        <span class="border-foreground/10 border-b py-0.5">{b.chord}</span>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </main>

      <!-- ── RIGHT: contextual inspector ──────────────────────────────────── -->
      <aside class="border-foreground bg-card flex w-[320px] shrink-0 flex-col overflow-y-auto border-l-2">
        <!-- inspector header (mode identity, always same corner) -->
        <div class="border-foreground bg-muted/40 flex items-center gap-2 border-b-2 px-3 py-2.5">
          <HeadIcon class="size-4 shrink-0" aria-hidden="true" />
          <span class="text-xs font-black uppercase tracking-widest">{tabLabel(mode)}</span>
          <span class="text-muted-foreground ml-auto font-mono text-[10px] uppercase">Inspector</span>
        </div>

        <!-- ===== OVERVIEW inspector: song metadata + save/sync ===== -->
        {#if mode === 'overview'}
          {@render insHead('Song')}
          {@render row('Title', meta.title, false)}
          {@render row('Artist', meta.artist, false)}
          {@render row('Tempo', `${meta.bpm} BPM`)}
          {@render row('Time signature', meta.timeSignature)}
          {@render row('Duration', meta.durationLabel)}
          {@render row('Bars / sections', `${meta.bars} / ${sectionRows.length}`)}

          {@render insHead('Key & transpose')}
          <div class="flex items-center gap-2 px-3 py-2">
            <span class="border-foreground bg-background inline-flex items-center rounded-[var(--radius)] border px-2 py-1 font-mono text-xs font-bold">{meta.keyLabel}</span>
            <span class="text-muted-foreground text-[11px]">display</span>
            <span class="border-foreground/30 bg-background ml-auto inline-flex items-center overflow-hidden rounded-[var(--radius)] border font-mono text-[11px] font-black">
              <span class="grid size-6 place-items-center"><Minus class="size-3" aria-hidden="true" /></span>
              <span class="border-foreground/20 min-w-8 border-x px-2 py-0.5 text-center">0</span>
              <span class="grid size-6 place-items-center"><Plus class="size-3" aria-hidden="true" /></span>
            </span>
          </div>

          {@render insHead('Save & sync')}
          <div class="space-y-1 px-3 py-2">
            <div class="flex items-center gap-2 text-xs font-bold"><Check class="size-3.5 text-[color:var(--studio-orange)]" aria-hidden="true" />Saved locally</div>
            <div class="flex items-center gap-2 text-xs font-bold"><Cloud class="size-3.5" aria-hidden="true" />Synced to cloud</div>
            <div class="text-muted-foreground pt-1 font-mono text-[11px] tabular-nums">Updated {savedAt}</div>
            <div class="text-muted-foreground font-mono text-[11px]">Draft · {meta.draftLabel}</div>
          </div>
        {/if}

        <!-- ===== GRID inspector: selected bar + count-in ===== -->
        {#if mode === 'grid'}
          {@render insHead('Selected bar')}
          <div class="flex items-center gap-3 px-3 py-2">
            <span class="grid size-11 shrink-0 place-items-center rounded-[var(--radius)] border-2 border-foreground bg-card font-mono text-xl font-black tabular-nums">{selectedBar.number}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                {@render chip(selectedBarSection.color, 'size-2.5')}
                <span class="truncate text-xs font-black uppercase">{selectedBarSection.label}</span>
              </div>
              <div class="text-muted-foreground font-mono text-[11px] tabular-nums">starts {selectedBar.startSec.toFixed(2)}s</div>
            </div>
          </div>
          {@render row('Beats', `${meta.beatsPerBar}`)}
          {@render row('Meter', meta.timeSignature)}
          {@render row('Chord', selectedBar.chord)}
          <div class="px-3 pt-1 pb-2">
            <Button variant="outline" size="sm" class="h-7 w-full gap-1.5 text-[11px]" onclick={() => focusBars(selectedBar.number, selectedBar.number)}>
              <Waypoints class="size-3.5" aria-hidden="true" />Focus in waveform
            </Button>
          </div>

          {@render insHead('Count-in & song start')}
          <div class="flex flex-wrap gap-1.5 px-3 py-2">
            {#each [0, 4, 8] as n (n)}
              <span class="rounded-[var(--radius)] border-2 px-2.5 py-1 text-[11px] font-bold {n === songEditorFixture.countInBeats ? 'border-foreground bg-foreground text-background' : 'border-foreground/30 text-muted-foreground'}">{n === 0 ? 'Off' : `${n}`}</span>
            {/each}
            <span class="text-muted-foreground self-center text-[11px]">beats</span>
          </div>
          {@render row('Before song', '1.97 s')}
          {@render row('Start at', 'bar 1 · beat 1')}

          {@render insHead('History')}
          <div class="flex flex-wrap gap-1.5 px-3 py-2">
            <Button variant="outline" size="sm" class="h-7 text-[11px]">Undo</Button>
            <Button variant="outline" size="sm" class="h-7 text-[11px] opacity-40">Redo</Button>
            <Button variant="outline" size="sm" class="h-7 gap-1 text-[11px]"><RotateCcw class="size-3" aria-hidden="true" />Reset</Button>
          </div>
        {/if}

        <!-- ===== SECTIONS inspector: selected section ===== -->
        {#if mode === 'sections'}
          {@render insHead('Section')}
          <div class="flex items-center gap-3 px-3 py-2">
            {@render chip(selectedSection.color, 'size-7')}
            <div class="min-w-0">
              <div class="truncate text-sm font-black uppercase tracking-wide">{selectedSection.label}</div>
              <div class="text-muted-foreground font-mono text-[11px] tabular-nums">bars {selectedSection.fromBar}–{selectedSection.toBar} · {secDuration(selectedSection.bars)}</div>
            </div>
          </div>
          {@render row('Kind', selectedSection.kind)}
          {@render row('Bars', `${selectedSection.bars}`)}
          {@render row('Range', `${selectedSection.fromBar}–${selectedSection.toBar}`)}
          <div class="px-3 pb-2 pt-1">
            <label class="text-muted-foreground mb-1 block text-[10px] font-black uppercase tracking-widest" for="v2-sec-label">Label</label>
            <input id="v2-sec-label" value={selectedSection.label} class="border-foreground bg-background w-full rounded-[var(--radius)] border-2 px-2 py-1 text-xs" />
          </div>

          {@render insHead('Kind & colour')}
          <div class="flex flex-wrap gap-1.5 px-3 py-2">
            {#each SECTION_KINDS as k (k)}
              {@const on = k === selectedSection.kind}
              <span
                class="inline-flex items-center gap-1 rounded-[var(--radius)] border-2 px-1.5 py-1 text-[10px] font-bold {on ? 'border-foreground' : 'border-transparent hover:border-foreground/20'}"
                title={k}
              >
                {@render chip(sectionKindColor(k), 'size-3')}
                <span class="capitalize {on ? '' : 'text-muted-foreground'}">{k}</span>
              </span>
            {/each}
          </div>
          <div class="px-3 pb-3 pt-1">
            <Button variant="outline" size="sm" class="h-7 w-full gap-1.5 text-[11px]" onclick={() => focusBars(selectedSection.fromBar, selectedSection.toBar)}>
              <Waypoints class="size-3.5" aria-hidden="true" />Focus in waveform
            </Button>
          </div>
        {/if}

        <!-- ===== CHORDS inspector: selected chord ===== -->
        {#if mode === 'chords'}
          {@render insHead('Chord')}
          <div class="flex items-center gap-3 px-3 py-2">
            <span class="grid h-12 w-14 shrink-0 place-items-center rounded-[var(--radius)] border-2 border-foreground bg-card font-mono text-2xl font-black">{selectedBar.chord}</span>
            <div class="min-w-0">
              <div class="text-muted-foreground font-mono text-[11px] tabular-nums">bar {selectedBar.number} · beat 1</div>
              <div class="flex items-center gap-1.5 pt-0.5">
                {@render chip(selectedBarSection.color, 'size-2.5')}
                <span class="truncate text-[11px] font-bold uppercase">{selectedBarSection.label}</span>
              </div>
            </div>
          </div>
          {@render row('Root', selectedChord?.root ?? '—')}
          {@render row('Quality', qualityLabel(selectedChord?.quality))}
          {@render row('Anchored beat', `bar ${selectedBar.number} · 1`)}

          {@render insHead('Root')}
          <div class="grid grid-cols-6 gap-1 px-3 py-2">
            {#each NOTES as n (n)}
              {@const on = n === selectedChord?.root}
              <span class="grid h-7 place-items-center rounded-[var(--radius)] border-2 font-mono text-[11px] font-bold {on ? 'border-foreground bg-foreground text-background' : 'border-foreground/20 text-muted-foreground'}">{n}</span>
            {/each}
          </div>
          {@render insHead('Quality')}
          <div class="flex flex-wrap gap-1 px-3 py-2">
            {#each QUALITIES as q (q.id)}
              {@const on = q.id === selectedChord?.quality}
              <span class="rounded-[var(--radius)] border-2 px-2 py-1 font-mono text-[11px] font-bold {on ? 'border-foreground bg-foreground text-background' : 'border-foreground/20 text-muted-foreground'}">{q.label}</span>
            {/each}
          </div>

          {@render insHead('Suggestions')}
          <div class="space-y-1.5 px-3 py-2">
            <div class="text-muted-foreground text-[11px]">Harmony analysis proposes chords per section.</div>
            <Button variant="secondary" size="sm" class="h-7 w-full text-[11px]">Use section suggestions (4)</Button>
            <Button variant="outline" size="sm" class="h-7 w-full text-[11px]">Finish section</Button>
          </div>
        {/if}

        <!-- ===== CUE inspector: selected cue ===== -->
        {#if mode === 'cue'}
          {@render insHead('Performer')}
          <div class="flex flex-wrap gap-1.5 px-3 py-2">
            <span class="border-foreground bg-foreground text-background rounded-[var(--radius)] border-2 px-2 py-0.5 text-[11px] font-bold">Lead vox</span>
            <span class="border-foreground/30 text-muted-foreground rounded-[var(--radius)] border-2 px-2 py-0.5 text-[11px] font-bold">Guitar</span>
            <span class="border-foreground/30 text-muted-foreground rounded-[var(--radius)] border-2 px-2 py-0.5 text-[11px] font-bold">+ Add</span>
          </div>

          {@render insHead('Cue')}
          <div class="flex items-center gap-2 px-3 py-2">
            {@render chip(selectedCue.color, 'size-4')}
            <span class="text-sm font-black uppercase tracking-wide">{selectedCue.label}</span>
            <span class="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">bars {selectedCue.fromBar}–{selectedCue.toBar}</span>
          </div>
          <div class="flex gap-1.5 px-3 pb-2">
            {@render fauxToggle(selectedCue.spoken, 'Spoken cue')}
            {@render fauxToggle(selectedCue.countIn, 'Count-in')}
          </div>
          <div class="px-3 pb-2">
            <label class="text-muted-foreground mb-1 block text-[10px] font-black uppercase tracking-widest" for="v2-cue-text">Spoken text</label>
            <input id="v2-cue-text" value={selectedCue.spoken ? selectedCue.label : ''} placeholder="—" class="border-foreground bg-background w-full rounded-[var(--radius)] border-2 px-2 py-1 text-xs" />
          </div>
          {@render row('Voice', 'en · Lessac')}
          {@render row('Lead', '2 beats')}
          <div class="px-3 py-2">
            <Button variant="secondary" size="sm" class="h-7 w-full gap-1.5 text-[11px]"><Mic class="size-3.5" aria-hidden="true" />Auto-generate all</Button>
          </div>
        {/if}

        <!-- ===== LYRICS inspector: lyrics status + selected line ===== -->
        {#if mode === 'lyrics'}
          {@render insHead('Lyrics')}
          {@render row('Draft', meta.draftLabel, false)}
          {@render row('Lines', `${lyricLines.length}`)}
          {@render row('Words', `${songEditorFixture.lyrics?.words.length ?? 0}`)}
          {@render row('Status', 'aligned')}
          {@render row('Transcriber', `v${songEditorFixture.lyrics?.transcriberVersion ?? 0}`)}

          {@render insHead('Selected line')}
          <div class="px-3 py-2">
            <div class="text-muted-foreground mb-1 font-mono text-[11px] tabular-nums">line {selectedLyric.index + 1} · {selectedLyric.timeLabel}</div>
            <div class="border-foreground/20 bg-muted/30 rounded-[var(--radius)] border px-2 py-1.5 text-[13px] leading-relaxed">{selectedLyric.text}</div>
          </div>

          {@render insHead('Actions')}
          <div class="flex flex-col gap-1.5 px-3 py-2">
            <Button variant="outline" size="sm" class="h-7 w-full text-[11px]">Save lyrics</Button>
            <Button variant="secondary" size="sm" class="h-7 w-full gap-1.5 text-[11px]"><Clock class="size-3.5" aria-hidden="true" />Fit to song</Button>
          </div>
        {/if}

        <!-- ===== LEAD SHEET inspector: read-only + print ===== -->
        {#if mode === 'leadsheet'}
          {@render insHead('Lead sheet')}
          <div class="text-muted-foreground flex items-start gap-2 px-3 py-2 text-[11px] leading-relaxed">
            <Info class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            A read-only performance chart derived from the saved song map — sections, chords, key and timing.
          </div>
          {@render row('Key', meta.keyLabel)}
          {@render row('Tempo', `${meta.bpm} BPM`)}
          {@render row('Sections', `${sectionRows.length}`)}
          {@render row('Bars', `${meta.bars}`)}

          {@render insHead('Layout')}
          <div class="flex flex-wrap gap-1.5 px-3 py-2">
            <span class="border-foreground bg-foreground text-background rounded-[var(--radius)] border-2 px-2 py-0.5 text-[11px] font-bold">Chords</span>
            <span class="border-foreground/30 text-muted-foreground rounded-[var(--radius)] border-2 px-2 py-0.5 text-[11px] font-bold">+ Lyrics</span>
            <span class="border-foreground/30 text-muted-foreground rounded-[var(--radius)] border-2 px-2 py-0.5 text-[11px] font-bold">Transpose 0</span>
          </div>

          {@render insHead('Section colours')}
          <div class="grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-2">
            {#each sectionRows as s (s.id)}
              <div class="flex items-center gap-1.5">
                {@render chip(s.color, 'size-2.5')}
                <span class="truncate text-[11px] font-bold">{s.label}</span>
              </div>
            {/each}
          </div>

          {@render insHead('Export')}
          <div class="flex flex-col gap-1.5 px-3 py-2">
            <Button variant="outline" size="sm" class="h-7 w-full gap-1.5 text-[11px]"><Printer class="size-3.5" aria-hidden="true" />Print</Button>
            <Button variant="outline" size="sm" class="h-7 w-full gap-1.5 text-[11px]"><FileMusic class="size-3.5" aria-hidden="true" />Export PDF</Button>
          </div>
        {/if}

        <!-- mode help — always the last block, same place every mode -->
        <div class="border-foreground/12 mt-auto border-t px-3 py-2.5">
          <div class="text-muted-foreground flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
            {#if mode === 'overview'}<ListMusic class="size-3.5" aria-hidden="true" />Mixer{/if}
            {#if mode === 'grid'}<Hash class="size-3.5" aria-hidden="true" />Bars &amp; beats{/if}
            {#if mode === 'sections'}<Tag class="size-3.5" aria-hidden="true" />Sections{/if}
            {#if mode === 'chords'}<Music2 class="size-3.5" aria-hidden="true" />Chords{/if}
            {#if mode === 'cue'}<Megaphone class="size-3.5" aria-hidden="true" />Cues{/if}
            {#if mode === 'lyrics'}<Type class="size-3.5" aria-hidden="true" />Lyrics{/if}
            {#if mode === 'leadsheet'}<Palette class="size-3.5" aria-hidden="true" />Chart{/if}
            <HelpHint
              class="ml-auto"
              side="left"
              label="{tabLabel(mode)} help"
              text={mode === 'overview'
                ? 'Every source and generated track is a lane. Volume, mute and solo save with the song and stay aligned for playback and export.'
                : mode === 'grid'
                  ? 'Bars and beats drive everything downstream. Select a bar to inspect its beats; the count-in and song-start anchor live in the inspector.'
                  : mode === 'sections'
                    ? 'Tag stretches of the song as intro / verse / chorus. Colours match the waveform bands, the pads and the exported setlist.'
                    : mode === 'chords'
                      ? 'Place a chord on beat 1 of any bar. Analysis suggestions can be accepted per section from the inspector.'
                      : mode === 'cue'
                        ? 'Per section, toggle a spoken cue and/or a count-in. Auto-generate reads each section name just before it starts.'
                        : mode === 'lyrics'
                          ? 'Paste lyrics for this draft, then optionally fit each word to the audio as a separate step.'
                          : 'A read-only performance view of the saved song map. Print or export without touching the underlying data.'}
            />
          </div>
        </div>
      </aside>
    </div>
  </div>
</div>

<style>
  /* Cards inside the brutalist frame pick up the panel fill (matches /edit). */
  .v2 :global(.border-2.border-foreground.bg-card),
  .v2 :global(textarea.border-foreground) {
    background: var(--card);
  }
</style>
