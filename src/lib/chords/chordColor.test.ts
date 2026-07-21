/**
 * Coloured chords must survive the three places that rebuild a chord label
 * from structure: `formatChordSymbol` (what the lead sheet and the mixer chord
 * rail actually render), `transposeChord`, and a parse → render → re-parse
 * round trip.
 *
 * Before v6, colour lived ONLY in `displayRaw`. The strict sheet parser kept
 * the typed token verbatim there, which looked correct in isolation — but both
 * renderers call `formatChordSymbol()`, which rebuilds from `quality` +
 * `extensions`. So an imported `Bm7b5` displayed as `Bm7`, and transposing it
 * up a tone produced `C#m7`: a different chord function, silently.
 */
import { describe, expect, it } from 'vitest'
import { formatChordSymbol } from './formatChordSymbol'
import { parseChordText } from './parseChordText'
import { transposeChord } from './transposeChord'
import { parseStrictChordToken } from './sheet/chordToken'

/** Every symbol here must render back exactly as written. */
const VERBATIM = [
  'Dm7',
  'Bm7b5',
  'E7b9',
  'C7#9',
  'G7b13',
  'F7#11',
  'C7b5',
  'Bdim7',
  'C6',
  'Am6',
  'Cm9',
  'Cm11',
  'Cmaj9',
  'C13',
  'C7sus4',
  'C9sus4',
  'Cadd9',
  'Cadd11',
  'C5',
  'C6/9',
  'Cmaj7',
  'Csus2',
  'C/E',
  'Dm7b5/Ab',
]

describe('coloured chords render as written', () => {
  for (const symbol of VERBATIM) {
    it(`${symbol} renders as ${symbol}`, () => {
      const r = parseStrictChordToken(symbol)
      expect(r.ok, `${symbol} should parse`).toBe(true)
      if (!r.ok) return
      expect(formatChordSymbol(r.chord)).toBe(symbol)
    })
  }

  it('the ø shorthand normalises to its written-out equivalent', () => {
    const r = parseStrictChordToken('Bø')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(formatChordSymbol(r.chord)).toBe('Bm7b5')
  })

  it('an extension replaces the seventh rather than being glued to it', () => {
    // `min7` + `9` used to render `Cm79`.
    const r = parseStrictChordToken('Cm9')
    expect(r.ok && r.chord.quality).toBe('min7')
    expect(r.ok && r.chord.extensions).toEqual(['9'])
    expect(r.ok && formatChordSymbol(r.chord)).toBe('Cm9')
  })

  it('a triad with an added tone does not read as a dominant', () => {
    const chord = { root: 'C' as const, quality: 'major', extensions: ['9'], displayRaw: '' }
    // `C9` would mean a dominant ninth; a major triad plus a 9 is `Cadd9`.
    expect(formatChordSymbol(chord)).toBe('Cadd9')
  })

  it('the marking menu borrowed-iv chord is not spelled "Fminor6"', () => {
    // `minor6` had no entry in the suffix map and fell through to the raw
    // quality string.
    const chord = { root: 'F' as const, quality: 'minor6', displayRaw: '' }
    expect(formatChordSymbol(chord)).toBe('Fm6')
  })
})

describe('coloured chords survive transpose', () => {
  const cases: Array<[string, number, string]> = [
    ['Bm7b5', 2, 'C#m7b5'],
    ['E7b9', 2, 'F#7b9'],
    ['C6', 2, 'D6'],
    ['Cm9', 2, 'Dm9'],
    ['Cadd11', 2, 'Dadd11'],
    ['Bdim7', 1, 'Cdim7'],
    ['C7sus4', 2, 'D7sus4'],
    ['C6/9', 2, 'D6/9'],
    ['Dm7b5/Ab', 2, 'Em7b5/A#'],
    ['C5', 7, 'G5'],
  ]
  for (const [symbol, semitones, want] of cases) {
    it(`${symbol} +${semitones} → ${want}`, () => {
      const r = parseStrictChordToken(symbol)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(formatChordSymbol(transposeChord(r.chord, semitones))).toBe(want)
    })
  }

  it('transpose never alters the colour, only the root and bass', () => {
    // Spelling may legitimately change (`Ab` +12 → `G#` — transpose prefers
    // sharps unless told otherwise), so assert on the colour fields, which
    // must be untouched at any interval.
    for (const symbol of VERBATIM) {
      const r = parseStrictChordToken(symbol)
      if (!r.ok) continue
      for (const semitones of [1, 5, 7, 12, -3]) {
        const moved = transposeChord(r.chord, semitones)
        expect(moved.quality, `${symbol} +${semitones}`).toBe(r.chord.quality)
        expect(moved.extensions, `${symbol} +${semitones}`).toEqual(r.chord.extensions)
        expect(moved.alterations, `${symbol} +${semitones}`).toEqual(r.chord.alterations)
      }
    }
  })

  it('round trip: render → re-parse → render is stable', () => {
    for (const symbol of VERBATIM) {
      const first = parseStrictChordToken(symbol)
      if (!first.ok) continue
      const rendered = formatChordSymbol(first.chord)
      const second = parseStrictChordToken(rendered)
      expect(second.ok, `${rendered} should re-parse`).toBe(true)
      if (!second.ok) continue
      expect(formatChordSymbol(second.chord), symbol).toBe(rendered)
    }
  })
})

describe('hand-typed colour survives too', () => {
  // The entry box uses the lenient parser as a fallback for partial input; it
  // must not throw colour away either.
  for (const [symbol, want] of [
    ['Bm7b5', ['b5']],
    ['E7b9', ['b9']],
    ['C7#9', ['#9']],
  ] as const) {
    it(`${symbol} keeps ${want.join('')}`, () => {
      const r = parseChordText(symbol)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.chord.alterations).toEqual([...want])
    })
  }
})
