# Song Edit — design exploration

Five structurally different design directions for BarBro's **Song Edit** page, built as
read-only prototypes so we can compare information architecture, density, navigation and
cross-tab consistency side by side — then pull the strongest ideas into the real editor.

## How to view

Sign in, then open the hub and flip between versions with the floating switcher:

| Route | Version |
|---|---|
| [`/debug/song-editor`](src/routes/debug/song-editor/+page.svelte) | Index / gallery |
| [`/debug/song-editor/version-1`](src/routes/debug/song-editor/version-1/+page.svelte) | 1 · Compact DAW workspace |
| [`/debug/song-editor/version-2`](src/routes/debug/song-editor/version-2/+page.svelte) | 2 · Three-pane inspector IDE |
| [`/debug/song-editor/version-3`](src/routes/debug/song-editor/version-3/+page.svelte) | 3 · Persistent waveform, tabs as layers |
| [`/debug/song-editor/version-4`](src/routes/debug/song-editor/version-4/+page.svelte) | 4 · Aligned-lane arrangement |
| [`/debug/song-editor/version-5`](src/routes/debug/song-editor/version-5/+page.svelte) | 5 · Document + pinned timeline |

They render **under the real app navbar** (they're `/debug` routes), so each is a true
preview of the page content in context.

## Method & grounding

- **Real data model.** Every version renders the same realistic `SongMap` fixture
  ([`src/lib/debug/songEditorFixture.ts`](src/lib/debug/songEditorFixture.ts)) — "Dum av dig",
  122 BPM, G major, **96 bars / 384 beats, 8 sections, per-bar chords, 22 timed lyric lines,
  a cue track, and mixer lanes** — shaped to the production types, not an invented model.
  Lyric text is original placeholder filler (realistic length, no real song's words).
- **Shared interactive waveform.** All versions reuse
  [`DebugSharedWaveform.svelte`](src/lib/components/DebugSharedWaveform.svelte) — a real
  zoom / pan / minimap waveform whose viewport (`viewStart`/`viewEnd`) is **page-owned**, so
  the "one shared global navigation" idea (zoom into the chorus, switch mode, stay put) is
  actually demonstrable in each.
- **Reused production primitives.** `Button`, `HelpHint`, lucide icons, `sectionKindColor`,
  plus the shared waveform. Store-coupled surfaces (the real `WaveformPlayer`/`MixerView`,
  which need `PlaybackController` and the `songMap` store) are reproduced read-only with the
  same neobrutalist classes rather than wired live — appropriate for a design prototype.
- **Grounded baseline.** [`/debug/edit-style/current`](src/routes/debug/edit-style/current/+page.svelte)
  is a faithful copy of today's `/edit` for before/after comparison.
- **Scope.** Read-only prototypes — controls exist visually; no state mutation. Effort went to
  layout, hierarchy, density, navigation and polish. Neobrutalist identity preserved throughout
  (`border-foreground`, `--studio-orange`, Arial Black display, mono readouts, hard shadows).

## Validation

- `npm run check` → **0 errors** across the whole project (4 pre-existing warnings, none in these files).
- All six routes SSR-resolve cleanly (they return the app's `303 → /welcome` auth gate when
  signed out, never a 500).
- **Screenshots not captured here:** the `/debug` auth gate redirects signed-out requests, so
  headless screenshots aren't possible in this environment. View signed-in to evaluate visually.

---

## Version 1 — Compact DAW workspace

**Thesis.** A producer's single-window tool, not a stack of dashboard cards. All global state
collapses into one slim command bar (condensed identity · transport · save-state · the 7 modes
as a segmented switch); the shared waveform is pinned directly beneath as a **permanent spine**;
everything below is the active mode's dense tool surface. The transport and timeline never move —
switching modes feels like changing a tool, not navigating to a page.

**Layout.** Command bar (Row A: identity, `key · BPM · time-sig`, transpose, transport, save +
draft; Row B: clustered mode switch `[Overview] · [Grid|Sections|Chords] · [Cue|Lyrics|Lead sheet]`
+ live `View bars N–M`) → the one waveform spine → a `flex-1` tool surface using a shared
`toolbar(label, help, controls)` grammar (flat strip, orange active tick, no boxes/big titles). A
264px right inspector rail appears only for grid/sections/chords at `lg+`.

**Strengths.** Maximal working area (chrome ≈ two 32px rows + spine). Genuinely persistent context.
Identical toolbar/inspector grammar across modes → feels like one instrument.

**Tradeoffs.** The spine's own mini-transport visually duplicates the command-bar transport (would
be suppressed in production). `h-full` single-window scroll assumes a height model. Inspector hidden
below `lg`. Overview mixer is intentionally shallow.

**Best ideas.** ① Command bar as the single home for everything global (kills the tall header).
② The permanent shared spine. ③ Clustered mode groups binding the three timeline modes + a context
inspector that only appears where editing benefits.

---

## Version 2 — Three-pane inspector IDE

**Thesis.** Reframe the editor as a fixed DAW-style **workbench that never reflows**: modes on a
left rail, one center workspace that swaps per mode, a persistent right inspector for all secondary
controls. The promise is **predictable placement** — the same tool is always in the same corner, so
switching modes changes *content*, never *chrome*.

**Layout.** Left **mode rail** (~88px) with modes grouped `Mix / Timeline / Perform` (surfacing the
waveform family) → **center workspace** (shared waveform on top for grid/sections/chords; full content
otherwise) → **right inspector** (~320px) that is genuinely different per mode (selection properties,
metadata, chord picker, cue toggles, …) and always ends with mode help. A slim top strip spans
center+right: transport, live `bars X–Y · zoom×` readout, and a `Saved · Synced` pill in the far corner.
A `focusBars()` link moves the shared viewport to the current selection.

**Strengths.** Reclaims all the header/tab vertical space. Selection drives both the inspector and the
playhead, so panes feel connected. Secondary controls leave the workspace → kills the 3-border nesting.

**Tradeoffs.** Fixed-height frame assumes a ~3.5rem navbar. Rail + 320px inspector narrows the
workspace on small laptops (horizontal scroll rather than reflow). Minor transport/mixer duplication.

**Best ideas.** ① Contextual inspector as the home for all secondary controls — the single biggest
"dashboard → IDE" move. ② Grouped mode rail naming the waveform family. ③ "Focus in waveform" tying an
inspector selection back to the shared viewport.

---

## Version 3 — Persistent waveform, tabs become layers

**Thesis.** Reject the tab-swap model outright. There is no tab bar. One shared timeline workspace is
always on screen around a single waveform that is mounted once and **never rebuilds**; the seven edit
functions become time-aligned **layers** (a DAW track column): grid, sections, chords, cue, lyrics —
all projected onto the same viewport and bar grid. Overview and Lead sheet (the only non-timeline
functions) are a docked mixer strip and a full-bleed overlay that leave the waveform mounted beneath.

**Layout.** Compact command bar → a **contextual tool row** that recolors to the active layer's accent
and swaps its controls per layer → the **workspace**: a left rail of DAW track-headers (eye toggle +
name + active dot) aligned row-for-row with lanes `Bars ruler → Grid → Sections → Audio (hero) →
Chords → Cue → Lyrics`, with one studio-orange playhead line stitched through every row. Adaptive
density (ruler step, beat ticks, chord labels, lyric text) keys off `barsInView`.

**Strengths.** The strongest expression of "one shared global navigation" — the viewport truly persists
and every layer reads as one coherent multi-track surface. Header + panels condensed to one command bar
+ one tool row.

**Tradeoffs.** The hero waveform sits in its own lanecell, ~2px inset from flat lanes (sub-0.5% drift).
Fixed 132px rail is tight on narrow screens. Lyrics is split across a lane (results) and a dock
(paste/fit). Point-marker (cue) lanes crowd at extreme zoom-out.

**Best ideas.** ① Left rail that IS both the layer panel AND the track-header column. ② A single playhead
threaded through every layer. ③ Contextual tool row keyed to the active layer's accent (the UI recolors
to what you're editing without moving the timeline). ④ Non-timeline modes as dock/overlay.

---

## Version 4 — Aligned-lane arrangement

**Thesis.** A DAW arrangement view. The whole song is a vertical stack of horizontally
**time-aligned lanes** sharing ONE ruler, zoom and scroll (a single page-owned viewport). Because
audio, bars, sections, chords, lyrics and cues line up to the same bars, their **relationships read at
a glance** — that alignment is the core value. The 7 tabs become "which lane is focused": the focused
lane doubles in height and reveals its inline tools.

**Layout.** Compact top bar (transport + playhead readout + identity + zoom) and a 7-chip lane selector.
A single 2-column grid: fixed ~190px left lane-header column (name, icon, eye, M/S for stems) beside the
shared body. Lanes: **Audio** (the waveform, master viewport) → **Ruler** → **Grid** → **Sections** →
**Chords** → **Lyrics** → **Cue** → **Mixer** (expands to per-stem mini-wave lanes when focused) →
**Lead sheet** (ribbon that expands to a full chart). A continuous orange playhead threads audio →
section → chord → lyric → cue; a faint section tint sits behind the lanes.

**Strengths.** One viewport keeps every lane in sync. Condensed header, dense-but-crisp grid. All 7
functions reachable two ways (lane-header or top-bar chip). Adaptive density from full-song to a few bars.

**Tradeoffs.** Playhead drawn per-lane, so lane borders create hairline breaks in the line. The
waveform's minimap spans the full song while other lanes track the viewport (a minor conceptual seam).
Expanding all stems grows vertical space → the page scrolls.

**Best ideas.** ① Lane-focus-as-tabs — the tab metaphor becomes physical (a lane grows and exposes an
inline inspector). ② Always-on aligned ruler + threaded playhead as the single navigation spine.
③ Per-lane visibility + collapsible stems group to tune arrangement density like a real DAW.

---

## Version 5 — Document + pinned timeline

**Thesis.** Treat the song as a smart musical **document**, not a DAW. A pinned top zone (compact
transport + slim scrubbable minimap) is the constant anchor; below it the primary canvas is a scrolling
**lead-sheet chart** that reads top-to-bottom. The seven functions are focused *tools* that reshape or
dock onto the always-visible document. Leans on typographic hierarchy, sections-as-navigation, and calm
density.

**Layout.** Pinned zone (`sticky top-0`, measured via `bind:clientHeight`): single-line masthead +
transport + a collapsible `DebugSharedWaveform` (degrades to a one-line `bars X–Y · zoom · playhead`
summary). Body = three columns: sticky left **Outline** (section list = navigation; click scrolls +
moves the playhead; a crosshair zooms the pinned timeline to that section), center **Document** (a paper
chart: colored section headings, **chords positioned over the lyric lines by real timing**, bar numbers
in the margin, instrumental sections as 4-bar chord staves), and a contextual right **Dock** per mode.

**Strengths.** A genuinely musician-readable chart from real timing. One persistent spatial anchor and
fast outline jumps. Far less border-stacking than today (one paper sheet + hairlines vs. 3-deep boxes).

**Tradeoffs.** The full waveform is tall for a "slim" pin (mitigated by collapse). Fine-grained bar/beat
grid editing is demoted to an inspector. Left outline + right dock hide on narrow screens (document-first).

**Best ideas.** ① Chords absolutely positioned over lyric lines from real timing, collapsing repeats to
changes like a real chart. ② Outline-as-navigation with a "zoom the timeline to this section" crosshair.
③ Collapsible pinned timeline that degrades to a mono status line. ④ Measured pin height feeding sticky
offsets + `scroll-margin-top` so smooth-scroll never lands under the pin.

---

## Comparison

Ratings are relative across these five (Low / Med / High), from the implementations + reports.

| Dimension | V1 DAW | V2 Inspector | V3 Layers | V4 Lanes | V5 Document |
|---|---|---|---|---|---|
| Information density | High | High | High | **Very high** | Med |
| Ease of navigation | High | High | Med | Med | **High** |
| Cross-tab consistency | High | **Very high** | **Very high** | High | Med |
| Waveform integration | High | High | **Very high** | **Very high** | Med |
| Learning curve | Low | Low–Med | **High** | High | **Low** |
| Visual clarity | High | High | Med (dense) | Med (dense) | **Very high** |
| Scalability (more modes/features) | Med | **High** | Med | Med | High |
| Implementation complexity | Low–Med | Med | High | **High** | Med |
| Keyboard suitability | Med | High | Med | Med | Med |
| Future-feature suitability | Med | **High** | High | High | Med |

## Strongest ideas (reusable regardless of the winning direction)

1. **One page-owned waveform viewport, shared across all modes** (every version). This is the single
   most valuable, lowest-risk change: it fixes "the waveform isn't global" and makes the timeline modes
   feel like one instrument. Adopt this first, independent of layout.
2. **A slim command bar that absorbs the header + transport + save-state + mode switch** (V1, V2, V4).
   Reclaims the vertical space the current header/tab box wastes.
3. **Secondary controls in a contextual inspector** (V2) instead of stacked bordered panels — the
   cleanest antidote to today's 3-border nesting and the biggest "dashboard → tool" shift.
4. **Modes as layers / focused lanes on a persistent timeline** (V3, V4) for the waveform family
   (grid / sections / chords / cue) — they genuinely share a timeline, so treating them as one surface
   is more honest than separate tabs.
5. **Chords positioned over lyrics from real timing + outline navigation** (V5) — the most readable
   representation of the actual chart, valuable for the Lyrics/Lead-sheet side even if the overall shell
   comes from another version.

## Assessment (no single winner forced)

- For the **quickest, safest win**: adopt idea (1) in the current page immediately, then (2)/(3) —
  i.e. evolve toward **V2's inspector model**, which scores highest on consistency and scalability while
  staying closest to today's structure.
- For the **most ambitious "feels like a real tool"** direction: **V3 (layers)** and **V4 (lanes)** are
  the boldest and best embody the DAW ambition, at a higher learning-curve and implementation cost.
- **V5 (document)** is the strongest for readability and for the lyrics/lead-sheet experience, and its
  chart + outline ideas are worth lifting even into a different shell.

A pragmatic path: **V2's shell** (rail + inspector + shared top strip) as the frame, carrying **V3/V4's
shared-timeline treatment** for the waveform modes and **V5's chords-over-lyrics chart** for
lyrics/lead-sheet.
