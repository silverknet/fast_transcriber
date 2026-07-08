import { describe, expect, it } from 'vitest'
import type { ChordSymbol, SongMap, SongKey } from './types'
import {
  effectiveTransposeSemitones,
  formatTransposeLabel,
  transposeChordForDisplay,
  transposeChordForStorage,
  transposeSongKey,
} from './transposition'
import { SONGMAP_FORMAT_VERSION } from './version'

function baseMap(transpose?: SongMap['transpose']): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Song',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    transpose,
    timeline: { bars: [], beats: [] },
    sections: [],
    harmony: [],
    cueTracks: [],
  }
}

describe('song transposition helpers', () => {
  it('defaults missing transpose to 0 and formats signed labels', () => {
    expect(effectiveTransposeSemitones(baseMap())).toBe(0)
    expect(effectiveTransposeSemitones(baseMap({ baseSemitones: 2 }))).toBe(2)
    expect(formatTransposeLabel(2)).toBe('+2')
    expect(formatTransposeLabel(-3)).toBe('-3')
    expect(formatTransposeLabel(0)).toBe('0')
  })

  it('transposes keys without changing mode', () => {
    const key: SongKey = { root: 'E', accidental: 'flat', mode: 'major' }
    expect(transposeSongKey(key, 2)).toEqual({ root: 'F', mode: 'major' })
  })

  it('derives displayed chords while preserving source chords', () => {
    const source: ChordSymbol = {
      root: 'C',
      quality: 'major',
      bass: 'E',
      displayRaw: 'C/E',
    }
    const displayedKey: SongKey = { root: 'D', mode: 'major' }
    const displayed = transposeChordForDisplay(source, 2, displayedKey)

    expect(source.displayRaw).toBe('C/E')
    expect(displayed).toMatchObject({
      root: 'D',
      bass: 'F',
      accidental: undefined,
      bassAccidental: 'sharp',
      displayRaw: 'D/F#',
    })
  })

  it('inverse-transposes sounding chord commits back to storage pitch', () => {
    const displayed: ChordSymbol = { root: 'D', quality: 'minor', displayRaw: 'Dm' }
    const source = transposeChordForStorage(displayed, 2, { root: 'C', mode: 'major' })
    expect(source.displayRaw).toBe('Cm')
    expect(source.root).toBe('C')
  })
})
