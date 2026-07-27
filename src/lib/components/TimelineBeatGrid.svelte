<script lang="ts">
  /**
   * Bar strip: grid = bar + wheel beats; sections = multi-select + tints; chords = per-beat chord labels + selection.
   */
  import { onDestroy } from 'svelte'
  import { clientXToTimeInView, timeToPxInView } from '$lib/audio/timeGeometry'
  import type { BarGridAction } from '$lib/songmap/timelineEdit'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import type { Bar, Beat, Section, SectionKind } from '$lib/songmap/types'
  import { beginPatchBatch, endPatchBatch } from '$lib/stores/songMap'

  /** Inline preview of an unaccepted suggested next section. */
  export type SuggestionPreview = {
    kind: SectionKind
    label: string
    /** Inclusive bar indices for the preview range. */
    startBarIndex: number
    endBarIndex: number
  }

  /**
   * Audio-derived candidate where a new section *might* start. Rendered as
   * a thin tick over the bar strip (advisory only — the user does not need
   * to accept or reject; they just inform the user's eye + the next-section
   * suggestion's bar count).
   */
  export type AudioBorderTick = {
    bar: number
    /** 0..1 — drives opacity of the tick. */
    confidence: number
  }

  const HIDE_BAR_CHROME_ENTER = 18
  const HIDE_BAR_CHROME_EXIT = 52
  const SMOOTH_ALPHA = 0.16
  const LABEL_FADE_START_PX = 20
  const LABEL_FADE_END_PX = 52
  const DRAG_PX = 5
  const CHORD_LABEL_PAD_PX = 9
  const CHORD_LABEL_CHAR_PX = 7.4
  const CHORD_SUGGESTION_CHAR_PX = 6.9
  const CHORD_DOUBLE_TAP_MS = 320
  const CHORD_DOUBLE_TAP_PX = 18

  function chordLabelFits(widthPx: number, label: string, charPx = CHORD_LABEL_CHAR_PX): boolean {
    if (!label) return false
    return widthPx >= Math.ceil(label.length * charPx + CHORD_LABEL_PAD_PX)
  }

  const SECTION_LABEL_TEXT: Record<SectionKind, string> = {
    intro: 'text-violet-200',
    verse: 'text-sky-200',
    preChorus: 'text-cyan-200',
    chorus: 'text-amber-200',
    bridge: 'text-orange-200',
    solo: 'text-rose-200',
    riff: 'text-lime-200',
    break: 'text-stone-200',
    outro: 'text-fuchsia-200',
    custom: 'text-zinc-200',
  }

  let {
    viewStart,
    viewEnd,
    widthPx,
    bars,
    beats,
    editable = false,
    stripMode = 'grid',
    mapSections = [],
    onAction,
    selectedBarId = $bindable<string | null>(null),
    selectedBarIds = $bindable<string[]>([]),
    /** After pointer-up in sections mode, seek transport to earliest selected bar (grid parity). */
    onSectionsSeekCommit,
    /** Horizontal pan (trackpad); return true if handled. Tried before grid-mode beat wheel. */
    onViewportWheel,
    /** Chords mode: after selecting a beat, report pointer position for anchoring a popover. */
    onChordBeatInteract,
    /** Chords mode: single-click SELECTS an off-grid (divided-bar) chord slot. */
    onChordFractionSelect,
    /** Chords mode: double-click an off-grid slot → open the chord picker. */
    onChordFractionInteract,
    /** barId → its off-grid fraction chord slots (label + fraction), rendered in the chord strip. */
    chordFractionByBar = {} as Record<string, { fraction: number; label: string }[]>,
    /** Key (`barId:fraction`) of the currently-selected off-grid slot, for highlight. */
    selectedFractionKey = null as string | null,
    /** Chords mode: right-click command menu request. */
    onChordContextMenu,
    /** Chords mode: drag a selected chord to move the whole selection by N beats. */
    onChordsMove,
    selectedBeatId = $bindable<string | null>(null),
    /** Chords mode: multi-select beats (timeline order); single-click also sets `selectedBeatId`. */
    chordsSelectionBeatIds = $bindable<string[]>([]),
    chordLabelByBeatId = {} as Record<string, string>,
    /** Per-bar chord suggestions from cached chroma — keyed by the bar's downbeat id. */
    chordSuggestionByBeatId = {} as Record<string, { label: string; confidence: number }>,
    /** Song timeline bounds (sec); required for bar-edge stretch so the last bar can extend to decode end. */
    timelineMinSec = 0,
    timelineMaxSec = 0,
    /** Sections mode: preview the next-section suggestion as a ghost block on the bar strip. */
    suggestionPreview = null as SuggestionPreview | null,
    onAcceptSuggestion = undefined as (() => void) | undefined,
    onDismissSuggestion = undefined as (() => void) | undefined,
    /** Sections mode: commit a section edge-drag resize. Inclusive bar indices. */
    onResizeSection = undefined as
      | ((sectionId: string, newStartBarIndex: number, newEndBarIndex: number) => void)
      | undefined,
    /** Sections mode: commit a boundary drag — `newBoundaryBarIndex` becomes the right section's startBarIndex. */
    onResizeBoundary = undefined as
      | ((leftSectionId: string, rightSectionId: string, newBoundaryBarIndex: number) => void)
      | undefined,
    /** Sections mode: audio-derived candidate borders shown as ghost ticks. */
    audioBorderTicks = [] as AudioBorderTick[],
    /**
     * Grid mode: count-in beats rendered as dim ghost ticks BEFORE bar 1.
     * Each entry is one pre-song click in original-time. The bar strip
     * renders them at the corresponding pixel positions inside the
     * viewport (so they're visible whenever there's lead-in space to
     * the left of bar 1). Empty = no count-in.
     */
    countInTicks = [] as { timeSec: number; downbeat: boolean }[],
    /**
     * Grid mode: the bar that currently anchors the song start. That
     * bar gets a persistent anchor icon; others show one only on
     * hover. `null` = no beats analyzed yet.
     */
    songStartBarIndex = null as number | null,
    /**
     * Grid mode: handler for clicking the "Set as start" anchor icon
     * on any bar. Receives the bar's 0-based `index`. Undefined
     * disables the affordance.
     */
    onSetStartBar = undefined as ((barIndex: number) => void) | undefined,
  }: {
    viewStart: number
    viewEnd: number
    widthPx: number
    bars: Bar[]
    beats: Beat[]
    editable?: boolean
    stripMode?: 'grid' | 'sections' | 'chords'
    mapSections?: Section[]
    onAction?: (action: BarGridAction) => void
    selectedBarId?: string | null
    selectedBarIds?: string[]
    onSectionsSeekCommit?: (timeSec: number) => void
    onViewportWheel?: (e: WheelEvent) => boolean
    onChordBeatInteract?: (detail: { clientX: number; clientY: number }) => void
    onChordFractionSelect?: (detail: { barId: string; fraction: number }) => void
    onChordFractionInteract?: (detail: {
      barId: string
      fraction: number
      clientX: number
      clientY: number
    }) => void
    chordFractionByBar?: Record<string, { fraction: number; label: string }[]>
    selectedFractionKey?: string | null
    onChordContextMenu?: (detail: { clientX: number; clientY: number }) => void
    onChordsMove?: (detail: { delta: number }) => void
    selectedBeatId?: string | null
    chordsSelectionBeatIds?: string[]
    chordLabelByBeatId?: Record<string, string>
    chordSuggestionByBeatId?: Record<string, { label: string; confidence: number }>
    timelineMinSec?: number
    timelineMaxSec?: number
    suggestionPreview?: SuggestionPreview | null
    onAcceptSuggestion?: () => void
    onDismissSuggestion?: () => void
    onResizeSection?: (sectionId: string, newStartBarIndex: number, newEndBarIndex: number) => void
    onResizeBoundary?: (
      leftSectionId: string,
      rightSectionId: string,
      newBoundaryBarIndex: number,
    ) => void
    audioBorderTicks?: AudioBorderTick[]
    countInTicks?: { timeSec: number; downbeat: boolean }[]
    songStartBarIndex?: number | null
    onSetStartBar?: (barIndex: number) => void
  } = $props()

  let gridEl = $state<HTMLDivElement | undefined>()
  let rangeAnchorIndex = $state<number | null>(null)
  /** Sorted-beat index for Shift+click / drag range in chords mode. */
  let rangeAnchorChordSortedIndex = $state<number | null>(null)

  let editing = $derived(
    Boolean(
      editable &&
        (stripMode === 'sections' ||
          stripMode === 'chords' ||
          (stripMode === 'grid' && onAction)),
    ),
  )

  let sortedBars = $derived([...bars].sort((a, b) => a.index - b.index))

  type BarSlice = { bar: Bar; x0: number; x1: number; w: number }

  let barSlices = $derived.by(() => {
    if (!(widthPx > 0) || viewEnd <= viewStart) return [] as BarSlice[]
    const out: BarSlice[] = []
    for (const bar of bars) {
      if (bar.endSec <= viewStart || bar.startSec >= viewEnd) continue
      const t0 = Math.max(bar.startSec, viewStart)
      const t1 = Math.min(bar.endSec, viewEnd)
      const x0 = timeToPxInView(t0, viewStart, viewEnd, widthPx)
      const x1 = timeToPxInView(t1, viewStart, viewEnd, widthPx)
      const w = x1 - x0
      if (w > 0.25) out.push({ bar, x0, x1, w })
    }
    return out
  })

  /** One label row per section, positioned over the visible time span of that section’s bars. */
  type SectionSpan = {
    key: string
    sectionId: string
    label: string
    kind: SectionKind
    x0: number
    w: number
    startBarIndex: number
    endBarIndex: number
  }
  type SectionLabelSpan = SectionSpan

  const SECTION_FILL_CSS: Record<SectionKind, string> = {
    intro: 'background-color: rgb(139 92 246 / 0.25)',
    verse: 'background-color: rgb(14 165 233 / 0.20)',
    preChorus: 'background-color: rgb(6 182 212 / 0.20)',
    chorus: 'background-color: rgb(245 158 11 / 0.25)',
    bridge: 'background-color: rgb(249 115 22 / 0.20)',
    solo: 'background-color: rgb(244 63 94 / 0.20)',
    riff: 'background-color: rgb(132 204 22 / 0.22)',
    break: 'background-color: rgb(120 113 108 / 0.22)',
    outro: 'background-color: rgb(217 70 239 / 0.20)',
    custom: 'background-color: rgb(113 113 122 / 0.20)',
  }

  const SECTION_LEFT_BORDER_CSS: Record<SectionKind, string> = {
    intro: 'border-left: 2px solid rgb(167 139 250)',
    verse: 'border-left: 2px solid rgb(56 189 248)',
    preChorus: 'border-left: 2px solid rgb(34 211 238)',
    chorus: 'border-left: 2px solid rgb(251 191 36)',
    bridge: 'border-left: 2px solid rgb(251 146 60)',
    solo: 'border-left: 2px solid rgb(251 113 133)',
    riff: 'border-left: 2px solid rgb(163 230 53)',
    break: 'border-left: 2px solid rgb(168 162 158)',
    outro: 'border-left: 2px solid rgb(232 121 249)',
    custom: 'border-left: 2px solid rgb(161 161 170)',
  }

  /**
   * Live-preview ranges for in-progress edge / boundary drags. Layout derives
   * from this during the drag so sections visually follow the cursor; on
   * pointer-up the parent commits via `onResizeSection` / `onResizeBoundary`
   * and this clears. Array because a boundary drag updates *two* sections at
   * once (left shrinks while right grows or vice versa).
   */
  let pendingResize = $state<Array<{
    sectionId: string
    startBarIndex: number
    endBarIndex: number
  }>>([])

  /** `mapSections` with `pendingResize` applied to each matching section. */
  let effectiveSections = $derived.by(() => {
    if (pendingResize.length === 0) return mapSections
    const overrides = new Map(pendingResize.map((p) => [p.sectionId, p]))
    return mapSections.map((s) => {
      const o = overrides.get(s.id)
      return o
        ? { ...s, barRange: { startBarIndex: o.startBarIndex, endBarIndex: o.endBarIndex } }
        : s
    })
  })

  /** Contiguous section tint fills — visible in sections AND chords mode so the
   * user can place chords with section context in view. (Interactive edge
   * handles below stay sections-only — chords mode is read-only for sections.) */
  let sectionFillSpans = $derived.by(() => {
    if (!(widthPx > 0) || viewEnd <= viewStart || effectiveSections.length === 0) {
      return [] as SectionSpan[]
    }
    const byIndex = new Map(bars.map((b) => [b.index, b]))
    const out: SectionSpan[] = []
    for (const sec of effectiveSections) {
      const inRange: Bar[] = []
      for (let i = sec.barRange.startBarIndex; i <= sec.barRange.endBarIndex; i++) {
        const b = byIndex.get(i)
        if (b) inRange.push(b)
      }
      if (inRange.length === 0) continue
      const t0 = Math.min(...inRange.map((b) => b.startSec))
      const t1 = Math.max(...inRange.map((b) => b.endSec))
      const visT0 = Math.max(t0, viewStart)
      const visT1 = Math.min(t1, viewEnd)
      if (!(visT1 > visT0)) continue
      const x0 = timeToPxInView(visT0, viewStart, viewEnd, widthPx)
      const x1 = timeToPxInView(visT1, viewStart, viewEnd, widthPx)
      const w = x1 - x0
      if (w < 0.5) continue
      out.push({
        key: sec.id,
        sectionId: sec.id,
        label: sec.label.trim() || sec.kind,
        kind: sec.kind,
        x0,
        w,
        startBarIndex: sec.barRange.startBarIndex,
        endBarIndex: sec.barRange.endBarIndex,
      })
    }
    return out
  })

  /** Pixel span of the next-section suggestion preview ghost (sections mode only). */
  let suggestionPreviewPx = $derived.by(() => {
    if (
      stripMode !== 'sections' ||
      !suggestionPreview ||
      !(widthPx > 0) ||
      viewEnd <= viewStart
    ) {
      return null as { x0: number; w: number; kind: SectionKind; label: string } | null
    }
    const byIndex = new Map(bars.map((b) => [b.index, b]))
    const inRange: Bar[] = []
    for (let i = suggestionPreview.startBarIndex; i <= suggestionPreview.endBarIndex; i++) {
      const b = byIndex.get(i)
      if (b) inRange.push(b)
    }
    if (inRange.length === 0) return null
    const t0 = Math.min(...inRange.map((b) => b.startSec))
    const t1 = Math.max(...inRange.map((b) => b.endSec))
    const visT0 = Math.max(t0, viewStart)
    const visT1 = Math.min(t1, viewEnd)
    if (!(visT1 > visT0)) return null
    const x0 = timeToPxInView(visT0, viewStart, viewEnd, widthPx)
    const x1 = timeToPxInView(visT1, viewStart, viewEnd, widthPx)
    const w = x1 - x0
    if (w < 0.5) return null
    return { x0, w, kind: suggestionPreview.kind, label: suggestionPreview.label }
  })

  /** Single horizontal highlight for the full selected time span (sections mode). */
  let selectionRangePx = $derived.by(() => {
    if (stripMode !== 'sections' || selectedBarIds.length === 0 || !(widthPx > 0) || viewEnd <= viewStart) {
      return null as { x0: number; w: number } | null
    }
    const byId = new Map(bars.map((b) => [b.id, b]))
    const sel: Bar[] = []
    for (const id of selectedBarIds) {
      const b = byId.get(id)
      if (b) sel.push(b)
    }
    if (sel.length === 0) return null
    const t0 = Math.min(...sel.map((b) => b.startSec))
    const t1 = Math.max(...sel.map((b) => b.endSec))
    const visT0 = Math.max(t0, viewStart)
    const visT1 = Math.min(t1, viewEnd)
    if (!(visT1 > visT0)) return null
    const x0 = timeToPxInView(visT0, viewStart, viewEnd, widthPx)
    const x1 = timeToPxInView(visT1, viewStart, viewEnd, widthPx)
    const w = x1 - x0
    if (w < 0.5) return null
    return { x0, w }
  })

  /** Single horizontal highlight for the full selected time span (chords mode). */
  let chordsSelectionRangePx = $derived.by(() => {
    if (stripMode !== 'chords' || chordsSelectionBeatIds.length === 0 || !(widthPx > 0) || viewEnd <= viewStart) {
      return null as { x0: number; w: number } | null
    }
    const sorted = sortBeatsByTime(beats)
    const selSet = new Set(chordsSelectionBeatIds)
    const barsById = new Map(bars.map((b) => [b.id, b]))
    let t0 = Number.POSITIVE_INFINITY
    let t1 = Number.NEGATIVE_INFINITY
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!
      if (!selSet.has(b.id)) continue
      const bar = barsById.get(b.barId)
      const barEnd = bar?.endSec ?? b.timeSec + 0.1
      const next = sorted[i + 1]
      const beatEnd = next ? Math.min(next.timeSec, barEnd) : barEnd
      if (b.timeSec < t0) t0 = b.timeSec
      if (beatEnd > t1) t1 = beatEnd
    }
    if (!isFinite(t0) || !(t1 > t0)) return null
    const visT0 = Math.max(t0, viewStart)
    const visT1 = Math.min(t1, viewEnd)
    if (!(visT1 > visT0)) return null
    const x0 = timeToPxInView(visT0, viewStart, viewEnd, widthPx)
    const x1 = timeToPxInView(visT1, viewStart, viewEnd, widthPx)
    const w = x1 - x0
    if (w < 0.5) return null
    return { x0, w }
  })

  let sectionLabelSpans = $derived.by(() => {
    if (!(widthPx > 0) || viewEnd <= viewStart || effectiveSections.length === 0) {
      return [] as SectionLabelSpan[]
    }
    const byIndex = new Map(bars.map((b) => [b.index, b]))
    const out: SectionLabelSpan[] = []
    for (const sec of effectiveSections) {
      const inRange: Bar[] = []
      for (let i = sec.barRange.startBarIndex; i <= sec.barRange.endBarIndex; i++) {
        const b = byIndex.get(i)
        if (b) inRange.push(b)
      }
      if (inRange.length === 0) continue
      const t0 = Math.min(...inRange.map((b) => b.startSec))
      const t1 = Math.max(...inRange.map((b) => b.endSec))
      const visT0 = Math.max(t0, viewStart)
      const visT1 = Math.min(t1, viewEnd)
      if (!(visT1 > visT0)) continue
      const x0 = timeToPxInView(visT0, viewStart, viewEnd, widthPx)
      const x1 = timeToPxInView(visT1, viewStart, viewEnd, widthPx)
      const w = x1 - x0
      if (w < 2) continue
      out.push({
        key: sec.id,
        sectionId: sec.id,
        label: sec.label.trim() || sec.kind,
        kind: sec.kind,
        x0,
        w,
        startBarIndex: sec.barRange.startBarIndex,
        endBarIndex: sec.barRange.endBarIndex,
      })
    }
    return out
  })

  /**
   * Pixel positions of count-in ghost ticks (grid mode). Each tick is
   * a pre-song click in original-time; ticks whose original-time falls
   * outside the visible viewport are dropped (so e.g. zooming into the
   * middle of the song hides them naturally). Single source of truth:
   * the parent computes positions from `songPlaybackPlan(sm)`, the
   * strip just paints them.
   */
  let countInTickPx = $derived.by(() => {
    if (
      stripMode !== 'grid' ||
      !(widthPx > 0) ||
      viewEnd <= viewStart ||
      countInTicks.length === 0
    ) {
      return [] as Array<{ key: string; x: number; downbeat: boolean }>
    }
    const out: Array<{ key: string; x: number; downbeat: boolean }> = []
    for (let i = 0; i < countInTicks.length; i++) {
      const t = countInTicks[i]!
      if (t.timeSec < viewStart || t.timeSec > viewEnd) continue
      const x = timeToPxInView(t.timeSec, viewStart, viewEnd, widthPx)
      out.push({ key: `ci-${i}`, x, downbeat: t.downbeat })
    }
    return out
  })

  /** Pixel positions of audio-derived border ticks (sections mode). */
  let audioBorderTickPx = $derived.by(() => {
    if (
      stripMode !== 'sections' ||
      !(widthPx > 0) ||
      viewEnd <= viewStart ||
      audioBorderTicks.length === 0
    ) {
      return [] as Array<{ key: string; x: number; confidence: number }>
    }
    const byIndex = new Map(bars.map((b) => [b.index, b]))
    const out: Array<{ key: string; x: number; confidence: number }> = []
    for (const tick of audioBorderTicks) {
      const b = byIndex.get(tick.bar)
      if (!b) continue
      if (b.startSec < viewStart || b.startSec > viewEnd) continue
      const x = timeToPxInView(b.startSec, viewStart, viewEnd, widthPx)
      out.push({ key: `audio-${tick.bar}`, x, confidence: tick.confidence })
    }
    return out
  })

  /**
   * Pairs of sections that share a boundary (left.endBarIndex + 1 ===
   * right.startBarIndex). These get a single shared handle instead of two
   * overlapping edge handles, so dragging moves the boundary in one motion.
   */
  let sectionBoundaries = $derived.by(() => {
    if (sectionFillSpans.length < 2) {
      return [] as Array<{ key: string; leftSpan: SectionSpan; rightSpan: SectionSpan }>
    }
    const sorted = [...sectionFillSpans].sort((a, b) => a.startBarIndex - b.startBarIndex)
    const pairs: Array<{ key: string; leftSpan: SectionSpan; rightSpan: SectionSpan }> = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const left = sorted[i]
      const right = sorted[i + 1]
      if (left.endBarIndex + 1 === right.startBarIndex) {
        pairs.push({ key: `${left.sectionId}-${right.sectionId}`, leftSpan: left, rightSpan: right })
      }
    }
    return pairs
  })

  /** Section ids whose left edge is shared with another section — skip standalone left handle. */
  let sectionsWithLeftNeighbor = $derived(
    new Set(sectionBoundaries.map((p) => p.rightSpan.sectionId)),
  )
  /** Section ids whose right edge is shared with another section — skip standalone right handle. */
  let sectionsWithRightNeighbor = $derived(
    new Set(sectionBoundaries.map((p) => p.leftSpan.sectionId)),
  )

  let zoomStableCrowdingPx = $derived.by(() => {
    if (!(widthPx > 0) || viewEnd <= viewStart || bars.length === 0) return 9999
    const span = viewEnd - viewStart
    const pxPerSec = span > 0 ? widthPx / span : 0
    if (!(pxPerSec > 0)) return 9999
    const durs = bars.map((b) => Math.max(1e-6, b.endSec - b.startSec)).sort((a, b) => a - b)
    const mid = Math.floor(durs.length / 2)
    const medianBarSec =
      durs.length % 2 === 1 ? durs[mid]! : (durs[mid - 1]! + durs[mid]!) / 2
    return medianBarSec * pxPerSec
  })

  let smoothedCrowding = $state<number | null>(null)
  let hideBarChrome = $state(false)

  $effect(() => {
    const raw = zoomStableCrowdingPx
    if (smoothedCrowding === null) {
      smoothedCrowding = raw
    } else {
      smoothedCrowding = smoothedCrowding * (1 - SMOOTH_ALPHA) + raw * SMOOTH_ALPHA
    }
    const s = smoothedCrowding
    if (s < HIDE_BAR_CHROME_ENTER) hideBarChrome = true
    else if (s > HIDE_BAR_CHROME_EXIT) hideBarChrome = false
  })

  let tickDimmed = $derived(hideBarChrome && !editing)

  function labelOpacityForSlice(sliceW: number): number {
    if (hideBarChrome) return 0
    if (sliceW >= LABEL_FADE_END_PX) return 1
    if (sliceW <= LABEL_FADE_START_PX) return 0
    return (sliceW - LABEL_FADE_START_PX) / (LABEL_FADE_END_PX - LABEL_FADE_START_PX)
  }

  let songEnds = $derived.by(() => {
    if (beats.length === 0) return { firstId: null as string | null, lastId: null as string | null }
    const s = [...beats].sort((a, b) => a.timeSec - b.timeSec || a.id.localeCompare(b.id))
    return { firstId: s[0]!.id, lastId: s[s.length - 1]!.id }
  })

  function isBarSelected(barId: string): boolean {
    if (stripMode === 'grid') return selectedBarId === barId
    return selectedBarIds.includes(barId)
  }

  type BeatLine = {
    id: string
    barId: string
    x: number
    downbeat: boolean
    indexInBar: number
    songStart: boolean
    songEnd: boolean
  }

  let beatLines = $derived.by(() => {
    if (!(widthPx > 0) || viewEnd <= viewStart) return [] as BeatLine[]
    const out: BeatLine[] = []
    for (const b of beats) {
      if (b.timeSec < viewStart || b.timeSec > viewEnd) continue
      out.push({
        id: b.id,
        barId: b.barId,
        x: timeToPxInView(b.timeSec, viewStart, viewEnd, widthPx),
        downbeat: b.indexInBar === 0,
        indexInBar: b.indexInBar,
        songStart: b.id === songEnds.firstId,
        songEnd: b.id === songEnds.lastId,
      })
    }
    return out
  })

  function timeFromClientX(clientX: number): number {
    if (!gridEl) return viewStart
    return clientXToTimeInView(clientX, gridEl, widthPx, viewStart, viewEnd)
  }

  function barAtTime(t: number): Bar | undefined {
    return bars.find((b) => t >= b.startSec && t < b.endSec)
  }

  function barEndForBeat(beat: Beat): number {
    const bar = bars.find((x) => x.id === beat.barId)
    return bar?.endSec ?? beat.timeSec + 0.1
  }

  /** Which beat owns time `t` on [beat.timeSec, next.timeSec) ∩ bar. */
  function beatAtTime(t: number): Beat | undefined {
    const sorted = [...beats].sort((a, b) => a.timeSec - b.timeSec || a.id.localeCompare(b.id))
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!
      const next = sorted[i + 1]
      const end = next ? Math.min(next.timeSec, barEndForBeat(b)) : barEndForBeat(b)
      if (t >= b.timeSec && t < end) return b
    }
    return undefined
  }

  /** Bars whose chords are OFF-GRID (divided) — their beat cells are hidden and
   *  replaced by fraction slots. */
  let dividedBarIds = $derived(new Set(Object.keys(chordFractionByBar)))

  /** Off-grid chord slot cells, positioned across each divided bar. */
  let chordFractionCellsPx = $derived.by(() => {
    type Cell = { key: string; barId: string; fraction: number; x0: number; x1: number; label: string }
    if (stripMode !== 'chords' || !(widthPx > 0) || viewEnd <= viewStart) return [] as Cell[]
    const byId = new Map(bars.map((b) => [b.id, b]))
    const out: Cell[] = []
    for (const [barId, slots] of Object.entries(chordFractionByBar)) {
      const bar = byId.get(barId)
      if (!bar || slots.length === 0) continue
      const dur = bar.endSec - bar.startSec
      for (let i = 0; i < slots.length; i++) {
        const s0 = bar.startSec + slots[i]!.fraction * dur
        const s1 = i + 1 < slots.length ? bar.startSec + slots[i + 1]!.fraction * dur : bar.endSec
        const visT0 = Math.max(s0, viewStart)
        const visT1 = Math.min(s1, viewEnd)
        if (!(visT1 > visT0)) continue
        const x0 = timeToPxInView(visT0, viewStart, viewEnd, widthPx)
        const x1 = timeToPxInView(visT1, viewStart, viewEnd, widthPx)
        if (x1 - x0 < 0.5) continue
        out.push({ key: `${barId}:${i}`, barId, fraction: slots[i]!.fraction, x0, x1, label: slots[i]!.label })
      }
    }
    return out
  })

  let chordBeatSegments = $derived.by(() => {
    if (stripMode !== 'chords' || !(widthPx > 0) || viewEnd <= viewStart) {
      return [] as { beat: Beat; x0: number; x1: number }[]
    }
    const sorted = [...beats].sort((a, b) => a.timeSec - b.timeSec || a.id.localeCompare(b.id))
    const out: { beat: Beat; x0: number; x1: number }[] = []
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!
      if (dividedBarIds.has(b.barId)) continue
      const next = sorted[i + 1]
      const t1 = Math.min(
        next ? next.timeSec : Number.POSITIVE_INFINITY,
        barEndForBeat(b),
      )
      if (b.timeSec >= viewEnd || t1 <= viewStart) continue
      const t0 = Math.max(b.timeSec, viewStart)
      const te = Math.min(t1, viewEnd)
      if (!(te > t0)) continue
      const x0 = timeToPxInView(t0, viewStart, viewEnd, widthPx)
      const x1 = timeToPxInView(te, viewStart, viewEnd, widthPx)
      if (x1 - x0 > 0.2) out.push({ beat: b, x0, x1 })
    }
    return out
  })

  let chordLabelSpans = $derived.by(() => {
    if (stripMode !== 'chords' || !(widthPx > 0) || viewEnd <= viewStart) {
      return [] as { beatId: string; label: string; x0: number; x1: number }[]
    }
    const sorted = [...beats].sort((a, b) => a.timeSec - b.timeSec || a.id.localeCompare(b.id))
    const labeled = sorted
      .map((beat) => ({ beat, label: chordLabelByBeatId[beat.id] ?? '' }))
      .filter((entry) => entry.label && !dividedBarIds.has(entry.beat.barId))
    if (labeled.length === 0) return []
    const timelineEnd = Math.max(
      timelineMaxSec,
      ...bars.map((bar) => bar.endSec),
      labeled[labeled.length - 1]!.beat.timeSec + 0.1,
    )
    const barsById = new Map(bars.map((bar) => [bar.id, bar]))
    const barsByIndex = new Map(bars.map((bar) => [bar.index, bar]))
    const sectionEndForBeat = (beat: Beat): number => {
      const bar = barsById.get(beat.barId)
      if (!bar) return timelineEnd
      const section = mapSections.find(
        (s) =>
          bar.index >= s.barRange.startBarIndex &&
          bar.index <= s.barRange.endBarIndex,
      )
      if (!section) return timelineEnd
      return barsByIndex.get(section.barRange.endBarIndex)?.endSec ?? timelineEnd
    }
    const out: { beatId: string; label: string; x0: number; x1: number }[] = []
    for (let i = 0; i < labeled.length; i += 1) {
      const current = labeled[i]!
      const next = labeled[i + 1]
      const spanStart = current.beat.timeSec
      const spanEnd = Math.min(next ? next.beat.timeSec : timelineEnd, sectionEndForBeat(current.beat))
      if (spanStart >= viewEnd || spanEnd <= viewStart) continue
      const visibleStart = Math.max(spanStart, viewStart)
      const visibleEnd = Math.min(spanEnd, viewEnd)
      if (!(visibleEnd > visibleStart)) continue
      const x0 = timeToPxInView(visibleStart, viewStart, viewEnd, widthPx)
      const x1 = timeToPxInView(visibleEnd, viewStart, viewEnd, widthPx)
      if (x1 - x0 > 0.5) out.push({ beatId: current.beat.id, label: current.label, x0, x1 })
    }
    return out
  })

  let sectionsDragCleanup: (() => void) | null = null
  let chordsDragCleanup: (() => void) | null = null
  let barBoundaryResizeCleanup: (() => void) | null = null
  let lastChordTap: { beatId: string; timeMs: number; clientX: number; clientY: number } | null = null

  onDestroy(() => {
    sectionsDragCleanup?.()
    chordsDragCleanup?.()
    barBoundaryResizeCleanup?.()
  })

  let barBoundaryStretchReady = $derived(
    editing && stripMode === 'grid' && Boolean(onAction) && timelineMaxSec > timelineMinSec + 1e-6,
  )

  function onBarBoundaryPointerDown(e: PointerEvent, barId: string, edge: 'left' | 'right') {
    if (!onAction || stripMode !== 'grid' || !editing || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    selectedBarId = barId

    barBoundaryResizeCleanup?.()
    const pid = e.pointerId
    let raf = 0
    let pending: number | null = null

    // Coalesce the whole drag into ONE undo step. Each pointermove
    // emits a patchSongMap inside the batch; `endPatchBatch()` pushes
    // exactly one history entry on pointerup.
    beginPatchBatch()

    const emit = (t: number) => {
      onAction({
        type: 'setBarBoundary',
        barId,
        edge,
        boundarySec: t,
        timelineMinSec,
        timelineMaxSec,
      })
    }

    const flush = () => {
      raf = 0
      if (pending === null) return
      const t = pending
      pending = null
      emit(t)
    }

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      ev.preventDefault()
      pending = timeFromClientX(ev.clientX)
      if (!raf) raf = requestAnimationFrame(flush)
    }

    const teardown = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      if (pending !== null) {
        emit(pending)
        pending = null
      }
      endPatchBatch()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      barBoundaryResizeCleanup = null
      try {
        gridEl?.releasePointerCapture(pid)
      } catch {
        /* not captured */
      }
    }

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return
      teardown()
    }

    try {
      gridEl?.setPointerCapture(pid)
    } catch {
      /* */
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    barBoundaryResizeCleanup = teardown
  }

  /** The existing section covering `barIndex`, if any (bar-index range). */
  function sectionRangeAtBarIndex(barIndex: number): { start: number; end: number } | null {
    for (const s of effectiveSections) {
      if (barIndex >= s.barRange.startBarIndex && barIndex <= s.barRange.endBarIndex) {
        return { start: s.barRange.startBarIndex, end: s.barRange.endBarIndex }
      }
    }
    return null
  }

  function applySectionsClick(hit: Bar, shift: boolean, meta: boolean) {
    const idx = hit.index
    if (shift && rangeAnchorIndex != null) {
      const a = Math.min(rangeAnchorIndex, idx)
      const b = Math.max(rangeAnchorIndex, idx)
      selectedBarIds = sortedBars.filter((bar) => bar.index >= a && bar.index <= b).map((bar) => bar.id)
    } else if (meta) {
      const set = new Set(selectedBarIds)
      if (set.has(hit.id)) set.delete(hit.id)
      else set.add(hit.id)
      selectedBarIds = [...set]
      rangeAnchorIndex = idx
    } else {
      // Plain click: selecting an existing section is first-class — clicking any
      // bar inside a tagged section selects the WHOLE section. Untagged bars
      // select just the one bar so a fresh range can still be built up for a new
      // section (drag also always selects a sub-range).
      const sec = sectionRangeAtBarIndex(idx)
      if (sec) {
        selectedBarIds = sortedBars
          .filter((bar) => bar.index >= sec.start && bar.index <= sec.end)
          .map((bar) => bar.id)
      } else {
        selectedBarIds = [hit.id]
      }
      rangeAnchorIndex = idx
    }
  }

  function onSectionsPointerDown(e: PointerEvent) {
    if (!editing || e.button !== 0) return
    sectionsDragCleanup?.()
    sectionsDragCleanup = null
    const hit = barAtTime(timeFromClientX(e.clientX))
    if (!hit) {
      selectedBarIds = []
      rangeAnchorIndex = null
      return
    }

    const downShift = e.shiftKey
    const downMeta = e.metaKey || e.ctrlKey
    const startIdx = hit.index
    const startX = e.clientX
    const startY = e.clientY
    let dragActive = false
    // Snapshot the pre-drag selection so Shift+drag can add to it (vs. replacing).
    const preDragSelection = [...selectedBarIds]

    const move = (ev: PointerEvent) => {
      if (!dragActive) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_PX) return
        dragActive = true
      }
      const cur = barAtTime(timeFromClientX(ev.clientX))
      if (!cur) return
      const a = Math.min(startIdx, cur.index)
      const b = Math.max(startIdx, cur.index)
      const dragRangeIds = sortedBars
        .filter((bar) => bar.index >= a && bar.index <= b)
        .map((bar) => bar.id)
      if (downShift) {
        // Additive: union of prior selection and the current drag range.
        const merged = new Set(preDragSelection)
        for (const id of dragRangeIds) merged.add(id)
        selectedBarIds = sortedBars.filter((bar) => merged.has(bar.id)).map((bar) => bar.id)
        // Don't clobber rangeAnchorIndex — it powers Shift+click chains.
      } else {
        selectedBarIds = dragRangeIds
        rangeAnchorIndex = startIdx
      }
    }

    const teardown = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      sectionsDragCleanup = null
    }

    const up = () => {
      teardown()
      if (!dragActive) {
        applySectionsClick(hit, downShift, downMeta)
      }
      if (onSectionsSeekCommit) {
        setTimeout(() => {
          const sel = sortedBars.filter((b) => selectedBarIds.includes(b.id))
          if (sel.length === 0) return
          onSectionsSeekCommit(Math.min(...sel.map((b) => b.startSec)))
        }, 0)
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    sectionsDragCleanup = teardown
  }

  /**
   * Edge-drag resize for a section whose edge is NOT shared with a neighbor.
   * `fixedBarIndex` is the opposite edge of the section, which stays anchored
   * while the dragged edge follows the cursor.
   */
  function onSectionEdgePointerDown(
    e: PointerEvent,
    sectionId: string,
    fixedBarIndex: number,
  ) {
    if (!editing || e.button !== 0) return
    e.stopPropagation()
    sectionsDragCleanup?.()
    sectionsDragCleanup = null

    const startX = e.clientX
    const startY = e.clientY
    let dragActive = false

    const move = (ev: PointerEvent) => {
      if (!dragActive) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_PX) return
        dragActive = true
      }
      const cur = barAtTime(timeFromClientX(ev.clientX))
      if (!cur) return
      const a = Math.min(fixedBarIndex, cur.index)
      const b = Math.max(fixedBarIndex, cur.index)
      pendingResize = [{ sectionId, startBarIndex: a, endBarIndex: b }]
    }

    const teardown = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      sectionsDragCleanup = null
    }

    const up = () => {
      teardown()
      const p = pendingResize.find((r) => r.sectionId === sectionId)
      if (dragActive && p) {
        onResizeSection?.(sectionId, p.startBarIndex, p.endBarIndex)
      }
      pendingResize = []
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    sectionsDragCleanup = teardown
  }

  /**
   * Boundary-drag: a shared edge between two adjacent sections. Dragging
   * shrinks one side while growing the other — the boundary moves but the
   * outer endpoints stay anchored. Both sections clamp to at least 1 bar.
   */
  function onSectionBoundaryPointerDown(
    e: PointerEvent,
    leftId: string,
    rightId: string,
    leftFixedStart: number,
    rightFixedEnd: number,
  ) {
    if (!editing || e.button !== 0) return
    e.stopPropagation()
    sectionsDragCleanup?.()
    sectionsDragCleanup = null

    const startX = e.clientX
    const startY = e.clientY
    let dragActive = false

    const move = (ev: PointerEvent) => {
      if (!dragActive) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_PX) return
        dragActive = true
      }
      const cur = barAtTime(timeFromClientX(ev.clientX))
      if (!cur) return
      // Boundary = first bar of the right section.
      // Clamp so each section keeps at least 1 bar: leftStart+1 ≤ b ≤ rightEnd.
      const b = Math.max(leftFixedStart + 1, Math.min(rightFixedEnd, cur.index))
      pendingResize = [
        { sectionId: leftId, startBarIndex: leftFixedStart, endBarIndex: b - 1 },
        { sectionId: rightId, startBarIndex: b, endBarIndex: rightFixedEnd },
      ]
    }

    const teardown = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      sectionsDragCleanup = null
    }

    const up = () => {
      teardown()
      const right = pendingResize.find((r) => r.sectionId === rightId)
      if (dragActive && right) {
        onResizeBoundary?.(leftId, rightId, right.startBarIndex)
      }
      pendingResize = []
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    sectionsDragCleanup = teardown
  }

  function sortedBeatsChord(): Beat[] {
    return sortBeatsByTime(beats)
  }

  function applyChordsClick(hit: Beat, shift: boolean, meta: boolean): void {
    const sorted = sortedBeatsChord()
    const idx = sorted.findIndex((b) => b.id === hit.id)
    if (idx < 0) return

    if (shift && rangeAnchorChordSortedIndex != null) {
      const a = Math.min(rangeAnchorChordSortedIndex, idx)
      const b = Math.max(rangeAnchorChordSortedIndex, idx)
      chordsSelectionBeatIds = sorted.slice(a, b + 1).map((bt) => bt.id)
      selectedBeatId = hit.id
      return
    }
    if (meta) {
      const set = new Set(chordsSelectionBeatIds)
      if (set.has(hit.id)) set.delete(hit.id)
      else set.add(hit.id)
      chordsSelectionBeatIds = sorted.filter((b) => set.has(b.id)).map((b) => b.id)
      rangeAnchorChordSortedIndex = idx
      selectedBeatId = hit.id
      return
    }

    chordsSelectionBeatIds = [hit.id]
    rangeAnchorChordSortedIndex = idx
    selectedBeatId = hit.id
  }

  function onChordsPointerDown(e: PointerEvent) {
    if (!editing || e.button !== 0) return
    chordsDragCleanup?.()
    chordsDragCleanup = null

    // Divided bars are handled by their own click targets (off-grid slot
    // buttons rendered above the strip), so beat selection below is skipped
    // for them automatically — the buttons sit on top and catch the click.
    const hit = beatAtTime(timeFromClientX(e.clientX))
    if (!hit) {
      chordsSelectionBeatIds = []
      selectedBeatId = null
      rangeAnchorChordSortedIndex = null
      return
    }

    const downShift = e.shiftKey
    const downMeta = e.metaKey || e.ctrlKey
    const sorted = sortedBeatsChord()
    const startIdx = sorted.findIndex((b) => b.id === hit.id)
    if (startIdx < 0) return

    // Grabbing a beat that's already in the selection → DRAG MOVES the whole
    // selection by N beats (instead of starting a new range-select).
    const inSelection = chordsSelectionBeatIds.length > 0 && chordsSelectionBeatIds.includes(hit.id)
    const origSelection = inSelection ? [...chordsSelectionBeatIds] : []
    const origIdxs = origSelection
      .map((id) => sorted.findIndex((b) => b.id === id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)
    const minIdx = origIdxs[0] ?? 0
    const maxIdx = origIdxs[origIdxs.length - 1] ?? 0
    let moveDelta = 0

    const startX = e.clientX
    const startY = e.clientY
    let dragActive = false

    const move = (ev: PointerEvent) => {
      if (!dragActive) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_PX) return
        dragActive = true
      }
      const cur = beatAtTime(timeFromClientX(ev.clientX))
      if (!cur) return
      const curIdx = sorted.findIndex((b) => b.id === cur.id)
      if (curIdx < 0) return
      if (inSelection) {
        // Clamp the shift so the whole selection stays in bounds; preview the
        // destination beats via the selection highlight.
        const delta = Math.max(-minIdx, Math.min(sorted.length - 1 - maxIdx, curIdx - startIdx))
        moveDelta = delta
        chordsSelectionBeatIds = origIdxs.map((i) => sorted[i + delta].id)
        selectedBeatId = null
        return
      }
      const a = Math.min(startIdx, curIdx)
      const b = Math.max(startIdx, curIdx)
      chordsSelectionBeatIds = sorted.slice(a, b + 1).map((bt) => bt.id)
      rangeAnchorChordSortedIndex = startIdx
      selectedBeatId = cur.id
    }

    const teardown = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      chordsDragCleanup = null
    }

    const up = (ev: PointerEvent) => {
      teardown()
      if (dragActive && inSelection) {
        // Restore the original selection so the parent moves the right chords,
        // then apply the shift (parent re-selects the destination beats).
        chordsSelectionBeatIds = origSelection
        if (moveDelta !== 0) onChordsMove?.({ delta: moveDelta })
        return
      }
      if (!dragActive) {
        const now = performance.now()
        const doubleTap =
          !downShift &&
          !downMeta &&
          lastChordTap?.beatId === hit.id &&
          now - lastChordTap.timeMs <= CHORD_DOUBLE_TAP_MS &&
          Math.hypot(ev.clientX - lastChordTap.clientX, ev.clientY - lastChordTap.clientY) <=
            CHORD_DOUBLE_TAP_PX
        applyChordsClick(hit, downShift, downMeta)
        if (doubleTap) {
          lastChordTap = null
          onChordBeatInteract?.({ clientX: ev.clientX, clientY: ev.clientY })
        } else {
          lastChordTap = { beatId: hit.id, timeMs: now, clientX: ev.clientX, clientY: ev.clientY }
        }
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    chordsDragCleanup = teardown
  }

  function onChordsContextMenu(e: MouseEvent) {
    if (!editing || stripMode !== 'chords') return
    e.preventDefault()
    e.stopPropagation()

    const hit = beatAtTime(timeFromClientX(e.clientX))
    if (hit) {
      lastChordTap = null
      const selected = new Set(chordsSelectionBeatIds)
      if (!selected.has(hit.id)) {
        const sorted = sortedBeatsChord()
        const idx = sorted.findIndex((b) => b.id === hit.id)
        chordsSelectionBeatIds = [hit.id]
        selectedBeatId = hit.id
        rangeAnchorChordSortedIndex = idx >= 0 ? idx : null
      } else {
        selectedBeatId = hit.id
      }
    }
    onChordContextMenu?.({ clientX: e.clientX, clientY: e.clientY })
  }

  function onStripPointerDown(e: PointerEvent) {
    if (!editing || e.button !== 0) return

    if (stripMode === 'sections') {
      onSectionsPointerDown(e)
      return
    }

    if (stripMode === 'chords') {
      onChordsPointerDown(e)
      return
    }

    const hit = barAtTime(timeFromClientX(e.clientX))
    if (!hit) {
      selectedBarId = null
      selectedBarIds = []
      rangeAnchorIndex = null
      return
    }

    selectedBarId = hit.id
  }

  $effect(() => {
    const el = gridEl
    if (!el || !editing) return
    const fn = (e: WheelEvent) => {
      if (onViewportWheel?.(e)) {
        e.stopPropagation()
        return
      }
      if (stripMode !== 'grid' || !onAction) return
      if (!selectedBarId) return
      e.preventDefault()
      e.stopPropagation()
      const bar = bars.find((b) => b.id === selectedBarId)
      if (!bar) return
      const dir = e.deltaY > 0 ? -1 : 1
      onAction({ type: 'setBarBeatCount', barId: selectedBarId, count: bar.beatCount + dir })
    }
    el.addEventListener('wheel', fn, { passive: false })
    return () => el.removeEventListener('wheel', fn)
  })

  $effect(() => {
    if (!editing || stripMode !== 'sections') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectedBarIds = []
        rangeAnchorIndex = null
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  $effect(() => {
    if (!editing || stripMode !== 'chords') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        chordsSelectionBeatIds = []
        selectedBeatId = null
        rangeAnchorChordSortedIndex = null
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
</script>

<div
  bind:this={gridEl}
  class="relative w-full min-w-0 shrink-0 overflow-hidden overscroll-x-contain border-b border-foreground/10 bg-muted/15 {editing
    ? 'h-[4.5rem] pointer-events-auto'
    : 'h-11 pointer-events-none'}"
  aria-hidden={!editing}
  role={editing ? 'region' : undefined}
  aria-label={editing
    ? stripMode === 'sections'
      ? 'Bars and sections'
      : stripMode === 'chords'
        ? 'Chords per beat'
        : 'Bars and beats, editable'
    : undefined}
>
  {#if editing}
    <div
      class="absolute inset-0 z-[8] cursor-default select-none"
      role="presentation"
      aria-hidden="true"
      data-chord-beat-strip={stripMode === 'chords' ? '' : undefined}
      onpointerdown={onStripPointerDown}
      oncontextmenu={onChordsContextMenu}
    ></div>
  {/if}

  {#if barBoundaryStretchReady}
    {#each barSlices as slice (slice.bar.id)}
      <div
        class="absolute top-0 bottom-0 z-[35] w-2 -translate-x-1/2 cursor-ew-resize touch-none select-none"
        style:left="{slice.x0}px"
        role="separator"
        aria-label="Drag to resize bar start"
        onpointerdown={(ev) => onBarBoundaryPointerDown(ev, slice.bar.id, 'left')}
      ></div>
      <div
        class="absolute top-0 bottom-0 z-[35] w-2 -translate-x-1/2 cursor-ew-resize touch-none select-none"
        style:left="{slice.x1}px"
        role="separator"
        aria-label="Drag to resize bar end"
        onpointerdown={(ev) => onBarBoundaryPointerDown(ev, slice.bar.id, 'right')}
      ></div>
    {/each}
  {/if}

  <!-- Section titles: above bar fills. Visible in sections + chords + grid
       modes so users always have section context. -->
  {#if editing && (stripMode === 'sections' || stripMode === 'chords' || stripMode === 'grid')}
    {#each sectionLabelSpans as span (span.key)}
      <div
        class="pointer-events-none absolute top-0 z-[25] flex h-5 items-center justify-center overflow-hidden px-1 text-center text-[10px] font-semibold leading-none tracking-tight {SECTION_LABEL_TEXT[
          span.kind
        ] ?? 'text-zinc-200'}"
        style:left="{span.x0}px"
        style:width="{span.w}px"
        style:opacity={stripMode === 'sections' ? 1 : 0.65}
        title={span.label}
      >
        <span class="min-w-0 truncate drop-shadow-sm">{span.label}</span>
      </div>
    {/each}
  {/if}

  <!-- Section tint fills: visible in all modes. Dimmed outside sections mode
       so the beat/chord strip stays the visual focus. -->
  {#if editing && (stripMode === 'sections' || stripMode === 'chords' || stripMode === 'grid')}
    {#each sectionFillSpans as span (span.key)}
      <div
        class="pointer-events-none absolute inset-y-0"
        style:left="{span.x0}px"
        style:width="{span.w}px"
        style="{SECTION_FILL_CSS[span.kind] ?? ''}; {SECTION_LEFT_BORDER_CSS[span.kind] ?? ''}"
        style:opacity={stripMode === 'sections' ? 1 : 0.4}
        aria-hidden="true"
      ></div>
    {/each}
  {/if}

  <!-- Audio-derived border ticks: advisory hint, not user-actionable on its own.
       Drawn as a 2px dashed vertical line + a downward chevron at the top so it
       reads as "the analyzer thinks something happens here" rather than just
       being mistaken for a bar line. Opacity scales with confidence. -->
  {#if editing && stripMode === 'sections'}
    {#each audioBorderTickPx as tick (tick.key)}
      {@const alpha = Math.max(0.45, Math.min(0.95, tick.confidence))}
      <div
        class="pointer-events-none absolute top-0 bottom-0 z-[28] w-[2px] -translate-x-1/2"
        style:left="{tick.x}px"
        style:background="repeating-linear-gradient(to bottom, rgba(56, 189, 248, {alpha}) 0 4px, transparent 4px 7px)"
        aria-hidden="true"
        title="Detected border (confidence {Math.round(tick.confidence * 100)}%)"
      ></div>
      <div
        class="pointer-events-none absolute top-0 z-[29] -translate-x-1/2"
        style:left="{tick.x}px"
        style:border-top="5px solid rgba(56, 189, 248, {alpha})"
        style:border-left="4px solid transparent"
        style:border-right="4px solid transparent"
        style:width="0"
        style:height="0"
        aria-hidden="true"
      ></div>
    {/each}
  {/if}

  <!-- Count-in ghost ticks (grid mode). One per pre-song click in
       original-time, painted as a short dashed vertical line. They sit
       before bar 1 (or wherever the song-start anchor is) and rerender
       reactively when the user changes count-in 4 → 8: 4 new ticks
       appear instantly because `countInTicks` is a $derived in the
       parent. Pointer-events disabled so they don't interfere with
       bar edits. -->
  {#if stripMode === 'grid'}
    {#each countInTickPx as tick (tick.key)}
      <div
        class="pointer-events-none absolute top-0 bottom-0 z-[27] w-[2px] -translate-x-1/2"
        style:left="{tick.x}px"
        style:background="repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.42) 0 4px, transparent 4px 7px)"
        style:opacity={tick.downbeat ? 0.85 : 0.6}
        aria-hidden="true"
        title="Count-in click"
      ></div>
    {/each}
  {/if}

  <!-- Section edge-drag handles (sections mode): drag left/right boundary to resize. -->
  {#if editing && stripMode === 'sections'}
    {#each sectionFillSpans as span (span.key)}
      {#if !sectionsWithLeftNeighbor.has(span.sectionId)}
        <div
          class="group absolute top-0 bottom-0 z-[29] w-2 -translate-x-1/2 cursor-ew-resize touch-none select-none"
          style:left="{span.x0}px"
          role="separator"
          aria-label="Drag to resize section start"
          title="Drag to resize section"
          onpointerdown={(ev) => onSectionEdgePointerDown(ev, span.sectionId, span.endBarIndex)}
        >
          <div class="pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-white/0 transition-colors group-hover:bg-white/80"></div>
        </div>
      {/if}
      {#if !sectionsWithRightNeighbor.has(span.sectionId)}
        <div
          class="group absolute top-0 bottom-0 z-[29] w-2 -translate-x-1/2 cursor-ew-resize touch-none select-none"
          style:left="{span.x0 + span.w}px"
          role="separator"
          aria-label="Drag to resize section end"
          title="Drag to resize section"
          onpointerdown={(ev) => onSectionEdgePointerDown(ev, span.sectionId, span.startBarIndex)}
        >
          <div class="pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-white/0 transition-colors group-hover:bg-white/80"></div>
        </div>
      {/if}
    {/each}

    <!-- Shared boundary handles: dragging moves the boundary between two sections (left shrinks while right grows, or vice versa). -->
    {#each sectionBoundaries as pair (pair.key)}
      <div
        class="group absolute top-0 bottom-0 z-[30] w-3 -translate-x-1/2 cursor-ew-resize touch-none select-none"
        style:left="{pair.leftSpan.x0 + pair.leftSpan.w}px"
        role="separator"
        aria-label="Drag to move section boundary"
        title="Drag to move boundary"
        onpointerdown={(ev) =>
          onSectionBoundaryPointerDown(
            ev,
            pair.leftSpan.sectionId,
            pair.rightSpan.sectionId,
            pair.leftSpan.startBarIndex,
            pair.rightSpan.endBarIndex,
          )}
      >
        <div class="pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-white/0 transition-colors group-hover:bg-white"></div>
      </div>
    {/each}
  {/if}

  <!-- Next-section suggestion preview (sections mode): half-height ghost block on the bar strip. -->
  {#if editing && stripMode === 'sections' && suggestionPreviewPx}
    {@const sp = suggestionPreviewPx}
    <div
      class="pointer-events-none absolute bottom-0 z-[26] top-1/2 border-2 border-dashed border-white/70"
      style:left="{sp.x0}px"
      style:width="{sp.w}px"
      style="{SECTION_FILL_CSS[sp.kind] ?? ''}"
      aria-hidden="true"
    ></div>
    <div
      class="pointer-events-none absolute z-[27] flex items-center px-1.5 text-[10px] font-bold uppercase tracking-wide drop-shadow-sm {SECTION_LABEL_TEXT[
        sp.kind
      ] ?? 'text-zinc-200'}"
      style:left="{sp.x0}px"
      style:width="{sp.w}px"
      style:top="50%"
      style:height="50%"
    >
      <span class="min-w-0 truncate">+ {sp.label}</span>
    </div>
    <div
      class="absolute z-[40] flex gap-1"
      style:left="{Math.max(2, sp.x0 + sp.w - 42)}px"
      style:top="calc(50% + 2px)"
    >
      <button
        type="button"
        class="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-emerald-500 text-[11px] font-bold text-white shadow hover:bg-emerald-400 active:bg-emerald-600"
        title="Accept suggestion"
        aria-label="Accept suggestion"
        onclick={(e) => {
          e.stopPropagation()
          onAcceptSuggestion?.()
        }}
      >✓</button>
      <button
        type="button"
        class="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-zinc-700 text-[11px] font-bold text-white shadow hover:bg-zinc-600 active:bg-zinc-800"
        title="Dismiss suggestion"
        aria-label="Dismiss suggestion"
        onclick={(e) => {
          e.stopPropagation()
          onDismissSuggestion?.()
        }}
      >✕</button>
    </div>
  {/if}

  <div
    class="pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out"
    style:opacity={hideBarChrome ? 0 : 1}
  >
    {#each barSlices as slice (slice.bar.id)}
      <div
        class="absolute inset-y-0 {slice.bar.index % 2 === 0
            ? 'bg-foreground/10'
            : 'bg-foreground/5'} {stripMode === 'grid' && isBarSelected(slice.bar.id)
          ? 'ring-1 ring-inset ring-amber-400/45'
          : ''}"
        style:left="{slice.x0}px"
        style:width="{slice.w}px"
      ></div>
      <div
        class="absolute inset-y-0 w-px bg-foreground/35"
        style:left="{slice.x0}px"
      ></div>
    {/each}
    
    {#if editing && stripMode === 'chords'}
      {#each chordBeatSegments as seg (seg.beat.id)}
        <div
          class="pointer-events-none absolute inset-y-0 z-[6] rounded-sm border border-transparent bg-zinc-500/5"
          style:left="{seg.x0}px"
          style:width="{seg.x1 - seg.x0}px"
          aria-hidden="true"
        ></div>
        {#if !chordLabelByBeatId[seg.beat.id] && chordSuggestionByBeatId[seg.beat.id]}
          {@const sug = chordSuggestionByBeatId[seg.beat.id]}
          {@const tier = sug.confidence >= 0.10 ? 'high' : sug.confidence >= 0.05 ? 'medium' : 'low'}
          {@const sugLabel = `${sug.label}${tier === 'low' ? '?' : ''}`}
          {#if chordLabelFits(seg.x1 - seg.x0, sugLabel, CHORD_SUGGESTION_CHAR_PX)}
            <div
              class="text-muted-foreground pointer-events-none absolute bottom-0.5 z-[8] overflow-hidden whitespace-nowrap px-0.5 text-center font-mono text-[10px] font-medium tabular-nums {tier === 'high'
                ? 'opacity-65'
                : tier === 'medium'
                  ? 'italic opacity-50'
                  : 'italic opacity-35'}"
              style:left="{seg.x0}px"
              style:width="{seg.x1 - seg.x0}px"
              title={`Suggested: ${sug.label} (margin ${sug.confidence.toFixed(3)})`}
            >
              {sugLabel}
            </div>
          {/if}
        {/if}
      {/each}
      {#each chordLabelSpans as span (span.beatId)}
        {#if chordLabelFits(span.x1 - span.x0, span.label)}
          <div
            class="pointer-events-none absolute bottom-1 z-[9] overflow-hidden whitespace-nowrap px-1 text-left font-mono text-[11px] font-black tabular-nums text-foreground"
            style:left="{span.x0}px"
            style:width="{span.x1 - span.x0}px"
            title={span.label}
          >
            {span.label}
          </div>
        {/if}
      {/each}

      <!-- OFF-GRID (divided-bar) chord slots: a dashed cell + label, plus a real
           click target ABOVE the strip overlay so clicking opens the picker. -->
      {#each chordFractionCellsPx as cell (cell.key)}
        <div
          class="pointer-events-none absolute inset-y-0 z-[7] border-l border-dashed border-foreground/45 bg-foreground/[0.04]"
          style:left="{cell.x0}px"
          style:width="{cell.x1 - cell.x0}px"
          aria-hidden="true"
        ></div>
        {#if chordLabelFits(cell.x1 - cell.x0, cell.label || '—')}
          <div
            class="pointer-events-none absolute bottom-1 z-[10] overflow-hidden whitespace-nowrap px-1 text-left font-mono text-[11px] font-black tabular-nums text-foreground"
            style:left="{cell.x0}px"
            style:width="{cell.x1 - cell.x0}px"
            title={cell.label}
          >
            {cell.label || '—'}
          </div>
        {/if}
        <button
          type="button"
          class="pointer-events-auto absolute inset-y-0 z-[12] cursor-pointer {selectedFractionKey ===
          `${cell.barId}:${cell.fraction.toFixed(4)}`
            ? 'bg-foreground/15 ring-foreground/70 ring-1 ring-inset'
            : 'hover:bg-foreground/10'}"
          style:left="{cell.x0}px"
          style:width="{cell.x1 - cell.x0}px"
          aria-label={`Chord slot (${cell.label || 'empty'})`}
          title="Click to select · double-click to set the chord"
          onclick={() => onChordFractionSelect?.({ barId: cell.barId, fraction: cell.fraction })}
          ondblclick={(e) =>
            onChordFractionInteract?.({
              barId: cell.barId,
              fraction: cell.fraction,
              clientX: e.clientX,
              clientY: e.clientY,
            })}
        ></button>
      {/each}
    {/if}
  </div>

  <!-- Per-bar "Set as song start" affordance (grid mode). Every bar
       gets a small anchor button at its left edge: dim by default,
       full opacity on hover, and full opacity + amber tint on the
       currently-anchored bar (so the user always sees where the song
       starts from). Click → parent's `onSetStartBar(barIndex)` updates
       `startBeatId`; the plan reactively re-derives, count-in ghost
       ticks shift, click loop respects the new anchor on next play.
       One write, every consumer follows. -->
  {#if editing && stripMode === 'grid' && onSetStartBar}
    {#each barSlices as slice (slice.bar.id)}
      {@const isStart = slice.bar.index === songStartBarIndex}
      <button
        type="button"
        class="absolute top-0 z-[30] flex h-4 w-4 cursor-pointer items-center justify-center rounded-sm leading-none transition-opacity hover:bg-foreground/15 {isStart
          ? 'text-amber-400 opacity-100'
          : 'text-foreground opacity-15 hover:opacity-95'}"
        style:left="{slice.x0 + 2}px"
        onclick={(ev) => {
          ev.stopPropagation()
          onSetStartBar?.(slice.bar.index)
        }}
        title={isStart
          ? `Bar ${slice.bar.index + 1} is the song start`
          : `Set bar ${slice.bar.index + 1} as song start`}
        aria-label={`Set bar ${slice.bar.index + 1} as song start`}
      >
        <span class="text-[10px] font-bold tabular-nums leading-none">▼</span>
      </button>
    {/each}
  {/if}

  <!-- Selection range overlays: outside the hideBarChrome opacity wrapper so they stay visible at every zoom. -->
  {#if stripMode === 'sections' && selectionRangePx}
    <div
      class="pointer-events-none absolute inset-y-0 z-[7] rounded-[2px] bg-amber-400/10 ring-1 ring-inset ring-amber-400/28"
      style:left="{selectionRangePx.x0}px"
      style:width="{selectionRangePx.w}px"
      aria-hidden="true"
    ></div>
  {/if}
  {#if stripMode === 'chords' && chordsSelectionRangePx}
    <div
      class="pointer-events-none absolute inset-y-0 z-[7] rounded-[2px] bg-amber-400/10 ring-1 ring-inset ring-amber-400/28"
      style:left="{chordsSelectionRangePx.x0}px"
      style:width="{chordsSelectionRangePx.w}px"
      aria-hidden="true"
    ></div>
  {/if}

  {#each beatLines as bl (bl.id)}
    <div
      class="pointer-events-none absolute bottom-0 transition-opacity duration-200 ease-out {editing
        ? stripMode === 'sections' || stripMode === 'chords'
          ? 'top-10'
          : 'top-7'
        : 'top-2'} {bl.downbeat ? 'z-[10] w-[2px] bg-foreground/95' : 'w-px bg-foreground/45'}"
      style:left="{bl.x}px"
      style:opacity={bl.downbeat ? 1 : tickDimmed ? 0.28 : 1}
    ></div>
  {/each}

  {#each beatLines as bl (bl.id)}
    {#if editing && stripMode === 'grid' && (bl.songStart || bl.songEnd)}
      <div
        class="pointer-events-none absolute top-8 z-[26] -translate-x-1/2 font-mono text-[9px] font-bold tabular-nums select-none"
        style:left="{bl.x}px"
      >
        {#if bl.songStart}
          <span
            class="pointer-events-none rounded bg-emerald-600/90 px-1 py-px text-white shadow-sm"
            title="Song start (earliest beat)"
            >S</span
          >
        {/if}
        {#if bl.songEnd}
          <span
            class="pointer-events-none mt-0.5 block rounded bg-rose-600/90 px-1 py-px text-white shadow-sm"
            title="Song end (latest beat)"
            >E</span
          >
        {/if}
      </div>
    {/if}
  {/each}

  <div class="pointer-events-none absolute inset-0">
    {#each barSlices as slice (slice.bar.id)}
      {#if editing && stripMode === 'grid'}
        <span
          class="text-muted-foreground absolute top-1 z-[5] truncate text-left font-mono text-[10px] leading-tight tabular-nums"
          style:left="{slice.x0 + 6}px"
          style:max-width="{Math.max(0, slice.w - 12)}px"
          style:opacity={labelOpacityForSlice(slice.w)}
        >
          Bar {slice.bar.index} · {slice.bar.meter.numerator}/{slice.bar.meter.denominator}
        </span>
      {:else if !editing || stripMode === 'sections' || stripMode === 'chords'}
        <span
          class="text-muted-foreground absolute z-[6] truncate font-mono text-[10px] tabular-nums transition-opacity duration-200 ease-out {stripMode === 'sections' ||
          stripMode === 'chords'
            ? 'top-6'
            : 'top-1.5'}"
          style:left="{slice.x0 + 6}px"
          style:max-width="{Math.max(0, slice.w - 10)}px"
          style:opacity={labelOpacityForSlice(slice.w)}
        >
          Bar {slice.bar.index}
        </span>
      {/if}
    {/each}
  </div>
</div>
