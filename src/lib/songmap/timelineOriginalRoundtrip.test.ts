import { describe, it, expect } from 'vitest'
import { createEmptySongMap } from './factory'
import { serializeSongMap } from './serialize'
import { parseSongMap } from './parse'
import type { Bar, Beat, SongMap } from './types'

/**
 * Regression: `timeline.original` (the "Reset grid" baseline snapshot) is
 * documented to survive reloads and is written into the `.smap`, but the parser
 * used to drop it — so every save→load silently lost it, and the collab
 * fingerprint then saw a phantom change and pushed the stripped map to all
 * collaborators. These lock the round-trip.
 */
function bars(): Bar[] {
  return [
    {
      id: 'bar1',
      index: 0,
      startSec: 0,
      endSec: 2,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: ['b0', 'b1', 'b2', 'b3'],
    },
  ]
}
function beats(): Beat[] {
  return [
    { id: 'b0', barId: 'bar1', indexInBar: 0, timeSec: 0 },
    { id: 'b1', barId: 'bar1', indexInBar: 1, timeSec: 0.5 },
    { id: 'b2', barId: 'bar1', indexInBar: 2, timeSec: 1 },
    { id: 'b3', barId: 'bar1', indexInBar: 3, timeSec: 1.5 },
  ]
}

function mapWithOriginal(): SongMap {
  const m = createEmptySongMap()
  m.timeline = {
    bars: bars(),
    beats: beats(),
    // A distinct baseline snapshot (different beat times) so we can prove it's
    // the ORIGINAL that survives, not just a copy of the live grid.
    original: {
      bars: bars(),
      beats: beats().map((b) => ({ ...b, timeSec: b.timeSec + 0.01 })),
    },
  }
  return m
}

describe('timeline.original persistence', () => {
  it('survives a JSON serialize → parse round-trip', () => {
    const m = mapWithOriginal()
    const back = parseSongMap(serializeSongMap(m))
    expect(back.timeline.original).toBeDefined()
    expect(back.timeline.original).toEqual(m.timeline.original)
  })

  it('a map without a snapshot round-trips with original still absent', () => {
    const m = createEmptySongMap()
    m.timeline = { bars: bars(), beats: beats() }
    const back = parseSongMap(serializeSongMap(m))
    expect(back.timeline.original).toBeUndefined()
  })
})
