import { describe, expect, it } from 'vitest'
import { parseSongMap, SongMapParseError } from './parse'
import { serializeSongMap } from './serialize'

const baseV2 = {
  formatVersion: 2,
  metadata: {
    title: 'V2 song',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  },
  timeline: { bars: [], beats: [] },
  sections: [],
  harmony: [],
  cueTracks: [],
}

describe('SongMap transpose schema', () => {
  it('loads v2 files as v3 with no transpose', () => {
    const sm = parseSongMap(JSON.stringify(baseV2))
    expect(sm.formatVersion).toBe(3)
    expect(sm.transpose).toBeUndefined()
    expect(JSON.parse(serializeSongMap(sm)).formatVersion).toBe(3)
  })

  it('persists a valid shared base transposition', () => {
    const sm = parseSongMap(JSON.stringify({ ...baseV2, transpose: { baseSemitones: -3 } }))
    expect(sm.transpose).toEqual({ baseSemitones: -3 })
    expect(JSON.parse(serializeSongMap(sm)).transpose).toEqual({ baseSemitones: -3 })
  })

  it('rejects non-integer or out-of-range transpose values', () => {
    expect(() =>
      parseSongMap(JSON.stringify({ ...baseV2, transpose: { baseSemitones: 1.5 } })),
    ).toThrow(SongMapParseError)
    expect(() =>
      parseSongMap(JSON.stringify({ ...baseV2, transpose: { baseSemitones: 13 } })),
    ).toThrow(SongMapParseError)
  })
})
