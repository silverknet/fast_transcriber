<script lang="ts">
  /**
   * Static, read-only reproduction of how `/edit` looks RIGHT NOW.
   *
   * This is a grounded visual baseline for design iteration — NOT the real
   * editor. There are no stores, no PlaybackController, no real audio, and no
   * interactivity beyond switching the `editMode` tabs. Every value is a static
   * const; the waveform is an approximated static SVG; the Cue and Lead-sheet
   * panels are simplified placeholders (the real ones are far heavier). The
   * markup, classes and structure otherwise mirror `src/routes/edit/+page.svelte`
   * (and the shared `EditSectionToolbar` / `WaveformPlayer` surfaces) so it
   * renders faithfully using the same global Tailwind utilities.
   */
  import { Button } from '$lib/components/ui/button'
  import HelpHint from '$lib/components/HelpHint.svelte'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import DebugSharedWaveform from '$lib/components/DebugSharedWaveform.svelte'
  import {
    ChevronLeft,
    ChevronRight,
    Layers,
    LocateFixed,
    Maximize2,
    Pause,
    Pencil,
    Play,
    RefreshCw,
    Repeat1,
    RotateCcw,
    Square,
    ZoomIn,
    ZoomOut,
  } from '@lucide/svelte'

  type EditMode = 'overview' | 'grid' | 'sections' | 'chords' | 'cue' | 'lyrics' | 'leadsheet'

  let editMode = $state<EditMode>('overview')

  // —— Static "song" ————————————————————————————————————————————————
  const song = {
    title: 'Dum av dig',
    artist: 'Håkan Hellström',
    bpm: 128,
    keyLabel: 'G major',
    draftLabel: 'Main',
  }

  const TOTAL_BARS = 96
  const TOTAL_BEATS = TOTAL_BARS * 4
  const durationLabel = '3:00'
  const currentLabel = '0:49'
  const viewLabel = '0:00 – 3:00'

  const tabs: { id: EditMode; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'grid', label: 'Grid' },
    { id: 'sections', label: 'Sections' },
    { id: 'chords', label: 'Chords' },
    { id: 'cue', label: 'Cue' },
    { id: 'lyrics', label: 'Lyrics' },
    { id: 'leadsheet', label: 'Lead sheet' },
  ]

  type SectionRow = { kind: string; label: string; start: number; end: number }
  const sections: SectionRow[] = [
    { kind: 'intro', label: 'Intro', start: 1, end: 8 },
    { kind: 'verse', label: 'Verse 1', start: 9, end: 24 },
    { kind: 'preChorus', label: 'Pre-chorus', start: 25, end: 32 },
    { kind: 'chorus', label: 'Chorus', start: 33, end: 48 },
    { kind: 'verse', label: 'Verse 2', start: 49, end: 64 },
    { kind: 'chorus', label: 'Chorus', start: 65, end: 80 },
    { kind: 'bridge', label: 'Bridge', start: 81, end: 88 },
    { kind: 'outro', label: 'Outro', start: 89, end: 96 },
  ]

  // Shared, page-owned waveform viewport (seconds). ONE instance renders above
  // the tabs; its viewport persists across tab switches (global to the song).
  const DURATION_SEC = 180
  let viewStart = $state(0)
  let viewEnd = $state(DURATION_SEC)
  const waveformSections = sections.map((s) => ({ kind: s.kind, label: s.label, from: s.start, to: s.end }))

  // Same low-opacity hues the real waveform tints sections with.
  const SECTION_FILL_RGBA: Record<string, string> = {
    intro: 'rgba(139, 92, 246, 0.12)',
    verse: 'rgba(14, 165, 233, 0.10)',
    preChorus: 'rgba(6, 182, 212, 0.10)',
    chorus: 'rgba(245, 158, 11, 0.12)',
    bridge: 'rgba(249, 115, 22, 0.10)',
    solo: 'rgba(244, 63, 94, 0.10)',
    outro: 'rgba(217, 70, 239, 0.10)',
    custom: 'rgba(113, 113, 122, 0.10)',
  }
  const sectionFill = (kind: string): string => SECTION_FILL_RGBA[kind] ?? 'transparent'

  const chordCycle = ['G', 'D', 'Em', 'C']
  type BarCell = { index: number; number: number; kind: string; label: string; isStart: boolean; chord: string }
  const bars: BarCell[] = Array.from({ length: TOTAL_BARS }, (_, i) => {
    const number = i + 1
    const sec = sections.find((s) => number >= s.start && number <= s.end)
    return {
      index: i,
      number,
      kind: sec?.kind ?? 'custom',
      label: sec?.label ?? '',
      isStart: sec ? sec.start === number : false,
      chord: chordCycle[i % chordCycle.length],
    }
  })

  type Band = { kind: string; label: string; leftPct: number; widthPct: number }
  const sectionBands: Band[] = sections.map((s) => ({
    kind: s.kind,
    label: s.label,
    leftPct: ((s.start - 1) / TOTAL_BARS) * 100,
    widthPct: ((s.end - s.start + 1) / TOTAL_BARS) * 100,
  }))

  // Deterministic pseudo-waveform envelopes (no real peaks needed).
  function makeWave(count: number, seed: number): number[] {
    return Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1)
      const env = Math.pow(Math.sin(t * Math.PI), 0.55)
      const noise = Math.abs(Math.sin((i + seed) * 12.9898) * 43758.5453) % 1
      const beat = 0.55 + 0.45 * Math.abs(Math.sin((i + seed) * 0.8))
      return Math.max(0.06, Math.min(1, env * (0.32 + 0.68 * noise) * beat))
    })
  }
  const waveBars = makeWave(220, 3)
  const laneBars = makeWave(120, 11)

  const lyricLines = [
    'Jag går längs med kajen',
    'och tänker bara på dig',
    'regnet över hela stan',
    'men jag känner mig fri',
    '',
    'Dum av dig, jag blir så dum av dig',
    'varje gång du ler mot mig',
    'Dum av dig, jag blir så dum av dig',
    'och jag faller om igen',
  ]

  type Lane = { label: string; dur: string; vol: number; color: string; muted: boolean; soloed: boolean }
  const mixerLanes: Lane[] = [
    { label: 'Original', dur: '3:00', vol: 100, color: 'var(--foreground)', muted: false, soloed: false },
    { label: 'Drums', dur: '3:00', vol: 92, color: '#0ea5e9', muted: false, soloed: false },
    { label: 'Bass', dur: '3:00', vol: 84, color: '#16a34a', muted: false, soloed: false },
    { label: 'Vocals', dur: '3:00', vol: 100, color: '#f43f5e', muted: false, soloed: false },
    { label: 'Cue', dur: '3:00', vol: 68, color: '#facc15', muted: true, soloed: false },
  ]

  const timelineToolbarTitle = $derived(
    editMode === 'grid' ? 'Grid' : editMode === 'sections' ? 'Sections' : 'Chords',
  )
  const timelineToolbarHelp = $derived(
    editMode === 'grid'
      ? 'Edit bars and beats: drag a bar to select it, then split, merge or change its beat count. Everything you hear plays back through the same grid the export uses.'
      : editMode === 'sections'
        ? 'Tag stretches of the song as intro / verse / chorus and so on. Multi-select bars, then apply a section kind — the colours match the pads and the exported setlist.'
        : 'Place a chord on any beat. Suggestions from the harmony analysis appear as ghosts you can accept per section.',
  )
</script>

<svelte:head>
  <title>Edit · Current — BarBro lab</title>
</svelte:head>

<!-- ── Reusable pieces (static snippets) ─────────────────────────────── -->

{#snippet tbHead(title: string, helpText: string, statusText?: string)}
  <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    <div class="flex min-w-0 items-center gap-1.5">
      <h2 class="text-muted-foreground truncate text-xs font-black uppercase tracking-wide">{title}</h2>
      {#if helpText}
        <HelpHint label={`${title} help`} text={helpText} />
      {/if}
      {#if statusText}
        <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{statusText}</span>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet waveSvg(samples: number[], klass: string)}
  <svg viewBox="0 0 1000 100" preserveAspectRatio="none" class={klass} aria-hidden="true">
    <g style="fill: var(--foreground); opacity: 0.55;">
      {#each samples as a, i (i)}
        <rect
          x={i * (1000 / samples.length)}
          y={50 - a * 46}
          width={(1000 / samples.length) * 0.72}
          height={a * 92}
        />
      {/each}
    </g>
  </svg>
{/snippet}

{#snippet barStrip()}
  <!-- Approximation of TimelineBeatGrid: a bar strip above the waveform. -->
  <div class="border-foreground/10 relative flex h-7 w-full overflow-hidden border-b">
    {#each bars as b (b.index)}
      <div
        class="relative flex-1 border-r border-foreground/10 last:border-r-0"
        style="background-color: {editMode === 'sections' ? sectionFill(b.kind) : 'transparent'}"
      >
        {#if b.number % 4 === 1}
          <span class="text-muted-foreground absolute inset-x-0 top-0 font-mono text-[8px] leading-7">{b.number}</span>
        {/if}
      </div>
    {/each}
  </div>
  {#if editMode === 'chords'}
    <div class="border-foreground/10 relative flex h-8 w-full overflow-hidden border-b">
      {#each bars as b (b.index)}
        <div class="flex flex-1 items-center justify-center overflow-hidden border-r border-foreground/10 last:border-r-0">
          <span class="font-mono text-[9px] font-bold leading-none">{b.chord}</span>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet waveformPlayer()}
  <!-- Faithful reproduction of the WaveformPlayer surface (static). -->
  <div class="flex w-full min-w-0 flex-col gap-3">
    <!-- Transport row -->
    <div class="flex flex-wrap items-center justify-center gap-3">
      <Button type="button" variant="secondary" size="sm" class="gap-2">
        <Play class="size-4" aria-hidden="true" />
        Play
      </Button>
      <Button type="button" variant="outline" size="sm" class="gap-2" title="Stop and go to selection start">
        <Square class="size-4" aria-hidden="true" />
        Stop
      </Button>
      <label
        class="border-foreground/40 hover:bg-foreground/5 ml-1 flex shrink-0 cursor-pointer items-center gap-1.5 border-2 px-2 py-1 text-xs"
        title="Play clicks alongside the audio (and count-in if configured)"
      >
        <input type="checkbox" checked class="accent-foreground size-3.5" />
        <span class="font-bold uppercase tracking-wider">Click</span>
      </label>
      <span
        class="border-foreground/40 inline-flex h-7 cursor-pointer list-none items-center gap-1 border-2 px-2 text-xs font-bold uppercase tracking-wider"
        title="Volume"
      >
        Vol
      </span>
      <span class="text-muted-foreground font-mono text-xs tabular-nums">
        {currentLabel} / {durationLabel}
      </span>
      <span class="text-muted-foreground text-xs">
        Selection: 0:00 – {durationLabel}
      </span>
    </div>

    <!-- Zoom bar -->
    <div
      class="border-foreground/10 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed px-2 py-1.5"
      aria-label="Waveform zoom"
    >
      <span class="text-muted-foreground font-mono text-[10px] tabular-nums">View {viewLabel}</span>
      <Button type="button" variant="ghost" size="sm" class="size-8 p-0" title="Zoom in">
        <ZoomIn class="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" class="size-8 p-0" title="Zoom out">
        <ZoomOut class="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" class="size-8 p-0" title="Pan earlier">
        <ChevronLeft class="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" class="size-8 p-0" title="Pan later">
        <ChevronRight class="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" class="size-8 p-0" title="Show full file">
        <Maximize2 class="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" class="size-8 p-0" title="Follow playhead">
        <LocateFixed class="size-4" aria-hidden="true" />
      </Button>
      <HelpHint
        label="Waveform gestures"
        text="Ctrl/Cmd+scroll to zoom. Two-finger or Shift-scroll pans. Drag bars or beats to select. In chord mode, double-click/tap edits and Space plays from the selected beat. Esc clears selection."
      />
    </div>

    <!-- Detail waveform -->
    <div
      class="text-foreground border-foreground/10 bg-foreground/5 flex w-full min-w-0 max-w-full flex-col overflow-hidden overscroll-x-contain rounded-xl border"
    >
      {@render barStrip()}
      <div class="relative w-full" style="height: 144px;">
        {@render waveSvg(waveBars, 'block h-36 w-full')}
        {#if editMode === 'sections'}
          {#each sectionBands as s (s.label + s.leftPct)}
            <div
              class="pointer-events-none absolute inset-y-0"
              style="left: {s.leftPct}%; width: {s.widthPct}%; background-color: {sectionFill(s.kind)}"
              aria-hidden="true"
            ></div>
          {/each}
        {/if}
        <!-- full-file selection shade -->
        <div class="pointer-events-none absolute inset-y-0 left-0 right-0 bg-zinc-400/18 ring-1 ring-zinc-500/35"></div>
        <!-- playhead -->
        <div
          class="bg-foreground/90 pointer-events-none absolute top-0 bottom-0 z-[2] w-px"
          style="left: 27%; box-shadow: 0 0 8px rgba(255,255,255,0.35);"
        ></div>
      </div>
    </div>

    <!-- Minimap / overview -->
    <div class="flex flex-col gap-1.5">
      <div class="flex min-h-5 items-center justify-between gap-3">
        <p class="text-muted-foreground text-[10px]">
          Overview — full timeline · shaded = selection · bright box = detail viewport (same navigation as import)
        </p>
      </div>
      {#if editMode === 'chords'}
        <div class="relative mb-1.5 h-5 w-full" aria-label="Section navigator">
          {#each sectionBands as s (s.label + s.leftPct)}
            <div
              class="border-background/50 text-foreground/90 absolute inset-y-0 overflow-hidden rounded-[2px] border-l px-1 text-left font-mono text-[10px] font-bold whitespace-nowrap"
              style="left: {s.leftPct}%; width: {s.widthPct}%; background-color: {sectionFill(s.kind)};"
            >
              {s.label}
            </div>
          {/each}
        </div>
      {/if}
      <div
        class="text-foreground border-foreground/15 bg-foreground/5 relative h-[52px] w-full overflow-hidden overscroll-x-contain rounded-md border"
      >
        {@render waveSvg(waveBars, 'pointer-events-none block h-full w-full opacity-80')}
        {#if editMode === 'sections'}
          {#each sectionBands as s (s.label + s.leftPct)}
            <div
              class="pointer-events-none absolute inset-y-0"
              style="left: {s.leftPct}%; width: {s.widthPct}%; background-color: {sectionFill(s.kind)}"
              aria-hidden="true"
            ></div>
          {/each}
        {/if}
        <div class="pointer-events-none absolute inset-y-0 left-0 right-0 bg-zinc-500/22"></div>
        <div class="pointer-events-none absolute inset-y-0 left-0 z-[1] w-px bg-foreground/85" style="left: 27%;"></div>
        <div
          class="pointer-events-none absolute inset-y-0 left-0 z-[2] box-border w-full border-2 border-zinc-400/70 bg-zinc-400/12"
        ></div>
      </div>
    </div>
  </div>
{/snippet}

{#snippet mixerLane(lane: Lane, showLabels: boolean)}
  <div class="border-foreground/30 bg-background flex items-center gap-2 border-2 px-2 py-1.5">
    <div class="w-28 shrink-0 min-w-0">
      <div class="truncate text-xs font-semibold">{lane.label}</div>
      <div class="text-muted-foreground font-mono text-[10px] truncate">{lane.dur}</div>
    </div>
    <div class="flex shrink-0 gap-0.5">
      <Button variant={lane.muted ? 'default' : 'outline'} size="sm" class="h-7 w-7 p-0 font-mono text-[11px]" title="Mute">
        M
      </Button>
      <Button
        variant={lane.soloed ? 'default' : 'outline'}
        size="sm"
        class="h-7 w-7 p-0 font-mono text-[11px] {lane.soloed ? 'bg-amber-500 hover:bg-amber-500/90' : ''}"
        title="Solo"
      >
        S
      </Button>
    </div>
    <input
      type="range"
      min="0"
      max="1.5"
      step="0.01"
      value={lane.vol / 100}
      class="w-28 shrink-0 accent-foreground"
      aria-label="{lane.label} volume"
    />
    <span class="text-muted-foreground w-9 shrink-0 text-right font-mono text-[10px] tabular-nums">{lane.vol}%</span>
    <div class="relative flex-1 overflow-hidden" style="height: 44px;">
      {@render waveSvg(laneBars, 'block h-11 w-full')}
      {#if showLabels}
        {#each sectionBands as s (s.label + s.leftPct)}
          <span
            class="text-foreground/70 absolute top-0.5 font-mono text-[8px] font-bold"
            style="left: calc({s.leftPct}% + 2px);"
          >{s.label}</span>
        {/each}
      {/if}
      <div class="pointer-events-none absolute top-0 bottom-0 z-[2] w-px bg-rose-500" style="left: 27%;"></div>
    </div>
  </div>
{/snippet}

<!-- ── Page ──────────────────────────────────────────────────────────── -->

<main
  class="edit-page relative z-10 flex min-h-dvh w-full max-w-none flex-col gap-6 px-2 py-8 sm:px-4 md:px-6 md:py-12 lg:px-8"
>
  <!-- Song-first header (a <div>, not a <header>) -->
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <h1 class="flex items-center gap-2 text-3xl font-bold tracking-tight">
        <span class="min-w-0 truncate">{song.title}</span>
        <span class="text-muted-foreground/50 shrink-0" aria-hidden="true">
          <Pencil class="size-4" />
        </span>
        <Button variant="outline" size="icon-xs" class="shrink-0 border-2" aria-label={`Draft: ${song.draftLabel}`}>
          <Layers aria-hidden="true" />
        </Button>
      </h1>

      <span class="text-muted-foreground/70 mt-0.5 block max-w-full truncate px-0 text-left text-base leading-tight">
        {song.artist}
      </span>

      <div
        class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums"
      >
        <span>{song.bpm} BPM</span>
        <span class="text-muted-foreground/40" aria-hidden="true">·</span>
        <span class="inline-flex items-center gap-1">
          {song.keyLabel}
          <span class="text-muted-foreground/50" aria-hidden="true">
            <RefreshCw class="size-3" />
          </span>
        </span>
        <span class="text-muted-foreground/40" aria-hidden="true">·</span>
        <span
          class="border-foreground/30 bg-background inline-flex items-center overflow-hidden rounded-[var(--radius)] border font-mono text-[11px] font-black"
          aria-label="Song transpose"
        >
          <span class="px-2 py-0.5">-1</span>
          <span class="border-foreground/20 min-w-9 border-x px-2 py-0.5 text-center">0</span>
          <span class="px-2 py-0.5">+1</span>
        </span>
      </div>
    </div>

    <!-- 7-tab bar -->
    <div
      class="border-foreground bg-muted inline-grid grid-cols-7 gap-0 self-start overflow-hidden border-2 sm:self-auto"
      role="tablist"
      aria-label="Edit mode"
    >
      {#each tabs as t (t.id)}
        <Button
          type="button"
          role="tab"
          aria-selected={editMode === t.id}
          variant="ghost"
          size="sm"
          class="h-8 border-0 px-3 text-xs font-bold shadow-none transition-colors {editMode === t.id
            ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
            : 'bg-transparent text-foreground hover:bg-foreground/15 active:bg-foreground/25'}"
          onclick={() => (editMode = t.id)}
        >
          {t.label}
        </Button>
      {/each}
    </div>
  </div>

  <!-- ── Overview ─────────────────────────────────────────────────── -->
  <!-- ── SHARED waveform + navigation: ONE instance, global to the song. Its
       viewport is page-owned, so zoom/scroll survives switching tabs. This is
       the deliberate improvement over today's /edit (where the waveform only
       exists inside grid/sections/chords). ── -->
  <div class="mx-auto w-full max-w-6xl">
    <DebugSharedWaveform
      bind:viewStart
      bind:viewEnd
      sections={waveformSections}
      bars={TOTAL_BARS}
      durationSec={DURATION_SEC}
      playheadSec={DURATION_SEC * 0.27}
    />
  </div>

  {#if editMode === 'overview'}
    <section class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5" aria-label="Overview">
      <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-2.5 sm:mb-4">
        {@render tbHead(
          'Overview',
          'Original audio, stems, and cues load as separate lanes. Volume, mute, and solo settings are saved with the song, and every lane stays aligned for playback and export. Click on a waveform to seek.',
        )}
        <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span class="font-mono tabular-nums">{TOTAL_BARS} bars</span>
          <span class="font-mono tabular-nums">{sections.length} sections</span>
          <span class="font-mono tabular-nums">{song.bpm} BPM</span>
          <span class="font-mono tabular-nums">{song.keyLabel}</span>
        </div>
      </div>

      <div class="flex justify-end">
        <span class="text-muted-foreground rounded-[var(--radius)] px-2 py-0.5 text-xs font-bold">Show BarBro Band tools</span>
      </div>

      <!-- MixerView reproduction -->
      <div class="border-foreground bg-background space-y-3 border-2 px-3 py-3">
        <div class="border-foreground/30 flex flex-wrap items-center gap-2 border-b-2 pb-2">
          <Button variant="default" size="sm" class="h-9 w-9 p-0" aria-label="Play">
            <Play class="size-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" class="h-9 w-9 p-0" aria-label="Restart song" title="Restart song">
            <RotateCcw class="size-3.5" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" class="h-9 w-9 p-0" aria-label="Stop">
            <Square class="size-3.5" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1.5" title="Replay section once">
            <Repeat1 class="size-3.5" aria-hidden="true" />
            Replay 1×
          </Button>
          <div class="font-mono text-sm tabular-nums">{currentLabel} / {durationLabel}</div>
          <label
            class="text-foreground inline-flex h-8 items-center gap-2 rounded-[var(--radius)] px-2.5 text-xs font-bold shadow-sm"
            style="background: linear-gradient(120deg, color-mix(in oklch, var(--studio-orange) 32%, var(--background)) 0%, color-mix(in oklch, var(--studio-orange-soft) 46%, var(--background)) 55%, color-mix(in oklch, var(--studio-orange) 28%, var(--background)) 100%);"
          >
            <input type="checkbox" class="accent-foreground size-3.5" />
            Playback mode
          </label>
          <span class="border-foreground/40 bg-background text-muted-foreground inline-flex h-8 items-center rounded-[var(--radius)] border-2 px-2 text-xs font-bold">Band</span>
          <span class="border-foreground/40 bg-background text-muted-foreground inline-flex h-8 items-center rounded-[var(--radius)] border-2 px-2 text-xs font-bold">Live rig</span>
          <div class="bg-muted/70 ring-foreground/10 flex min-w-0 flex-[1_1_24rem] items-center gap-2 overflow-hidden rounded-[var(--radius)] px-2 py-1 ring-1">
            <div class="min-w-[7.5rem] flex-none">
              <div class="flex items-baseline gap-2">
                <span class="text-muted-foreground text-[10px] font-black uppercase">Chord</span>
                <span class="truncate font-mono text-lg leading-none font-black tabular-nums">G</span>
              </div>
              <div class="bg-foreground/10 mt-1 h-1.5 overflow-hidden rounded-full">
                <div class="bg-primary h-full rounded-full" style="width: 45%"></div>
              </div>
              <div class="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[10px] leading-none font-bold tabular-nums">
                <span class="uppercase">Next</span>
                <span class="text-foreground truncate font-black">D</span>
                <span>in 1.9s</span>
              </div>
            </div>
            <div class="bg-background/70 ring-foreground/10 relative h-9 min-w-0 flex-1 overflow-hidden rounded-[var(--radius)] ring-1">
              <div class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px" style="left: 33%"></div>
              <div class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px" style="left: 66%"></div>
              <span class="bg-primary text-primary-foreground ring-primary/20 ring-foreground/10 absolute top-1/2 flex h-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius)] px-1 font-mono text-xs font-black tabular-nums shadow-sm ring-1" style="left: 2%; width: 30%;">G</span>
              <span class="bg-primary/20 text-foreground ring-primary/40 absolute top-1/2 flex h-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius)] px-1 font-mono text-xs font-black tabular-nums shadow-sm ring-1" style="left: 34%; width: 30%;">D</span>
              <span class="bg-background/95 text-foreground ring-foreground/10 absolute top-1/2 flex h-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius)] px-1 font-mono text-xs font-black tabular-nums shadow-sm ring-1" style="left: 66%; width: 30%;">Em</span>
            </div>
          </div>
          <div class="text-muted-foreground ml-auto text-xs">{mixerLanes.length} tracks</div>
          <Button variant="outline" size="sm" class="h-8 gap-1 px-2" title="Re-scan disk and reload all tracks">
            <RefreshCw class="size-3.5" aria-hidden="true" />
            Reload
          </Button>
        </div>

        <div class="flex flex-col gap-1.5">
          {#each mixerLanes as lane, i (lane.label)}
            {@render mixerLane(lane, i === 0)}
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <!-- ── Grid / Sections / Chords (shared timeline) ───────────────── -->
  {#if editMode === 'grid' || editMode === 'sections' || editMode === 'chords'}
    <section class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5" aria-label="Edit timeline">
      <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-2.5 sm:mb-4">
        {@render tbHead(timelineToolbarTitle, timelineToolbarHelp)}
        <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span class="font-mono tabular-nums">{TOTAL_BARS} bars</span>
          <span class="font-mono tabular-nums">{TOTAL_BEATS} beats</span>
          {#if editMode === 'sections' || editMode === 'chords'}
            <span class="text-muted-foreground">{song.draftLabel}</span>
          {/if}
        </div>
      </div>

      {#if editMode === 'chords'}
        <!-- Chord controls toolbar (compact) -->
        <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-1.5">
          {@render tbHead('Chord controls', 'Suggestions can be accepted for the selected section or hidden once the section is finished.')}
          <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <Button variant="outline" size="sm" class="h-7 border-2 px-2 text-xs font-bold">Sheet</Button>
            <Button variant="outline" size="sm" class="h-7 border-2 px-2 text-xs font-bold">Inspect</Button>
            <span class="border-foreground/30 mx-1 h-5 border-l" aria-hidden="true"></span>
            <label class="inline-flex items-center gap-2 font-bold">
              <input type="checkbox" checked class="accent-foreground size-3.5" />
              Suggestions
            </label>
            <span class="text-muted-foreground">Chorus (bars 33–48)</span>
            <button type="button" class="text-foreground underline-offset-2 hover:underline">Use section suggestions (4)</button>
            <button type="button" class="text-foreground underline-offset-2 hover:underline">Finish section</button>
          </div>
        </div>

        <!-- Song key toolbar (compact) -->
        <div data-song-key-picker>
          <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-1.5">
            {@render tbHead('Song key', 'Set the source song key used for display, transposed labels, suggestions, and exports. Detection is only a helper; the saved key is what matters.')}
            <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <span class="border-input bg-background text-foreground border-2 px-2 py-1 text-xs">G</span>
              <span class="border-input bg-background text-foreground border-2 px-2 py-1 text-xs">natural</span>
              <span class="border-input bg-background text-foreground border-2 px-2 py-1 text-xs">major</span>
            </div>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <!-- ── Grid extras: History + Metronome ─────────────────────────── -->
  {#if editMode === 'grid'}
    <section class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5" aria-label="Edit history">
      <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-2.5 sm:mb-4">
        {@render tbHead('History', 'Cmd/Ctrl+Z undoes timeline edits. Hold Shift to redo. Reset restores the saved analyzed grid; re-analyze detects bars and beats again from the current audio.')}
        <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <button type="button" class="border-foreground border-2 px-3 py-1 text-sm font-bold">Undo</button>
          <button type="button" class="border-foreground border-2 px-3 py-1 text-sm font-bold opacity-40">Redo</button>
          <span class="text-muted-foreground mx-1 text-xs">·</span>
          <button type="button" class="border-foreground border-2 px-3 py-1 text-sm">Reset to analyzed</button>
          <button type="button" class="border-foreground border-2 px-3 py-1 text-sm">Re-analyze grid</button>
        </div>
      </div>
    </section>

    <section class="brutalist-shadow border-foreground bg-background w-full space-y-4 border-2 p-3 sm:p-4 md:p-5" aria-label="Metronome">
      <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-2.5 sm:mb-4">
        {@render tbHead('Metronome', 'Count-in adds clicks before playback starts. Start at beat sets the song-start anchor; moving it later lets earlier beats play under the count-in, for example a drum fill before the downbeat.')}
      </div>

      <fieldset class="border-foreground border-2 px-3 py-3">
        <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Count-in beats</legend>
        <div class="flex flex-wrap gap-3 pt-1">
          {#each [0, 4, 8] as n (n)}
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="gridCountInBeats" checked={n === 4} class="accent-foreground" />
              {n === 0 ? 'Off' : `${n} beats`}
            </label>
          {/each}
        </div>
        <p class="text-muted-foreground mt-2 font-mono text-xs tabular-nums">
          4 clicks · 1.88s before song start · 1.88s silence prepended
        </p>
      </fieldset>

      <fieldset class="border-foreground border-2 px-3 py-3">
        <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Start at beat</legend>
        <div class="flex flex-wrap items-center gap-3 pt-1">
          <input type="number" value="1" class="border-foreground bg-background w-24 border-2 px-2 py-1 text-sm tabular-nums" aria-label="Song-start beat" />
          <span class="text-muted-foreground font-mono text-xs">Start: bar 1 beat 1 (0.00 s)</span>
        </div>
      </fieldset>
    </section>

    <details class="group border-foreground bg-background border-2">
      <summary class="text-muted-foreground hover:text-foreground cursor-pointer list-none px-4 py-3 text-xs font-medium tracking-wide uppercase select-none marker:content-none [&::-webkit-details-marker]:hidden">
        <span class="underline-offset-2 group-open:underline">Timeline details</span>
        <span class="text-muted-foreground/70 ml-2 font-normal normal-case">analysis preview and bar playback</span>
      </summary>
      <div class="border-foreground space-y-6 border-t-2 px-4 py-4">
        <dl class="text-foreground/90 space-y-2 text-sm">
          <div class="flex justify-between gap-4"><dt class="text-muted-foreground">Bars</dt><dd>{TOTAL_BARS}</dd></div>
          <div class="flex justify-between gap-4"><dt class="text-muted-foreground">Beats</dt><dd>{TOTAL_BEATS}</dd></div>
          <div class="flex justify-between gap-4"><dt class="text-muted-foreground">Duration</dt><dd class="tabular-nums">180.00s</dd></div>
        </dl>
      </div>
    </details>
  {/if}

  <!-- ── Lyrics ───────────────────────────────────────────────────── -->
  {#if editMode === 'lyrics'}
    <section class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5" aria-label="Lyrics">
      <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-2.5 sm:mb-4">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div class="flex min-w-0 items-center gap-1.5">
            <h2 class="text-muted-foreground truncate text-xs font-black uppercase tracking-wide">Lyrics</h2>
            <HelpHint
              label="Lyrics help"
              text={`Lyrics belong to the CURRENT draft (“${song.draftLabel}”) — “Save lyrics” stores the text ON THIS DRAFT and replaces that draft's lyrics. Timing each word to the audio is a SEPARATE, optional step.`}
            />
          </div>
          <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            <button type="button" class="border-foreground border-2 px-3 py-1 text-xs font-bold">Save lyrics</button>
            <button type="button" class="border-foreground bg-foreground text-background border-2 px-3 py-1 text-xs font-bold">Fit to song</button>
          </div>
        </div>
        <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span class="text-muted-foreground">draft <span class="text-foreground font-bold">{song.draftLabel}</span></span>
          <span class="font-mono tabular-nums">{lyricLines.filter((l) => l).length} cleaned lines</span>
          <span class="text-muted-foreground">Saved, not fitted yet</span>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-muted-foreground text-xs font-medium uppercase tracking-wide" for="lyrics-paste">Paste lyrics</label>
          <textarea
            id="lyrics-paste"
            rows="18"
            class="border-foreground bg-background min-h-[24rem] w-full resize-y border-2 px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none"
            spellcheck="false">{lyricLines.join('\n')}</textarea>
        </div>

        <div class="flex min-w-0 flex-col gap-2">
          <span class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Cleaned preview · {lyricLines.filter((l) => l).length} lines
          </span>
          <div class="border-foreground/30 bg-muted/40 min-h-[24rem] overflow-auto border-2 px-3 py-2">
            {#each lyricLines as line, i (i)}
              {#if line}
                <p class="text-sm leading-relaxed">{line}</p>
              {:else}
                <div class="h-3"></div>
              {/if}
            {/each}
          </div>
          <p class="text-muted-foreground text-xs">Saved — not fitted to the song yet.</p>
        </div>
      </div>
    </section>
  {/if}

  <!-- ── Lead sheet (simplified placeholder) ──────────────────────── -->
  {#if editMode === 'leadsheet'}
    <section class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5" aria-label="Lead sheet">
      <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-2.5 sm:mb-4">
        {@render tbHead('Lead sheet', 'The lead sheet is a read-only performance view of the current song map: sections, lyrics, chords, key, and timing all come from the saved editor data.')}
      </div>

      <div class="mx-auto max-w-3xl space-y-6">
        <div class="border-foreground/20 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 pb-3">
          <span class="text-2xl font-bold tracking-tight">{song.title}</span>
          <span class="text-muted-foreground text-sm">{song.artist}</span>
          <span class="text-muted-foreground ml-auto font-mono text-xs tabular-nums">{song.keyLabel} · {song.bpm} BPM</span>
        </div>
        {#each sections as s (s.label + s.start)}
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="size-2.5 rounded-[2px]" style="background-color: {sectionKindColor(s.kind)}"></span>
              <span class="text-xs font-black uppercase tracking-wide">{s.label}</span>
              <span class="text-muted-foreground font-mono text-[10px] tabular-nums">bars {s.start}–{s.end}</span>
            </div>
            <div class="font-mono text-sm font-bold tracking-wide">
              {chordCycle.join('   ')}   {chordCycle.join('   ')}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── Cue (simplified placeholder) ─────────────────────────────── -->
  {#if editMode === 'cue'}
    <section class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5" aria-label="Cue editor">
      <div class="edit-section-toolbar border-foreground/20 bg-muted/35 mb-3 rounded-[var(--radius)] border px-2.5 py-2.5 sm:mb-4">
        {@render tbHead('Cue', 'Per section, toggle a spoken cue and/or a count-in — click a section to edit its voice line. Switch voice tracks with the pills; Auto-generate reads each section name just before it starts.')}
      </div>

      <div class="mt-3 space-y-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-muted-foreground mr-1 text-[11px] font-bold uppercase tracking-wide">Performer</span>
          <span class="border-foreground bg-foreground text-background border-2 px-2 py-0.5 text-xs font-bold">Lead vox</span>
          <span class="border-foreground/40 border-2 px-2 py-0.5 text-xs font-bold">Guitar</span>
          <span class="border-foreground/40 border-2 px-2 py-0.5 text-xs font-bold">+ Add</span>
        </div>

        <div class="border-foreground/30 divide-foreground/15 divide-y border-2">
          {#each sections as s (s.label + s.start)}
            <div class="flex items-center gap-3 px-3 py-2">
              <span class="size-2.5 shrink-0 rounded-[2px]" style="background-color: {sectionKindColor(s.kind)}"></span>
              <span class="w-28 shrink-0 text-xs font-bold uppercase tracking-wide">{s.label}</span>
              <label class="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={s.start === 33 || s.start === 65} class="accent-foreground size-3.5" />
                Spoken cue
              </label>
              <label class="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={s.start === 1} class="accent-foreground size-3.5" />
                Count-in
              </label>
              <span class="text-muted-foreground ml-auto truncate font-mono text-[11px]">
                {s.start === 33 || s.start === 65 ? `“${s.label}”` : '—'}
              </span>
            </div>
          {/each}
        </div>

        <div class="flex justify-end">
          <button type="button" class="border-foreground bg-foreground text-background border-2 px-3 py-1 text-xs font-bold">
            Auto-generate cues
          </button>
        </div>
      </div>
    </section>
  {/if}
</main>

<style>
  /* Copied verbatim from the real edit page's scoped block so the panels and
     tab bar pick up the same card fill + hard shadow overrides. */
  .edit-page :global(.brutalist-shadow.border-foreground.bg-background),
  .edit-page :global(.brutalist-shadow-sm.border-foreground.bg-background),
  .edit-page :global(details.border-foreground.bg-background) {
    background: var(--card);
  }

  .edit-page :global(.brutalist-shadow-sm.border-foreground.bg-muted) {
    background: var(--studio-orange);
    color: var(--foreground);
  }

  .edit-page :global(.inline-grid.grid-cols-7.border-foreground.bg-muted) {
    background: var(--card);
    box-shadow: 4px 4px 0 var(--ink);
  }

  .edit-page :global(fieldset.border-foreground) {
    background: color-mix(in oklch, var(--card) 84%, var(--muted));
  }
</style>
