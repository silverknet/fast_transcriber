/**
 * Non-destructive edits to bars/beats inside an existing SongMap (editor).
 * Beat times within a bar follow equal spacing from bar geometry: downbeat at `startSec`,
 * last beat before `endSec`. All operations return a new map or an error; callers bump `metadata.updatedAt`.
 */

import type { Bar, Beat, HarmonyEvent, SongMap } from './types'
import { sortBarsByIndex, sortBeatsByTime } from './normalize'

export type TimelineEditError = { ok: false; error: string }
export type TimelineEditOk = { ok: true; map: SongMap }
export type TimelineEditResult = TimelineEditOk | TimelineEditError

const T_EPS = 1e-4

/** UI / analysis: allowed beats per bar when editing count. */
export const MIN_BEATS_PER_BAR = 1
export const MAX_BEATS_PER_BAR = 32

/**
 * Cheap, allocation-free check: does the live timeline already match
 * the snapshot? Used by the UI to disable the Reset button when there's
 * nothing to revert.
 */
export function timelineMatchesOriginal(map: SongMap): boolean {
  const orig = map.timeline.original
  if (!orig) return true // No snapshot → nothing to revert to, treat as "in sync"
  const bars = map.timeline.bars
  const beats = map.timeline.beats
  if (bars.length !== orig.bars.length || beats.length !== orig.beats.length) return false
  for (let i = 0; i < bars.length; i++) {
    const a = bars[i]!
    const b = orig.bars[i]!
    if (
      a.id !== b.id ||
      a.startSec !== b.startSec ||
      a.endSec !== b.endSec ||
      a.beatCount !== b.beatCount
    ) {
      return false
    }
  }
  for (let i = 0; i < beats.length; i++) {
    const a = beats[i]!
    const b = orig.beats[i]!
    if (a.id !== b.id || a.barId !== b.barId || a.timeSec !== b.timeSec || a.indexInBar !== b.indexInBar) {
      return false
    }
  }
  return true
}

/**
 * Replace `timeline.bars` and `timeline.beats` with `timeline.original`
 * (deep-copied so future edits don't mutate the snapshot). Leaves the
 * snapshot itself untouched so the user can revert again later.
 * No-ops when there's no snapshot.
 */
export function resetTimelineToOriginal(map: SongMap): TimelineEditResult {
  const orig = map.timeline.original
  if (!orig) return fail('No analyzed baseline to reset to.')
  const next: SongMap = {
    ...map,
    timeline: {
      ...map.timeline,
      bars: orig.bars.map((b) => ({ ...b, beatIds: [...b.beatIds] })),
      beats: orig.beats.map((b) => ({ ...b })),
    },
  }
  return ok(next)
}

function ok(map: SongMap): TimelineEditOk {
  return { ok: true, map }
}

function fail(error: string): TimelineEditError {
  return { ok: false, error }
}

export type IdFactory = () => string

function beatsForBarByIndex(map: SongMap, barId: string): Beat[] {
  return [...map.timeline.beats.filter((b) => b.barId === barId)].sort(
    (a, b) => a.indexInBar - b.indexInBar,
  )
}

function beatsForBarSorted(map: SongMap, barId: string): Beat[] {
  return sortBeatsByTime(map.timeline.beats.filter((b) => b.barId === barId))
}

function barById(map: SongMap, barId: string): Bar | undefined {
  return map.timeline.bars.find((b) => b.id === barId)
}

/** `timeSec[i] = startSec + (i/n) * (endSec - startSec)` for `i = 0..n-1`. */
export function evenBeatTimes(bar: Bar, n: number): number[] {
  const D = bar.endSec - bar.startSec
  if (n < 1 || !(D > 0)) return []
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(bar.startSec + (i / n) * D)
  }
  return out
}

function replaceBarBeats(map: SongMap, barId: string, nextInBar: Beat[]): SongMap {
  const bar = barById(map, barId)
  if (!bar) return map

  const ordered = [...nextInBar].sort((a, b) => a.indexInBar - b.indexInBar)
  const nextBar: Bar = {
    ...bar,
    beatCount: ordered.length,
    beatIds: ordered.map((b) => b.id),
    meter: { ...bar.meter, numerator: ordered.length },
  }

  const otherBeats = map.timeline.beats.filter((b) => b.barId !== barId)
  return {
    ...map,
    timeline: {
      ...map.timeline,
      bars: map.timeline.bars.map((b) => (b.id === barId ? nextBar : b)),
      beats: sortBeatsByTime([...otherBeats, ...ordered]),
    },
  }
}

/** Minimum bar length (seconds) when stretching boundaries — keeps room for evenly spaced beats. */
function minBarDurationSec(bar: Bar): number {
  return Math.max(0.1, bar.beatCount * 0.032)
}

/**
 * Move a bar boundary in time: **left** edge drags the start of `barId` (and the previous bar’s end);
 * **right** edge drags the end of `barId` (and the next bar’s start, or extends the last bar to `timelineMaxSec`).
 * Beats in each affected bar are re-equalized on the new interval.
 *
 * `timelineMinSec` / `timelineMaxSec` clamp the outer song timeline (e.g. 0 … decoded duration).
 */
export function setBarBoundary(
  map: SongMap,
  barId: string,
  edge: 'left' | 'right',
  boundarySec: number,
  timelineMinSec: number,
  timelineMaxSec: number,
): TimelineEditResult {
  const sorted = sortBarsByIndex(map.timeline.bars)
  const i = sorted.findIndex((b) => b.id === barId)
  if (i < 0) return fail(`Unknown bar ${barId}`)
  const cur = sorted[i]!

  const replaceTwoBars = (a: Bar, b: Bar): SongMap => {
    const others = map.timeline.bars.filter((x) => x.id !== a.id && x.id !== b.id)
    const bars = sortBarsByIndex([...others, a, b]).map((x, j) => ({ ...x, index: j }))
    return { ...map, timeline: { ...map.timeline, bars } }
  }

  const replaceOneBar = (a: Bar): SongMap => {
    const others = map.timeline.bars.filter((x) => x.id !== a.id)
    const bars = sortBarsByIndex([...others, a]).map((x, j) => ({ ...x, index: j }))
    return { ...map, timeline: { ...map.timeline, bars } }
  }

  if (edge === 'left') {
    if (i === 0) {
      const hi = cur.endSec - minBarDurationSec(cur)
      const lo = timelineMinSec
      if (!(hi > lo + T_EPS)) return fail('Bar is too short to stretch')
      const newB = Math.min(Math.max(boundarySec, lo), hi)
      const cur2: Bar = { ...cur, startSec: newB }
      let nextMap = replaceOneBar(cur2)
      const r = redistributeBeatsEvenly(nextMap, cur.id)
      return r
    }
    const prev = sorted[i - 1]!
    const lo = prev.startSec + minBarDurationSec(prev)
    const hi = cur.endSec - minBarDurationSec(cur)
    if (!(hi > lo + T_EPS)) return fail('Adjacent bars too tight')
    const newB = Math.min(Math.max(boundarySec, lo), hi)
    const prev2: Bar = { ...prev, endSec: newB }
    const cur2: Bar = { ...cur, startSec: newB }
    let nextMap = replaceTwoBars(prev2, cur2)
    const r1 = redistributeBeatsEvenly(nextMap, prev.id)
    if (!r1.ok) return r1
    nextMap = r1.map
    return redistributeBeatsEvenly(nextMap, cur.id)
  }

  // right edge
  const hiBound =
    timelineMaxSec > timelineMinSec + T_EPS ? timelineMaxSec : sorted[sorted.length - 1]!.endSec + 120
  if (i >= sorted.length - 1) {
    const lo = cur.startSec + minBarDurationSec(cur)
    if (!(hiBound > lo + T_EPS)) return fail('No room to extend last bar')
    const newB = Math.min(Math.max(boundarySec, lo), hiBound)
    const cur2: Bar = { ...cur, endSec: newB }
    let nextMap = replaceOneBar(cur2)
    return redistributeBeatsEvenly(nextMap, cur.id)
  }
  const next = sorted[i + 1]!
  const lo = cur.startSec + minBarDurationSec(cur)
  const hi = next.endSec - minBarDurationSec(next)
  if (!(hi > lo + T_EPS)) return fail('Adjacent bars too tight')
  const newB = Math.min(Math.max(boundarySec, lo), hi)
  const cur2: Bar = { ...cur, endSec: newB }
  const next2: Bar = { ...next, startSec: newB }
  let nextMap = replaceTwoBars(cur2, next2)
  const r1 = redistributeBeatsEvenly(nextMap, cur.id)
  if (!r1.ok) return r1
  nextMap = r1.map
  return redistributeBeatsEvenly(nextMap, next.id)
}

/**
 * Rewrite every beat in the bar so `timeSec` matches equal spacing for the current
 * `[startSec,endSec)` and `beatCount`.
 */
export function redistributeBeatsEvenly(map: SongMap, barId: string): TimelineEditResult {
  const bar = barById(map, barId)
  if (!bar) return fail(`Unknown bar ${barId}`)
  const inBar = beatsForBarByIndex(map, barId)
  if (inBar.length === 0) return ok(map)
  if (inBar.length !== bar.beatCount) {
    return fail(`Bar ${barId}: beat list length does not match beatCount`)
  }
  const n = inBar.length
  const D = bar.endSec - bar.startSec
  if (!(D > 0)) return fail('Bar has no usable duration')
  const times = evenBeatTimes(bar, n)
  const updated = inBar.map((b, i) => ({ ...b, timeSec: times[i]! }))
  const other = map.timeline.beats.filter((b) => b.barId !== barId)
  return ok({
    ...map,
    timeline: {
      ...map.timeline,
      beats: sortBeatsByTime([...other, ...updated]),
    },
  })
}

/**
 * Set the number of beats in a bar; times are always re-derived (equal spacing).
 * Extra beats are dropped from the end (by index); new beats get fresh ids.
 */
export function setBarBeatCount(
  map: SongMap,
  barId: string,
  count: number,
  idFactory: IdFactory,
): TimelineEditResult {
  const bar = barById(map, barId)
  if (!bar) return fail(`Unknown bar ${barId}`)
  const D = bar.endSec - bar.startSec
  if (!(D > 0)) return fail('Bar has no usable duration')

  const n = Math.max(MIN_BEATS_PER_BAR, Math.min(MAX_BEATS_PER_BAR, Math.floor(count)))
  const cur = beatsForBarByIndex(map, barId)

  let nextBeats: Beat[]
  if (n === cur.length) {
    nextBeats = cur
  } else if (n < cur.length) {
    nextBeats = cur.slice(0, n).map((b, i) => ({ ...b, indexInBar: i }))
  } else {
    nextBeats = cur.map((b, i) => ({ ...b, indexInBar: i }))
    const source = cur[0]?.source ?? 'manual'
    for (let i = cur.length; i < n; i++) {
      nextBeats.push({
        id: idFactory(),
        barId,
        indexInBar: i,
        timeSec: bar.startSec,
        source,
      })
    }
  }

  let m = replaceBarBeats(map, barId, nextBeats)
  return redistributeBeatsEvenly(m, barId)
}

function splitHarmonyOnBarDivide(
  harmony: HarmonyEvent[],
  oldBarId: string,
  newBarId: string,
  splitSec: number,
): HarmonyEvent[] {
  const out: HarmonyEvent[] = []
  for (const h of harmony) {
    if (h.barId !== oldBarId) {
      out.push(h)
      continue
    }
    if (h.startSec >= splitSec - 1e-9) {
      out.push({ ...h, barId: newBarId })
      continue
    }
    if (h.endSec <= splitSec + 1e-9) {
      out.push(h)
      continue
    }
    const clipped = { ...h, endSec: splitSec }
    if (clipped.endSec > clipped.startSec + 1e-9) out.push(clipped)
  }
  return out
}

/**
 * Split `[startSec,endSec)` at the midpoint in time. Beats split as
 * `nLeft = max(1, floor(n/2))`, `nRight = n - nLeft` (requires `n >= 2`).
 */
export function splitBarAtMidpoint(map: SongMap, barId: string, idFactory: IdFactory): TimelineEditResult {
  const bar = barById(map, barId)
  if (!bar) return fail(`Unknown bar ${barId}`)
  const byIdx = beatsForBarByIndex(map, bar.id)
  const n = byIdx.length
  if (n < 2) return fail('Need at least two beats to split a bar')

  const T = (bar.startSec + bar.endSec) * 0.5
  if (!(T > bar.startSec + T_EPS && T < bar.endSec - T_EPS)) {
    return fail('Bar is too short to split at the midpoint')
  }

  const nLeft = Math.max(1, Math.floor(n / 2))
  const nRight = n - nLeft
  if (nRight < 1) return fail('Invalid beat partition')

  const leftSlice = byIdx.slice(0, nLeft).map((b, i) => ({
    ...b,
    barId: bar.id,
    indexInBar: i,
  }))
  const newBarId = idFactory()
  const rightSlice = byIdx.slice(nLeft).map((b, i) => ({
    ...b,
    barId: newBarId,
    indexInBar: i,
  }))

  const leftBar: Bar = {
    ...bar,
    endSec: T,
    beatCount: leftSlice.length,
    beatIds: leftSlice.map((b) => b.id),
    meter: { ...bar.meter, numerator: leftSlice.length },
  }
  const newBar: Bar = {
    id: newBarId,
    index: bar.index + 1,
    startSec: T,
    endSec: bar.endSec,
    beatCount: rightSlice.length,
    beatIds: rightSlice.map((b) => b.id),
    meter: { numerator: rightSlice.length, denominator: bar.meter.denominator },
  }

  const otherBars = map.timeline.bars.filter((b) => b.id !== bar.id)
  const mergedBars = [...otherBars, leftBar, newBar].sort(
    (a, b) => a.startSec - b.startSec || a.index - b.index,
  )
  const normalizedBars = mergedBars.map((b, i) => ({ ...b, index: i }))

  const otherBeats = map.timeline.beats.filter((b) => b.barId !== bar.id)
  let allBeats = sortBeatsByTime([...otherBeats, ...leftSlice, ...rightSlice])

  const splitAt = bar.index
  const sections = map.sections.map((s) => ({
    ...s,
    barRange: {
      startBarIndex: s.barRange.startBarIndex > splitAt ? s.barRange.startBarIndex + 1 : s.barRange.startBarIndex,
      endBarIndex: s.barRange.endBarIndex >= splitAt ? s.barRange.endBarIndex + 1 : s.barRange.endBarIndex,
    },
  }))

  const harmony = splitHarmonyOnBarDivide(map.harmony, bar.id, newBarId, T)

  let next: SongMap = {
    ...map,
    timeline: { bars: normalizedBars, beats: allBeats },
    sections,
    harmony,
  }

  const r1 = redistributeBeatsEvenly(next, bar.id)
  if (!r1.ok) return r1
  next = r1.map
  const r2 = redistributeBeatsEvenly(next, newBarId)
  if (!r2.ok) return r2
  return ok(r2.map)
}

/**
 * Merges this bar into the previous one (removes a bar line). First bar cannot merge.
 * Beat times are re-equalized over the combined interval.
 */
export function mergeBarWithPrevious(map: SongMap, barId: string): TimelineEditResult {
  const barsSorted = sortBarsByIndex(map.timeline.bars)
  const i = barsSorted.findIndex((b) => b.id === barId)
  if (i <= 0) return fail('No previous bar to merge into')

  const prev = barsSorted[i - 1]!
  const cur = barsSorted[i]!

  const prevBeats = beatsForBarByIndex(map, prev.id)
  const curBeats = beatsForBarByIndex(map, cur.id)
  const mergedBeats = [...prevBeats, ...curBeats.map((b, k) => ({
    ...b,
    barId: prev.id,
    indexInBar: prevBeats.length + k,
  }))]

  const mergedBar: Bar = {
    ...prev,
    endSec: cur.endSec,
    beatCount: mergedBeats.length,
    beatIds: mergedBeats.map((b) => b.id),
    meter: { ...prev.meter, numerator: mergedBeats.length },
  }

  const otherBars = map.timeline.bars.filter((b) => b.id !== prev.id && b.id !== cur.id)
  const mergedBars = [...otherBars, mergedBar].sort((a, b) => a.startSec - b.startSec)
  const normalizedBars = mergedBars.map((b, j) => ({ ...b, index: j }))

  const otherBeats = map.timeline.beats.filter((b) => b.barId !== prev.id && b.barId !== cur.id)
  const allBeats = sortBeatsByTime([...otherBeats, ...mergedBeats])

  const removedIndex = cur.index
  const sections = map.sections.map((s) => {
    let a = s.barRange.startBarIndex
    let b = s.barRange.endBarIndex
    if (a > removedIndex) a -= 1
    if (b >= removedIndex) b -= 1
    if (a > b) b = a
    return { ...s, barRange: { startBarIndex: a, endBarIndex: b } }
  })

  const harmony = map.harmony.map((h) => (h.barId === cur.id ? { ...h, barId: prev.id } : h))

  let next: SongMap = {
    ...map,
    timeline: { bars: normalizedBars, beats: allBeats },
    sections,
    harmony,
  }

  return redistributeBeatsEvenly(next, prev.id)
}

/** Shift all timeline times (bars, beats, harmony) — used when prepending a bar at t=0. */
function shiftTimeline(map: SongMap, deltaSec: number): SongMap {
  return {
    ...map,
    timeline: {
      bars: map.timeline.bars.map((b) => ({
        ...b,
        startSec: b.startSec + deltaSec,
        endSec: b.endSec + deltaSec,
      })),
      beats: map.timeline.beats.map((b) => ({
        ...b,
        timeSec: b.timeSec + deltaSec,
      })),
    },
    harmony: map.harmony.map((h) => ({
      ...h,
      startSec: h.startSec + deltaSec,
      endSec: h.endSec + deltaSec,
    })),
  }
}

function removeBarById(map: SongMap, barId: string): TimelineEditResult {
  const bar = barById(map, barId)
  if (!bar) return fail(`Unknown bar ${barId}`)
  const ri = bar.index
  const rest = map.timeline.bars
    .filter((b) => b.id !== barId)
    .sort((a, b) => a.startSec - b.startSec)
  const normalizedBars = rest.map((b, i) => ({ ...b, index: i }))
  const otherBeats = map.timeline.beats.filter((b) => b.barId !== barId)
  const sections = map.sections.map((s) => {
    let a = s.barRange.startBarIndex
    let b = s.barRange.endBarIndex
    if (a > ri) a -= 1
    if (b >= ri) b -= 1
    if (a > b) b = a
    return { ...s, barRange: { startBarIndex: a, endBarIndex: b } }
  })
  const harmony = map.harmony.filter((h) => h.barId !== barId)
  return ok({
    ...map,
    timeline: { bars: normalizedBars, beats: sortBeatsByTime(otherBeats) },
    sections,
    harmony,
  })
}

/**
 * Insert a bar before the first bar. If the first bar starts too early to fit another bar of the
 * same duration before it, the whole timeline is shifted forward first.
 */
export function addBarAtStart(map: SongMap, idFactory: IdFactory): TimelineEditResult {
  const sorted = sortBarsByIndex(map.timeline.bars)
  if (sorted.length === 0) return fail('No bars — analyze audio first')

  const first = sorted[0]!
  const D = Math.max(0.25, first.endSec - first.startSec)
  const beatCount = Math.max(MIN_BEATS_PER_BAR, Math.min(MAX_BEATS_PER_BAR, first.beatCount))
  const denom = first.meter.denominator

  let m = map
  if (first.startSec < D - 1e-9) {
    m = shiftTimeline(m, D)
  }

  const sorted2 = sortBarsByIndex(m.timeline.bars)
  const first2 = sorted2[0]!
  const startSec = first2.startSec - D
  const endSec = first2.startSec
  if (!(startSec < endSec - T_EPS)) return fail('Cannot add bar at start')

  const barId = idFactory()
  const beatIds: string[] = []
  const beats: Beat[] = []
  for (let i = 0; i < beatCount; i++) {
    const bid = idFactory()
    beatIds.push(bid)
    beats.push({
      id: bid,
      barId,
      indexInBar: i,
      timeSec: 0,
      source: 'manual',
    })
  }

  const newBar: Bar = {
    id: barId,
    index: 0,
    startSec,
    endSec,
    meter: { numerator: beatCount, denominator: denom },
    beatCount,
    beatIds,
  }

  const merged = [newBar, ...sorted2].sort((a, b) => a.startSec - b.startSec)
  const allBars = merged.map((b, i) => ({ ...b, index: i }))

  const otherBeats = m.timeline.beats
  const allBeats = sortBeatsByTime([...otherBeats, ...beats])

  const sections = m.sections.map((s) => ({
    ...s,
    barRange: {
      startBarIndex: s.barRange.startBarIndex + 1,
      endBarIndex: s.barRange.endBarIndex + 1,
    },
  }))

  let next: SongMap = {
    ...m,
    timeline: { bars: allBars, beats: allBeats },
    sections,
  }

  return redistributeBeatsEvenly(next, barId)
}

/** Append a bar after the last bar with the same duration and beat count template as the last bar. */
export function addBarAtEnd(map: SongMap, idFactory: IdFactory): TimelineEditResult {
  const sorted = sortBarsByIndex(map.timeline.bars)
  if (sorted.length === 0) return fail('No bars — analyze audio first')

  const last = sorted[sorted.length - 1]!
  const D = Math.max(0.25, last.endSec - last.startSec)
  const beatCount = Math.max(MIN_BEATS_PER_BAR, Math.min(MAX_BEATS_PER_BAR, last.beatCount))
  const denom = last.meter.denominator

  const startSec = last.endSec
  const endSec = last.endSec + D
  const barId = idFactory()
  const beatIds: string[] = []
  const beats: Beat[] = []
  for (let i = 0; i < beatCount; i++) {
    const bid = idFactory()
    beatIds.push(bid)
    beats.push({
      id: bid,
      barId,
      indexInBar: i,
      timeSec: 0,
      source: 'manual',
    })
  }

  const newBar: Bar = {
    id: barId,
    index: sorted.length,
    startSec,
    endSec,
    meter: { numerator: beatCount, denominator: denom },
    beatCount,
    beatIds,
  }

  const allBars = [...sorted, newBar].map((b, i) => ({ ...b, index: i }))
  const allBeats = sortBeatsByTime([...map.timeline.beats, ...beats])

  let next: SongMap = {
    ...map,
    timeline: { bars: allBars, beats: allBeats },
  }

  return redistributeBeatsEvenly(next, barId)
}

export function removeBarAtStart(map: SongMap): TimelineEditResult {
  const sorted = sortBarsByIndex(map.timeline.bars)
  if (sorted.length === 0) return fail('No bars')
  if (sorted.length <= 1) return fail('Cannot remove the only bar')
  return removeBarById(map, sorted[0]!.id)
}

export function removeBarAtEnd(map: SongMap): TimelineEditResult {
  const sorted = sortBarsByIndex(map.timeline.bars)
  if (sorted.length === 0) return fail('No bars')
  if (sorted.length <= 1) return fail('Cannot remove the only bar')
  return removeBarById(map, sorted[sorted.length - 1]!.id)
}

// ── Multi-bar operations ──────────────────────────────────────────────────
//
// Both take a SELECTION of neighbouring bars and rewrite it as a whole. They
// share two promises, because a grid edit that quietly moves music is worse
// than one that refuses:
//
//   1. The selection's OUTER edges never move — whatever came before and after
//      is untouched, so these are safe to use on part of a song.
//   2. Chords keep the moment they sound. Their anchors are repaired (a beat
//      that changes bar takes its chord's `barId` with it); off-grid chords
//      keep their absolute time by re-deriving their fraction.

/** The selection as real bars, in timeline order — or null if it isn't a contiguous run. */
function selectionBars(map: SongMap, barIds: readonly string[]): Bar[] | null {
  const byId = new Map(map.timeline.bars.map((b) => [b.id, b]))
  const picked: Bar[] = []
  for (const id of barIds) {
    const bar = byId.get(id)
    if (!bar) return null
    picked.push(bar)
  }
  if (picked.length === 0) return null
  picked.sort((a, b) => a.index - b.index)
  for (let i = 1; i < picked.length; i++) {
    if (picked[i]!.index !== picked[i - 1]!.index + 1) return null
  }
  return picked
}

/** Beats of the selection, in bar order then beat order. */
function flatBeats(map: SongMap, bars: readonly Bar[]): Beat[] | null {
  const out: Beat[] = []
  for (const bar of bars) {
    const inBar = beatsForBarByIndex(map, bar.id)
    if (inBar.length !== bar.beatCount) return null
    out.push(...inBar)
  }
  return out
}

/**
 * Put every chord back on the beat it belongs to after bars/beats moved.
 *
 * Only touches chords inside the rewritten span. A chord anchored to a beat
 * follows that beat (new bar, new index, new time); an OFF-GRID chord (bar +
 * fraction, the ÷N feature) keeps its absolute time by re-deriving which bar
 * it now sits in and where inside it.
 */
function repairHarmonyAnchors(map: SongMap, spanStartSec: number, spanEndSec: number): SongMap {
  const beatsById = new Map(map.timeline.beats.map((b) => [b.id, b]))
  const barsById = new Map(map.timeline.bars.map((b) => [b.id, b]))
  const sorted = sortBeatsByTime(map.timeline.beats)
  const harmony = map.harmony.map((h): HarmonyEvent => {
    if (h.beatId) {
      const beat = beatsById.get(h.beatId)
      if (!beat) return h
      const span = beatHarmonySpanLocal(beat, sorted, barsById)
      return {
        ...h,
        barId: beat.barId,
        startSec: span.startSec,
        endSec: span.endSec,
        ...(h.beatAnchor ? { beatAnchor: { indexInBar: beat.indexInBar } } : {}),
      }
    }
    if (typeof h.barFraction === 'number') {
      // Off-grid: keep the SOUNDING time, re-derive the anchor around it.
      if (h.startSec < spanStartSec - T_EPS || h.startSec > spanEndSec + T_EPS) return h
      const host = map.timeline.bars.find(
        (b) => h.startSec >= b.startSec - T_EPS && h.startSec < b.endSec - T_EPS,
      )
      if (!host) return h
      const d = host.endSec - host.startSec
      if (!(d > 0)) return h
      const frac = Math.min(0.999999, Math.max(0, (h.startSec - host.startSec) / d))
      return { ...h, barId: host.id, barFraction: frac }
    }
    return h
  })
  return { ...map, harmony }
}

/** Local copy of the half-open beat span (importing harmonyEdit here would cycle). */
function beatHarmonySpanLocal(
  beat: Beat,
  allBeatsSorted: readonly Beat[],
  barsById: Map<string, Bar>,
): { startSec: number; endSec: number } {
  const bar = barsById.get(beat.barId)
  const barEnd = bar?.endSec ?? beat.timeSec + 0.25
  const idx = allBeatsSorted.findIndex((b) => b.id === beat.id)
  const next = idx >= 0 && idx + 1 < allBeatsSorted.length ? allBeatsSorted[idx + 1]! : null
  let endSec = barEnd
  if (next && next.timeSec > beat.timeSec) endSec = Math.min(next.timeSec, barEnd)
  if (!(endSec > beat.timeSec)) endSec = Math.min(beat.timeSec + 0.02, barEnd)
  return { startSec: beat.timeSec, endSec }
}

/**
 * EVEN OUT — one steady pulse across the whole selection.
 *
 * Detection often leaves a run of bars breathing slightly: each bar is
 * internally even, but the bars themselves are a few milliseconds long or
 * short, so the click wanders against a track that is actually machine-steady.
 * This spreads EVERY beat in the selection equally over the span the selection
 * already occupies. Bar lines move to wherever their beats land; the first
 * bar's start and the last bar's end do not move, so the surrounding song is
 * untouched. Beats per bar are preserved.
 */
export function evenOutBars(map: SongMap, barIds: readonly string[]): TimelineEditResult {
  const bars = selectionBars(map, barIds)
  if (!bars) return fail('Select a run of neighbouring bars to even out.')
  const first = bars[0]!
  const last = bars[bars.length - 1]!
  const span = last.endSec - first.startSec
  if (!(span > 0)) return fail('The selected bars have no length to spread beats over.')
  const flat = flatBeats(map, bars)
  if (!flat) return fail('A selected bar’s beat list does not match its beat count.')
  if (flat.length < 1) return fail('There are no beats in the selection.')

  const step = span / flat.length
  const timeAt = (i: number) => first.startSec + i * step
  const nextTime = new Map<string, number>()
  flat.forEach((b, i) => nextTime.set(b.id, timeAt(i)))

  // Bar j starts where its first beat lands; outer edges are pinned.
  const startIndexOfBar: number[] = []
  let acc = 0
  for (const bar of bars) {
    startIndexOfBar.push(acc)
    acc += bar.beatCount
  }
  const selected = new Map(bars.map((b, j) => [b.id, j]))

  const nextBars = map.timeline.bars.map((b) => {
    const j = selected.get(b.id)
    if (j === undefined) return b
    return {
      ...b,
      startSec: j === 0 ? first.startSec : timeAt(startIndexOfBar[j]!),
      endSec: j === bars.length - 1 ? last.endSec : timeAt(startIndexOfBar[j + 1]!),
    }
  })
  const nextBeats = map.timeline.beats.map((b) =>
    nextTime.has(b.id) ? { ...b, timeSec: nextTime.get(b.id)! } : b,
  )

  const moved: SongMap = {
    ...map,
    timeline: { ...map.timeline, bars: nextBars, beats: sortBeatsByTime(nextBeats) },
  }
  return ok(repairHarmonyAnchors(moved, first.startSec, last.endSec))
}

/**
 * OFFSET THE DOWNBEAT — move the bar lines, not the beats.
 *
 * Detection regularly hears the pulse correctly but lands "one" on the wrong
 * beat, so the whole song (or a stretch of it) is barred a beat or two late.
 * Nothing is wrong with the beats themselves, so nothing here moves them: only
 * the grouping into bars shifts by `offsetBeats`, which is what a musician
 * means by "the downbeat is on the 2".
 *
 * The beats pushed out of the front become a short pickup bar rather than
 * being dropped — losing beats to fix a barring mistake would be a worse bug
 * than the one being fixed. The tail is short for the same reason.
 */
export function offsetSelectionDownbeat(
  map: SongMap,
  barIds: readonly string[],
  offsetBeats: number,
  idFactory: IdFactory,
): TimelineEditResult {
  const bars = selectionBars(map, barIds)
  if (!bars) return fail('Select a run of neighbouring bars to re-bar.')
  const flat = flatBeats(map, bars)
  if (!flat) return fail('A selected bar’s beat list does not match its beat count.')
  const d = Math.round(offsetBeats)
  if (!Number.isFinite(d) || d < 1) return fail('Choose how many beats to move the downbeat by.')
  if (d >= flat.length) return fail('That is more beats than the selection holds.')

  // Group sizes: a short pickup of `d`, then the original bar lengths again.
  const sizes = [d, ...bars.map((b) => b.beatCount)]
  const groups: Beat[][] = []
  let cursor = 0
  for (const size of sizes) {
    if (cursor >= flat.length) break
    groups.push(flat.slice(cursor, cursor + size))
    cursor += size
  }
  if (cursor < flat.length) groups.push(flat.slice(cursor)) // safety: never drop beats

  const first = bars[0]!
  const last = bars[bars.length - 1]!
  // Reuse the selection's bar identities so chords anchored to a bar survive;
  // mint one only if the pickup makes the selection longer than it was.
  const ids = groups.map((_, j) => bars[j]?.id ?? idFactory())
  const meterOf = (j: number) => bars[Math.min(j, bars.length - 1)]!.meter

  const rebuiltBars: Bar[] = groups.map((g, j) => ({
    id: ids[j]!,
    index: first.index + j,
    startSec: j === 0 ? first.startSec : g[0]!.timeSec,
    endSec:
      j === groups.length - 1 ? last.endSec : groups[j + 1]![0]!.timeSec,
    meter: { ...meterOf(j), numerator: g.length },
    beatCount: g.length,
    beatIds: g.map((b) => b.id),
  }))

  const rebuiltBeats: Beat[] = groups.flatMap((g, j) =>
    g.map((b, i) => ({ ...b, barId: ids[j]!, indexInBar: i })),
  )

  const selectedIds = new Set(bars.map((b) => b.id))
  const movedBeatIds = new Set(rebuiltBeats.map((b) => b.id))
  const before = map.timeline.bars.filter((b) => b.index < first.index)
  const after = map.timeline.bars.filter((b) => b.index > last.index)
  const shift = rebuiltBars.length - bars.length
  const nextBars = sortBarsByIndex([
    ...before,
    ...rebuiltBars,
    ...after.map((b) => ({ ...b, index: b.index + shift })),
  ])
  const nextBeats = sortBeatsByTime([
    ...map.timeline.beats.filter((b) => !selectedIds.has(b.barId) && !movedBeatIds.has(b.id)),
    ...rebuiltBeats,
  ])

  const moved: SongMap = {
    ...map,
    timeline: { ...map.timeline, bars: nextBars, beats: nextBeats },
  }
  return ok(repairHarmonyAnchors(moved, first.startSec, last.endSec))
}

export type BarGridAction =
  | { type: 'setBarBeatCount'; barId: string; count: number }
  | { type: 'splitBarAtMidpoint'; barId: string }
  | { type: 'mergeBarWithPrevious'; barId: string }
  | { type: 'redistributeBar'; barId: string }
  | {
      type: 'setBarBoundary'
      barId: string
      edge: 'left' | 'right'
      boundarySec: number
      timelineMinSec: number
      timelineMaxSec: number
    }
  | { type: 'addBarAtStart' }
  | { type: 'addBarAtEnd' }
  | { type: 'removeBarAtStart' }
  | { type: 'removeBarAtEnd' }
  | { type: 'evenOutBars'; barIds: string[] }
  | { type: 'offsetDownbeat'; barIds: string[]; offsetBeats: number }

export function applyBarGridAction(
  map: SongMap,
  action: BarGridAction,
  idFactory: IdFactory,
): TimelineEditResult {
  switch (action.type) {
    case 'setBarBoundary':
      return setBarBoundary(
        map,
        action.barId,
        action.edge,
        action.boundarySec,
        action.timelineMinSec,
        action.timelineMaxSec,
      )
    case 'setBarBeatCount':
      return setBarBeatCount(map, action.barId, action.count, idFactory)
    case 'splitBarAtMidpoint':
      return splitBarAtMidpoint(map, action.barId, idFactory)
    case 'mergeBarWithPrevious':
      return mergeBarWithPrevious(map, action.barId)
    case 'redistributeBar':
      return redistributeBeatsEvenly(map, action.barId)
    case 'addBarAtStart':
      return addBarAtStart(map, idFactory)
    case 'addBarAtEnd':
      return addBarAtEnd(map, idFactory)
    case 'removeBarAtStart':
      return removeBarAtStart(map)
    case 'removeBarAtEnd':
      return removeBarAtEnd(map)
    case 'evenOutBars':
      return evenOutBars(map, action.barIds)
    case 'offsetDownbeat':
      return offsetSelectionDownbeat(map, action.barIds, action.offsetBeats, idFactory)
    default:
      return fail('Unknown bar grid action')
  }
}
