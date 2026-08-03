<script lang="ts">
  /**
   * Song Edit — design prototype VERSION 5: "Document + pinned timeline".
   *
   * A reading/writing hybrid that treats the song as a DOCUMENT, not a DAW.
   *
   *   • A PINNED top zone (compact transport + a slim, scrubable overview
   *     waveform/minimap via `DebugSharedWaveform`) is the constant spatial
   *     anchor. One page-owned `viewStart`/`viewEnd` drives it.
   *   • The main surface is a SCROLLING DOCUMENT: the song as a lead-sheet-style
   *     chart that reads top-to-bottom — colored section headings, chords
   *     positioned OVER the lyric lines, bar numbers in a left margin.
   *   • A left OUTLINE (the section list) jumps you to any section
   *     (sections-as-navigation).
   *   • The seven edit functions are reached via a slim contextual switch and
   *     shown as focused TOOLS that keep the document visible: Grid docks a
   *     bar/tempo inspector right, Cue puts markers in the left margin + a cue
   *     list, Mix docks a mixer strip, Sections makes the outline editable,
   *     Chords/Lyrics/Read reshape the chart itself.
   *
   * READ-ONLY: every control is visual. A single `mode` `$state` and an
   * `activeSectionId` `$state` are the only real behaviour; switching + outline
   * navigation work. All data comes from the shared production-shaped fixture.
   */
  import { browser } from '$app/environment'
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
    type EditTabId,
  } from '$lib/debug/songEditorFixture'
  import {
    Play,
    Square,
    Volume2,
    ChevronDown,
    ChevronUp,
    Music,
    Type,
    FileText,
    ListMusic,
    LayoutGrid,
    Megaphone,
    SlidersHorizontal,
    Sparkles,
    Hash,
    Plus,
    GripVertical,
    Pencil,
    RefreshCw,
    Repeat1,
    Crosshair,
    Clock,
  } from '@lucide/svelte'

  // ── Page state (the only real behaviour) ──────────────────────────────
  let mode = $state<EditTabId>('leadsheet')
  let activeSectionId = $state(sectionRows[0]!.id)
  let selectedBar = $state(9)
  let timelineOpen = $state(true)
  let clickOn = $state(true)

  // ONE page-owned waveform viewport (seconds). Persists across mode switches.
  let viewStart = $state(0)
  let viewEnd = $state(DURATION_SEC)

  // Measured height of the pinned zone → sticky offset for the rails + scroll
  // margin for section anchors. Layout sync only (not a state bridge).
  let pinnedH = $state(180)

  // ── Contextual mode switch: Document focuses + Tool focuses ────────────
  const MODE_INFO: Record<EditTabId, { label: string; icon: typeof Play; help: string }> = {
    leadsheet: { label: 'Read', icon: FileText, help: 'A clean performance chart — sections, chords over lyrics, nothing else. This is the document at rest.' },
    chords: { label: 'Chords', icon: Music, help: 'Chords sit above the lyric line where they change. The palette + suggestions dock on the right; accept a whole section at once.' },
    lyrics: { label: 'Lyrics', icon: Type, help: 'Paste lyrics on the right; the chart re-flows live. Word-timing status shows which lines are aligned to the audio.' },
    sections: { label: 'Sections', icon: ListMusic, help: 'The outline becomes editable — rename a section, change its kind colour, nudge its bar range, add or merge.' },
    grid: { label: 'Grid', icon: LayoutGrid, help: 'A compact bar & tempo inspector docks on the right. Pick a bar in the margin to see its beats, timing and chord.' },
    cue: { label: 'Cue', icon: Megaphone, help: 'Spoken cue + count-in markers appear in the document margin; the full cue list docks on the right.' },
    overview: { label: 'Mix', icon: SlidersHorizontal, help: 'Original audio, stems and cues as aligned lanes. Volume / mute / solo dock on the right, chart still in view.' },
  }
  const READ_MODES: EditTabId[] = ['leadsheet', 'chords', 'lyrics']
  const EDIT_MODES: EditTabId[] = ['sections', 'grid', 'cue', 'overview']

  const dockOpen = $derived(mode === 'chords' || mode === 'lyrics' || mode === 'grid' || mode === 'cue' || mode === 'overview')

  // ── Chart model: derive the lead-sheet document from the fixture ───────
  const BAR_SEC = DURATION_SEC / meta.bars
  const barIndexAt = (sec: number) => Math.min(meta.bars - 1, Math.max(0, Math.floor((sec + 1e-4) / BAR_SEC)))

  type ChordMark = { label: string; leftPct: number }
  type LyricRow = { type: 'lyric'; bar: number; text: string; chords: ChordMark[]; aligned: boolean; time: string }
  type StaffRow = { type: 'staff'; bar: number; cells: { number: number; chord: string; color: string }[] }
  type DocRow = LyricRow | StaffRow

  // Chords active across one lyric line, positioned by real timing. Collapses
  // repeated chords so only changes are drawn — the way a chart reads.
  function chordsOverLine(lineStart: number, lineEnd: number): ChordMark[] {
    const span = Math.max(0.001, lineEnd - lineStart)
    const start = barIndexAt(lineStart)
    const out: ChordMark[] = []
    for (let i = start; i < barCells.length; i++) {
      const b = barCells[i]!
      if (b.startSec >= lineEnd) break
      const leftPct = Math.max(0, Math.min(94, ((b.startSec - lineStart) / span) * 100))
      const prev = out.length ? out[out.length - 1]!.label : null
      if (b.chord !== prev) out.push({ label: b.chord, leftPct })
    }
    if (!out.length) out.push({ label: barCells[start]!.chord, leftPct: 0 })
    return out
  }

  const sectionStartSec = (fromBar: number) => barCells[fromBar - 1]?.startSec ?? 0
  const sectionEndSec = (toBar: number) => (toBar < meta.bars ? barCells[toBar]!.startSec : DURATION_SEC)

  const docSections = $derived(
    sectionRows.map((s) => {
      const startSec = sectionStartSec(s.fromBar)
      const endSec = sectionEndSec(s.toBar)
      const linesIn = lyricLines.filter((l) => l.startSec >= startSec - 0.01 && l.startSec < endSec - 0.01)
      const rows: DocRow[] = []
      if (linesIn.length) {
        linesIn.forEach((l, i) => {
          const next = linesIn[i + 1]
          const lineEnd = Math.min(next ? next.startSec : endSec, endSec)
          rows.push({
            type: 'lyric',
            bar: barCells[barIndexAt(l.startSec)]!.number,
            text: l.text,
            chords: chordsOverLine(l.startSec, lineEnd),
            aligned: l.index % 2 === 0,
            time: l.timeLabel,
          })
        })
      } else {
        const secBars = barCells.slice(s.fromBar - 1, s.toBar)
        for (let i = 0; i < secBars.length; i += 4) {
          const g = secBars.slice(i, i + 4)
          rows.push({
            type: 'staff',
            bar: g[0]!.number,
            cells: g.map((b) => ({ number: b.number, chord: b.chord, color: b.color })),
          })
        }
      }
      return { ...s, startSec, endSec, hasLyrics: linesIn.length > 0, rows }
    }),
  )

  const activeSection = $derived(docSections.find((s) => s.id === activeSectionId) ?? docSections[0]!)
  const playheadSec = $derived(activeSection ? Math.min(DURATION_SEC, activeSection.startSec + 2) : 0)
  const selBar = $derived(barCells[Math.min(barCells.length, Math.max(1, selectedBar)) - 1]!)
  const selBarSection = $derived(sectionRows.find((s) => selBar.number >= s.fromBar && selBar.number <= s.toBar))

  // Pinned-timeline read-outs.
  const viewBarStart = $derived(Math.floor(viewStart / BAR_SEC) + 1)
  const viewBarEnd = $derived(Math.min(meta.bars, Math.ceil(viewEnd / BAR_SEC)))
  const zoomX = $derived((DURATION_SEC / Math.max(0.001, viewEnd - viewStart)).toFixed(1))

  const alignedCount = $derived(lyricLines.filter((l) => l.index % 2 === 0).length)
  const ModeIcon = $derived(MODE_INFO[mode].icon)

  // ── Navigation (visual only) ──────────────────────────────────────────
  function selectSection(id: string) {
    activeSectionId = id
    if (browser) document.getElementById(`v5-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function zoomTimelineToSection(startSec: number, endSec: number) {
    viewStart = startSec
    viewEnd = endSec
  }
</script>

<svelte:head>
  <title>Song Editor · v5 Document + pinned timeline — BarBro lab</title>
</svelte:head>

<main class="v5 min-h-dvh w-full bg-background text-foreground">
  <!-- ══ PINNED ZONE: header + transport + slim overview waveform ══════ -->
  <div
    bind:clientHeight={pinnedH}
    class="sticky top-0 z-30 border-b-2 border-foreground bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
  >
    <div class="mx-auto w-full max-w-[1400px] px-3 sm:px-4 md:px-6">
      <!-- Row 1 · condensed masthead -->
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-2.5">
        <h1 class="font-display truncate text-xl leading-none tracking-tight sm:text-2xl">{meta.title}</h1>
        <span class="text-muted-foreground truncate text-sm">{meta.artist}</span>
        <span
          class="border-foreground/40 text-muted-foreground inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          title="Active draft"
        >
          <Pencil class="size-3" aria-hidden="true" /> {meta.draftLabel}
        </span>
        <div class="text-muted-foreground ml-auto flex items-center gap-x-2.5 font-mono text-[11px] tabular-nums">
          <span>{meta.bpm} BPM</span>
          <span class="text-muted-foreground/40" aria-hidden="true">·</span>
          <span>{meta.keyLabel}</span>
          <span class="text-muted-foreground/40" aria-hidden="true">·</span>
          <span class="border-foreground/30 inline-flex items-center overflow-hidden border text-[10px] font-black" aria-label="Transpose">
            <span class="px-1.5 py-0.5">-1</span>
            <span class="border-foreground/20 border-x px-1.5 py-0.5 text-center">0</span>
            <span class="px-1.5 py-0.5">+1</span>
          </span>
        </div>
      </div>

      <!-- Row 2 · transport + contextual mode switch -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
        <div class="flex items-center gap-1.5">
          <Button size="sm" class="h-7 w-7 p-0" aria-label="Play"><Play class="size-4" aria-hidden="true" /></Button>
          <Button variant="outline" size="sm" class="h-7 w-7 p-0" aria-label="Stop"><Square class="size-3.5" aria-hidden="true" /></Button>
          <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2" title="Replay active section once">
            <Repeat1 class="size-3.5" aria-hidden="true" /> 1×
          </Button>
          <label
            class="border-foreground/40 ml-1 inline-flex h-7 cursor-pointer items-center gap-1.5 border px-2 text-[11px] font-bold uppercase tracking-wide {clickOn ? 'bg-foreground text-background' : ''}"
            title="Play the click track"
          >
            <input type="checkbox" bind:checked={clickOn} class="accent-foreground size-3" /> Click
          </label>
          <span class="border-foreground/40 text-muted-foreground inline-flex h-7 items-center gap-1 border px-2 text-[11px] font-bold uppercase tracking-wide" title="Count-in">
            <Hash class="size-3" aria-hidden="true" /> 4
          </span>
          <span class="border-foreground/40 text-muted-foreground ml-1 inline-flex h-7 items-center gap-1 border px-2" title="Volume">
            <Volume2 class="size-3.5" aria-hidden="true" />
          </span>
          <span class="font-mono text-xs tabular-nums">
            <span class="font-bold">{fmtTime(playheadSec)}</span>
            <span class="text-muted-foreground"> / {meta.durationLabel}</span>
          </span>
        </div>

        <!-- The slim contextual switch: Document focuses | Tool focuses -->
        <div class="ml-auto flex items-center gap-1.5" role="tablist" aria-label="Edit mode">
          <span class="text-muted-foreground mr-0.5 hidden text-[9px] font-black uppercase tracking-widest sm:inline">Read</span>
          <div class="border-foreground inline-flex overflow-hidden border">
            {#each READ_MODES as id (id)}
              {@const Icon = MODE_INFO[id].icon}
              <button
                type="button"
                role="tab"
                aria-selected={mode === id}
                class="inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-bold transition-colors {mode === id
                  ? 'bg-foreground text-background'
                  : 'hover:bg-foreground/10'}"
                onclick={() => (mode = id)}
              >
                <Icon class="size-3.5" aria-hidden="true" /> {MODE_INFO[id].label}
              </button>
            {/each}
          </div>
          <span class="text-muted-foreground ml-1 mr-0.5 hidden text-[9px] font-black uppercase tracking-widest sm:inline">Edit</span>
          <div class="border-foreground inline-flex overflow-hidden border">
            {#each EDIT_MODES as id (id)}
              {@const Icon = MODE_INFO[id].icon}
              <button
                type="button"
                role="tab"
                aria-selected={mode === id}
                class="inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-bold transition-colors {mode === id
                  ? 'bg-foreground text-background'
                  : 'hover:bg-foreground/10'}"
                onclick={() => (mode = id)}
              >
                <Icon class="size-3.5" aria-hidden="true" /> {MODE_INFO[id].label}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Row 3 · pinned overview waveform / minimap (collapsible) -->
      {#if timelineOpen}
        <div class="pb-2.5">
          <DebugSharedWaveform
            bind:viewStart
            bind:viewEnd
            sections={waveformSections}
            bars={meta.bars}
            durationSec={DURATION_SEC}
            {playheadSec}
          />
          <div class="mt-1 flex items-center justify-between">
            <p class="text-muted-foreground text-[10px]">
              Pinned timeline — always visible. Scrub / zoom here; the document below stays in place.
            </p>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide"
              onclick={() => (timelineOpen = false)}
            >
              <ChevronUp class="size-3.5" aria-hidden="true" /> Collapse
            </button>
          </div>
        </div>
      {:else}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-1.5 text-[11px]"
          onclick={() => (timelineOpen = true)}
        >
          <ChevronDown class="size-3.5" aria-hidden="true" />
          <span class="font-bold uppercase tracking-wide">Timeline</span>
          <span class="font-mono tabular-nums">bars {viewBarStart}–{viewBarEnd} · {zoomX}× · playhead {fmtTime(playheadSec)}</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- ══ BODY: outline · document · contextual dock ═══════════════════ -->
  <div class="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-4 md:px-6">
    <div class="flex items-start gap-4">
      <!-- ── LEFT OUTLINE (sections-as-navigation) ─────────────────── -->
      <aside
        class="sticky hidden w-52 shrink-0 self-start md:block lg:w-56"
        style="top: {pinnedH + 12}px; max-height: calc(100dvh - {pinnedH + 32}px)"
      >
        <div class="brutalist-shadow border-foreground bg-card flex max-h-full flex-col border-2">
          <div class="border-foreground/15 flex items-center justify-between border-b px-2.5 py-1.5">
            <span class="text-muted-foreground text-[10px] font-black uppercase tracking-widest">Outline</span>
            <span class="text-muted-foreground font-mono text-[10px] tabular-nums">{sectionRows.length}</span>
          </div>
          <nav class="min-h-0 flex-1 overflow-y-auto p-1.5">
            {#each docSections as s (s.id)}
              <div class="group relative">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-[var(--radius)] px-1.5 py-1.5 text-left transition-colors {activeSectionId === s.id
                    ? 'bg-foreground/10'
                    : 'hover:bg-foreground/5'}"
                  onclick={() => selectSection(s.id)}
                >
                  <span class="h-6 w-1.5 shrink-0 rounded-[1px]" style="background-color: {s.color}"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs font-bold {activeSectionId === s.id ? '' : ''}">{s.label}</span>
                    <span class="text-muted-foreground block font-mono text-[10px] tabular-nums">
                      bars {s.fromBar}–{s.toBar} · {fmtTime(s.startSec)}
                    </span>
                  </span>
                  {#if mode === 'cue' && cueRows[docSections.indexOf(s)]?.spoken}
                    <Megaphone class="text-muted-foreground size-3 shrink-0" aria-hidden="true" />
                  {/if}
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground absolute right-1 top-1.5 hidden rounded-[var(--radius)] p-1 group-hover:block"
                  title="Zoom the pinned timeline to this section"
                  onclick={() => zoomTimelineToSection(s.startSec, s.endSec)}
                >
                  <Crosshair class="size-3.5" aria-hidden="true" />
                </button>

                {#if mode === 'sections'}
                  <!-- Sections mode: the outline becomes editable -->
                  <div class="mb-1 ml-3 mr-1 flex items-center gap-1 pb-1">
                    <span class="border-foreground/30 size-4 shrink-0 rounded-[2px] border" style="background-color: {s.color}" title="Section colour"></span>
                    <input
                      value={s.label}
                      class="border-foreground/25 bg-background min-w-0 flex-1 border px-1 py-0.5 text-[11px]"
                      aria-label="Rename section"
                    />
                    <GripVertical class="text-muted-foreground/50 size-3.5 shrink-0" aria-hidden="true" />
                  </div>
                {/if}
              </div>
            {/each}
          </nav>
          {#if mode === 'sections'}
            <div class="border-foreground/15 flex gap-1.5 border-t p-1.5">
              <Button variant="outline" size="xs" class="h-6 flex-1 gap-1 text-[10px]"><Plus class="size-3" aria-hidden="true" /> Add</Button>
              <Button variant="outline" size="xs" class="h-6 flex-1 text-[10px]">Merge</Button>
            </div>
          {/if}
        </div>
      </aside>

      <!-- ── CENTER DOCUMENT: the lead-sheet chart ─────────────────── -->
      <div class="min-w-0 flex-1">
        <article class="brutalist-shadow border-foreground bg-card border-2 px-4 py-5 sm:px-7 sm:py-8">
          <div class="mx-auto max-w-3xl">
            <!-- Chart masthead -->
            <header class="border-foreground/20 mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 pb-3">
              <span class="font-display text-2xl leading-none tracking-tight sm:text-3xl">{meta.title}</span>
              <span class="text-muted-foreground text-sm">{meta.artist}</span>
              <span class="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
                {meta.keyLabel} · {meta.timeSignature} · {meta.bpm} BPM · {meta.durationLabel}
              </span>
            </header>

            <!-- Mode hint (calm, one line) -->
            <div class="text-muted-foreground mb-5 flex items-center gap-1.5 text-[11px]">
              <span class="text-foreground font-black uppercase tracking-wide">{MODE_INFO[mode].label}</span>
              <span aria-hidden="true">·</span>
              <span class="min-w-0 flex-1 truncate">{MODE_INFO[mode].help}</span>
              <HelpHint label="{MODE_INFO[mode].label} help" text={MODE_INFO[mode].help} side="left" />
            </div>

            <!-- The chart body: sections top-to-bottom -->
            <div class="space-y-7">
              {#each docSections as s (s.id)}
                <section
                  id="v5-sec-{s.id}"
                  style="scroll-margin-top: {pinnedH + 16}px"
                  class="scroll-mt-0 {activeSectionId === s.id ? '' : ''}"
                >
                  <!-- Section heading -->
                  <div
                    class="mb-2 flex items-center gap-2 border-l-4 pl-2.5 {activeSectionId === s.id ? 'opacity-100' : 'opacity-95'}"
                    style="border-color: {s.color}"
                  >
                    {#if mode === 'cue'}
                      <span
                        class="inline-flex items-center gap-1"
                        title={cueRows[docSections.indexOf(s)]?.spoken ? 'Spoken cue on' : 'No spoken cue'}
                      >
                        {#if cueRows[docSections.indexOf(s)]?.spoken}
                          <Megaphone class="size-3.5" style="color: {s.color}" aria-hidden="true" />
                        {/if}
                        {#if cueRows[docSections.indexOf(s)]?.countIn}
                          <Hash class="text-muted-foreground size-3.5" aria-hidden="true" />
                        {/if}
                      </span>
                    {/if}
                    <h2 class="font-display text-sm uppercase tracking-widest">{s.label}</h2>
                    <span class="text-muted-foreground font-mono text-[10px] tabular-nums">
                      bars {s.fromBar}–{s.toBar} · {fmtTime(s.startSec)}
                    </span>
                    {#if mode === 'sections'}
                      <button type="button" class="text-muted-foreground hover:text-foreground ml-1" title="Edit section">
                        <Pencil class="size-3.5" aria-hidden="true" />
                      </button>
                    {/if}
                    {#if mode === 'cue' && cueRows[docSections.indexOf(s)]?.spoken}
                      <span class="text-muted-foreground ml-auto truncate font-mono text-[10px]">“{s.label}”</span>
                    {/if}
                  </div>

                  <!-- Section rows -->
                  <div class="space-y-2.5">
                    {#each s.rows as row, ri (ri)}
                      {#if row.type === 'lyric'}
                        <div class="flex items-stretch gap-3">
                          <!-- bar-number margin -->
                          <button
                            type="button"
                            class="text-muted-foreground w-8 shrink-0 pt-4 text-right font-mono text-[10px] tabular-nums hover:text-foreground {mode === 'grid' && selBar.number === row.bar ? 'text-foreground font-bold' : ''}"
                            onclick={() => (selectedBar = row.bar)}
                            title="Bar {row.bar}"
                          >
                            {row.bar}
                          </button>
                          <div class="min-w-0 flex-1">
                            <!-- chords positioned OVER the lyric line -->
                            <div class="relative h-4">
                              {#each row.chords as c (c.leftPct + c.label)}
                                <span
                                  class="absolute top-0 -translate-x-1/2 font-mono text-[12px] font-black leading-none {mode === 'chords'
                                    ? 'text-[color:var(--studio-orange)]'
                                    : 'text-foreground'} {mode === 'chords' ? 'rounded-[2px] px-0.5 ring-1 ring-foreground/15' : ''}"
                                  style="left: max(0.4rem, {c.leftPct}%)"
                                >{c.label}</span>
                              {/each}
                            </div>
                            <!-- lyric line -->
                            <p
                              class="text-[15px] leading-snug {mode === 'lyrics' && !row.aligned ? 'text-muted-foreground [text-decoration:underline_dotted] underline-offset-4' : ''} {mode === 'lyrics' ? 'hover:bg-foreground/5' : ''}"
                            >
                              {row.text}
                              {#if mode === 'lyrics'}
                                <span class="text-muted-foreground ml-1 font-mono text-[9px] tabular-nums">{row.time}{row.aligned ? '' : ' ~'}</span>
                              {/if}
                            </p>
                          </div>
                        </div>
                      {:else}
                        <!-- instrumental chord staff (bars in groups of four) -->
                        <div class="flex items-stretch gap-3">
                          <span class="text-muted-foreground w-8 shrink-0 pt-2 text-right font-mono text-[10px] tabular-nums">{row.bar}</span>
                          <div class="grid min-w-0 flex-1 grid-cols-4 gap-2">
                            {#each row.cells as cell (cell.number)}
                              <button
                                type="button"
                                class="border-foreground/15 flex flex-col border-l-2 bg-foreground/[0.02] px-2 py-1.5 text-left transition-colors hover:bg-foreground/5 {mode === 'grid' && selBar.number === cell.number ? 'ring-1 ring-foreground' : ''}"
                                style="border-color: {cell.color}"
                                onclick={() => (selectedBar = cell.number)}
                              >
                                <span class="text-muted-foreground font-mono text-[9px] tabular-nums">{cell.number}</span>
                                <span class="font-mono text-base font-black leading-tight">{cell.chord}</span>
                              </button>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    {/each}
                  </div>
                </section>
              {/each}
            </div>

            <!-- Chart footer -->
            <footer class="border-foreground/15 text-muted-foreground mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 font-mono text-[10px] tabular-nums">
              <span>{meta.bars} bars</span>
              <span>{sectionRows.length} sections</span>
              <span>{lyricLines.length} lyric lines</span>
              <span>{alignedCount} aligned</span>
              <span class="ml-auto">Read-only performance chart — derived from the saved song map</span>
            </footer>
          </div>
        </article>
      </div>

      <!-- ── RIGHT DOCK: focused tool, document stays visible ──────── -->
      {#if dockOpen}
        <aside
          class="sticky hidden w-72 shrink-0 self-start lg:block xl:w-80"
          style="top: {pinnedH + 12}px; max-height: calc(100dvh - {pinnedH + 32}px)"
        >
          <div class="brutalist-shadow border-foreground bg-card flex max-h-full flex-col border-2">
            <div class="border-foreground/15 flex items-center gap-1.5 border-b px-2.5 py-2">
              <ModeIcon class="size-3.5" aria-hidden="true" />
              <span class="text-muted-foreground text-[10px] font-black uppercase tracking-widest">
                {mode === 'chords' ? 'Chord tools' : mode === 'lyrics' ? 'Lyrics' : mode === 'grid' ? 'Bar & tempo' : mode === 'cue' ? 'Cue list' : 'Mix'}
              </span>
              <HelpHint label="Tool help" text={MODE_INFO[mode].help} side="left" class="ml-auto" />
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto p-2.5">
              {#if mode === 'chords'}
                <!-- Chord palette + suggestions -->
                <div class="space-y-3">
                  <div>
                    <div class="text-muted-foreground mb-1 text-[10px] font-bold uppercase tracking-wide">Song key</div>
                    <div class="flex items-center gap-1.5 text-xs">
                      <span class="border-foreground bg-background border-2 px-2 py-1 font-mono font-black">G</span>
                      <span class="border-foreground/40 border px-2 py-1">natural</span>
                      <span class="border-foreground/40 border px-2 py-1">major</span>
                    </div>
                  </div>
                  <div>
                    <div class="text-muted-foreground mb-1 text-[10px] font-bold uppercase tracking-wide">Palette</div>
                    <div class="grid grid-cols-4 gap-1.5">
                      {#each ['G', 'D', 'Em', 'C', 'Am', 'D7', 'Bm', 'A'] as ch (ch)}
                        <button type="button" class="border-foreground/40 hover:bg-foreground hover:text-background border px-1 py-1.5 text-center font-mono text-sm font-black">{ch}</button>
                      {/each}
                    </div>
                  </div>
                  <div class="border-foreground/15 border-t pt-2.5">
                    <label class="flex items-center gap-2 text-xs font-bold">
                      <input type="checkbox" checked class="accent-foreground size-3.5" /> Show suggestions
                    </label>
                    <div class="border-foreground/25 bg-foreground/[0.03] mt-2 flex items-center gap-2 border p-2 text-xs">
                      <Sparkles class="size-4 shrink-0" style="color: {sectionKindColor('chorus')}" aria-hidden="true" />
                      <span class="min-w-0"><span class="font-bold">Chorus</span> — 4 chords suggested from the analysis</span>
                    </div>
                    <Button variant="default" size="sm" class="mt-2 h-7 w-full text-[11px]">Use section suggestions (4)</Button>
                    <Button variant="outline" size="sm" class="mt-1.5 h-7 w-full text-[11px]">Finish section</Button>
                  </div>
                </div>
              {:else if mode === 'lyrics'}
                <!-- Paste + word-timing status -->
                <div class="space-y-2.5">
                  <div class="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">Paste lyrics</div>
                  <textarea
                    rows="10"
                    class="border-foreground bg-background w-full resize-y border-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed"
                    spellcheck="false">{lyricLines.map((l) => l.text).join('\n')}</textarea>
                  <div class="flex gap-1.5">
                    <Button variant="outline" size="sm" class="h-7 flex-1 text-[11px]">Save lyrics</Button>
                    <Button variant="default" size="sm" class="h-7 flex-1 text-[11px]">Fit to song</Button>
                  </div>
                  <div class="border-foreground/15 space-y-1.5 border-t pt-2.5 text-[11px]">
                    <div class="flex items-center justify-between">
                      <span class="text-muted-foreground">Word timing</span>
                      <span class="font-mono tabular-nums">{alignedCount}/{lyricLines.length} lines</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="inline-flex items-center gap-1"><span class="bg-foreground inline-block h-2 w-4"></span> aligned</span>
                      <span class="text-muted-foreground inline-flex items-center gap-1"><span class="inline-block h-2 w-4 [border-bottom:1px_dotted_currentColor]"></span> not fitted</span>
                    </div>
                  </div>
                </div>
              {:else if mode === 'grid'}
                <!-- Bar & tempo inspector -->
                <div class="space-y-3">
                  <div class="grid grid-cols-2 gap-2 text-xs">
                    <div class="border-foreground/20 border p-2">
                      <div class="text-muted-foreground text-[9px] font-bold uppercase tracking-wide">Tempo</div>
                      <div class="font-mono text-lg font-black tabular-nums">{meta.bpm}</div>
                    </div>
                    <div class="border-foreground/20 border p-2">
                      <div class="text-muted-foreground text-[9px] font-bold uppercase tracking-wide">Meter</div>
                      <div class="font-mono text-lg font-black tabular-nums">{meta.timeSignature}</div>
                    </div>
                  </div>
                  <div class="border-foreground/25 bg-foreground/[0.03] border p-2.5">
                    <div class="mb-1 flex items-center justify-between">
                      <span class="text-muted-foreground text-[9px] font-bold uppercase tracking-wide">Selected bar</span>
                      <span class="font-mono text-sm font-black tabular-nums">{selBar.number}</span>
                    </div>
                    <dl class="space-y-1 font-mono text-[11px] tabular-nums">
                      <div class="flex justify-between"><dt class="text-muted-foreground">Section</dt><dd>{selBarSection?.label ?? '—'}</dd></div>
                      <div class="flex justify-between"><dt class="text-muted-foreground">Chord</dt><dd class="font-black">{selBar.chord}</dd></div>
                      <div class="flex justify-between"><dt class="text-muted-foreground">Start</dt><dd>{fmtTime(selBar.startSec)} · {selBar.startSec.toFixed(2)}s</dd></div>
                      <div class="flex justify-between"><dt class="text-muted-foreground">Beats</dt><dd>{meta.beatsPerBar}</dd></div>
                    </dl>
                    <div class="mt-2 flex gap-1">
                      {#each Array(meta.beatsPerBar) as _, bi (bi)}
                        <div class="h-6 flex-1 border-b-2 {bi === 0 ? 'bg-foreground/20 border-foreground' : 'bg-foreground/5 border-foreground/30'}" title="Beat {bi + 1}{bi === 0 ? ' (downbeat)' : ''}"></div>
                      {/each}
                    </div>
                  </div>
                  <fieldset class="border-foreground/20 border p-2">
                    <legend class="text-muted-foreground px-1 text-[9px] font-bold uppercase tracking-wide">Count-in</legend>
                    <div class="flex gap-3 pt-1 text-xs">
                      {#each [0, 4, 8] as n (n)}
                        <label class="flex items-center gap-1"><input type="radio" name="v5ci" checked={n === 4} class="accent-foreground" />{n === 0 ? 'Off' : n}</label>
                      {/each}
                    </div>
                  </fieldset>
                  <div class="flex gap-1.5">
                    <Button variant="outline" size="sm" class="h-7 flex-1 gap-1 text-[11px]"><RefreshCw class="size-3" aria-hidden="true" /> Re-analyze</Button>
                    <Button variant="outline" size="sm" class="h-7 flex-1 text-[11px]">Reset grid</Button>
                  </div>
                </div>
              {:else if mode === 'cue'}
                <!-- Cue list -->
                <div class="space-y-2.5">
                  <div class="flex flex-wrap items-center gap-1">
                    <span class="text-muted-foreground mr-1 text-[9px] font-black uppercase tracking-wide">Voice</span>
                    <span class="border-foreground bg-foreground text-background border px-1.5 py-0.5 text-[10px] font-bold">Lead vox</span>
                    <span class="border-foreground/40 border px-1.5 py-0.5 text-[10px] font-bold">Guitar</span>
                    <span class="border-foreground/40 border px-1.5 py-0.5 text-[10px] font-bold">+ Add</span>
                  </div>
                  <div class="border-foreground/20 divide-foreground/12 divide-y border">
                    {#each cueRows as c (c.id)}
                      <div class="flex items-center gap-2 px-2 py-1.5">
                        <span class="size-2.5 shrink-0 rounded-[2px]" style="background-color: {c.color}"></span>
                        <span class="w-20 shrink-0 truncate text-[11px] font-bold uppercase tracking-wide">{c.label}</span>
                        <label class="flex items-center gap-1 text-[10px]" title="Spoken cue"><input type="checkbox" checked={c.spoken} class="accent-foreground size-3" /><Megaphone class="size-3" aria-hidden="true" /></label>
                        <label class="ml-auto flex items-center gap-1 text-[10px]" title="Count-in"><input type="checkbox" checked={c.countIn} class="accent-foreground size-3" /><Hash class="size-3" aria-hidden="true" /></label>
                      </div>
                    {/each}
                  </div>
                  <Button variant="default" size="sm" class="h-7 w-full text-[11px]">Auto-generate cues</Button>
                </div>
              {:else if mode === 'overview'}
                <!-- Mixer strip -->
                <div class="space-y-1.5">
                  <div class="text-muted-foreground mb-1 flex items-center justify-between text-[10px]">
                    <span class="font-mono tabular-nums">{mixerLanes.length} tracks</span>
                    <button type="button" class="hover:text-foreground inline-flex items-center gap-1 font-bold uppercase tracking-wide"><RefreshCw class="size-3" aria-hidden="true" /> Reload</button>
                  </div>
                  {#each mixerLanes as lane (lane.key)}
                    <div class="border-foreground/25 bg-background flex items-center gap-1.5 border px-1.5 py-1.5">
                      <span class="size-2.5 shrink-0 rounded-[2px]" style="background-color: {lane.color}"></span>
                      <span class="min-w-0 flex-1 truncate text-[11px] font-semibold">{lane.label}</span>
                      <button type="button" class="border-foreground/40 size-5 shrink-0 border text-[9px] font-black {lane.muted ? 'bg-foreground text-background' : ''}" title="Mute">M</button>
                      <button type="button" class="border-foreground/40 size-5 shrink-0 border text-[9px] font-black {lane.solo ? 'bg-amber-400' : ''}" title="Solo">S</button>
                      <span class="text-muted-foreground w-9 shrink-0 text-right font-mono text-[10px] tabular-nums">{lane.db} dB</span>
                    </div>
                  {/each}
                  <div class="border-foreground/15 text-muted-foreground mt-2 border-t pt-2 text-[10px] leading-relaxed">
                    <Clock class="mr-1 inline size-3 align-[-2px]" aria-hidden="true" />
                    Volume, mute and solo save with the song; every lane stays aligned for playback and export.
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </aside>
      {/if}
    </div>
  </div>
</main>
