import { describe, expect, it } from 'vitest'
import { serializeSongMap } from '$lib/songmap/serialize'
import { parseSongMap } from '$lib/songmap/parse'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

function mapWithOffGridChord(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 'T', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 20 }, source: 'upload' },
    timeline: {
      bars: [
        { id: 'bar1', index: 0, startSec: 10, endSec: 14, meter: { numerator: 4, denominator: 4 }, beatCount: 4, beatIds: ['b1', 'b2', 'b3', 'b4'] },
      ],
      beats: [
        { id: 'b1', barId: 'bar1', indexInBar: 0, timeSec: 10 },
        { id: 'b2', barId: 'bar1', indexInBar: 1, timeSec: 11 },
        { id: 'b3', barId: 'bar1', indexInBar: 2, timeSec: 12 },
        { id: 'b4', barId: 'bar1', indexInBar: 3, timeSec: 13 },
      ],
    },
    sections: [],
    harmony: [
      { id: 'h0', barId: 'bar1', startSec: 10, endSec: 11.33, chord: { root: 'A', quality: 'min', displayRaw: 'Am' }, barFraction: 0 },
      { id: 'h1', barId: 'bar1', startSec: 11.33, endSec: 12.67, chord: { root: 'F', displayRaw: 'F' }, barFraction: 1 / 3 },
      { id: 'h2', barId: 'bar1', startSec: 12.67, endSec: 14, chord: { root: 'C', displayRaw: 'C' }, barFraction: 2 / 3 },
    ],
    cueTracks: [],
  }
}

describe('off-grid chords survive a .smap round-trip', () => {
  it('preserves barFraction on serialize → parse', () => {
    const parsed = parseSongMap(serializeSongMap(mapWithOffGridChord()))
    const fr = parsed.harmony
      .map((h) => h.barFraction)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)
    expect(fr).toHaveLength(3)
    expect(fr[0]).toBeCloseTo(0, 6)
    expect(fr[1]).toBeCloseTo(1 / 3, 6)
    expect(fr[2]).toBeCloseTo(2 / 3, 6)
    // beatId stays absent for off-grid chords.
    expect(parsed.harmony.every((h) => h.beatId == null)).toBe(true)
  })
})
