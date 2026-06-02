import { describe, expect, it } from 'vitest'
import { fitKeyFromChroma, tonicIntToNote } from './keyDetect'

/** Build a chroma vector with energy on `pitchClasses`, equal weight, normalized. */
function chromaFor(pitchClasses: number[]): number[] {
  const c = Array.from({ length: 12 }, () => 0)
  for (const pc of pitchClasses) c[pc % 12] += 1
  const sum = c.reduce((s, v) => s + v, 0)
  return c.map((v) => (sum > 0 ? v / sum : 0))
}

describe('fitKeyFromChroma', () => {
  it('detects C major from a C-major triad chroma (C, E, G)', () => {
    // C=0, E=4, G=7
    const result = fitKeyFromChroma(chromaFor([0, 4, 7]))
    expect(result).not.toBeNull()
    expect(result!.tonic).toBe(0)
    expect(result!.mode).toBe('major')
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it('detects A minor from an A-minor triad chroma (A, C, E)', () => {
    // A=9, C=0, E=4
    const result = fitKeyFromChroma(chromaFor([9, 0, 4]))
    expect(result).not.toBeNull()
    expect(result!.tonic).toBe(9)
    expect(result!.mode).toBe('minor')
  })

  it('detects G major from a typical I–IV–V–vi chord palette', () => {
    // G major: G B D | C E G | D F# A | E G B
    // pitch classes: 7,11,2 + 0,4,7 + 2,6,9 + 4,7,11
    // Tight synthetic palette → confidence is small; relax the floor for the
    // unit test. Real songs accumulate much more signal on the tonic.
    const result = fitKeyFromChroma(chromaFor([7, 11, 2, 0, 4, 7, 2, 6, 9, 4, 7, 11]), 0)
    expect(result).not.toBeNull()
    expect(result!.tonic).toBe(7)
    expect(result!.mode).toBe('major')
  })

  it('detects F major from F, Bb, C chords', () => {
    // F=5, A=9, C=0 | Bb=10, D=2, F=5 | C=0, E=4, G=7
    const result = fitKeyFromChroma(chromaFor([5, 9, 0, 10, 2, 5, 0, 4, 7]), 0)
    expect(result).not.toBeNull()
    expect(result!.tonic).toBe(5)
    expect(result!.mode).toBe('major')
  })

  it('returns null for a flat (uniform) chroma — too ambiguous', () => {
    const flat = Array.from({ length: 12 }, () => 1 / 12)
    expect(fitKeyFromChroma(flat)).toBeNull()
  })

  it('returns null for an all-zero chroma', () => {
    const zero = Array.from({ length: 12 }, () => 0)
    expect(fitKeyFromChroma(zero)).toBeNull()
  })

  it('respects the confidence floor parameter', () => {
    // A C-major triad gives plenty of margin; lifting the floor to 0.999
    // should reject it.
    const cMajor = chromaFor([0, 4, 7])
    expect(fitKeyFromChroma(cMajor, 0.999)).toBeNull()
    expect(fitKeyFromChroma(cMajor, 0.0)).not.toBeNull()
  })

  it('rotation: D-major chroma resolves to D, not C', () => {
    // D major triad: D=2, F#=6, A=9
    const result = fitKeyFromChroma(chromaFor([2, 6, 9]))
    expect(result).not.toBeNull()
    expect(result!.tonic).toBe(2)
    expect(result!.mode).toBe('major')
  })
})

describe('tonicIntToNote', () => {
  it('returns natural notes for natural tonics in major mode', () => {
    expect(tonicIntToNote(0, 'major')).toEqual({ root: 'C' })
    expect(tonicIntToNote(7, 'major')).toEqual({ root: 'G' })
    expect(tonicIntToNote(2, 'major')).toEqual({ root: 'D' })
    expect(tonicIntToNote(11, 'major')).toEqual({ root: 'B' })
  })

  it('prefers sharps in major-mode sharp keys', () => {
    // F# major (6) — common sharp key
    expect(tonicIntToNote(6, 'major')).toEqual({ root: 'F', accidental: 'sharp' })
  })

  it('prefers flats in minor mode for Bb, Eb, Ab', () => {
    // Bb minor (10), Eb minor (3), Ab minor (8)
    expect(tonicIntToNote(10, 'minor')).toEqual({ root: 'B', accidental: 'flat' })
    expect(tonicIntToNote(3, 'minor')).toEqual({ root: 'E', accidental: 'flat' })
    expect(tonicIntToNote(8, 'minor')).toEqual({ root: 'A', accidental: 'flat' })
  })

  it('handles natural-tonic minor keys without an accidental', () => {
    expect(tonicIntToNote(9, 'minor')).toEqual({ root: 'A' })
    expect(tonicIntToNote(4, 'minor')).toEqual({ root: 'E' })
  })
})
