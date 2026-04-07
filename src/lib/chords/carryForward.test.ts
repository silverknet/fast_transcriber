import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { resolveChordAtEachBeat } from './carryForward'
import type { SongMap } from '$lib/songmap/types'

function minimalMap(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 't',
      createdAt: '',
      updatedAt: '',
    },
    timeline: {
      bars: [
        {
          id: 'bar1',
          index: 0,
          startSec: 0,
          endSec: 4,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 2,
          beatIds: ['b0', 'b1'],
        },
      ],
      beats: [
        { id: 'b0', barId: 'bar1', indexInBar: 0, timeSec: 0 },
        { id: 'b1', barId: 'bar1', indexInBar: 1, timeSec: 2 },
      ],
    },
    sections: [],
    harmony: [
      {
        id: 'h1',
        barId: 'bar1',
        beatId: 'b0',
        startSec: 0,
        endSec: 2,
        chord: { root: 'C', quality: 'major', displayRaw: 'C' },
        beatAnchor: { indexInBar: 0 },
      },
    ],
    cues: { mode: 'off', countInBeats: 0, useSectionLabels: false },
  }
}

describe('resolveChordAtEachBeat', () => {
  it('carries forward to beats without events', () => {
    const m = minimalMap()
    const map = resolveChordAtEachBeat(m)
    expect(map.get('b0')?.root).toBe('C')
    expect(map.get('b1')?.root).toBe('C')
  })
})
