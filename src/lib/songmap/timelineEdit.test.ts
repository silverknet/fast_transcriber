import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import type { Bar, Beat, SongMap } from './types'
import { setBarBoundary } from './timelineEdit'

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
