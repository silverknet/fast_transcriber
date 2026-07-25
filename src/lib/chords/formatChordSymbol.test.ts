import { describe, expect, it } from 'vitest'
import { formatChordSymbol } from './formatChordSymbol'
import { parseChordText } from './parseChordText'
import type { ChordSymbol } from '$lib/songmap/types'

/**
 * `formatChordSymbol` renders a structured `ChordSymbol` back to text. It is the
 * inverse of `parseChordText` and the single place display strings are built, so
 * a wrong stem here silently corrupts every chord shown or exported. These lock
 * the quality map, the seventh-stem substitution, added-tone spelling, colour
 * tones, accidentals, and the slash bass.
 */
function chord(partial: Partial<ChordSymbol>): ChordSymbol {
  return { root: 'C', displayRaw: '', ...partial }
}

describe('formatChordSymbol — root & accidentals', () => {
  it('prints a bare major triad as just the root', () => {
    expect(formatChordSymbol(chord({ quality: 'major' }))).toBe('C')
  })
  it('renders ASCII accidentals by default and Unicode on request', () => {
    expect(formatChordSymbol(chord({ root: 'F', accidental: 'sharp' }))).toBe('F#')
    expect(formatChordSymbol(chord({ root: 'B', accidental: 'flat' }))).toBe('Bb')
    expect(formatChordSymbol(chord({ root: 'F', accidental: 'sharp' }), { unicode: true })).toBe('F♯')
    expect(formatChordSymbol(chord({ root: 'B', accidental: 'flat' }), { unicode: true })).toBe('B♭')
  })
})

describe('formatChordSymbol — quality base map', () => {
  it('maps each modeled quality to its printed stem', () => {
    const cases: [string, string][] = [
      ['major', 'C'],
      ['minor', 'Cm'],
      ['dim', 'Cdim'],
      ['aug', 'Caug'],
      ['7', 'C7'],
      ['maj7', 'Cmaj7'],
      ['min7', 'Cm7'],
      ['sus2', 'Csus2'],
      ['sus4', 'Csus4'],
      ['add9', 'Cadd9'],
      ['major6', 'C6'],
      ['minor6', 'Cm6'],
    ]
    for (const [quality, expected] of cases) {
      expect(formatChordSymbol(chord({ quality }))).toBe(expected)
    }
  })
  it('falls back to the raw quality string for an unmodeled quality', () => {
    expect(formatChordSymbol(chord({ quality: 'weird' }))).toBe('Cweird')
  })
})

describe('formatChordSymbol — extensions replace the seventh stem', () => {
  it('substitutes rather than appends for seventh families (no "m79")', () => {
    expect(formatChordSymbol(chord({ quality: 'min7', extensions: ['9'] }))).toBe('Cm9')
    expect(formatChordSymbol(chord({ quality: 'min7', extensions: ['11'] }))).toBe('Cm11')
    expect(formatChordSymbol(chord({ quality: 'maj7', extensions: ['9'] }))).toBe('Cmaj9')
    expect(formatChordSymbol(chord({ quality: '7', extensions: ['9'] }))).toBe('C9')
    expect(formatChordSymbol(chord({ quality: '7', extensions: ['13'] }))).toBe('C13')
  })
  it('keeps only the HIGHEST extension (13 implies 9 and 11)', () => {
    expect(formatChordSymbol(chord({ quality: 'min7', extensions: ['9', '11', '13'] }))).toBe('Cm13')
  })
  it('spells an added tone on a triad as addN (not a dominant N)', () => {
    expect(formatChordSymbol(chord({ quality: 'major', extensions: ['9'] }))).toBe('Cadd9')
  })
})

describe('formatChordSymbol — colour tones & bass', () => {
  it('appends alterations after the stem', () => {
    expect(formatChordSymbol(chord({ quality: 'min7', alterations: ['b5'] }))).toBe('Cm7b5')
    expect(formatChordSymbol(chord({ quality: '7', alterations: ['#9'] }))).toBe('C7#9')
  })
  it('renders a slash bass with its own accidental', () => {
    expect(formatChordSymbol(chord({ quality: 'major', bass: 'E' }))).toBe('C/E')
    expect(formatChordSymbol(chord({ quality: 'min7', bass: 'B', bassAccidental: 'flat' }))).toBe('Cm7/Bb')
  })
})

describe('formatChordSymbol ↔ parseChordText round-trip', () => {
  // Every rendered symbol must re-parse to the same structural chord — this is
  // what keeps transpose/serialize/re-display stable.
  it('is stable across the common chord vocabulary', () => {
    for (const text of ['C', 'Cm', 'Cm7', 'Cmaj7', 'G7', 'Cm7b5', 'Am9', 'Cmaj9', 'Dm11', 'C/E', 'Fm7/Ab']) {
      const first = parseChordText(text)
      expect(first.ok).toBe(true)
      if (!first.ok) continue
      const second = parseChordText(first.chord.displayRaw)
      expect(second.ok).toBe(true)
      if (!second.ok) continue
      expect(second.chord.quality).toBe(first.chord.quality)
      expect(second.chord.extensions ?? []).toEqual(first.chord.extensions ?? [])
      expect(second.chord.displayRaw).toBe(first.chord.displayRaw)
    }
  })
})
