import { describe, expect, it } from 'vitest'
import { parseSongMap, SongMapParseError } from './parse'
import { serializeSongMap } from './serialize'
import { SONGMAP_FORMAT_VERSION } from './version'

const baseV3 = {
  formatVersion: 3,
  metadata: {
    title: 'V3 song',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  },
  timeline: { bars: [], beats: [] },
  sections: [],
  harmony: [],
  cueTracks: [],
}

const lyrics = {
  words: [
    { text: 'Well', startSec: 12.1, endSec: 12.4, line: 0, aligned: true },
    { text: 'you', startSec: 12.4, endSec: 12.6, line: 0 },
    { text: 'done', startSec: 12.6, endSec: 12.9, line: 0, aligned: true },
  ],
  sourceText: 'Well you done',
  alignedAt: '2026-07-09T00:00:00.000Z',
  transcriberVersion: 1,
}

describe('SongMap lyrics schema (v4)', () => {
  it('loads v3 files as v4 with no lyrics', () => {
    const sm = parseSongMap(JSON.stringify(baseV3))
    expect(sm.formatVersion).toBe(SONGMAP_FORMAT_VERSION)
    expect(sm.lyrics).toBeUndefined()
    expect(JSON.parse(serializeSongMap(sm)).formatVersion).toBe(SONGMAP_FORMAT_VERSION)
  })

  it('persists lyrics through a full parse → serialize → parse round-trip', () => {
    const sm = parseSongMap(JSON.stringify({ ...baseV3, formatVersion: 4, lyrics }))
    expect(sm.lyrics).toEqual(lyrics)
    const again = parseSongMap(serializeSongMap(sm))
    expect(again.lyrics).toEqual(lyrics)
  })

  it('accepts imported-but-unaligned lyrics (sourceText only, empty words)', () => {
    const sm = parseSongMap(
      JSON.stringify({ ...baseV3, formatVersion: 4, lyrics: { words: [], sourceText: 'La la la' } }),
    )
    expect(sm.lyrics?.sourceText).toBe('La la la')
    expect(sm.lyrics?.words).toEqual([])
    expect(parseSongMap(serializeSongMap(sm)).lyrics?.sourceText).toBe('La la la')
  })

  it('rejects malformed words (bad times, negative line, missing text)', () => {
    const bad = (words: unknown) =>
      JSON.stringify({ ...baseV3, formatVersion: 4, lyrics: { words, sourceText: 'x' } })
    expect(() =>
      parseSongMap(bad([{ text: 'a', startSec: 2, endSec: 1, line: 0 }])),
    ).toThrow(SongMapParseError)
    expect(() =>
      parseSongMap(bad([{ text: 'a', startSec: 0, endSec: 1, line: -1 }])),
    ).toThrow(SongMapParseError)
    expect(() => parseSongMap(bad([{ startSec: 0, endSec: 1, line: 0 }]))).toThrow(
      SongMapParseError,
    )
  })

  it('rejects lyrics without sourceText', () => {
    expect(() =>
      parseSongMap(JSON.stringify({ ...baseV3, formatVersion: 4, lyrics: { words: [] } })),
    ).toThrow(SongMapParseError)
  })
})
