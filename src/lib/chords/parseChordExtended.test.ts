import { describe, expect, it } from 'vitest'
import { parseChordText } from './parseChordText'

/**
 * Regression for the extended/altered chord mangling (audit defect C1).
 *
 * The quality patterns used to reject any trailing colour tone: `m7b5` fell
 * through the `m7` guard to MAJOR, then the caller salvaged the `b5` as a bare
 * alteration and dropped the seventh — so a half-diminished chord displayed as
 * `Cb5`. Likewise `Am9` / `Cmaj9` parsed to added-ninth triads instead of the
 * extended seventh chords a musician means. These forms are common enough
 * (jazz/pop lead sheets) that silent corruption is a real data-quality bug.
 */
function parsed(text: string) {
  const r = parseChordText(text)
  if (!r.ok) throw new Error(`expected ${text} to parse, got: ${r.error}`)
  return r.chord
}

describe('parseChordText — extended & altered chords (C1 regression)', () => {
  it('m7b5 (half-diminished) is min7 with a b5 colour tone, not a bare b5 triad', () => {
    const c = parsed('Cm7b5')
    expect(c.root).toBe('C')
    expect(c.quality).toBe('min7')
    expect(c.alterations).toContain('b5')
    // The seventh must survive round-trip.
    expect(c.displayRaw).toContain('7')
    expect(c.displayRaw).toContain('b5')
  })

  it('m9 implies the b7 → min7 + 9 (not an A major / add9 triad)', () => {
    const c = parsed('Am9')
    expect(c.root).toBe('A')
    expect(c.quality).toBe('min7')
    expect(c.extensions).toContain('9')
  })

  it('m11 and m13 keep their minor-seventh character', () => {
    expect(parsed('Dm11').quality).toBe('min7')
    expect(parsed('Dm11').extensions).toContain('11')
    expect(parsed('Dm13').quality).toBe('min7')
    expect(parsed('Dm13').extensions).toContain('13')
  })

  it('maj9/maj11/maj13 keep the major-seventh character + extension', () => {
    const c9 = parsed('Cmaj9')
    expect(c9.quality).toBe('maj7')
    expect(c9.extensions).toContain('9')
    expect(parsed('Cmaj11').quality).toBe('maj7')
    expect(parsed('Cmaj11').extensions).toContain('11')
    expect(parsed('Cmaj13').quality).toBe('maj7')
    expect(parsed('Cmaj13').extensions).toContain('13')
  })

  it('does not regress the plain sevenths it already handled', () => {
    expect(parsed('Cm7').quality).toBe('min7')
    expect(parsed('Cmaj7').quality).toBe('maj7')
    expect(parsed('Dm7').quality).toBe('min7')
    expect(parsed('G7').quality).toBe('7')
    expect(parsed('C').quality).toBe('major')
    expect(parsed('Cm').quality).toBe('minor')
  })

  it('round-trips the display so a re-parse is stable', () => {
    for (const t of ['Cm7b5', 'Am9', 'Cmaj9', 'Dm11', 'Cmaj13']) {
      const first = parsed(t)
      const second = parsed(first.displayRaw)
      expect(second.quality).toBe(first.quality)
      expect(second.extensions ?? []).toEqual(first.extensions ?? [])
    }
  })
})
