<script lang="ts">
  /**
   * Song Edit — DESIGN PROTOTYPE, version-1: "Compact DAW workspace".
   *
   * A single, continuous single-window tool. One persistent slim command bar
   * carries ALL global controls (condensed song identity, transport, save-state
   * and the 7 modes as a segmented switch). Directly beneath it the shared
   * waveform/timeline is the SPINE — present on every mode, driven by ONE
   * page-owned viewport (`viewStart`/`viewEnd`) so zoom/scroll survives mode
   * switches. Below the spine sits the active mode's dense tool surface: a single
   * flat editing toolbar (no per-panel boxes, no big titles) + the mode's working
   * content, using the full width, with a context inspector for the editing modes.
   *
   * READ-ONLY: controls exist visually only. No state mutation, no business
   * logic. Everything renders against the real-shaped `songEditorFixture`.
   */
  import type { Snippet } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import HelpHint from '$lib/components/HelpHint.svelte'
  import DebugSharedWaveform from '$lib/components/DebugSharedWaveform.svelte'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import {
    meta,
    sectionRows,
    chordRow,
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
    Play,
    Square,
    RotateCcw,
    Volume2,
    Repeat1,
    RefreshCw,
    Undo2,
    Redo2,
    Check,
    Plus,
    Sparkles,
    Mic,
    Type,
    FileText,
    LayoutGrid,
    Rows3,
    Music4,
    SlidersHorizontal,
    Layers,
    Printer,
    ChevronRight,
  } from '@lucide/svelte'

  // ── Active mode + page-owned SPINE viewport (persists across mode switches) ─
  let mode = $state<EditTabId>('grid')
  let viewStart = $state(0)
  let viewEnd = $state(DURATION_SEC)
  const playheadSec = DURATION_SEC * 0.27

  // ── Derived song facts ────────────────────────────────────────────────────
  const barSec = DURATION_SEC / meta.bars
  const totalBeats = meta.bars * meta.beatsPerBar
  const beatTicks = Array.from({ length: meta.beatsPerBar }, (_, i) => i)
  const countInOptions = [0, 4, 8]

  // Sections enriched with their per-bar chords, time span, and lyric lines.
  const sectionGroups = sectionRows.map((s) => {
    const startSec = (s.fromBar - 1) * barSec
    const endSec = s.toBar * barSec
    return {
      ...s,
      startSec,
      endSec,
      durLabel: fmtTime(endSec - startSec),
      cells: barCells.slice(s.fromBar - 1, s.toBar),
      chords: barCells.slice(s.fromBar - 1, s.toBar).map((b) => b.chord),
      lyrics: lyricLines.filter((l) => l.text && l.startSec >= startSec && l.startSec < endSec),
      widthPct: (s.bars / meta.bars) * 100,
      leftPct: ((s.fromBar - 1) / meta.bars) * 100,
    }
  })

  // Static "selected" items for the context inspectors (read-only prototype).
  const selBar = barCells[32]! // bar 33 — the first chorus downbeat
  const selSection = sectionRows[3]! // Chorus, bars 33–48
  const selGroup = sectionGroups[3]!

  // Section-kind palette (the "apply a tag" swatch row).
  const KIND_PALETTE: { kind: string; label: string }[] = [
    { kind: 'intro', label: 'Intro' },
    { kind: 'verse', label: 'Verse' },
    { kind: 'preChorus', label: 'Pre' },
    { kind: 'chorus', label: 'Chorus' },
    { kind: 'bridge', label: 'Bridge' },
    { kind: 'solo', label: 'Solo' },
    { kind: 'outro', label: 'Outro' },
    { kind: 'custom', label: 'Custom' },
  ]

  // Mixer fader position from a dB value (purely for the meter fill).
  const gainFrac = (db: number) => Math.max(0.05, Math.min(1, (db + 30) / 30))

  // ── Mode metadata (icon + grouping) ───────────────────────────────────────
  const ICON: Record<EditTabId, typeof Play> = {
    overview: SlidersHorizontal,
    grid: LayoutGrid,
    sections: Rows3,
    chords: Music4,
    cue: Mic,
    lyrics: Type,
    leadsheet: FileText,
  }
  const MODES = EDIT_TABS.map((t) => ({ ...t, icon: ICON[t.id] }))
  const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<
    EditTabId,
    (typeof MODES)[number]
  >
  // Three related clusters: identity/mix · the spine-driven timeline family · docs.
  const MODE_GROUPS: EditTabId[][] = [
    ['overview'],
    ['grid', 'sections', 'chords'],
    ['cue', 'lyrics', 'leadsheet'],
  ]

  const showInspector = $derived(mode === 'grid' || mode === 'sections' || mode === 'chords')

  const modeStatusText = $derived(
    mode === 'overview'
      ? `${mixerLanes.length} tracks`
      : mode === 'grid'
        ? `${meta.bars} bars · ${totalBeats} beats`
        : mode === 'sections'
          ? `${sectionRows.length} sections`
          : mode === 'chords'
            ? `${chordRow.length} chords · ${meta.keyLabel}`
            : mode === 'cue'
              ? `${cueRows.filter((c) => c.spoken).length}/${cueRows.length} cues on`
              : mode === 'lyrics'
                ? `${lyricLines.length} lines`
                : `${sectionRows.length} sections · ${meta.timeSignature}`,
  )

  // Shared control class fragments (keep the flat toolbar consistent everywhere).
  const CHIP = 'inline-flex h-6 items-center gap-1 border-2 border-foreground/35 bg-background px-2 text-[11px] font-bold uppercase tracking-wide'
  const CHIP_ON = 'inline-flex h-6 items-center gap-1 border-2 border-foreground bg-foreground text-background px-2 text-[11px] font-bold uppercase tracking-wide'
  const DIV = 'mx-0.5 h-5 w-px bg-foreground/20'
</script>

<svelte:head>
  <title>Song Editor · v1 Compact DAW workspace — BarBro lab</title>
</svelte:head>

<!-- ════════════════════════ reusable snippets ════════════════════════ -->

{#snippet segGroup(ids: EditTabId[])}
  <div class="inline-flex overflow-hidden border-2 border-foreground bg-card" role="tablist" aria-label="Edit mode group">
    {#each ids as id (id)}
      {@const m = MODE_BY_ID[id]}
      {@const Icon = m.icon}
      <button
        type="button"
        role="tab"
        aria-selected={mode === id}
        title={m.label}
        class="inline-flex h-7 items-center gap-1.5 border-r-2 border-foreground px-2.5 text-[11px] font-bold uppercase tracking-wide transition-colors last:border-r-0 {mode ===
        id
          ? 'bg-foreground text-background'
          : 'bg-transparent hover:bg-foreground/10'}"
        onclick={() => (mode = id)}
      >
        <Icon class="size-3.5" aria-hidden="true" />
        <span class="hidden md:inline">{m.label}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet toolbar(label: string, help: string, controls: Snippet)}
  <div class="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b-2 border-foreground bg-card px-3 py-1.5">
    <div class="flex shrink-0 items-center gap-1.5">
      <span class="inline-block h-4 w-1 bg-[var(--studio-orange)]" aria-hidden="true"></span>
      <span class="font-display text-xs uppercase tracking-wider">{label}</span>
      {#if help}
        <HelpHint label={`${label} help`} text={help} />
      {/if}
    </div>
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
      {@render controls()}
    </div>
  </div>
{/snippet}

{#snippet barCell(b: (typeof barCells)[number], emphasizeChord: boolean)}
  {@const active = b.number === selBar.number}
  <div
    class="relative flex h-12 flex-col justify-between overflow-hidden border-2 px-1 py-1 {active
      ? 'border-[var(--studio-orange)] bg-[color-mix(in_oklch,var(--studio-orange)_10%,var(--card))]'
      : 'border-foreground/20 bg-card hover:border-foreground/50'}"
  >
    <span class="absolute inset-x-0 top-0 h-[3px]" style="background-color:{b.color}" aria-hidden="true"></span>
    <span class="font-mono text-[9px] font-bold leading-none text-muted-foreground tabular-nums">{b.number}</span>
    <span
      class="text-center font-mono font-black leading-none {emphasizeChord
        ? 'text-sm'
        : 'text-[11px]'}">{b.chord}</span>
    <div class="flex items-end justify-center gap-[3px]">
      {#each beatTicks as bi (bi)}
        <span class="w-[2px] {bi === 0 ? 'h-2.5 bg-foreground/70' : 'h-1.5 bg-foreground/30'}"></span>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet inspectorHeader(text: string)}
  <div class="flex items-center gap-1.5 border-b-2 border-foreground/15 pb-1.5">
    <span class="inline-block h-3 w-1 bg-[var(--studio-orange)]" aria-hidden="true"></span>
    <span class="font-display text-[10px] uppercase tracking-wider text-muted-foreground">{text}</span>
  </div>
{/snippet}

{#snippet kv(k: string, v: string)}
  <div class="flex items-baseline justify-between gap-3">
    <span class="text-[11px] text-muted-foreground">{k}</span>
    <span class="font-mono text-[11px] font-bold tabular-nums">{v}</span>
  </div>
{/snippet}

<!-- ════════════════════════ mode toolbars ════════════════════════ -->

{#snippet overviewControls()}
  <Button variant="outline" size="sm" class="h-7 gap-1.5 border-2 text-[11px] font-bold" title="Re-scan disk and reload all tracks">
    <RefreshCw class="size-3.5" aria-hidden="true" />
    Reload
  </Button>
  <span class={DIV} aria-hidden="true"></span>
  <span class={CHIP}><input type="checkbox" class="accent-foreground size-3" />Band mode</span>
  <span class={CHIP_ON}>Band</span>
  <span class={CHIP}>Live rig</span>
  <span class={DIV} aria-hidden="true"></span>
  <span class="inline-flex items-center gap-1.5 text-[11px]">
    <Volume2 class="size-3.5 text-muted-foreground" aria-hidden="true" />
    <input type="range" min="0" max="1.5" step="0.01" value="1" class="accent-foreground h-1 w-28" aria-label="Master volume" />
    <span class="font-mono text-muted-foreground tabular-nums">0 dB</span>
  </span>
  <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{modeStatusText}</span>
{/snippet}

{#snippet gridControls()}
  <Button variant="outline" size="sm" class="h-7 gap-1.5 border-2 text-[11px] font-bold" title="Undo (Cmd/Ctrl+Z)">
    <Undo2 class="size-3.5" aria-hidden="true" />Undo
  </Button>
  <Button variant="outline" size="sm" class="h-7 gap-1.5 border-2 text-[11px] font-bold opacity-45" title="Redo (Shift+Cmd/Ctrl+Z)">
    <Redo2 class="size-3.5" aria-hidden="true" />Redo
  </Button>
  <span class={DIV} aria-hidden="true"></span>
  <span class={CHIP}>Reset to analyzed</span>
  <span class={CHIP}><RefreshCw class="size-3" aria-hidden="true" />Re-analyze</span>
  <span class={DIV} aria-hidden="true"></span>
  <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Count-in</span>
  <div class="inline-flex overflow-hidden border-2 border-foreground/35">
    {#each countInOptions as n (n)}
      <span
        class="border-r border-foreground/25 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums last:border-r-0 {n === meta.beatsPerBar
          ? 'bg-foreground text-background'
          : 'bg-background'}">{n === 0 ? 'Off' : n}</span>
    {/each}
  </div>
  <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Start beat</span>
  <span class="border-2 border-foreground/35 bg-background px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums">1</span>
  <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{modeStatusText}</span>
{/snippet}

{#snippet sectionsControls()}
  <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Apply tag</span>
  {#each KIND_PALETTE as p (p.kind)}
    <button
      type="button"
      class="inline-flex h-6 items-center gap-1 border-2 border-foreground/35 bg-background px-1.5 text-[11px] font-bold hover:border-foreground"
      title={p.label}
    >
      <span class="size-2.5 rounded-[2px]" style="background-color:{sectionKindColor(p.kind)}"></span>
      {p.label}
    </button>
  {/each}
  <span class={DIV} aria-hidden="true"></span>
  <span class={CHIP}><Plus class="size-3" aria-hidden="true" />Add</span>
  <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{modeStatusText}</span>
{/snippet}

{#snippet chordsControls()}
  <span class={CHIP_ON}><Sparkles class="size-3" aria-hidden="true" />Suggestions</span>
  <span class={DIV} aria-hidden="true"></span>
  <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Key</span>
  <span class="border-2 border-foreground/35 bg-background px-2 py-0.5 text-[11px] font-bold">G</span>
  <span class="border-2 border-foreground/35 bg-background px-2 py-0.5 text-[11px] font-bold">natural</span>
  <span class="border-2 border-foreground/35 bg-background px-2 py-0.5 text-[11px] font-bold">major</span>
  <span class={DIV} aria-hidden="true"></span>
  <span class={CHIP}>Import sheet</span>
  <span class="ml-auto flex items-center gap-2">
    <span class="font-mono text-[11px] text-muted-foreground tabular-nums">{modeStatusText}</span>
  </span>
{/snippet}

{#snippet cueControls()}
  <span class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Performer</span>
  <span class={CHIP_ON}>Lead vox</span>
  <span class={CHIP}>Guitar</span>
  <span class={CHIP}><Plus class="size-3" aria-hidden="true" />Add</span>
  <span class={DIV} aria-hidden="true"></span>
  <span class={CHIP}>Voice · Lessac</span>
  <span class={DIV} aria-hidden="true"></span>
  <span class="inline-flex h-6 items-center gap-1 border-2 border-foreground bg-foreground px-2 text-[11px] font-bold uppercase tracking-wide text-background">
    <Sparkles class="size-3" aria-hidden="true" />Auto-generate
  </span>
  <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{modeStatusText}</span>
{/snippet}

{#snippet lyricsControls()}
  <span class="text-[11px]">draft <span class="font-bold">{meta.draftLabel}</span></span>
  <span class={DIV} aria-hidden="true"></span>
  <span class={CHIP}>Save lyrics</span>
  <span class="inline-flex h-6 items-center gap-1 border-2 border-foreground bg-foreground px-2 text-[11px] font-bold uppercase tracking-wide text-background">Fit to song</span>
  <span class="text-[11px] text-muted-foreground">Saved · not fitted yet</span>
  <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{modeStatusText}</span>
{/snippet}

{#snippet leadsheetControls()}
  <span class={CHIP}>Transpose 0</span>
  <span class="border-2 border-foreground/35 bg-background px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums">{meta.keyLabel} · {meta.bpm} BPM</span>
  <span class={DIV} aria-hidden="true"></span>
  <span class={CHIP}><Printer class="size-3" aria-hidden="true" />Print</span>
  <span class={CHIP}>Export PDF</span>
  <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{modeStatusText}</span>
{/snippet}

<!-- ════════════════════════ mode bodies ════════════════════════ -->

{#snippet overviewBody()}
  <div class="flex flex-col gap-3 p-3">
    <!-- Now / next chord readout — DAW-style transport telemetry. -->
    <div class="flex flex-wrap items-center gap-3 border-2 border-foreground bg-card px-3 py-2">
      <div class="flex items-baseline gap-2">
        <span class="text-[10px] font-black uppercase text-muted-foreground">Chord</span>
        <span class="font-mono text-2xl font-black leading-none tabular-nums">G</span>
      </div>
      <div class="flex items-center gap-1 font-mono text-[11px] font-bold text-muted-foreground tabular-nums">
        <span class="uppercase">Next</span>
        <ChevronRight class="size-3" aria-hidden="true" />
        <span class="font-black text-foreground">D</span>
        <span>in 1.9s</span>
      </div>
      <div class="relative ml-2 hidden h-7 min-w-40 flex-1 overflow-hidden border border-foreground/20 bg-background sm:block">
        <span class="absolute top-1/2 flex h-5 -translate-y-1/2 items-center justify-center bg-foreground px-1 font-mono text-[11px] font-black text-background" style="left:2%;width:30%">G</span>
        <span class="absolute top-1/2 flex h-5 -translate-y-1/2 items-center justify-center bg-foreground/25 px-1 font-mono text-[11px] font-black" style="left:34%;width:30%">D</span>
        <span class="absolute top-1/2 flex h-5 -translate-y-1/2 items-center justify-center border border-foreground/25 bg-background px-1 font-mono text-[11px] font-black" style="left:66%;width:30%">Em</span>
      </div>
      <span class="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{meta.bars} bars · {meta.keyLabel} · {meta.bpm} BPM</span>
    </div>

    <!-- Compact mixer strip -->
    <div class="border-2 border-foreground bg-card">
      <div class="flex items-center gap-3 border-b-2 border-foreground/15 bg-muted/40 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
        <span class="w-40">Track</span>
        <span class="w-14 text-center">Mute</span>
        <span class="w-40">Level</span>
        <span class="w-12 text-right">dB</span>
        <span class="flex-1">Meter</span>
      </div>
      {#each mixerLanes as lane (lane.key)}
        <div class="flex items-center gap-3 border-b border-foreground/10 px-3 py-1.5 last:border-b-0 {lane.muted ? 'opacity-55' : ''}">
          <div class="flex w-40 min-w-0 items-center gap-2">
            <span class="size-3 shrink-0 rounded-[2px]" style="background-color:{lane.color}"></span>
            <span class="truncate text-xs font-bold">{lane.label}</span>
          </div>
          <div class="flex w-14 justify-center gap-1">
            <span class="inline-flex size-6 items-center justify-center border-2 font-mono text-[10px] font-black {lane.muted ? 'border-foreground bg-foreground text-background' : 'border-foreground/35'}">M</span>
            <span class="inline-flex size-6 items-center justify-center border-2 font-mono text-[10px] font-black {lane.solo ? 'border-foreground bg-[var(--studio-orange)]' : 'border-foreground/35'}">S</span>
          </div>
          <input type="range" min="0" max="1.5" step="0.01" value={gainFrac(lane.db) * 1.5} class="accent-foreground h-1 w-40" aria-label="{lane.label} volume" />
          <span class="w-12 text-right font-mono text-[11px] tabular-nums">{lane.db} dB</span>
          <div class="relative h-3 flex-1 overflow-hidden border border-foreground/15 bg-background">
            <div class="absolute inset-y-0 left-0" style="width:{gainFrac(lane.db) * 100}%;background:linear-gradient(90deg,{lane.color},color-mix(in oklch,{lane.color} 40%,transparent))"></div>
          </div>
        </div>
      {/each}
    </div>
    <p class="text-[11px] text-muted-foreground">Volume, mute and solo are saved with the song and stay aligned across playback and export. Click a lane's meter to seek.</p>
  </div>
{/snippet}

{#snippet gridBody()}
  <div class="flex flex-col gap-4 p-3">
    {#each sectionGroups as g (g.id)}
      <div>
        <div class="mb-1 flex items-center gap-2">
          <span class="size-2.5 rounded-[2px]" style="background-color:{g.color}"></span>
          <span class="font-display text-[11px] uppercase tracking-wide">{g.label}</span>
          <span class="font-mono text-[10px] text-muted-foreground tabular-nums">bars {g.fromBar}–{g.toBar} · {g.bars} bars · {g.durLabel}</span>
        </div>
        <div class="grid grid-cols-4 gap-1 sm:grid-cols-8 md:grid-cols-12 xl:grid-cols-16">
          {#each g.cells as b (b.number)}
            {@render barCell(b, false)}
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet sectionsBody()}
  <div class="flex flex-col gap-3 p-3">
    <!-- Proportional arrangement strip (mirrors the spine bands as a table key). -->
    <div class="relative flex h-8 w-full overflow-hidden border-2 border-foreground">
      {#each sectionGroups as g (g.id)}
        <div
          class="relative flex items-center overflow-hidden border-r border-background/40 px-1.5 last:border-r-0"
          style="width:{g.widthPct}%;background-color:color-mix(in oklch,{g.color} 32%,var(--card))"
          title="{g.label} · bars {g.fromBar}–{g.toBar}"
        >
          <span class="truncate text-[10px] font-black uppercase tracking-wide">{g.label}</span>
        </div>
      {/each}
    </div>

    <!-- Section table -->
    <div class="border-2 border-foreground bg-card">
      <div class="grid grid-cols-[1.5rem_1fr_5rem_6rem_3.5rem_4rem] items-center gap-2 border-b-2 border-foreground/15 bg-muted/40 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
        <span></span>
        <span>Section</span>
        <span>Kind</span>
        <span>Bars</span>
        <span class="text-right">Count</span>
        <span class="text-right">Length</span>
      </div>
      {#each sectionGroups as g (g.id)}
        {@const sel = g.id === selSection.id}
        <div class="grid grid-cols-[1.5rem_1fr_5rem_6rem_3.5rem_4rem] items-center gap-2 border-b border-foreground/10 px-3 py-1.5 text-xs last:border-b-0 {sel ? 'bg-[color-mix(in_oklch,var(--studio-orange)_9%,var(--card))]' : ''}">
          <span class="size-3 rounded-[2px]" style="background-color:{g.color}"></span>
          <span class="truncate font-bold">{g.label}</span>
          <span class="font-mono text-[11px] text-muted-foreground">{g.kind}</span>
          <span class="font-mono text-[11px] tabular-nums">{g.fromBar}–{g.toBar}</span>
          <span class="text-right font-mono text-[11px] tabular-nums">{g.bars}</span>
          <span class="text-right font-mono text-[11px] tabular-nums">{g.durLabel}</span>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet chordsBody()}
  <div class="flex flex-col gap-4 p-3">
    {#each sectionGroups as g (g.id)}
      <div>
        <div class="mb-1 flex items-center gap-2">
          <span class="size-2.5 rounded-[2px]" style="background-color:{g.color}"></span>
          <span class="font-display text-[11px] uppercase tracking-wide">{g.label}</span>
          <span class="font-mono text-[10px] text-muted-foreground tabular-nums">bars {g.fromBar}–{g.toBar}</span>
        </div>
        <div class="grid grid-cols-4 gap-1 sm:grid-cols-8 md:grid-cols-12 xl:grid-cols-16">
          {#each g.cells as b (b.number)}
            {@render barCell(b, true)}
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet cueBody()}
  <div class="flex flex-col gap-3 p-3">
    <div class="border-2 border-foreground bg-card">
      <div class="grid grid-cols-[1.5rem_1fr_6rem_6rem_2.5rem_1fr] items-center gap-2 border-b-2 border-foreground/15 bg-muted/40 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
        <span></span>
        <span>Section</span>
        <span class="text-center">Spoken cue</span>
        <span class="text-center">Count-in</span>
        <span class="text-center">Lead</span>
        <span>Voice line</span>
      </div>
      {#each cueRows as c (c.id)}
        <div class="grid grid-cols-[1.5rem_1fr_6rem_6rem_2.5rem_1fr] items-center gap-2 border-b border-foreground/10 px-3 py-1.5 text-xs last:border-b-0">
          <span class="size-3 rounded-[2px]" style="background-color:{c.color}"></span>
          <span class="truncate font-bold uppercase tracking-wide">{c.label}</span>
          <span class="flex justify-center">
            <span class="inline-flex size-5 items-center justify-center border-2 {c.spoken ? 'border-foreground bg-foreground text-background' : 'border-foreground/30'}">
              {#if c.spoken}<Check class="size-3" aria-hidden="true" />{/if}
            </span>
          </span>
          <span class="flex justify-center">
            <span class="inline-flex size-5 items-center justify-center border-2 {c.countIn ? 'border-foreground bg-foreground text-background' : 'border-foreground/30'}">
              {#if c.countIn}<Check class="size-3" aria-hidden="true" />{/if}
            </span>
          </span>
          <span class="text-center font-mono text-[11px] text-muted-foreground tabular-nums">2</span>
          <span class="truncate font-mono text-[11px] text-muted-foreground">{c.spoken ? `“${c.label}”` : '—'}</span>
        </div>
      {/each}
    </div>
    <p class="text-[11px] text-muted-foreground">Each spoken cue is read a set number of beats before its section begins. Count-in adds clicks before the first downbeat.</p>
  </div>
{/snippet}

{#snippet lyricsBody()}
  <div class="grid min-h-full grid-cols-1 gap-3 p-3 md:grid-cols-2">
    <div class="flex min-h-0 flex-col gap-1.5">
      <span class="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Paste lyrics · draft {meta.draftLabel}</span>
      <textarea
        readonly
        class="min-h-[18rem] flex-1 resize-none border-2 border-foreground bg-background px-3 py-2 font-mono text-[13px] leading-relaxed focus:outline-none"
        spellcheck="false">{lyricLines.map((l) => l.text).join('\n')}</textarea>
    </div>
    <div class="flex min-h-0 flex-col gap-1.5">
      <span class="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Timed lines · {lyricLines.length} cleaned</span>
      <div class="min-h-[18rem] flex-1 overflow-y-auto border-2 border-foreground/30 bg-muted/25">
        {#each lyricLines as l (l.index)}
          <div class="flex items-center gap-2 border-b border-foreground/10 px-3 py-1.5 last:border-b-0">
            <span class="w-10 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{l.timeLabel}</span>
            <span class="inline-block size-1.5 shrink-0 rounded-full {l.index % 2 === 0 ? 'bg-[var(--studio-orange)]' : 'bg-foreground/25'}" title={l.index % 2 === 0 ? 'Aligned' : 'Not aligned'}></span>
            <span class="truncate text-[13px]">{l.text}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/snippet}

{#snippet leadsheetBody()}
  <div class="p-4">
    <div class="mx-auto max-w-5xl">
      <div class="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 border-foreground pb-3">
        <span class="font-display text-2xl uppercase tracking-tight">{meta.title}</span>
        <span class="text-sm text-muted-foreground">{meta.artist}</span>
        <span class="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{meta.keyLabel} · {meta.bpm} BPM · {meta.timeSignature}</span>
      </div>
      <div class="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
        {#each sectionGroups as g (g.id)}
          <div class="break-inside-avoid">
            <div class="mb-1 flex items-center gap-2">
              <span class="size-2.5 rounded-[2px]" style="background-color:{g.color}"></span>
              <span class="font-display text-[12px] uppercase tracking-wide">{g.label}</span>
              <span class="font-mono text-[10px] text-muted-foreground tabular-nums">{g.bars} bars</span>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm font-black leading-tight">
              {#each g.chords as c, i (i)}
                <span class="min-w-6">{c}</span>
              {/each}
            </div>
            {#if g.lyrics.length}
              <div class="mt-1.5 space-y-0.5 border-l-2 pl-2" style="border-color:{g.color}">
                {#each g.lyrics as l (l.index)}
                  <p class="text-[13px] leading-snug text-foreground/85">{l.text}</p>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/snippet}

<!-- ════════════════════════ mode inspectors ════════════════════════ -->

{#snippet gridInspector()}
  <div class="flex flex-col gap-3 p-3">
    {@render inspectorHeader('Selected bar')}
    <div class="flex items-center gap-2">
      <span class="size-3 rounded-[2px]" style="background-color:{selBar.color}"></span>
      <span class="font-display text-lg">Bar {selBar.number}</span>
      <span class="ml-auto font-mono text-lg font-black tabular-nums">{selBar.chord}</span>
    </div>
    <div class="space-y-1.5">
      {@render kv('Section', selBar.sectionLabel || selBar.kind)}
      {@render kv('Start', `${selBar.startSec.toFixed(2)}s`)}
      {@render kv('Meter', meta.timeSignature)}
      {@render kv('Beats', String(meta.beatsPerBar))}
    </div>
    <div class="mt-1 space-y-1.5">
      {@render inspectorHeader('Metronome')}
      {@render kv('Count-in', `${meta.beatsPerBar} beats`)}
      {@render kv('Pre-roll', `${(meta.beatsPerBar * (60 / meta.bpm)).toFixed(2)}s`)}
      {@render kv('Start at', 'bar 1 · beat 1')}
    </div>
    <div class="flex flex-wrap gap-1.5">
      <span class={CHIP}>Split bar</span>
      <span class={CHIP}>Merge</span>
      <span class={CHIP}>Beats 3</span>
      <span class={CHIP}>Beats 4</span>
    </div>
  </div>
{/snippet}

{#snippet sectionsInspector()}
  <div class="flex flex-col gap-3 p-3">
    {@render inspectorHeader('Selected section')}
    <div class="flex items-center gap-2">
      <span class="size-3 rounded-[2px]" style="background-color:{selGroup.color}"></span>
      <span class="font-display text-lg">{selGroup.label}</span>
    </div>
    <div class="space-y-1.5">
      {@render kv('Kind', selGroup.kind)}
      {@render kv('Bars', `${selGroup.fromBar}–${selGroup.toBar}`)}
      {@render kv('Count', String(selGroup.bars))}
      {@render kv('Length', selGroup.durLabel)}
    </div>
    <div class="space-y-2">
      {@render inspectorHeader('Change kind')}
      <div class="grid grid-cols-2 gap-1.5">
        {#each KIND_PALETTE as p (p.kind)}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 border-2 px-2 py-1 text-[11px] font-bold {p.kind === selGroup.kind
              ? 'border-foreground bg-foreground/5'
              : 'border-foreground/25 hover:border-foreground'}"
          >
            <span class="size-2.5 rounded-[2px]" style="background-color:{sectionKindColor(p.kind)}"></span>
            {p.label}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/snippet}

{#snippet chordsInspector()}
  <div class="flex flex-col gap-3 p-3">
    {@render inspectorHeader('Selected bar')}
    <div class="flex items-center gap-2">
      <span class="size-3 rounded-[2px]" style="background-color:{selBar.color}"></span>
      <span class="font-display text-lg">Bar {selBar.number}</span>
      <span class="ml-auto font-mono text-2xl font-black tabular-nums">{selBar.chord}</span>
    </div>
    {@render kv('Section', selBar.sectionLabel || selBar.kind)}
    <div class="space-y-2">
      {@render inspectorHeader('Suggestions · Chorus')}
      {#each ['G', 'D', 'Em', 'C'] as s, i (i)}
        <div class="flex items-center justify-between gap-2 border-2 border-dashed border-foreground/30 px-2 py-1">
          <span class="font-mono text-sm font-black">{s}</span>
          <span class="font-mono text-[10px] text-muted-foreground tabular-nums">{92 - i * 11}%</span>
        </div>
      {/each}
      <span class="inline-flex h-7 w-full items-center justify-center gap-1 border-2 border-foreground bg-foreground text-[11px] font-bold uppercase tracking-wide text-background">
        <Sparkles class="size-3" aria-hidden="true" />Use section suggestions (4)
      </span>
    </div>
  </div>
{/snippet}

<!-- ════════════════════════ page ════════════════════════ -->

<main class="v1 flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
  <!-- ── Persistent slim COMMAND BAR (all global controls) ── -->
  <header class="flex-none border-b-2 border-foreground bg-card">
    <!-- Row A: identity · transport · save-state -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5">
      <!-- identity -->
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 truncate font-display text-base uppercase tracking-tight">{meta.title}</span>
        <span class="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">{meta.artist}</span>
      </div>
      <span class={DIV} aria-hidden="true"></span>
      <div class="flex shrink-0 items-center gap-2 font-mono text-[11px] font-bold text-muted-foreground tabular-nums">
        <span class="text-foreground">{meta.keyLabel}</span>
        <span aria-hidden="true">·</span>
        <span class="text-foreground">{meta.bpm} BPM</span>
        <span aria-hidden="true">·</span>
        <span>{meta.timeSignature}</span>
      </div>
      <!-- transpose -->
      <div class="inline-flex shrink-0 items-center overflow-hidden border-2 border-foreground/35 bg-background font-mono text-[11px] font-black" aria-label="Song transpose">
        <span class="px-1.5 py-0.5 text-muted-foreground">−1</span>
        <span class="border-x border-foreground/25 px-2 py-0.5 text-center">0</span>
        <span class="px-1.5 py-0.5 text-muted-foreground">+1</span>
      </div>

      <!-- transport (global, always here) -->
      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="icon-sm" class="border-2" aria-label="Restart" title="Restart from start">
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          class="h-7 gap-1.5 border-2 border-foreground bg-[var(--studio-orange)] px-3 text-[12px] font-black uppercase tracking-wide text-[var(--studio-ink)] hover:bg-[var(--studio-orange)] hover:brightness-105"
          aria-label="Play"
        >
          <Play class="size-4" aria-hidden="true" />Play
        </Button>
        <Button variant="outline" size="icon-sm" class="border-2" aria-label="Stop" title="Stop">
          <Square class="size-3.5" aria-hidden="true" />
        </Button>
        <span class="ml-1 font-mono text-xs font-bold tabular-nums">{fmtTime(playheadSec)}<span class="text-muted-foreground"> / {meta.durationLabel}</span></span>
        <label class="ml-1 inline-flex h-7 cursor-pointer items-center gap-1.5 border-2 border-foreground/40 px-2 text-[11px] font-bold uppercase tracking-wide" title="Play a click alongside the song">
          <input type="checkbox" checked class="accent-foreground size-3" />Click
        </label>
        <span class="hidden items-center gap-1 lg:inline-flex" title="Volume">
          <Volume2 class="size-3.5 text-muted-foreground" aria-hidden="true" />
          <input type="range" min="0" max="1.5" step="0.01" value="1" class="accent-foreground h-1 w-16" aria-label="Master volume" />
        </span>
      </div>

      <span class={DIV} aria-hidden="true"></span>
      <!-- save-state + draft -->
      <div class="flex shrink-0 items-center gap-2">
        <span class="inline-flex h-7 items-center gap-1.5 border-2 border-foreground/30 bg-background px-2 text-[11px] font-bold" title="All changes saved at 18:30">
          <span class="size-1.5 rounded-full bg-emerald-500" aria-hidden="true"></span>Saved 18:30
        </span>
        <Button variant="outline" size="sm" class="h-7 gap-1.5 border-2 text-[11px] font-bold" aria-label="Draft: {meta.draftLabel}" title="Draft: {meta.draftLabel}">
          <Layers class="size-3.5" aria-hidden="true" />{meta.draftLabel}
        </Button>
      </div>
    </div>

    <!-- Row B: the 7 modes as a compact segmented mode-switch + contextual status -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t-2 border-foreground/15 px-3 py-1.5">
      {#each MODE_GROUPS as ids, gi (gi)}
        {@render segGroup(ids)}
        {#if gi === 0 || gi === 1}
          <span class="mx-0.5 hidden h-5 w-px bg-foreground/25 sm:inline-block" aria-hidden="true"></span>
        {/if}
      {/each}
      <span class="ml-auto flex items-center gap-2 font-mono text-[11px] text-muted-foreground tabular-nums">
        <span class="hidden text-[10px] font-black uppercase tracking-wide sm:inline">View</span>
        <span>bars {Math.floor(viewStart / barSec) + 1}–{Math.min(meta.bars, Math.ceil(viewEnd / barSec))}</span>
      </span>
    </div>
  </header>

  <!-- ── The SPINE: shared waveform/timeline, present on EVERY mode ── -->
  <div class="flex-none border-b-2 border-foreground bg-background px-2 py-2">
    <DebugSharedWaveform
      bind:viewStart
      bind:viewEnd
      sections={waveformSections}
      bars={meta.bars}
      durationSec={DURATION_SEC}
      {playheadSec}
    />
  </div>

  <!-- ── Active mode's tool surface: flat toolbar + working content (+inspector) ── -->
  <div class="flex min-h-0 flex-1 flex-col">
    {#if mode === 'overview'}
      {@render toolbar('Mix', 'Original audio, stems and cues load as separate lanes. Volume, mute and solo are saved with the song and every lane stays aligned for playback and export.', overviewControls)}
    {:else if mode === 'grid'}
      {@render toolbar('Grid', 'Edit bars and beats: select a bar, then split, merge or change its beat count. Everything you hear plays back through the same grid the export uses.', gridControls)}
    {:else if mode === 'sections'}
      {@render toolbar('Sections', 'Tag stretches of the song as intro / verse / chorus. Multi-select bars, then apply a kind — the colours match the pads and the exported setlist.', sectionsControls)}
    {:else if mode === 'chords'}
      {@render toolbar('Chords', 'Place a chord on any beat. Suggestions from the harmony analysis appear as ghosts you can accept per section.', chordsControls)}
    {:else if mode === 'cue'}
      {@render toolbar('Cue', 'Per section, toggle a spoken cue and/or a count-in. Auto-generate reads each section name just before it starts.', cueControls)}
    {:else if mode === 'lyrics'}
      {@render toolbar('Lyrics', 'Lyrics belong to the current draft. Save stores the text; fitting each word to the audio is a separate, optional step.', lyricsControls)}
    {:else}
      {@render toolbar('Lead sheet', 'A read-only performance view of the saved song: sections, chords, lyrics, key and timing all come from the editor data.', leadsheetControls)}
    {/if}

    <div class="flex min-h-0 flex-1">
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {#if mode === 'overview'}
          {@render overviewBody()}
        {:else if mode === 'grid'}
          {@render gridBody()}
        {:else if mode === 'sections'}
          {@render sectionsBody()}
        {:else if mode === 'chords'}
          {@render chordsBody()}
        {:else if mode === 'cue'}
          {@render cueBody()}
        {:else if mode === 'lyrics'}
          {@render lyricsBody()}
        {:else}
          {@render leadsheetBody()}
        {/if}
      </div>

      {#if showInspector}
        <aside class="hidden w-64 flex-none overflow-y-auto border-l-2 border-foreground bg-card lg:block">
          {#if mode === 'grid'}
            {@render gridInspector()}
          {:else if mode === 'sections'}
            {@render sectionsInspector()}
          {:else}
            {@render chordsInspector()}
          {/if}
        </aside>
      {/if}
    </div>
  </div>
</main>

<style>
  /* Match the editor's card fill for the workspace surfaces. */
  .v1 :global(input[type='range']) {
    cursor: pointer;
  }
</style>
