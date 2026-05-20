import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { barsBySystem } from './iterate'
import type { Bar, SongMap } from '$lib/songmap/types'

function bar(index: number): Bar {
  return {
    id: `b${index}`,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: [],
  }
}

function mapWithBars(bars: Bar[]): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 't', createdAt: '', updatedAt: '' },
    timeline: { bars, beats: [] },
    harmony: [],
    sections: [],
    cues: { mode: 'off', countInBeats: 0, useSectionLabels: false },
  } as unknown as SongMap
}

describe('barsBySystem', () => {
  it('returns [] for an empty song', () => {
    expect(barsBySystem(mapWithBars([]))).toEqual([])
  })

  it('packs exactly N bars into one row at default barsPerSystem=4', () => {
    const rows = barsBySystem(mapWithBars([bar(0), bar(1), bar(2), bar(3)]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(4)
  })

  it('overflow goes into a new row', () => {
    const rows = barsBySystem(mapWithBars([bar(0), bar(1), bar(2), bar(3), bar(4)]))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveLength(4)
    expect(rows[1]).toHaveLength(1)
    expect(rows[1][0].index).toBe(4)
  })

  it('sorts unordered input by Bar.index before grouping', () => {
    const rows = barsBySystem(mapWithBars([bar(3), bar(0), bar(2), bar(1), bar(4)]))
    expect(rows[0].map((b) => b.index)).toEqual([0, 1, 2, 3])
    expect(rows[1].map((b) => b.index)).toEqual([4])
  })

  it('respects a custom barsPerSystem', () => {
    const rows = barsBySystem(
      mapWithBars([bar(0), bar(1), bar(2), bar(3), bar(4), bar(5)]),
      2,
    )
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.length)).toEqual([2, 2, 2])
  })
})
