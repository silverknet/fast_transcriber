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

export type BarGridAction =
  | { type: 'setBarBeatCount'; barId: string; count: number }
  | { type: 'splitBarAtMidpoint'; barId: string }
  | { type: 'mergeBarWithPrevious'; barId: string }
  | { type: 'redistributeBar'; barId: string }
  | { type: 'addBarAtStart' }
  | { type: 'addBarAtEnd' }
  | { type: 'removeBarAtStart' }
  | { type: 'removeBarAtEnd' }

export function applyBarGridAction(
  map: SongMap,
  action: BarGridAction,
  idFactory: IdFactory,
): TimelineEditResult {
  switch (action.type) {
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
    default:
      return fail('Unknown bar grid action')
  }
}
