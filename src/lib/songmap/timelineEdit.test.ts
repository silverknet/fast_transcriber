import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { mergeAnalysisIntoSongMap } from './merge'
import type { Bar, Beat, SongMap } from './types'
import {
  resetTimelineToOriginal,
  setBarBoundary,
  timelineMatchesOriginal,
} from './timelineEdit'

function mapTwoBars(): SongMap {
  const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  const bar0: Bar = {
    id: 'bar0',
    index: 0,
    startSec: 0,
    endSec: 2,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: ['b00', 'b01', 'b02', 'b03'],
  }
  const bar1: Bar = {
    id: 'bar1',
    index: 1,
    startSec: 2,
    endSec: 4,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: ['b10', 'b11', 'b12', 'b13'],
  }
  const beats: Beat[] = [
    { id: 'b00', barId: 'bar0', indexInBar: 0, timeSec: 0 },
    { id: 'b01', barId: 'bar0', indexInBar: 1, timeSec: 0.5 },
    { id: 'b02', barId: 'bar0', indexInBar: 2, timeSec: 1 },
    { id: 'b03', barId: 'bar0', indexInBar: 3, timeSec: 1.5 },
    { id: 'b10', barId: 'bar1', indexInBar: 0, timeSec: 2 },
    { id: 'b11', barId: 'bar1', indexInBar: 1, timeSec: 2.5 },
    { id: 'b12', barId: 'bar1', indexInBar: 2, timeSec: 3 },
    { id: 'b13', barId: 'bar1', indexInBar: 3, timeSec: 3.5 },
  ]
  return { ...base, timeline: { bars: [bar0, bar1], beats } }
}

describe('setBarBoundary', () => {
  it('stretches first bar right and shifts next bar start; beats re-equalize', () => {
    const m0 = mapTwoBars()
    const r = setBarBoundary(m0, 'bar0', 'right', 2.5, 0, 100)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const b0 = r.map.timeline.bars.find((b) => b.id === 'bar0')!
    const b1 = r.map.timeline.bars.find((b) => b.id === 'bar1')!
    expect(b0.startSec).toBe(0)
    expect(b0.endSec).toBeCloseTo(2.5)
    expect(b1.startSec).toBeCloseTo(2.5)
    expect(b1.endSec).toBeCloseTo(4)
    const t0 = r.map.timeline.beats.filter((x) => x.barId === 'bar0').sort((a, b) => a.indexInBar - b.indexInBar)
    expect(t0.map((x) => x.timeSec)).toEqual([0, 0.625, 1.25, 1.875])
    const t1 = r.map.timeline.beats.filter((x) => x.barId === 'bar1').sort((a, b) => a.indexInBar - b.indexInBar)
    expect(t1.map((x) => x.timeSec)).toEqual([2.5, 2.875, 3.25, 3.625])
  })

  it('moves shared boundary left when dragging first bar left edge', () => {
    const m0 = mapTwoBars()
    const r = setBarBoundary(m0, 'bar1', 'left', 2.2, 0, 100)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const b0 = r.map.timeline.bars.find((b) => b.id === 'bar0')!
    const b1 = r.map.timeline.bars.find((b) => b.id === 'bar1')!
    expect(b0.endSec).toBeCloseTo(2.2)
    expect(b1.startSec).toBeCloseTo(2.2)
  })

  it('extends last bar end up to timelineMaxSec', () => {
    const m0 = mapTwoBars()
    const r = setBarBoundary(m0, 'bar1', 'right', 5, 0, 5)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const b1 = r.map.timeline.bars.find((b) => b.id === 'bar1')!
    expect(b1.endSec).toBeCloseTo(5)
  })
})

describe('reset-grid snapshot (timeline.original)', () => {
  /**
   * A full analysis fragment (bars + beats) seeds `timeline.original`.
   * Partial fragments don't overwrite it; subsequent full analyses do.
   */
  it('mergeAnalysisIntoSongMap captures the snapshot on a full analysis', () => {
    const base = mapTwoBars()
    const merged = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    expect(merged.timeline.original).toBeDefined()
    expect(merged.timeline.original!.bars).toEqual(base.timeline.bars)
    expect(merged.timeline.original!.beats).toEqual(base.timeline.beats)
  })

  it('snapshot is deep-copied (later live edits do not mutate it)', () => {
    const base = mapTwoBars()
    const merged = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    const edited = setBarBoundary(merged, 'bar0', 'right', 2.5, 0, 100)
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    // Original snapshot still reflects the pre-edit geometry.
    const origBar0 = edited.map.timeline.original!.bars.find((b) => b.id === 'bar0')!
    expect(origBar0.endSec).toBe(2)
  })

  it('partial fragments preserve an existing snapshot', () => {
    const base = mapTwoBars()
    const seeded = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    expect(seeded.timeline.original).toBeDefined()
    const snapshotBeforePatch = seeded.timeline.original
    // Apply a bars-only fragment (no beats). Snapshot must NOT update.
    const patchedBars = seeded.timeline.bars.map((b) => ({ ...b }))
    const patched = mergeAnalysisIntoSongMap(seeded, { bars: patchedBars })
    expect(patched.timeline.original).toBe(snapshotBeforePatch)
  })

  it('a new full analysis overwrites the snapshot', () => {
    const base = mapTwoBars()
    const first = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    const shiftedBars: Bar[] = first.timeline.bars.map((b) => ({
      ...b,
      startSec: b.startSec + 10,
      endSec: b.endSec + 10,
    }))
    const shiftedBeats: Beat[] = first.timeline.beats.map((b) => ({
      ...b,
      timeSec: b.timeSec + 10,
    }))
    const second = mergeAnalysisIntoSongMap(first, {
      bars: shiftedBars,
      beats: shiftedBeats,
    })
    expect(second.timeline.original!.bars[0]!.startSec).toBe(10)
  })

  it('timelineMatchesOriginal returns true right after a full analysis', () => {
    const base = mapTwoBars()
    const merged = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    expect(timelineMatchesOriginal(merged)).toBe(true)
  })

  it('timelineMatchesOriginal returns false after a live edit', () => {
    const base = mapTwoBars()
    const merged = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    const edited = setBarBoundary(merged, 'bar0', 'right', 2.5, 0, 100)
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(timelineMatchesOriginal(edited.map)).toBe(false)
  })

  it('timelineMatchesOriginal treats "no snapshot" as in sync (legacy file)', () => {
    const base = mapTwoBars() // no snapshot
    expect(timelineMatchesOriginal(base)).toBe(true)
  })

  it('resetTimelineToOriginal restores the snapshot bars + beats', () => {
    const base = mapTwoBars()
    const merged = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    const edited = setBarBoundary(merged, 'bar0', 'right', 2.5, 0, 100)
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    const reverted = resetTimelineToOriginal(edited.map)
    expect(reverted.ok).toBe(true)
    if (!reverted.ok) return
    expect(reverted.map.timeline.bars).toEqual(merged.timeline.bars)
    expect(reverted.map.timeline.beats).toEqual(merged.timeline.beats)
    // Snapshot itself is still present so the user can reset again later.
    expect(reverted.map.timeline.original).toBeDefined()
  })

  it('resetTimelineToOriginal fails when there is no snapshot', () => {
    const r = resetTimelineToOriginal(mapTwoBars())
    expect(r.ok).toBe(false)
  })

  it('reset → edit → reset round-trip is stable', () => {
    const base = mapTwoBars()
    const merged = mergeAnalysisIntoSongMap(base, {
      bars: base.timeline.bars,
      beats: base.timeline.beats,
    })
    const edited1 = setBarBoundary(merged, 'bar0', 'right', 2.5, 0, 100)
    expect(edited1.ok).toBe(true)
    if (!edited1.ok) return
    const reverted1 = resetTimelineToOriginal(edited1.map)
    expect(reverted1.ok).toBe(true)
    if (!reverted1.ok) return
    const edited2 = setBarBoundary(reverted1.map, 'bar0', 'right', 2.7, 0, 100)
    expect(edited2.ok).toBe(true)
    if (!edited2.ok) return
    const reverted2 = resetTimelineToOriginal(edited2.map)
    expect(reverted2.ok).toBe(true)
    if (!reverted2.ok) return
    expect(timelineMatchesOriginal(reverted2.map)).toBe(true)
  })
})
