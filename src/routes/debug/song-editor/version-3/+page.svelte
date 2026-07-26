<script lang="ts">
  /**
   * Song Edit — design prototype VERSION 3: "Persistent waveform, tabs become LAYERS".
   *
   * READ-ONLY design study. No stores, no PlaybackController, no real audio.
   * Every control is visual only; the only live state is the shared waveform
   * viewport (viewStart/viewEnd), which layer is ACTIVE, per-layer visibility,
   * and which docked/overlay view is open.
   *
   * Thesis: reject the tab-swap model. ONE shared timeline workspace is always
   * present. The seven edit functions become time-aligned LAYERS drawn around a
   * single, never-rebuilt waveform (grid, sections, chords, cue, lyrics) plus two
   * genuinely non-timeline modes surfaced as a docked mixer strip (Overview) and
   * a full-bleed chart overlay (Lead sheet). A left rail toggles each layer's
   * visibility and which is active; a slim contextual tool row follows the active
   * layer — but you never leave the timeline, so zooming into the chorus stays put.
   */
  import type { Snippet } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import HelpHint from '$lib/components/HelpHint.svelte'
  import DebugSharedWaveform from '$lib/components/DebugSharedWaveform.svelte'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import {
    meta,
    sectionRows,
    barCells,
    lyricLines,
    waveformSections,
    mixerLanes,
    cueRows,
    DURATION_SEC,
    fmtTime,
  } from '$lib/debug/songEditorFixture'
  import {
    AudioLines,
    Captions,
    ChevronDown,
    Eye,
    EyeOff,
    Grid2x2,
    Layers,
    Megaphone,
    Music,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    RotateCcw,
    ScrollText,
    Scissors,
    SlidersHorizontal,
    Square,
    Tag,
    Type,
    Undo2,
    Redo2,
    WandSparkles,
    X,
  } from '@lucide/svelte'

  // ── Layer model ──────────────────────────────────────────────────────
  type LayerId = 'grid' | 'sections' | 'chords' | 'cue' | 'lyrics'
  type Layer = { id: LayerId; label: string; icon: typeof Eye; accent: string; hint: string }

  const LAYERS: Layer[] = [
    {
      id: 'grid',
      label: 'Grid',
      icon: Grid2x2,
      accent: '#64748b',
      hint: 'Bars and beats. Split, merge or re-meter a bar; set the count-in and the song-start anchor. Everything you hear plays back through this same grid the export uses.',
    },
    {
      id: 'sections',
      label: 'Sections',
      icon: Tag,
      accent: '#0ea5e9',
      hint: 'Tag stretches of the song — intro, verse, chorus. Colours match the pads and the exported setlist. Bands sit right on the timeline so ranges read at a glance.',
    },
    {
      id: 'chords',
      label: 'Chords',
      icon: Music,
      accent: 'var(--studio-orange)',
      hint: 'One chord block per bar, keyed to the downbeat. Set the song key + transpose; accept harmony-analysis suggestions per section.',
    },
    {
      id: 'cue',
      label: 'Cue',
      icon: Megaphone,
      accent: '#f43f5e',
      hint: 'Spoken cues + count-in per section, dropped as markers on the timeline. Auto-generate reads each section name just before it starts.',
    },
    {
      id: 'lyrics',
      label: 'Lyrics',
      icon: Type,
      accent: '#8b5cf6',
      hint: 'Paste the words, fit them to the song, and see each timed line laid along the bottom of the same timeline.',
    },
  ]
  const layerById = (id: LayerId): Layer => LAYERS.find((l) => l.id === id)!

  // ── Live prototype state ─────────────────────────────────────────────
  let viewStart = $state(0)
  let viewEnd = $state(DURATION_SEC)
  let activeLayer = $state<LayerId>('grid')
  let visible = $state<Record<LayerId, boolean>>({
    grid: true,
    sections: true,
    chords: true,
    cue: true,
    lyrics: true,
  })
  let dock = $state<'none' | 'mixer' | 'lyrics'>('none')
  let overlay = $state<'none' | 'leadsheet'>('none')

  const setActive = (id: LayerId) => {
    activeLayer = id
    visible[id] = true
  }
  const activeMeta = $derived(layerById(activeLayer))

  // ── Timeline projection (shared bar grid) ────────────────────────────
  const secPerBar = DURATION_SEC / meta.bars
  const span = $derived(viewEnd - viewStart)
  const barsInView = $derived(span / secPerBar)
  const projPct = (sec: number) => ((sec - viewStart) / span) * 100
  const inView = (a: number, b: number) => b > viewStart && a < viewEnd

  const rulerStep = $derived(barsInView > 64 ? 8 : barsInView > 32 ? 4 : barsInView > 16 ? 2 : 1)
  const showBeats = $derived(barsInView <= 20)
  const gridLineStep = $derived(barsInView > 56 ? 4 : 1)
  const showChordText = $derived(barsInView <= 40)
  const showLyricText = $derived(barsInView <= 52)

  // Static playhead (~top of the first chorus) — a single line through every layer.
  const playheadSec = 33.2 * secPerBar
  const playheadInView = $derived(playheadSec >= viewStart && playheadSec <= viewEnd)
  const playheadPct = $derived(projPct(playheadSec))

  // ── Pre-derived layer content (static — one source, many lenses) ──────
  const sectionBlocks = sectionRows.map((s) => ({
    ...s,
    from: (s.fromBar - 1) * secPerBar,
    to: s.toBar * secPerBar,
  }))
  const chordBlocks = barCells.map((b) => ({ ...b, from: b.startSec, to: b.startSec + secPerBar }))
  const cueMarkers = cueRows
    .filter((c) => c.spoken)
    .map((c) => ({ label: c.label, color: c.color, sec: (c.fromBar - 1) * secPerBar }))
  const lyricBlocks = lyricLines.map((l, i) => ({
    text: l.text,
    from: l.startSec,
    to: lyricLines[i + 1]?.startSec ?? l.startSec + 4,
    timeLabel: l.timeLabel,
  }))
  const cueCount = cueRows.filter((c) => c.spoken).length
  const lyricCount = lyricLines.length
  const totalBeats = meta.bars * meta.beatsPerBar

  const chordsForSection = (fromBar: number, toBar: number) =>
    chordBlocks.filter((b) => b.number >= fromBar && b.number <= toBar).map((b) => b.chord)
  const lyricsForSection = (fromSec: number, toSec: number) =>
    lyricLines.filter((l) => l.startSec >= fromSec && l.startSec < toSec)

  const boxStyle = (from: number, to: number) =>
    `left:${projPct(from)}%;width:${projPct(to) - projPct(from)}%`
</script>

<svelte:head>
  <title>Song Edit · Layers (v3) — BarBro lab</title>
</svelte:head>

<!-- ══ Reusable lane snippets ═══════════════════════════════════════════ -->

{#snippet rulerLane()}
  {#each barCells as b (b.number)}
    {#if (b.number - 1) % rulerStep === 0 && inView(b.startSec, b.startSec + secPerBar)}
      <div class="pointer-events-none absolute top-0 bottom-0" style="left:{projPct(b.startSec)}%">
        <span class="border-foreground/25 absolute top-0 bottom-1 border-l"></span>
        <span
          class="text-muted-foreground absolute top-1 left-1 font-mono text-[9px] font-bold tabular-nums leading-none"
          >{b.number}</span
        >
      </div>
    {/if}
  {/each}
{/snippet}

{#snippet gridLane()}
  {#each barCells as b (b.number)}
    {#if (b.number - 1) % gridLineStep === 0 && inView(b.startSec, b.startSec + secPerBar)}
      <span
        class="pointer-events-none absolute top-0 bottom-0 {b.isSectionStart
          ? 'border-foreground/70'
          : (b.number - 1) % 4 === 0
            ? 'border-foreground/45'
            : 'border-foreground/15'} border-l"
        style="left:{projPct(b.startSec)}%"
      ></span>
    {/if}
    {#if showBeats && inView(b.startSec, b.startSec + secPerBar)}
      {#each [1, 2, 3] as beat (beat)}
        <span
          class="border-foreground/12 pointer-events-none absolute bottom-0 h-2 border-l"
          style="left:{projPct(b.startSec + beat * (secPerBar / 4))}%"
        ></span>
      {/each}
    {/if}
  {/each}
  {#if inView(0, secPerBar)}
    <span
      class="border-foreground/50 text-foreground/80 absolute bottom-1 flex items-center gap-1 rounded-[2px] border bg-[color-mix(in_oklch,var(--foreground)_8%,transparent)] px-1 py-0.5 font-mono text-[8px] font-black uppercase leading-none"
      style="left:calc({projPct(0)}% + 3px)">◂ 4-beat count-in</span
    >
  {/if}
{/snippet}

{#snippet sectionsLane()}
  {#each sectionBlocks as s (s.id)}
    {#if inView(s.from, s.to)}
      <button
        type="button"
        class="absolute inset-y-[3px] flex items-center overflow-hidden rounded-[2px] border-l-[3px] px-1.5 text-left"
        style="{boxStyle(s.from, s.to)};border-color:{s.color};background:color-mix(in oklch, {s.color} 22%, transparent)"
        title="{s.label} · bars {s.fromBar}–{s.toBar}"
      >
        <span class="text-foreground truncate font-mono text-[10px] font-black uppercase leading-none tracking-wide"
          >{s.label}</span
        >
        <span class="text-foreground/55 ml-1.5 shrink-0 font-mono text-[9px] tabular-nums leading-none"
          >{s.bars}</span
        >
      </button>
    {/if}
  {/each}
{/snippet}

{#snippet chordsLane()}
  {#each chordBlocks as b (b.number)}
    {#if inView(b.from, b.to)}
      <div
        class="absolute inset-y-[3px] flex items-center justify-center overflow-hidden border-r border-foreground/10 {b.isSectionStart
          ? 'border-l-2 border-l-foreground/45'
          : ''}"
        style="{boxStyle(b.from, b.to)};background:color-mix(in oklch, {b.color} 9%, transparent)"
      >
        {#if showChordText}
          <span class="font-mono text-[11px] font-black leading-none tabular-nums">{b.chord}</span>
        {:else}
          <span class="h-2.5 w-1 rounded-[1px]" style="background:{b.color}"></span>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

{#snippet cueLane()}
  {#if inView(0, secPerBar)}
    <span
      class="border-foreground/55 text-foreground/85 absolute top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-[2px] border bg-background px-1.5 py-0.5 font-mono text-[9px] font-black uppercase leading-none"
      style="left:calc({projPct(0)}% + 2px)"
    >
      <span class="size-1.5 rounded-full bg-foreground/70"></span>Count-in
    </span>
  {/if}
  {#each cueMarkers as c (c.label + c.sec)}
    {#if playheadInView || inView(c.sec, c.sec + secPerBar)}
      <span
        class="absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-[2px] border-l-[3px] bg-background/95 px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none shadow-[2px_2px_0_var(--brutalist-shadow-color)]"
        style="left:calc({projPct(c.sec)}% + 2px);border-color:{c.color}"
      >
        <Megaphone class="size-2.5" style="color:{c.color}" aria-hidden="true" />“{c.label}”
      </span>
    {/if}
  {/each}
{/snippet}

{#snippet lyricsLane()}
  {#each lyricBlocks as l, i (i)}
    {#if inView(l.from, l.to)}
      <div
        class="border-foreground/10 absolute inset-y-[3px] flex items-center overflow-hidden rounded-[2px] border-l bg-[color-mix(in_oklch,#8b5cf6_10%,transparent)] px-1.5"
        style={boxStyle(l.from, l.to)}
      >
        {#if showLyricText}
          <span class="text-foreground/90 truncate text-[11px] leading-none">{l.text}</span>
        {:else}
          <span class="h-2 w-1 rounded-[1px] bg-[#8b5cf6]/70"></span>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

<!-- ══ Layer row (rail header + timeline lane) ═══════════════════════════ -->

{#snippet layerRow(l: Layer, h: number, lane: Snippet)}
  {@const active = activeLayer === l.id}
  {@const Icon = l.icon}
  <div class="border-foreground/15 flex border-t" style="min-height:{h}px">
    <!-- rail header -->
    <div
      class="border-foreground/15 flex shrink-0 items-stretch gap-0 border-r"
      style="width:var(--rail);background:{active
        ? `color-mix(in oklch, ${l.accent} 12%, var(--muted))`
        : 'transparent'}"
    >
      <button
        type="button"
        class="hover:bg-foreground/10 flex w-7 shrink-0 items-center justify-center transition-colors"
        title={visible[l.id] ? `Hide ${l.label} layer` : `Show ${l.label} layer`}
        aria-pressed={visible[l.id]}
        onclick={() => (visible[l.id] = !visible[l.id])}
      >
        {#if visible[l.id]}
          <Eye class="size-3.5" aria-hidden="true" />
        {:else}
          <EyeOff class="text-muted-foreground/60 size-3.5" aria-hidden="true" />
        {/if}
      </button>
      <button
        type="button"
        class="hover:bg-foreground/5 flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left transition-colors"
        aria-pressed={active}
        onclick={() => setActive(l.id)}
      >
        <span
          class="size-4 shrink-0"
          style="color:{active ? l.accent : 'var(--muted-foreground)'}"
        >
          <Icon class="size-4" aria-hidden="true" />
        </span>
        <span
          class="min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-wide {active
            ? 'text-foreground'
            : 'text-muted-foreground'}">{l.label}</span
        >
        {#if active}
          <span class="size-1.5 shrink-0 rounded-full" style="background:{l.accent}"></span>
        {/if}
      </button>
    </div>

    <!-- timeline lane -->
    <div
      class="relative min-w-0 flex-1 overflow-hidden"
      style="border-left:3px solid {active ? l.accent : 'transparent'};background:{active
        ? `color-mix(in oklch, ${l.accent} 5%, transparent)`
        : 'transparent'}"
    >
      <div class="relative h-full w-full {visible[l.id] ? '' : 'opacity-25'}">
        {@render lane()}
      </div>
      {#if !visible[l.id]}
        <div class="v3-hatch pointer-events-none absolute inset-0"></div>
      {/if}
    </div>
  </div>
{/snippet}

<!-- ══ Page ═════════════════════════════════════════════════════════════ -->

<main
  class="v3-root text-foreground relative z-10 mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col gap-3 px-2 py-4 sm:px-4 md:px-6"
>
  <!-- ── Compact command bar (condensed from today's big header) ── -->
  <header class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <div class="flex min-w-0 items-center gap-2">
      <h1 class="font-display min-w-0 truncate text-xl leading-none tracking-tight">{meta.title}</h1>
      <Pencil class="text-muted-foreground/50 size-3.5 shrink-0" aria-hidden="true" />
      <span class="text-muted-foreground/70 min-w-0 truncate text-sm">{meta.artist}</span>
    </div>

    <div
      class="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] tabular-nums"
    >
      <span class="text-foreground font-bold">{meta.bpm} BPM</span>
      <span class="text-muted-foreground/40" aria-hidden="true">·</span>
      <span class="inline-flex items-center gap-1"
        >{meta.keyLabel}<RefreshCw class="text-muted-foreground/50 size-3" aria-hidden="true" /></span
      >
      <span class="text-muted-foreground/40" aria-hidden="true">·</span>
      <span
        class="border-foreground/30 bg-background inline-flex items-center overflow-hidden rounded-[var(--radius)] border text-[10px] font-black"
        aria-label="Transpose"
      >
        <span class="px-1.5 py-0.5">−1</span>
        <span class="border-foreground/20 min-w-7 border-x px-1.5 py-0.5 text-center">0</span>
        <span class="px-1.5 py-0.5">+1</span>
      </span>
      <span class="text-muted-foreground/40" aria-hidden="true">·</span>
      <span class="border-foreground/40 bg-muted/50 inline-flex items-center gap-1 rounded-[var(--radius)] border px-1.5 py-0.5">
        <Layers class="size-3" aria-hidden="true" />{meta.draftLabel}
        <ChevronDown class="size-3 opacity-60" aria-hidden="true" />
      </span>
    </div>

    <!-- non-timeline views — one click away, always -->
    <div class="ml-auto flex items-center gap-2">
      <span class="text-muted-foreground hidden font-mono text-[10px] tabular-nums sm:inline"
        >saved 18:30</span
      >
      <div class="border-foreground bg-background flex overflow-hidden rounded-[var(--radius)] border-2">
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors {dock ===
          'mixer'
            ? 'bg-foreground text-background'
            : 'hover:bg-foreground/10'}"
          aria-pressed={dock === 'mixer'}
          onclick={() => (dock = dock === 'mixer' ? 'none' : 'mixer')}
        >
          <SlidersHorizontal class="size-3.5" aria-hidden="true" />Mixer
        </button>
        <span class="border-foreground/30 border-l" aria-hidden="true"></span>
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors {overlay ===
          'leadsheet'
            ? 'bg-foreground text-background'
            : 'hover:bg-foreground/10'}"
          aria-pressed={overlay === 'leadsheet'}
          onclick={() => (overlay = overlay === 'leadsheet' ? 'none' : 'leadsheet')}
        >
          <ScrollText class="size-3.5" aria-hidden="true" />Lead sheet
        </button>
      </div>
    </div>
  </header>

  <!-- ── Contextual tool row (follows the active layer) ── -->
  <div
    class="brutalist-shadow-sm border-foreground bg-card flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1.5 border-2 px-2.5 py-1.5"
    style="border-top:4px solid {activeMeta.accent}"
  >
    <div class="flex shrink-0 items-center gap-1.5">
      <span class="size-2.5 rounded-[2px]" style="background:{activeMeta.accent}"></span>
      <span class="text-[11px] font-black uppercase tracking-wide">{activeMeta.label}</span>
      <HelpHint label={`${activeMeta.label} help`} text={activeMeta.hint} />
    </div>
    <span class="border-foreground/20 h-4 border-l" aria-hidden="true"></span>

    {#if activeLayer === 'grid'}
      <Button variant="outline" size="sm" class="h-7 gap-1.5 border-2 px-2 text-xs font-bold"
        ><Scissors class="size-3.5" aria-hidden="true" />Split</Button
      >
      <Button variant="outline" size="sm" class="h-7 border-2 px-2 text-xs font-bold">Merge</Button>
      <span class="inline-flex items-center gap-1 text-[11px]">
        <span class="text-muted-foreground font-bold uppercase">Beats</span>
        <span class="border-foreground bg-background flex overflow-hidden rounded-[var(--radius)] border font-mono text-[11px] font-black">
          <span class="px-1.5 py-0.5">3</span>
          <span class="bg-foreground text-background border-foreground/20 border-x px-1.5 py-0.5">4</span>
          <span class="px-1.5 py-0.5">5</span>
        </span>
      </span>
      <span class="inline-flex items-center gap-1 text-[11px]">
        <span class="text-muted-foreground font-bold uppercase">Count-in</span>
        <span class="border-foreground bg-background flex overflow-hidden rounded-[var(--radius)] border font-mono text-[11px] font-black">
          <span class="px-1.5 py-0.5">Off</span>
          <span class="bg-foreground text-background border-foreground/20 border-x px-1.5 py-0.5">4</span>
          <span class="px-1.5 py-0.5">8</span>
        </span>
      </span>
      <span class="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" class="border-2" aria-label="Undo"
          ><Undo2 class="size-3.5" aria-hidden="true" /></Button
        >
        <Button variant="outline" size="icon-sm" class="border-2 opacity-40" aria-label="Redo"
          ><Redo2 class="size-3.5" aria-hidden="true" /></Button
        >
        <Button variant="outline" size="sm" class="h-7 gap-1.5 border-2 px-2 text-xs font-bold"
          ><RotateCcw class="size-3.5" aria-hidden="true" />Reset</Button
        >
        <span class="text-muted-foreground font-mono text-[11px] tabular-nums"
          >{meta.bars} bars · {totalBeats} beats</span
        >
      </span>
    {:else if activeLayer === 'sections'}
      <span class="text-muted-foreground text-[11px] font-bold uppercase">Apply</span>
      {#each ['intro', 'verse', 'preChorus', 'chorus', 'bridge', 'solo', 'outro'] as kind (kind)}
        <button
          type="button"
          class="border-foreground/60 inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[11px] font-bold capitalize hover:bg-foreground/10"
        >
          <span class="size-2 rounded-[2px]" style="background:{sectionKindColor(kind)}"></span>{kind}
        </button>
      {/each}
      <span class="ml-auto flex items-center gap-2">
        <span class="text-muted-foreground font-mono text-[11px] tabular-nums"
          >selected: Chorus · bars 33–48</span
        >
        <Button variant="outline" size="sm" class="h-7 border-2 px-2 text-xs font-bold">Rename</Button>
      </span>
    {:else if activeLayer === 'chords'}
      <span class="inline-flex items-center gap-1 text-[11px]">
        <span class="text-muted-foreground font-bold uppercase">Key</span>
        <span class="border-input bg-background border px-1.5 py-0.5 font-mono text-[11px] font-black">G</span>
        <span class="border-input bg-background text-muted-foreground border px-1.5 py-0.5 text-[11px]">natural</span>
        <span class="border-input bg-background text-muted-foreground border px-1.5 py-0.5 text-[11px]">major</span>
      </span>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        <input type="checkbox" checked class="accent-foreground size-3.5" />Suggestions
      </label>
      <button type="button" class="text-foreground text-[11px] font-bold underline-offset-2 hover:underline"
        >Use section suggestions (4)</button
      >
      <span class="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" class="h-7 border-2 px-2 text-xs font-bold">Sheet import</Button>
        <Button variant="outline" size="sm" class="h-7 border-2 px-2 text-xs font-bold">Inspect</Button>
      </span>
    {:else if activeLayer === 'cue'}
      <span class="text-muted-foreground text-[11px] font-bold uppercase">Performer</span>
      <span class="border-foreground bg-foreground text-background rounded-[2px] border px-2 py-0.5 text-[11px] font-bold">Lead vox</span>
      <span class="border-foreground/50 rounded-[2px] border px-2 py-0.5 text-[11px] font-bold">Guitar</span>
      <button type="button" class="border-foreground/50 inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[11px] font-bold hover:bg-foreground/10"
        ><Plus class="size-3" aria-hidden="true" />Add</button
      >
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        <input type="checkbox" checked class="accent-foreground size-3.5" />Spoken count-in
      </label>
      <span class="ml-auto flex items-center gap-2">
        <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{cueCount}/{sectionRows.length} cues</span>
        <Button variant="secondary" size="sm" class="h-7 gap-1.5 border-2 px-2 text-xs font-bold"
          ><WandSparkles class="size-3.5" aria-hidden="true" />Auto-generate</Button
        >
      </span>
    {:else if activeLayer === 'lyrics'}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5 border-2 px-2 text-xs font-bold"
        onclick={() => (dock = dock === 'lyrics' ? 'none' : 'lyrics')}
      >
        <Captions class="size-3.5" aria-hidden="true" />Edit text
      </Button>
      <Button variant="secondary" size="sm" class="h-7 border-2 px-2 text-xs font-bold">Fit to song</Button>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        <input type="checkbox" checked class="accent-foreground size-3.5" />Show timings
      </label>
      <span class="ml-auto text-muted-foreground font-mono text-[11px] tabular-nums"
        >{lyricCount} lines · saved, not fitted</span
      >
    {/if}
  </div>

  <!-- ── The one shared timeline workspace ── -->
  <section
    class="v3-workspace brutalist-shadow border-foreground bg-card relative border-2"
    style="--rail:132px"
    aria-label="Timeline workspace"
  >
    <!-- Ruler (always on) -->
    <div class="flex" style="min-height:24px">
      <div class="border-foreground/15 flex shrink-0 items-center gap-1.5 border-r px-2" style="width:var(--rail)">
        <span class="text-muted-foreground text-[10px] font-black uppercase tracking-wide">Bars</span>
        <span class="text-muted-foreground/60 font-mono text-[10px] tabular-nums">{meta.timeSignature}</span>
      </div>
      <div class="relative min-w-0 flex-1 overflow-hidden">{@render rulerLane()}</div>
    </div>

    {@render layerRow(layerById('grid'), 46, gridLane)}
    {@render layerRow(layerById('sections'), 34, sectionsLane)}

    <!-- Master audio row — the never-rebuilt waveform. ONE page-owned viewport. -->
    <div class="border-foreground/15 flex border-t bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)]">
      <div
        class="border-foreground/15 flex w-[var(--rail)] shrink-0 flex-col justify-center gap-1 border-r px-2 py-2"
      >
        <div class="flex items-center gap-1.5">
          <AudioLines class="text-foreground size-4" aria-hidden="true" />
          <span class="text-[11px] font-black uppercase tracking-wide">Audio</span>
        </div>
        <span class="text-muted-foreground truncate font-mono text-[10px]">Original mix</span>
        <span class="text-muted-foreground/70 font-mono text-[10px] tabular-nums">{meta.durationLabel}</span>
      </div>
      <div class="relative min-w-0 flex-1 p-1.5">
        <DebugSharedWaveform
          bind:viewStart
          bind:viewEnd
          sections={waveformSections}
          bars={meta.bars}
          durationSec={DURATION_SEC}
          {playheadSec}
        />
      </div>
    </div>

    {@render layerRow(layerById('chords'), 44, chordsLane)}
    {@render layerRow(layerById('cue'), 34, cueLane)}
    {@render layerRow(layerById('lyrics'), 46, lyricsLane)}

    <!-- One playhead line through every layer (reinforces the single timeline) -->
    {#if playheadInView}
      <div
        class="pointer-events-none absolute top-0 bottom-0 z-[3] w-px bg-[var(--studio-orange)]"
        style="left:calc(var(--rail) + (100% - var(--rail)) * {playheadPct} / 100);box-shadow:0 0 0 2px color-mix(in oklch, var(--studio-orange) 20%, transparent)"
      ></div>
    {/if}

    <!-- ── Lead-sheet: full-bleed chart overlay (waveform stays mounted beneath) ── -->
    {#if overlay === 'leadsheet'}
      <div class="bg-card absolute inset-0 z-[5] flex flex-col">
        <div class="border-foreground/20 flex items-center gap-2 border-b-2 px-3 py-2">
          <ScrollText class="size-4" aria-hidden="true" />
          <span class="text-[11px] font-black uppercase tracking-wide">Lead sheet</span>
          <span class="text-muted-foreground text-[11px]">read-only performance chart</span>
          <button
            type="button"
            class="hover:bg-foreground/10 ml-auto flex size-7 items-center justify-center rounded-[var(--radius)]"
            aria-label="Close lead sheet"
            onclick={() => (overlay = 'none')}
          >
            <X class="size-4" aria-hidden="true" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto px-4 py-4">
          <div class="mx-auto max-w-3xl space-y-5">
            <div class="border-foreground/20 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 pb-3">
              <span class="font-display text-2xl tracking-tight">{meta.title}</span>
              <span class="text-muted-foreground text-sm">{meta.artist}</span>
              <span class="text-muted-foreground ml-auto font-mono text-xs tabular-nums"
                >{meta.keyLabel} · {meta.bpm} BPM · {meta.timeSignature}</span
              >
            </div>
            {#each sectionBlocks as s (s.id)}
              <div class="space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="size-2.5 rounded-[2px]" style="background:{s.color}"></span>
                  <span class="text-xs font-black uppercase tracking-wide">{s.label}</span>
                  <span class="text-muted-foreground font-mono text-[10px] tabular-nums"
                    >bars {s.fromBar}–{s.toBar}</span
                  >
                </div>
                <div class="font-mono text-sm font-bold tracking-wide">
                  {chordsForSection(s.fromBar, s.toBar).join('  ')}
                </div>
                {#each lyricsForSection(s.from, s.to) as l (l.index)}
                  <p class="text-foreground/85 text-sm leading-snug">{l.text}</p>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </section>

  <!-- ── Docked mixer strip (Overview) ── -->
  {#if dock === 'mixer'}
    <section
      class="brutalist-shadow border-foreground bg-card border-2"
      aria-label="Mixer"
    >
      <div class="border-foreground/20 flex flex-wrap items-center gap-2 border-b-2 px-3 py-2">
        <SlidersHorizontal class="size-4" aria-hidden="true" />
        <span class="text-[11px] font-black uppercase tracking-wide">Mixer</span>
        <Button variant="default" size="sm" class="h-7 w-7 p-0" aria-label="Play"
          ><Play class="size-3.5" aria-hidden="true" /></Button
        >
        <Button variant="outline" size="sm" class="h-7 w-7 border-2 p-0" aria-label="Stop"
          ><Square class="size-3 " aria-hidden="true" /></Button
        >
        <span class="font-mono text-xs tabular-nums">0:00 / {meta.durationLabel}</span>
        <label
          class="text-foreground ml-1 inline-flex h-7 items-center gap-1.5 rounded-[var(--radius)] px-2 text-[11px] font-bold"
          style="background:linear-gradient(120deg, color-mix(in oklch, var(--studio-orange) 30%, var(--background)), color-mix(in oklch, var(--studio-orange-soft) 44%, var(--background)))"
        >
          <input type="checkbox" class="accent-foreground size-3.5" />Playback mode
        </label>
        <span class="text-muted-foreground ml-auto text-[11px]">{mixerLanes.length} tracks</span>
        <button
          type="button"
          class="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-[var(--radius)]"
          aria-label="Close mixer"
          onclick={() => (dock = 'none')}
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </div>
      <div class="flex gap-2 overflow-x-auto px-3 py-3">
        {#each mixerLanes as lane (lane.key)}
          {@const fill = Math.max(0, Math.min(1, (lane.db + 24) / 24)) * 100}
          <div
            class="border-foreground/40 bg-background flex w-[76px] shrink-0 flex-col items-center gap-2 border-2 px-2 py-2 {lane.muted
              ? 'opacity-55'
              : ''}"
            style={lane.solo ? 'box-shadow:0 0 0 2px var(--studio-orange)' : ''}
          >
            <span class="h-1 w-full rounded-full" style="background:{lane.color}"></span>
            <span class="w-full truncate text-center text-[10px] font-bold leading-tight" title={lane.label}
              >{lane.label}</span
            >
            <div class="flex gap-1">
              <span
                class="border-foreground/50 flex size-5 items-center justify-center rounded-[2px] border font-mono text-[10px] font-black {lane.muted
                  ? 'bg-foreground text-background'
                  : ''}">M</span
              >
              <span
                class="border-foreground/50 flex size-5 items-center justify-center rounded-[2px] border font-mono text-[10px] font-black {lane.solo
                  ? 'bg-[var(--studio-orange)] text-black'
                  : ''}">S</span
              >
            </div>
            <div class="bg-muted relative h-20 w-2.5 overflow-hidden rounded-full">
              <div class="absolute inset-x-0 bottom-0 rounded-full" style="height:{fill}%;background:{lane.color}"></div>
              <div class="absolute inset-x-[-3px] h-1 rounded-[1px] bg-foreground" style="bottom:calc({fill}% - 2px)"></div>
            </div>
            <span class="text-muted-foreground font-mono text-[10px] tabular-nums">{lane.db} dB</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── Docked lyrics text editor (paste + fit) ── -->
  {#if dock === 'lyrics'}
    <section class="brutalist-shadow border-foreground bg-card border-2" aria-label="Lyrics text">
      <div class="border-foreground/20 flex items-center gap-2 border-b-2 px-3 py-2">
        <Captions class="size-4" aria-hidden="true" />
        <span class="text-[11px] font-black uppercase tracking-wide">Lyrics text</span>
        <span class="text-muted-foreground text-[11px]">paste on draft “{meta.draftLabel}”, then fit to song</span>
        <Button variant="secondary" size="sm" class="ml-auto h-7 border-2 px-2 text-xs font-bold">Fit to song</Button>
        <button
          type="button"
          class="hover:bg-foreground/10 flex size-7 items-center justify-center rounded-[var(--radius)]"
          aria-label="Close lyrics editor"
          onclick={() => (dock = 'none')}
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </div>
      <div class="grid gap-3 p-3 md:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <span class="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">Paste lyrics</span>
          <textarea
            rows="10"
            spellcheck="false"
            class="border-foreground bg-background h-52 w-full resize-none border-2 px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none"
            >{lyricLines.map((l) => l.text).join('\n')}</textarea
          >
        </div>
        <div class="flex min-w-0 flex-col gap-1.5">
          <span class="text-muted-foreground text-[10px] font-bold uppercase tracking-wide"
            >Timed preview · {lyricCount} lines</span
          >
          <div class="border-foreground/30 bg-muted/40 h-52 space-y-0.5 overflow-auto border-2 px-3 py-2">
            {#each lyricLines as l (l.index)}
              <p class="flex items-baseline gap-2 text-sm leading-snug">
                <span class="text-muted-foreground w-8 shrink-0 font-mono text-[10px] tabular-nums">{l.timeLabel}</span>
                <span class="truncate">{l.text}</span>
              </p>
            {/each}
          </div>
        </div>
      </div>
    </section>
  {/if}

  <!-- ── Footer: layer legend + gestures ── -->
  <footer class="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
    <span class="text-muted-foreground text-[10px] font-black uppercase tracking-wide">Layers</span>
    {#each LAYERS as l (l.id)}
      {@const Icon = l.icon}
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] font-bold"
        onclick={() => setActive(l.id)}
      >
        <span class="size-2 rounded-[2px]" style="background:{l.accent}"></span>
        <Icon class="size-3" aria-hidden="true" />{l.label}
        {#if !visible[l.id]}<span class="text-muted-foreground/50">(hidden)</span>{/if}
      </button>
    {/each}
    <span class="text-muted-foreground/70 ml-auto font-mono text-[10px]"
      >⌘/Ctrl+scroll zoom · drag wave to pan · one timeline, every layer aligned to the same bars</span
    >
  </footer>
</main>

<style>
  /* Card fill for the brutalist boxes, matching the real edit page. */
  .v3-root :global(.brutalist-shadow.border-foreground.bg-card),
  .v3-root :global(.brutalist-shadow-sm.border-foreground.bg-card) {
    background: var(--card);
  }

  /* Hidden-layer hatch overlay. */
  .v3-hatch {
    background-image: repeating-linear-gradient(
      45deg,
      color-mix(in oklch, var(--foreground) 9%, transparent) 0 5px,
      transparent 5px 11px
    );
  }
</style>
