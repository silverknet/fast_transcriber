import { describe, expect, it } from 'vitest'
import { NO_CHORD_SYMBOL } from './noChord'
import { parseChordText } from './parseChordText'
import { transposeChord } from './transposeChord'
import type { ChordSymbol } from '$lib/songmap/types'

/**
 * Transpose correctness is load-bearing: what you transpose to is what plays
 * live and exports to Ableton. Cover all 12 shifts, enharmonic spelling,
 * octave wraparound, slash-bass movement, and preservation of the chord's
 * quality / extensions.
 */
function chord(text: string): ChordSymbol {
  const r = parseChordText(text)
  if (!r.ok) throw new Error(`fixture parse failed: ${text}`)
  return r.chord
}

describe('transposeChord', () => {
  it('transposes by semitones (baseline)', () => {
    expect(transposeChord(chord('C'), 2).root).toBe('D')
  })
})

describe('transposeChord — root sweep (default sharp spelling)', () => {
  const expected: [string, string | undefined][] = [
    ['C', undefined],
    ['C', 'sharp'],
    ['D', undefined],
    ['D', 'sharp'],
    ['E', undefined],
    ['F', undefined],
    ['F', 'sharp'],
    ['G', undefined],
    ['G', 'sharp'],
    ['A', undefined],
    ['A', 'sharp'],
    ['B', undefined],
  ]
  it.each(expected.map((e, i) => [i, e[0], e[1]] as const))('C + %i semitones → %s (%s)', (semis, root, acc) => {
    const t = transposeChord(chord('C'), semis)
    expect(t.root).toBe(root)
    expect(t.accidental).toBe(acc)
  })
})

describe('transposeChord — enharmonic preference', () => {
  it('prefers flats when asked', () => {
    for (const [semis, root, acc] of [
      [1, 'D', 'flat'],
      [3, 'E', 'flat'],
      [6, 'G', 'flat'],
      [8, 'A', 'flat'],
      [10, 'B', 'flat'],
    ] as const) {
      const t = transposeChord(chord('C'), semis, true)
      expect([t.root, t.accidental]).toEqual([root, acc])
    }
  })
})

describe('transposeChord — wraparound & octaves', () => {
  it('wraps past B → C', () => {
    expect(transposeChord(chord('B'), 1).root).toBe('C')
  })
  it('A# + 2 → C', () => {
    const t = transposeChord(chord('A#'), 2)
    expect([t.root, t.accidental]).toEqual(['C', undefined])
  })
  it('a full octave (12) returns the same pitch class', () => {
    const t = transposeChord(chord('C'), 12)
    expect([t.root, t.accidental]).toEqual(['C', undefined])
  })
  it('negative shifts go down (C - 1 → B)', () => {
    expect(transposeChord(chord('C'), -1).root).toBe('B')
  })
})

describe('transposeChord — slash bass', () => {
  it('moves the bass with the chord', () => {
    const t = transposeChord(chord('C/E'), 2)
    expect([t.root, t.accidental]).toEqual(['D', undefined])
    expect([t.bass, t.bassAccidental]).toEqual(['F', 'sharp'])
  })
  it('leaves a bass-less chord bass-less', () => {
    const t = transposeChord(chord('C'), 5)
    expect(t.bass).toBeUndefined()
    expect(t.bassAccidental).toBeUndefined()
  })
})

describe('transposeChord — preserves quality / extensions', () => {
  it('keeps maj7 / min7 / dominant qualities and extensions', () => {
    expect(transposeChord(chord('Cmaj7'), 2).quality).toBe(chord('Cmaj7').quality)
    expect(transposeChord(chord('Dm7'), 3).quality).toBe(chord('Dm7').quality)
    const c7 = chord('G7')
    const t = transposeChord(c7, 5)
    expect(t.quality).toBe(c7.quality)
    expect(t.extensions).toEqual(c7.extensions)
    expect(t.root).toBe('C')
  })
  it('regenerates displayRaw to reflect the new root', () => {
    const t = transposeChord(chord('Cmaj7'), 2)
    expect(t.displayRaw).toBeTruthy()
    expect(t.displayRaw.startsWith('D')).toBe(true)
  })
})

describe('transposeChord — N.C. (no chord)', () => {
  it('returns a no-chord symbol unchanged for any shift', () => {
    for (const semis of [5, -3, 12, 1]) {
      const t = transposeChord(NO_CHORD_SYMBOL, semis)
      expect(t.noChord).toBe(true)
      expect(t.displayRaw).toBe('N.C.')
    }
  })
})

describe('transposeChord — purity', () => {
  it('does not mutate the input chord', () => {
    const c = chord('C')
    const before = { ...c }
    transposeChord(c, 7)
    expect(c).toEqual(before)
  })
  it('round-trips: +n then -n returns to the original pitch class', () => {
    const c = chord('E')
    const up = transposeChord(c, 5)
    const back = transposeChord(up, -5)
    expect([back.root, back.accidental]).toEqual(['E', undefined])
  })
})
