<script lang="ts">
  /** Waveform timeline editor orchestration (viewport-driven model). */
  import { onDestroy, tick, untrack } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    ChevronLeft,
    ChevronRight,
    LocateFixed,
    Maximize2,
    Pause,
    Play,
    Square,
    ZoomIn,
    ZoomOut,
  } from '@lucide/svelte'
  import { createAudioTransport, type TransportBindings } from '$lib/audio/audioTransport'
  import { timelineDurationForUi } from '$lib/audio/durationResolve'
  import { formatTime } from '$lib/audio/formatTime'
  import {
    clientXToContentX,
    clientXToTimeInView,
    timeToPxInView,
  } from '$lib/audio/timeGeometry'
  import { drawPeaksToCanvas } from '$lib/audio/waveformDraw'
  import {
    hitTestSelectionTarget,
    hitTestViewportTarget,
  } from '$lib/audio/waveformInteraction'
  import { computePeaks, computePeaksForTimeRange } from '$lib/audio/waveformPeaks'
  import {
    clampSelectionToTimeline,
    MIN_SELECTION_SPAN_SEC,
    moveSelection,
    resizeSelectionLeft,
    resizeSelectionRight,
  } from '$lib/audio/selectionMath'
  import {
    clampViewportToTimeline,
    MIN_VIEW_SPAN_SEC,
    moveViewport,
    recenterViewport,
    resizeViewportLeft,
    resizeViewportRight,
    zoomViewportWithAnchor,
  } from '$lib/audio/viewportMath'
  import { MAX_AUDIO_DURATION_SEC, MAX_WAVE_WIDTH_PX } from '$lib/constants'
  import TimelineBeatGrid from '$lib/components/TimelineBeatGrid.svelte'
  import { triggerBeatPulse } from '$lib/stores/beatPulse'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import { SECTION_KIND_OPTIONS } from '$lib/songmap/sectionEdit'
  import type { BarGridAction } from '$lib/songmap/timelineEdit'
  import type { Bar, Beat, Section, SectionKind } from '$lib/songmap/types'

  type BeatGridModel = { bars: Bar[]; beats: Beat[] }

  /** `trim` = home flow (region selection). `editor` = full-timeline editing (same controls, copy tuned). */
  let {
    file = null,
    rangeStart = $bindable(0),
    rangeEnd = $bindable(0),
    ready = $bindable(false),
    variant = 'trim',
    beatGrid = null as BeatGridModel | null,
    /** When set with `onBarGridAction`, the bar strip edits SongMap bars (equal spacing). */
    beatGridEditable = false,
    /** `grid` = beat/meter editing; `sections` = multi-select bars; `chords` = per-beat harmony. */
    timelineStripMode = 'grid' as 'grid' | 'sections' | 'chords',
    mapSections = [] as Section[],
    onBarGridAction = undefined as ((action: BarGridAction) => void) | undefined,
    /** Sections mode: parent applies tag to current multi-selection. */
    onApplySectionTag = undefined as ((kind: SectionKind) => void) | undefined,
    sectionsSelectionBarIds = $bindable<string[]>([]),
    /** Chords mode: multi-selected beats (timeline order). */
    chordsSelectionBeatIds = $bindable<string[]>([]),
    /** Chords mode: selected timeline beat; parent commits harmony. */
    selectedBeatId = $bindable<string | null>(null),
    /** Resolved + formatted chord label per beat (carry-forward included). */
    chordLabelByBeatId = {} as Record<string, string>,
    /** Chords mode: pointer position when user picks a beat (popover anchor). */
    onChordBeatInteract = undefined as
      | ((detail: { clientX: number; clientY: number }) => void)
      | undefined,
  } = $props()

  let isEditorVariant = $derived(variant === 'editor')
  let beatGridEditing = $derived(
    Boolean(
      isEditorVariant &&
        beatGridEditable &&
        beatGrid &&
        (timelineStripMode === 'sections' || timelineStripMode === 'chords' || onBarGridAction),
    ),
  )

  /** Selected bar in the strip (grid mode). */
  let selectedBarId = $state<string | null>(null)

  let sectionTagChoice = $state<SectionKind>('verse')

  $effect(() => {
    const ids = new Set(beatGrid?.bars.map((b) => b.id) ?? [])
    if (selectedBarId && !ids.has(selectedBarId)) selectedBarId = null
  })

  /** Prune stale bar ids when `beatGrid` changes — must not subscribe to `sectionsSelectionBarIds` or we loop. */
  $effect(() => {
    const ids = new Set(beatGrid?.bars.map((b) => b.id) ?? [])
    const cur = untrack(() => sectionsSelectionBarIds)
    const next = cur.filter((id) => ids.has(id))
    if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) {
      sectionsSelectionBarIds = next
    }
  })

  /** Prune stale beat ids when `beatGrid` changes — must not subscribe to `chordsSelectionBeatIds` or we loop. */
  $effect(() => {
    const ids = new Set(beatGrid?.beats.map((b) => b.id) ?? [])
    const cur = untrack(() => chordsSelectionBeatIds)
    const next = cur.filter((id) => ids.has(id))
    if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) {
      chordsSelectionBeatIds = next
    }
    const sid = untrack(() => selectedBeatId)
    if (sid && !ids.has(sid)) selectedBeatId = null
  })

  let prevTimelineStripMode = $state<'grid' | 'sections' | 'chords' | null>(null)
  $effect(() => {
    const m = timelineStripMode
    if (prevTimelineStripMode !== null && prevTimelineStripMode !== m) {
      selectedBarId = null
      sectionsSelectionBarIds = []
      selectedBeatId = null
      chordsSelectionBeatIds = []
    }
    prevTimelineStripMode = m
  })

  $effect(() => {
    if (!beatGridEditing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectedBarId = null
        sectionsSelectionBarIds = []
        selectedBeatId = null
        chordsSelectionBeatIds = []
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // —— Load / decode ——
  let error = $state('')
  let loading = $state(false)
  /** Monotonic token; ignore async decode results from stale loads. */
  let loadGeneration = $state(0)
  /** Decoded length (seconds) before media element metadata. */
  let decodedDuration = $state(0)

  // —— Canonical transport state (single source of truth for UI + head) ——
  /** Authoritative editor duration consumed by selection / viewport / transport / geometry. */
  let timelineSec = $state(0)
  /** Seconds; ONLY updated from `HTMLAudioElement.currentTime` (rAF while playing, sync when paused). */
  let currentTime = $state(0)
  let isPlaying = $state(false)
  let mediaReady = $state(false)

  // —— Waveform assets ——
  /** Kept for recomputing peaks when the container resizes (full file → fit width). */
  let decodedAudioBuffer = $state<AudioBuffer | null>(null)
  let peaks = $state<Float32Array | null>(null)
  /** Detail canvas width in CSS px — fits available viewport width. */
  let waveWidth = $state(0)
  /** Full-timeline overview for minimap (low bucket count). */
  let overviewPeaks = $state<Float32Array | null>(null)
  let overviewWidth = $state(0)
  /** Visible time window [viewStart, viewEnd] (sec). Sub-range = zoomed detail; full file = [0, duration]. */
  let viewStart = $state(0)
  let viewEnd = $state(0)
  /** When zoomed in and playing, scroll the window so the playhead stays in view (toggle). */
  let followPlayhead = $state(false)
  /** Keep playhead between these fractions of the visible window; scroll only when it leaves the band (reduces peak churn). */
  const FOLLOW_FRAC_LO = 0.26
  const FOLLOW_FRAC_HI = 0.5
  const FOLLOW_FRAC_TARGET = 0.38

  let objectUrl = $state('')
  /** Avoid re-scheduling `loadFile()` when the `$effect` re-runs with the same `File` **reference** (not metadata — new blobs can share size/name/time). */
  let lastScheduledFileRef: File | null = null
  let audioEl = $state<HTMLAudioElement | undefined>()
  let canvas = $state<HTMLCanvasElement | undefined>()
  let detailEl = $state<HTMLDivElement | undefined>()
  /** Row that wraps the detail canvas — better width than outer `detailEl` when the beat strip is hidden (waveWidth === 0). */
  let waveformRowEl = $state<HTMLDivElement | undefined>()
  let interactLayer = $state<HTMLDivElement | undefined>()
  let minimapEl = $state<HTMLDivElement | undefined>()
  let overviewCanvas = $state<HTMLCanvasElement | undefined>()

  const displayH = 144
  const minimapH = 52
  const transport = createAudioTransport()

  /** @type {'idle' | 'maybe-seek' | 'create-selection' | 'move-selection' | 'resize-selection-left' | 'resize-selection-right'} */
  let detailMode = $state('idle')
  /** @type {'idle' | 'drag-viewport' | 'resize-viewport-left' | 'resize-viewport-right'} */
  let minimapMode = $state('idle')
  /** Detail drag session */
  let detailSession = {
    downClientX: 0,
    downClientY: 0,
    pointerTravelMax: 0,
    anchorTime: 0,
    selectionAtDown: { start: 0, end: 0 },
    onSelectionBody: false,
  }
  /** Minimap drag session */
  let minimapSession = {
    downClientX: 0,
    viewAtDown: { start: 0, end: 0 },
  }
  /** Coalesce `computePeaksForTimeRange` during rapid zoom/pan (wheel can fire far above display refresh). */
  let mainPeaksRafId = 0
  /** Past this, empty-area drag becomes “new selection” instead of tap-to-seek (jitter tolerance). */
  const TAP_VS_SELECT_PX = 22

  /** Safe [start,end] for mapping when view state is mid-reset. */
  let layoutViewStart = $derived(
    viewEnd > viewStart ? viewStart : 0,
  )
  let layoutViewEnd = $derived(
    viewEnd > viewStart
      ? viewEnd
      : timelineSec > 0
        ? timelineSec
        : 1,
  )

  let viewWindowLabel = $derived(
    viewEnd > viewStart && timelineSec > 0
      ? `${formatTime(viewStart)} – ${formatTime(viewEnd)}`
      : '',
  )

  /** Hover / scrub preview time (seconds) — visual only until pointerup seek. */
  let hoverTime = $state<number | null>(null)
  let scrubPreviewTime = $state<number | null>(null)
  /**
   * Empty-area press pauses if playing; restore on release (seek, cancel, or selection drag).
   * Plain flag — not reactive UI state.
   */
  let resumePlaybackAfterWaveGesture = false

  let phantomTime = $derived(
    scrubPreviewTime != null ? scrubPreviewTime : hoverTime,
  )
  let phantomX = $derived(
    phantomTime != null && timelineSec > 0 && waveWidth > 0
      ? timeToPxInView(phantomTime, layoutViewStart, layoutViewEnd, waveWidth)
      : null,
  )
  let detailHoverTarget = $state('outside')
  let minimapHoverTarget = $state('outside')
  let pendingMainPeaksRecompute = false

  /**
   * Transport bindings. `currentTime` is only written here (via setCurrentTime), in
   * commitMediaTiming when paused, load/reset — not from timeupdate while playing (see onTimeUpdateSparse).
   */
  function tbind(): TransportBindings {
    return {
      getAudio: () => audioEl,
      getDuration: () => timelineSec,
      getRange: () => ({ start: rangeStart, end: rangeEnd }),
      setCurrentTime: (t) => {
        currentTime = t
      },
      getIsPlaying: () => isPlaying,
      setIsPlaying: (v) => {
        isPlaying = v
      },
    }
  }

  /** Grid mode: seek to selected bar start when selection changes (same as before). */
  $effect(() => {
    if (timelineStripMode !== 'grid' || !beatGridEditing || !selectedBarId || !beatGrid) return
    const bar = beatGrid.bars.find((x) => x.id === selectedBarId)
    if (!bar) return
    const d = timelineSec
    if (!(d > 0) || !mediaReady) return
    const t = Math.min(Math.max(0, bar.startSec), d)
    transport.seek(tbind(), t)
  })

  /** Sections mode: seek after pointer-up (selection commit), not on every drag frame. */
  function seekToSectionsSelection(timeSec: number) {
    if (!beatGridEditing || !mediaReady) return
    const d = timelineSec
    if (!(d > 0)) return
    transport.seek(tbind(), Math.min(Math.max(0, timeSec), d))
  }

  // —— Pure layout: time ↔ x uses the visible window [layoutViewStart, layoutViewEnd] ——
  let selLeft = $derived(
    timeToPxInView(rangeStart, layoutViewStart, layoutViewEnd, waveWidth),
  )
  let selW = $derived(
    timelineSec > 0
      ? timeToPxInView(rangeEnd, layoutViewStart, layoutViewEnd, waveWidth) -
          timeToPxInView(rangeStart, layoutViewStart, layoutViewEnd, waveWidth)
      : 0,
  )
  let playheadX = $derived(
    timeToPxInView(currentTime, layoutViewStart, layoutViewEnd, waveWidth),
  )
  let selRight = $derived(selLeft + selW)
  let showSelectionLeftHandle = $derived(
    rangeStart >= layoutViewStart && rangeStart <= layoutViewEnd,
  )
  let showSelectionRightHandle = $derived(
    rangeEnd >= layoutViewStart && rangeEnd <= layoutViewEnd,
  )
  let detailCursorClass = $derived(
    detailMode === 'move-selection'
      ? 'cursor-grabbing'
      : detailMode === 'resize-selection-left' || detailMode === 'resize-selection-right'
        ? 'cursor-ew-resize'
        : detailMode === 'idle' && detailHoverTarget === 'left-handle'
          ? 'cursor-ew-resize'
          : detailMode === 'idle' && detailHoverTarget === 'right-handle'
            ? 'cursor-ew-resize'
            : detailMode === 'idle' && detailHoverTarget === 'body'
              ? 'cursor-grab'
        : 'cursor-crosshair',
  )
  let minimapCursorClass = $derived(
    minimapMode === 'drag-viewport'
      ? 'cursor-grabbing'
      : minimapMode === 'resize-viewport-left' || minimapMode === 'resize-viewport-right'
        ? 'cursor-ew-resize'
        : minimapMode === 'idle' && minimapHoverTarget === 'left-handle'
          ? 'cursor-ew-resize'
          : minimapMode === 'idle' && minimapHoverTarget === 'right-handle'
            ? 'cursor-ew-resize'
            : minimapMode === 'idle' && minimapHoverTarget === 'body'
              ? 'cursor-grab'
        : 'cursor-crosshair',
  )

  function redrawCanvas() {
    if (peaks && waveWidth > 0 && canvas) {
      drawPeaksToCanvas(canvas, peaks, waveWidth, displayH)
    }
  }

  /** Re-draw whenever peaks, width, or canvas node change (canvas often binds after first peak compute). */
  $effect(() => {
    peaks
    waveWidth
    canvas
    redrawCanvas()
  })

  function redrawOverviewCanvas() {
    if (overviewPeaks && overviewWidth > 0 && overviewCanvas) {
      drawPeaksToCanvas(overviewCanvas, overviewPeaks, overviewWidth, minimapH)
    }
  }

  /**
   * Recompute main waveform peaks + canvas from current view + container width.
   * Called after zoom/pan and from resize — avoids relying only on $effect batching.
   */
  function updateMainPeaksFromState() {
    const buf = decodedAudioBuffer
    const el = waveformRowEl ?? detailEl
    if (!buf || !objectUrl) return
    if (!el) return
    let raw = Math.floor(el.clientWidth)
    if (raw < 48) {
      const br = Math.floor(el.getBoundingClientRect().width)
      if (br >= 48) {
        raw = br
      } else if (typeof window !== 'undefined') {
        raw = Math.min(
          MAX_WAVE_WIDTH_PX,
          Math.max(160, Math.floor(window.innerWidth - 80)),
        )
      }
    }
    if (raw < 48) return
    const w = Math.max(160, Math.min(raw, MAX_WAVE_WIDTH_PX))
    waveWidth = w
    const d = buf.duration
    const vs = viewEnd > viewStart ? viewStart : 0
    const ve = viewEnd > viewStart ? viewEnd : d
    peaks = computePeaksForTimeRange(buf, vs, ve, w)
    redrawCanvas()
  }

  /** At most one peak recompute per animation frame while the viewport changes rapidly. */
  function scheduleMainPeaksUpdate() {
    if (mainPeaksRafId) return
    mainPeaksRafId = requestAnimationFrame(() => {
      mainPeaksRafId = 0
      updateMainPeaksFromState()
    })
  }

  /** Immediate peaks (load, gesture end); cancels a pending scheduled update. */
  function flushMainPeaksUpdate() {
    if (mainPeaksRafId) {
      cancelAnimationFrame(mainPeaksRafId)
      mainPeaksRafId = 0
    }
    updateMainPeaksFromState()
  }

  function setSelection(start, end) {
    const next = clampSelectionToTimeline(timelineSec, start, end, MIN_SELECTION_SPAN_SEC)
    rangeStart = next.start
    rangeEnd = next.end
  }

  function setViewport(start, end) {
    const next = clampViewportToTimeline(timelineSec, start, end, MIN_VIEW_SPAN_SEC)
    viewStart = next.start
    viewEnd = next.end
    scheduleMainPeaksUpdate()
  }

  /** While playing, optionally keep the playhead inside a horizontal band of the zoomed view. */
  $effect(() => {
    if (!followPlayhead || !isPlaying) return
    const d = timelineSec
    if (!(d > 0) || !(viewEnd > viewStart)) return
    const span = viewEnd - viewStart
    if (!(span > 0) || span >= d * 0.999) return
    const t = Math.min(Math.max(0, currentTime), d)
    const frac = (t - viewStart) / span
    if (frac >= FOLLOW_FRAC_LO && frac <= FOLLOW_FRAC_HI) return
    const desiredStart = t - span * FOLLOW_FRAC_TARGET
    const next = clampViewportToTimeline(d, desiredStart, desiredStart + span, MIN_VIEW_SPAN_SEC)
    if (Math.abs(next.start - viewStart) < 0.004 && Math.abs(next.end - viewEnd) < 0.004) return
    setViewport(next.start, next.end)
  })

  let viewPortLeftPct = $derived(
    timelineSec > 0 && viewEnd > viewStart
      ? (viewStart / timelineSec) * 100
      : 0,
  )
  let viewPortWidthPct = $derived(
    timelineSec > 0 && viewEnd > viewStart
      ? ((viewEnd - viewStart) / timelineSec) * 100
      : 100,
  )
  let selectionLeftMinimapPct = $derived(
    timelineSec > 0
      ? (rangeStart / timelineSec) * 100
      : 0,
  )
  let selectionWidthMinimapPct = $derived(
    timelineSec > 0
      ? ((rangeEnd - rangeStart) / timelineSec) * 100
      : 0,
  )
  let playheadMinimapPct = $derived(
    timelineSec > 0
      ? (Math.max(0, Math.min(currentTime, timelineSec)) / timelineSec) * 100
      : 0,
  )

  /** Time range [startSec, endSec) of the current edit-mode selection (sections or chords). */
  let editSelectionTimeSec = $derived.by((): { startSec: number; endSec: number } | null => {
    if (!beatGrid || timelineStripMode === 'grid') return null

    if (timelineStripMode === 'sections' && sectionsSelectionBarIds.length > 0) {
      const byId = new Map(beatGrid.bars.map((b) => [b.id, b]))
      let t0 = Number.POSITIVE_INFINITY
      let t1 = Number.NEGATIVE_INFINITY
      for (const id of sectionsSelectionBarIds) {
        const b = byId.get(id)
        if (!b) continue
        if (b.startSec < t0) t0 = b.startSec
        if (b.endSec > t1) t1 = b.endSec
      }
      return isFinite(t0) && t1 > t0 ? { startSec: t0, endSec: t1 } : null
    }

    if (timelineStripMode === 'chords' && chordsSelectionBeatIds.length > 0) {
      const sorted = sortBeatsByTime(beatGrid.beats)
      const selSet = new Set(chordsSelectionBeatIds)
      const barsById = new Map(beatGrid.bars.map((b) => [b.id, b]))
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
      return isFinite(t0) && t1 > t0 ? { startSec: t0, endSec: t1 } : null
    }

    return null
  })

  let editSelLeft = $derived(
    editSelectionTimeSec && waveWidth > 0
      ? timeToPxInView(editSelectionTimeSec.startSec, layoutViewStart, layoutViewEnd, waveWidth)
      : 0,
  )
  let editSelW = $derived(
    editSelectionTimeSec && waveWidth > 0
      ? timeToPxInView(editSelectionTimeSec.endSec, layoutViewStart, layoutViewEnd, waveWidth) - editSelLeft
      : 0,
  )
  let editSelMinimapLeftPct = $derived(
    editSelectionTimeSec && timelineSec > 0
      ? (editSelectionTimeSec.startSec / timelineSec) * 100
      : 0,
  )
  let editSelMinimapWidthPct = $derived(
    editSelectionTimeSec && timelineSec > 0
      ? ((editSelectionTimeSec.endSec - editSelectionTimeSec.startSec) / timelineSec) * 100
      : 0,
  )

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

  type WaveformSectionSpan = { key: string; kind: string; x0Pct: number; wPct: number; xPx: number; wPx: number }

  /** Section tint spans for waveform + minimap. */
  let waveformSectionSpans = $derived.by((): WaveformSectionSpan[] => {
    if (!beatGrid || timelineStripMode !== 'sections' || mapSections.length === 0 || !(timelineSec > 0)) {
      return []
    }
    const byIndex = new Map(beatGrid.bars.map((b) => [b.index, b]))
    const out: WaveformSectionSpan[] = []
    for (const sec of mapSections) {
      const inRange: Bar[] = []
      for (let i = sec.barRange.startBarIndex; i <= sec.barRange.endBarIndex; i++) {
        const b = byIndex.get(i)
        if (b) inRange.push(b)
      }
      if (inRange.length === 0) continue
      const t0 = Math.min(...inRange.map((b) => b.startSec))
      const t1 = Math.max(...inRange.map((b) => b.endSec))
      if (!(t1 > t0)) continue
      const x0Pct = (t0 / timelineSec) * 100
      const wPct = ((t1 - t0) / timelineSec) * 100
      const xPx = waveWidth > 0 ? timeToPxInView(Math.max(t0, layoutViewStart), layoutViewStart, layoutViewEnd, waveWidth) : 0
      const wPx = waveWidth > 0
        ? timeToPxInView(Math.min(t1, layoutViewEnd), layoutViewStart, layoutViewEnd, waveWidth) - xPx
        : 0
      out.push({ key: sec.id, kind: sec.kind, x0Pct, wPct, xPx, wPx })
    }
    return out
  })

  function minimapXToTime(clientX) {
    if (!minimapEl || !(timelineSec > 0)) return 0
    const rect = minimapEl.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return frac * timelineSec
  }

  function onMinimapPointerMove(e) {
    if (!minimapEl || !(timelineSec > 0) || minimapMode === 'idle') return
    if (minimapMode === 'drag-viewport') {
      const rect = minimapEl.getBoundingClientRect()
      if (rect.width < 8) return
      const deltaT = ((e.clientX - minimapSession.downClientX) / rect.width) * timelineSec
      const moved = moveViewport(
        timelineSec,
        minimapSession.viewAtDown.start,
        minimapSession.viewAtDown.end,
        deltaT,
      )
      setViewport(moved.start, moved.end)
      return
    }
    applyMinimapModeAtTime(e.clientX)
  }

  function beginMinimapSession(e) {
    minimapSession = {
      downClientX: e.clientX,
      viewAtDown: { start: viewStart, end: viewEnd },
    }
  }

  function applyMinimapModeAtTime(clientX) {
    const t = minimapXToTime(clientX)
    if (minimapMode === 'resize-viewport-left') {
      const next = resizeViewportLeft(
        timelineSec,
        minimapSession.viewAtDown.start,
        minimapSession.viewAtDown.end,
        t,
      )
      setViewport(next.start, next.end)
      return
    }
    if (minimapMode === 'resize-viewport-right') {
      const next = resizeViewportRight(
        timelineSec,
        minimapSession.viewAtDown.start,
        minimapSession.viewAtDown.end,
        t,
      )
      setViewport(next.start, next.end)
    }
  }

  /**
   * @param {PointerEvent} e
   */
  function onMinimapPointerMoveHover(e) {
    if (minimapMode !== 'idle' || !minimapEl || !(timelineSec > 0)) return
    const rect = minimapEl.getBoundingClientRect()
    const xPx = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    minimapHoverTarget = hitTestViewportTarget(
      xPx,
      viewStart,
      viewEnd,
      timelineSec,
      rect.width,
    )
  }

  function onMinimapPointerLeave() {
    if (minimapMode === 'idle') minimapHoverTarget = 'outside'
  }

  function onMinimapPointerUp() {
    minimapMode = 'idle'
    minimapHoverTarget = 'outside'
    window.removeEventListener('pointermove', onMinimapPointerMove)
    window.removeEventListener('pointerup', onMinimapPointerUp)
    window.removeEventListener('pointercancel', onMinimapPointerUp)
  }

  /**
   * @param {PointerEvent} e
   */
  function onMinimapPointerDown(e) {
    minimapHoverTarget = 'outside'
    if (e.button !== 0 || !minimapEl || !(timelineSec > 0)) return
    followPlayhead = false
    const rect = minimapEl.getBoundingClientRect()
    const rw = rect.width
    if (rw < 8) return
    const xPx = Math.max(0, Math.min(rw, e.clientX - rect.left))
    const t = minimapXToTime(e.clientX)
    const target = hitTestViewportTarget(
      xPx,
      viewStart,
      viewEnd,
      timelineSec,
      rw,
    )
    beginMinimapSession(e)
    if (target === 'left-handle') {
      minimapMode = 'resize-viewport-left'
    } else if (target === 'right-handle') {
      minimapMode = 'resize-viewport-right'
    } else if (target === 'body') {
      minimapMode = 'drag-viewport'
    } else {
      minimapMode = 'idle'
      const centered = recenterViewport(timelineSec, viewStart, viewEnd, t)
      setViewport(centered.start, centered.end)
      return
    }
    window.addEventListener('pointermove', onMinimapPointerMove)
    window.addEventListener('pointerup', onMinimapPointerUp)
    window.addEventListener('pointercancel', onMinimapPointerUp)
  }

  /** Narrow (factor under 1) or widen (factor over 1) the window around `anchorSec`. */
  function zoomWithAnchor(factor, anchorSec) {
    const next = zoomViewportWithAnchor(timelineSec, viewStart, viewEnd, factor, anchorSec)
    setViewport(next.start, next.end)
  }

  function zoomIn() {
    followPlayhead = false
    const c = (layoutViewStart + layoutViewEnd) * 0.5
    zoomWithAnchor(0.5, c)
  }

  function zoomOut() {
    followPlayhead = false
    const c = (layoutViewStart + layoutViewEnd) * 0.5
    zoomWithAnchor(2, c)
  }

  function zoomFitAll() {
    followPlayhead = false
    const d = timelineSec
    if (d <= 0) return
    setViewport(0, d)
  }

  /** Shift the visible window by a fraction of the current span (negative = left / earlier). */
  function panView(fractionOfSpan) {
    followPlayhead = false
    if (!(timelineSec > 0) || viewEnd <= viewStart) return
    const span = viewEnd - viewStart
    const shifted = moveViewport(timelineSec, viewStart, viewEnd, span * fractionOfSpan)
    setViewport(shifted.start, shifted.end)
  }

  /** Horizontal trackpad / Shift+vertical wheel: pan detail view (not Ctrl/Cmd+zoom). */
  function wheelWantsPan(e: WheelEvent): boolean {
    if (e.ctrlKey || e.metaKey) return false
    if (e.shiftKey && Math.abs(e.deltaY) > 0) return true
    const ax = Math.abs(wheelPanDeltaX(e))
    if (ax < 1e-4) return false
    const ay = Math.abs(e.deltaY)
    // Mac trackpad often mixes a bit of deltaY on horizontal swipes; don't require |dx| >= |dy|.
    if (ay < 1e-4) return true
    return ax >= ay * 0.35
  }

  /**
   * Call `preventDefault` for horizontal wheel so the browser does not map the gesture to
   * history back/forward — broader than `wheelWantsPan` so diagonal swipes still cancel navigation
   * even when we do not move the viewport (e.g. edge of timeline).
   */
  function shouldBlockHorizontalWheelHistory(e: WheelEvent): boolean {
    if (e.ctrlKey || e.metaKey) return false
    if (e.shiftKey && Math.abs(e.deltaY) > 0) return true
    if (wheelWantsPan(e)) return true
    const ax = Math.abs(wheelPanDeltaX(e))
    if (ax < 0.5) return false
    const ay = Math.abs(e.deltaY)
    if (ay < 0.5) return true
    return ax >= ay * 0.12
  }

  function wheelPanDeltaX(e: WheelEvent): number {
    if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return -e.deltaY
    let dx = e.deltaX
    // WebKit sometimes leaves deltaX at 0 but sets wheelDeltaX for horizontal trackpad swipes.
    if (Math.abs(dx) < 1e-6) {
      const wdx = (e as WheelEvent & { wheelDeltaX?: number }).wheelDeltaX
      if (typeof wdx === 'number' && wdx !== 0) dx = -wdx / 12
    }
    return dx
  }

  /**
   * Map horizontal wheel delta to time shift: `widthPx` spans `timeSpanSec` seconds.
   * When we recognize a horizontal pan gesture, always `preventDefault` first so Chrome does not
   * treat it as history back/forward (losing in-app state). Returns true if default was prevented.
   */
  function tryWheelPan(e: WheelEvent, widthPx: number, timeSpanSec: number): boolean {
    const wantsPan = wheelWantsPan(e)
    const blockHistory = shouldBlockHorizontalWheelHistory(e)
    if (!wantsPan && !blockHistory) return false
    e.preventDefault()
    followPlayhead = false
    const d = timelineSec
    if (!wantsPan || d <= 0 || widthPx <= 0 || !(viewEnd > viewStart) || !(timeSpanSec > 0)) return true
    const dx = wheelPanDeltaX(e)
    const deltaSec = (dx / widthPx) * timeSpanSec
    const shifted = moveViewport(d, viewStart, viewEnd, deltaSec)
    setViewport(shifted.start, shifted.end)
    return true
  }

  /** One place to align authoritative timeline + ranges with media lifecycle. */
  function commitMediaTiming() {
    const d = timelineDurationForUi(decodedDuration)
    timelineSec = d
    setSelection(rangeStart, rangeEnd)
    const v = clampViewportToTimeline(d, viewStart, viewEnd, MIN_VIEW_SPAN_SEC)
    viewStart = v.start
    viewEnd = v.end
    // While playing, only rAF reads the element clock — avoid a stray metadata callback resetting UI time.
    if (!isPlaying && audioEl) {
      let t = audioEl.currentTime
      if (Number.isFinite(d) && d > 0) t = Math.min(Math.max(0, t), d)
      currentTime = t
    }
  }

  function finalizeMediaIfReady() {
    if (!audioEl || mediaReady) return
    mediaReady = true
    ready = true
    commitMediaTiming()
  }

  /**
   * Web Audio decode is authoritative for peaks/timeline. Do not block the waveform on
   * `<audio>` `canplay` / HAVE_FUTURE_DATA — blob MP3 can decode via AudioContext while the
   * media element never reaches a “ready” state in some environments.
   */
  function markMediaReadyAfterDecode() {
    if (mediaReady) return
    mediaReady = true
    ready = true
    commitMediaTiming()
  }

  async function loadFile() {
    if (!file) return
    const gen = ++loadGeneration
    loading = true
    ready = false
    mediaReady = false
    error = ''
    peaks = null
    waveWidth = 0
    decodedAudioBuffer = null
    timelineSec = 0
    decodedDuration = 0
    transport.stopRaf()

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = ''
    }
    if (audioEl) {
      audioEl.pause()
      isPlaying = false
      currentTime = 0
    }

    const ac = new AudioContext()
    try {
      const ab = await file.arrayBuffer()
      if (gen !== loadGeneration) return

      const buf = await ac.decodeAudioData(ab.slice(0))
      if (gen !== loadGeneration) return

      if (buf.duration > MAX_AUDIO_DURATION_SEC) {
        const m = Math.floor(MAX_AUDIO_DURATION_SEC / 60)
        error = `Audio must be ${m} minutes or shorter (this file is ${formatTime(buf.duration)}).`
        loading = false
        return
      }

      decodedDuration = buf.duration
      timelineSec = buf.duration
      decodedAudioBuffer = buf
      viewStart = 0
      viewEnd = buf.duration

      objectUrl = URL.createObjectURL(file)

      // If rangeStart/rangeEnd are already set to a valid sub-range (e.g. seeded from saved trim),
      // keep them. Otherwise default to full file.
      const hasValidRange =
        rangeStart >= 0 &&
        rangeEnd > rangeStart &&
        rangeEnd <= buf.duration + 0.1
      const initStart = hasValidRange ? rangeStart : 0
      const initEnd = hasValidRange ? Math.min(rangeEnd, buf.duration) : buf.duration
      const full = clampSelectionToTimeline(buf.duration, initStart, initEnd, MIN_SELECTION_SPAN_SEC)
      setSelection(full.start, full.end)

      loading = false

      await tick()
      await tick()
      if (gen !== loadGeneration) return
      markMediaReadyAfterDecode()
      /** `loading` just became false — layout may not have `detailEl`/canvas yet; refresh peaks after paint. */
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })
      if (gen !== loadGeneration) return
      flushMainPeaksUpdate()
    } catch {
      if (gen !== loadGeneration) return
      error = 'Could not decode this audio file.'
      loading = false
    } finally {
      await ac.close().catch(() => {})
    }
  }

  $effect(() => {
    if (!file) {
      lastScheduledFileRef = null
      error = ''
      ready = false
      mediaReady = false
      loading = false
      peaks = null
      waveWidth = 0
      overviewPeaks = null
      overviewWidth = 0
      decodedAudioBuffer = null
      viewStart = 0
      viewEnd = 0
      timelineSec = 0
      decodedDuration = 0
      transport.stopRaf()
      loadGeneration += 1
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = ''
      }
      return
    }
    if (file === lastScheduledFileRef) return
    lastScheduledFileRef = file
    /** Defer past this effect flush — sync `loadFile()` re-enters the runtime and can hit `effect_update_depth_exceeded`. */
    loading = true
    tick().then(() => loadFile())
  })

  /** Main waveform: resize recomputes width + peaks for the current view. */
  $effect(() => {
    decodedAudioBuffer
    objectUrl
    detailEl
    waveformRowEl
    /** Include so we re-apply after <canvas bind:this> — otherwise first redraw can run before canvas exists. */
    canvas
    const el = waveformRowEl ?? detailEl
    if (!el || !decodedAudioBuffer || !objectUrl) return
    let resizeDebounce = 0
    const apply = () => {
      /** Skip expensive peak recompute only while dragging — once `waveWidth` is still 0 we must compute. */
      if (detailMode !== 'idle' && waveWidth > 0) {
        pendingMainPeaksRecompute = true
        return
      }
      pendingMainPeaksRecompute = false
      scheduleMainPeaksUpdate()
    }

    const scheduleApply = () => {
      if (resizeDebounce) cancelAnimationFrame(resizeDebounce)
      resizeDebounce = requestAnimationFrame(() => {
        resizeDebounce = 0
        apply()
      })
    }

    const ro = new ResizeObserver(() => scheduleApply())
    ro.observe(el)
    /** Double rAF: flex layout often reports `clientWidth === 0` until after layout/paint. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => apply())
    })
    return () => {
      ro.disconnect()
      if (resizeDebounce) cancelAnimationFrame(resizeDebounce)
    }
  })

  /** Minimap: full-file overview waveform (fixed vertical size). */
  $effect(() => {
    decodedAudioBuffer
    objectUrl
    minimapEl
    overviewCanvas
    if (!minimapEl || !decodedAudioBuffer || !objectUrl) return

    const buf = decodedAudioBuffer
    const el = minimapEl

    let overviewDebounce = 0
    const applyOverview = () => {
      const raw = Math.floor(el.clientWidth)
      if (raw < 48) return
      /** Must match minimap inner width: a hard cap (previously 800px) left empty space on wide layouts so the viewport box did not align with the overview waveform. */
      const w = Math.max(120, Math.min(raw, MAX_WAVE_WIDTH_PX))
      overviewWidth = w
      overviewPeaks = computePeaks(buf, w)
      redrawOverviewCanvas()
    }

    const scheduleOverview = () => {
      if (overviewDebounce) cancelAnimationFrame(overviewDebounce)
      overviewDebounce = requestAnimationFrame(() => {
        overviewDebounce = 0
        applyOverview()
      })
    }

    const ro = new ResizeObserver(() => scheduleOverview())
    ro.observe(el)
    requestAnimationFrame(() => applyOverview())
    return () => {
      ro.disconnect()
      if (overviewDebounce) cancelAnimationFrame(overviewDebounce)
    }
  })

  /** Ctrl/Cmd + wheel = zoom; horizontal trackpad / Shift+scroll = pan (detail maps pixels ↔ visible span). */
  $effect(() => {
    timelineSec
    viewStart
    viewEnd
    waveWidth
    if (!detailEl || !objectUrl) return
    const el = detailEl
    const onWheel = /** @param {WheelEvent} e */ (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const d = timelineSec
        if (d <= 0) return
        const vs = viewEnd > viewStart ? viewStart : 0
        const ve = viewEnd > viewStart ? viewEnd : d
        const ww = waveWidth
        const t =
          ww > 0
            ? clientXToTimeInView(e.clientX, el, ww, vs, ve)
            : d * 0.5
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
        zoomWithAnchor(factor, t)
        return
      }
      const span = viewEnd > viewStart ? viewEnd - viewStart : 0
      tryWheelPan(e, waveWidth, span)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  /** Minimap: horizontal wheel pans the detail viewport across the full timeline. */
  $effect(() => {
    timelineSec
    viewStart
    viewEnd
    overviewWidth
    if (!minimapEl || !objectUrl) return
    const el = minimapEl
    const w = overviewWidth
    const onWheel = /** @param {WheelEvent} e */ (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const d = timelineSec
        if (d <= 0) return
        const t = w > 0 ? clientXToTimeInView(e.clientX, el, w, 0, d) : d * 0.5
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
        zoomWithAnchor(factor, t)
        return
      }
      tryWheelPan(e, w, timelineSec)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  /** If `canplay` already happened before we subscribed. */
  $effect(() => {
    if (!audioEl || !objectUrl || mediaReady) return
    if (audioEl.readyState >= 3) finalizeMediaIfReady()
  })

  /** Grid / editor: pulse page background on each beat while playing. */
  $effect(() => {
    if (!isEditorVariant || !beatGrid?.beats.length || !isPlaying || !audioEl) return

    const beats = [...beatGrid.beats].sort((a, b) => a.timeSec - b.timeSec)
    const times = beats.map((b) => b.timeSec)
    const accents = beats.map((b) => b.indexInBar === 0)
    const el = audioEl

    let prevT = el.currentTime
    let nextIdx = times.findIndex((bt) => bt >= prevT - 0.02)
    if (nextIdx < 0) nextIdx = times.length

    let raf = 0
    function tick() {
      const t = el.currentTime
      if (t < prevT - 0.03) {
        nextIdx = 0
        while (nextIdx < times.length && times[nextIdx]! < t) nextIdx++
      }
      while (nextIdx < times.length && t + 1e-4 >= times[nextIdx]!) {
        triggerBeatPulse(accents[nextIdx]!)
        nextIdx++
      }
      prevT = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  $effect(() => {
    return () => {
      transport.destroy()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  })

  onDestroy(() => {
    transport.destroy()
    if (mainPeaksRafId) cancelAnimationFrame(mainPeaksRafId)
  })

  // —— Interaction: time from pointer ——
  function timeAtClientX(clientX) {
    if (!detailEl || !(waveWidth > 0)) return 0
    return clientXToTimeInView(
      clientX,
      detailEl,
      waveWidth,
      layoutViewStart,
      layoutViewEnd,
    )
  }

  function contentXAtClient(clientX) {
    if (!detailEl) return 0
    return clientXToContentX(clientX, detailEl)
  }

  /** Attach window-level pointer tracking for active detail drags. */
  function attachPointerTracking(e, opts) {
    window.addEventListener('pointermove', onWavePointerMove)
    const finish = /** @param {PointerEvent} ev */ (ev) => {
      window.removeEventListener('pointermove', onWavePointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      onWavePointerUp(ev)
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    if (opts.capture) {
      try {
        interactLayer?.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    if (opts.preventDefault) {
      e.preventDefault()
    }
  }

  /**
   * Hover preview (no button pressed). Hidden while a waveform drag is active.
   * @param {PointerEvent} e
   */
  function onWavePointerMoveHover(e) {
    if (!(timelineSec > 0) || !(waveWidth > 0) || !mediaReady || !detailEl) return
    if (detailMode !== 'idle') return
    // Desktop: buttons===0. Touch has no hover; some browsers report buttons oddly — skip touch hover.
    if (e.pointerType === 'touch') return
    if (e.buttons !== 0) return
    const xPx = contentXAtClient(e.clientX)
    detailHoverTarget = hitTestSelectionTarget(
      xPx,
      rangeStart,
      rangeEnd,
      layoutViewStart,
      layoutViewEnd,
      waveWidth,
    )
    hoverTime = timeAtClientX(e.clientX)
  }

  function onWavePointerLeave() {
    if (detailMode === 'idle') {
      hoverTime = null
      detailHoverTarget = 'outside'
    }
  }

  function beginDetailSession(e, target, t) {
    detailSession = {
      downClientX: e.clientX,
      downClientY: e.clientY,
      pointerTravelMax: 0,
      anchorTime: t,
      selectionAtDown: { start: rangeStart, end: rangeEnd },
      onSelectionBody: target === 'body',
    }
  }

  function beginDetailMaybeSeek(e, t) {
    detailMode = 'maybe-seek'
    scrubPreviewTime = t
    resumePlaybackAfterWaveGesture = isPlaying
    if (isPlaying) transport.pause(tbind())
    attachPointerTracking(e, { capture: false, preventDefault: false })
  }

  function transitionDetailMaybeSeek(e, t) {
    if (detailMode !== 'maybe-seek') return false
    scrubPreviewTime = t
    if (detailSession.pointerTravelMax <= TAP_VS_SELECT_PX) return true
    scrubPreviewTime = null
    if (detailSession.onSelectionBody) {
      detailMode = 'move-selection'
    } else {
      detailMode = 'create-selection'
      detailSession.anchorTime = timeAtClientX(detailSession.downClientX)
    }
    try {
      interactLayer?.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    e.preventDefault()
    return false
  }

  function applyDetailModeAtTime(t) {
    if (detailMode === 'create-selection') {
      const a = detailSession.anchorTime
      const b = t
      setSelection(a, b)
      return
    }
    if (detailMode === 'resize-selection-left') {
      const r = resizeSelectionLeft(
        timelineSec,
        detailSession.selectionAtDown.start,
        detailSession.selectionAtDown.end,
        t,
      )
      setSelection(r.start, r.end)
      return
    }
    if (detailMode === 'resize-selection-right') {
      const r = resizeSelectionRight(
        timelineSec,
        detailSession.selectionAtDown.start,
        detailSession.selectionAtDown.end,
        t,
      )
      setSelection(r.start, r.end)
      return
    }
    if (detailMode === 'move-selection') {
      const dt = t - detailSession.anchorTime
      const r = moveSelection(
        timelineSec,
        detailSession.selectionAtDown.start,
        detailSession.selectionAtDown.end,
        dt,
      )
      setSelection(r.start, r.end)
    }
  }

  function finishDetailSession(e) {
    const seekTap =
      detailMode === 'maybe-seek' &&
      detailSession.pointerTravelMax <= TAP_VS_SELECT_PX
    if (seekTap) {
      transport.seek(tbind(), timeAtClientX(e.clientX))
    }
    scrubPreviewTime = null
    if (resumePlaybackAfterWaveGesture) {
      transport.play(tbind())
    }
    resumePlaybackAfterWaveGesture = false
    detailSession.onSelectionBody = false
    detailMode = 'idle'
    if (pendingMainPeaksRecompute) {
      pendingMainPeaksRecompute = false
      flushMainPeaksUpdate()
    }
  }

  function onWavePointerDown(e) {
    hoverTime = null
    detailHoverTarget = 'outside'
    resumePlaybackAfterWaveGesture = false
    detailMode = 'idle'
    if (!(timelineSec > 0) || !(waveWidth > 0) || !mediaReady || !detailEl) return
    if (e.button !== 0) return
    const xPx = contentXAtClient(e.clientX)
    const target = hitTestSelectionTarget(
      xPx,
      rangeStart,
      rangeEnd,
      layoutViewStart,
      layoutViewEnd,
      waveWidth,
    )
    const t = timeAtClientX(e.clientX)
    beginDetailSession(e, target, t)
    if (target === 'left-handle') {
      detailMode = 'resize-selection-left'
      attachPointerTracking(e, { capture: true, preventDefault: true })
    } else if (target === 'right-handle') {
      detailMode = 'resize-selection-right'
      attachPointerTracking(e, { capture: true, preventDefault: true })
    } else {
      beginDetailMaybeSeek(e, t)
    }
  }

  /**
   * @param {PointerEvent} e
   */
  function onWavePointerMove(e) {
    if (detailMode === 'idle') return
    detailSession.pointerTravelMax = Math.max(
      detailSession.pointerTravelMax,
      Math.hypot(e.clientX - detailSession.downClientX, e.clientY - detailSession.downClientY),
    )
    const t = timeAtClientX(e.clientX)
    if (transitionDetailMaybeSeek(e, t)) return
    applyDetailModeAtTime(t)
  }

  /**
   * @param {PointerEvent} e
   */
  function onWavePointerUp(e) {
    finishDetailSession(e)
    try {
      if (
        typeof interactLayer?.hasPointerCapture === 'function' &&
        interactLayer.hasPointerCapture(e.pointerId)
      ) {
        interactLayer.releasePointerCapture(e.pointerId)
      }
    } catch {
      /* ignore */
    }
  }

  /** Pause: stay at current time. Play: from current head (clamped into selection if needed). */
  function togglePlay() {
    if (!audioEl || !mediaReady || !(timelineSec > 0)) return
    if (isPlaying) {
      transport.pause(tbind())
      return
    }
    transport.ensurePlayheadInRange(tbind())
    transport.play(tbind())
  }

  function keyTargetIsEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const t = target.tagName
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'
  }

  $effect(() => {
    if (!mediaReady || !(timelineSec > 0)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat) return
      if (keyTargetIsEditable(e.target)) return
      e.preventDefault()
      togglePlay()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  /** Stop: pause and jump to the start of the selection (purple). Next Play begins there. */
  function stopPlayback() {
    if (!audioEl || !mediaReady || !(timelineSec > 0)) return
    transport.pause(tbind())
    transport.seek(tbind(), rangeStart)
  }

  function onAudioPlay() {
    transport.onPlay(tbind())
  }

  function onAudioPause() {
    transport.onPause(tbind())
  }

  /** Sparse `timeupdate` — only when paused (rAF owns the clock during playback). */
  function onTimeUpdateSparse() {
    if (isPlaying) return
    transport.syncPausedFromElement(tbind())
  }

  function onLoadedMetadata() {
    commitMediaTiming()
  }

  function onCanPlay() {
    finalizeMediaIfReady()
  }

  function onAudioError() {
    const el = audioEl
    const code = el?.error?.code
    const msg = el?.error?.message ?? 'unknown'
    error = `Audio playback failed (${code ?? '?'}): ${msg}`
    mediaReady = false
  }

  /** Blob URL changes need an explicit `load()` so the element picks up the new resource reliably. */
  $effect(() => {
    if (!audioEl || !objectUrl) return
    audioEl.load()
  })
</script>

{#if error}
  <p class="text-destructive text-center text-sm">{error}</p>
{:else if loading}
  <div
    class="border-foreground/10 bg-foreground/5 flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border px-6 py-12"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div
      class="border-muted-foreground/30 border-t-foreground/80 size-10 animate-spin rounded-full border-2"
    ></div>
    <p class="text-muted-foreground text-sm">Decoding audio…</p>
  </div>
{:else if objectUrl && decodedDuration > 0}
  <audio
    bind:this={audioEl}
    src={objectUrl}
    class="hidden"
    preload="auto"
    onerror={onAudioError}
    onloadedmetadata={onLoadedMetadata}
    oncanplay={onCanPlay}
    ontimeupdate={onTimeUpdateSparse}
    onplay={onAudioPlay}
    onpause={onAudioPause}
    onended={onAudioPause}
  ></audio>

  <div class="flex w-full min-w-0 flex-col gap-3">
    <div class="flex flex-wrap items-center justify-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        class="gap-2"
        disabled={!mediaReady}
        onclick={togglePlay}
      >
        {#if isPlaying}
          <Pause class="size-4" aria-hidden="true" />
          Pause
        {:else}
          <Play class="size-4" aria-hidden="true" />
          Play
        {/if}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="gap-2"
        disabled={!mediaReady}
        onclick={stopPlayback}
        title="Stop and go to selection start"
      >
        <Square class="size-4" aria-hidden="true" />
        Stop
      </Button>
      <span class="text-muted-foreground font-mono text-xs tabular-nums">
        {formatTime(currentTime)} / {formatTime(timelineSec)}
      </span>
      <span class="text-muted-foreground text-xs">
        Selection: {formatTime(rangeStart)} – {formatTime(rangeEnd)}
      </span>
    </div>

    <div
      class="border-foreground/10 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed px-2 py-1.5"
      aria-label="Waveform zoom"
    >
      <span class="text-muted-foreground font-mono text-[10px] tabular-nums">View {viewWindowLabel}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="size-8 p-0"
        disabled={!mediaReady}
        onclick={zoomIn}
        title="Zoom in"
      >
        <ZoomIn class="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="size-8 p-0"
        disabled={!mediaReady}
        onclick={zoomOut}
        title="Zoom out"
      >
        <ZoomOut class="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="size-8 p-0"
        disabled={!mediaReady}
        onclick={() => panView(-0.2)}
        title="Pan earlier"
      >
        <ChevronLeft class="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="size-8 p-0"
        disabled={!mediaReady}
        onclick={() => panView(0.2)}
        title="Pan later"
      >
        <ChevronRight class="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="size-8 p-0"
        disabled={!mediaReady}
        onclick={zoomFitAll}
        title="Show full file"
      >
        <Maximize2 class="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant={followPlayhead ? 'secondary' : 'ghost'}
        size="sm"
        class="size-8 p-0"
        disabled={!mediaReady}
        onclick={() => {
          followPlayhead = !followPlayhead
        }}
        title="Follow playhead while zoomed (stops when you pan or use zoom controls)"
      >
        <LocateFixed class="size-4" aria-hidden="true" />
      </Button>
    </div>

    <p class="text-muted-foreground text-center text-[11px]">
      {#if isEditorVariant}
        Ctrl/Cmd+scroll to zoom · two-finger / Shift+scroll to pan (waveform, bar strip, minimap) · Grid: click bar,
        vertical wheel = beats/bar; Sections: drag across bars, Shift+click range, ⌘/Ctrl+click toggle · Chords: drag or
        Shift+click beat range, ⌘/Ctrl+click toggle; click a beat opens the picker · ⌘/Ctrl+C / ⌘/Ctrl+V copy & paste
        resolved chords · Esc clears selection
      {:else}
        Ctrl/Cmd+scroll to zoom · two-finger / Shift+scroll to pan · top waveform: handles resize, body moves, outside
        drag creates selection, tap seeks · minimap: viewport handles resize, body drags, outside recenters
      {/if}
    </p>

    <div
      bind:this={detailEl}
      class="text-foreground border-foreground/10 bg-foreground/5 flex w-full min-w-0 max-w-full flex-col overflow-hidden overscroll-x-contain rounded-xl border"
    >
      {#if beatGrid && beatGrid.bars.length > 0 && waveWidth > 0 && timelineSec > 0}
        <TimelineBeatGrid
          viewStart={layoutViewStart}
          viewEnd={layoutViewEnd}
          widthPx={waveWidth}
          bars={beatGrid.bars}
          beats={beatGrid.beats}
          editable={beatGridEditing}
          stripMode={timelineStripMode}
          mapSections={mapSections}
          onAction={onBarGridAction}
          bind:selectedBarId
          bind:selectedBarIds={sectionsSelectionBarIds}
          bind:selectedBeatId
          bind:chordsSelectionBeatIds
          chordLabelByBeatId={chordLabelByBeatId}
          onSectionsSeekCommit={timelineStripMode === 'sections' ? seekToSectionsSelection : undefined}
          onViewportWheel={(e) => tryWheelPan(e, waveWidth, layoutViewEnd - layoutViewStart)}
          onChordBeatInteract={onChordBeatInteract}
        />
        {#if beatGridEditing && timelineStripMode === 'grid' && onBarGridAction}
          <div
            class="border-foreground/10 bg-muted/20 flex flex-wrap items-center gap-2 border-b px-2 py-1.5"
            role="toolbar"
            aria-label="Bar timeline"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              onclick={() => onBarGridAction?.({ type: 'addBarAtStart' })}
            >
              + Bar at start
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              onclick={() => onBarGridAction?.({ type: 'addBarAtEnd' })}
            >
              + Bar at end
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              disabled={beatGrid.bars.length <= 1}
              onclick={() => onBarGridAction?.({ type: 'removeBarAtStart' })}
            >
              − First bar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              disabled={beatGrid.bars.length <= 1}
              onclick={() => onBarGridAction?.({ type: 'removeBarAtEnd' })}
            >
              − Last bar
            </Button>
          </div>
        {/if}
        {#if beatGridEditing && timelineStripMode === 'grid' && selectedBarId && onBarGridAction}
          <div
            class="border-foreground/10 bg-muted/20 flex flex-wrap items-center gap-2 border-b px-2 py-1.5"
            role="toolbar"
            aria-label="Bar actions"
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class="h-8 text-xs"
              onclick={() => onBarGridAction?.({ type: 'splitBarAtMidpoint', barId: selectedBarId! })}
            >
              Split at midpoint
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class="h-8 text-xs"
              onclick={() => onBarGridAction?.({ type: 'mergeBarWithPrevious', barId: selectedBarId! })}
            >
              Merge with previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              onclick={() => {
                const bar = beatGrid.bars.find((b) => b.id === selectedBarId)
                if (!bar) return
                onBarGridAction?.({ type: 'setBarBeatCount', barId: selectedBarId!, count: bar.beatCount - 1 })
              }}
            >
              − Beat
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              onclick={() => {
                const bar = beatGrid.bars.find((b) => b.id === selectedBarId)
                if (!bar) return
                onBarGridAction?.({ type: 'setBarBeatCount', barId: selectedBarId!, count: bar.beatCount + 1 })
              }}
            >
              + Beat
            </Button>
          </div>
        {/if}
        {#if beatGridEditing && timelineStripMode === 'sections' && onApplySectionTag}
          <div
            class="border-foreground/10 bg-muted/20 flex flex-wrap items-center gap-2 border-b px-2 py-1.5"
            role="toolbar"
            aria-label="Section tags"
          >
            <label class="text-muted-foreground flex items-center gap-2 text-xs">
              Section
              <select
                class="border-input bg-background ring-offset-background focus-visible:ring-ring h-8 rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                bind:value={sectionTagChoice}
              >
                {#each SECTION_KIND_OPTIONS as opt (opt.kind)}
                  <option value={opt.kind}>{opt.label}</option>
                {/each}
              </select>
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class="h-8 text-xs"
              disabled={sectionsSelectionBarIds.length === 0}
              onclick={() => onApplySectionTag?.(sectionTagChoice)}
            >
              Tag selection
            </Button>
            <span class="text-muted-foreground text-[11px]">
              Drag to select bars · Shift+click range · ⌘/Ctrl+click toggle · Esc clears
            </span>
          </div>
        {/if}
      {/if}
      <div bind:this={waveformRowEl} class="text-foreground relative w-full min-w-0" style:min-height="{displayH}px">
        {#if !peaks}
          <div
            class="text-muted-foreground absolute inset-0 z-10 flex items-center justify-center gap-2 text-xs"
            aria-busy="true"
          >
            <div
              class="border-muted-foreground/30 border-t-foreground/80 size-6 animate-spin rounded-full border-2"
            ></div>
            Fitting waveform…
          </div>
        {/if}
        <!-- Do not cover the canvas with a mediaReady blur: `<audio>` can lag Web Audio decode; controls stay disabled until ready. -->
        <canvas bind:this={canvas} class="pointer-events-none relative z-[3] block" aria-hidden="true"></canvas>

        {#each waveformSectionSpans as span (span.key)}
          {#if span.wPx > 0}
            <div
              class="pointer-events-none absolute inset-y-0"
              style:left="{span.xPx}px"
              style:width="{span.wPx}px"
              style:background-color={SECTION_FILL_RGBA[span.kind] ?? 'transparent'}
              aria-hidden="true"
            ></div>
          {/if}
        {/each}
        <div
          class="pointer-events-none absolute inset-y-0 bg-zinc-400/18 ring-1 ring-zinc-500/35"
          style:left="{selLeft}px"
          style:width="{selW}px"
        ></div>
        {#if editSelectionTimeSec}
          <div
            class="pointer-events-none absolute inset-y-0 z-[1] bg-amber-400/12 ring-1 ring-inset ring-amber-400/30"
            style:left="{editSelLeft}px"
            style:width="{editSelW}px"
            aria-hidden="true"
          ></div>
        {/if}
        {#if showSelectionLeftHandle}
          <div
            class="pointer-events-none absolute top-1/2 z-[4] h-11 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-300/75 bg-zinc-500/95 shadow-md shadow-black/25"
            style:left="{selLeft}px"
            aria-hidden="true"
          ></div>
        {/if}
        {#if showSelectionRightHandle}
          <div
            class="pointer-events-none absolute top-1/2 z-[4] h-11 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-300/75 bg-zinc-500/95 shadow-md shadow-black/25"
            style:left="{selRight}px"
            aria-hidden="true"
          ></div>
        {/if}

        {#if phantomX != null}
          <div
            class="border-muted-foreground/80 pointer-events-none absolute top-0 bottom-0 z-[1] border-l border-dashed"
            style:left="{phantomX}px"
            aria-hidden="true"
          ></div>
        {/if}

        <div
          class="bg-foreground/90 pointer-events-none absolute top-0 bottom-0 z-[2] w-px [box-shadow:0_0_8px_rgba(255,255,255,0.35)]"
          style:left="{playheadX}px"
        ></div>

        <div
          bind:this={interactLayer}
          class="absolute inset-0 z-[4] {detailCursorClass}"
          onpointerdown={onWavePointerDown}
          onpointermove={onWavePointerMoveHover}
          onpointerleave={onWavePointerLeave}
          role="img"
          aria-label="Detail waveform: resize with handles, move selection body, drag outside to create selection, tap to seek"
        ></div>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <p class="text-muted-foreground text-[10px]">
        {#if isEditorVariant}
          Overview — full timeline · shaded = selection · bright box = detail viewport (same navigation as import)
        {:else}
          Overview — full file · shaded = selection · bright box = detail viewport (drag body, resize grips, click outside
          to recenter)
        {/if}
      </p>
      <div
        bind:this={minimapEl}
        class="text-foreground border-foreground/15 bg-foreground/5 relative h-[52px] w-full overflow-hidden overscroll-x-contain rounded-md border {minimapCursorClass}"
        onpointerdown={onMinimapPointerDown}
        onpointermove={onMinimapPointerMoveHover}
        onpointerleave={onMinimapPointerLeave}
        role="presentation"
      >
        <canvas
          bind:this={overviewCanvas}
          class="pointer-events-none block h-full w-full opacity-80"
          style:height="{minimapH}px"
          aria-hidden="true"
        ></canvas>
        {#each waveformSectionSpans as span (span.key)}
          <div
            class="pointer-events-none absolute inset-y-0"
            style:left="{span.x0Pct}%"
            style:width="{span.wPct}%"
            style:background-color={SECTION_FILL_RGBA[span.kind] ?? 'transparent'}
            aria-hidden="true"
          ></div>
        {/each}
        <div
          class="pointer-events-none absolute inset-y-0 bg-zinc-500/22"
          style:left="{selectionLeftMinimapPct}%"
          style:width="{selectionWidthMinimapPct}%"
        ></div>
        {#if editSelectionTimeSec}
          <div
            class="pointer-events-none absolute inset-y-0 bg-amber-400/15 ring-1 ring-inset ring-amber-400/30"
            style:left="{editSelMinimapLeftPct}%"
            style:width="{editSelMinimapWidthPct}%"
            aria-hidden="true"
          ></div>
        {/if}
        <div
          class="pointer-events-none absolute inset-y-0 z-[1] w-px bg-foreground/85"
          style:left="{playheadMinimapPct}%"
          aria-hidden="true"
        ></div>
        <div
          class="pointer-events-none absolute inset-y-0 z-[2] box-border border-2 border-zinc-400/70 bg-zinc-400/12 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          style:left="{viewPortLeftPct}%"
          style:width="{viewPortWidthPct}%"
        ></div>
        <div
          class="pointer-events-none absolute top-1/2 z-[3] h-8 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-300/85 bg-zinc-500 shadow-md shadow-black/20"
          style:left="{viewPortLeftPct}%"
          aria-hidden="true"
        ></div>
        <div
          class="pointer-events-none absolute top-1/2 z-[3] h-8 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-300/85 bg-zinc-500 shadow-md shadow-black/20"
          style:left="{viewPortLeftPct + viewPortWidthPct}%"
          aria-hidden="true"
        ></div>
      </div>
    </div>
  </div>
{/if}
