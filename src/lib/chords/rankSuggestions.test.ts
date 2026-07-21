import { describe, expect, it } from 'vitest'
import { rankChordSuggestions } from './rankSuggestions'

describe('rankChordSuggestions', () => {
  it('returns diatonic chords when key is set', () => {
    const key = { root: 'C' as const, mode: 'major' as const }
    const r = rankChordSuggestions('', key, { limit: 40 })
    expect(r.length).toBeGreaterThan(5)
    expect(r.some((x) => x.inKey && x.label.includes('C'))).toBe(true)
  })

  it('ranks in-key matches before others when query matches', () => {
    const key = { root: 'G' as const, mode: 'major' as const }
    const r = rankChordSuggestions('em', key, { limit: 20 })
    const firstInKey = r.find((x) => x.inKey && x.label.toLowerCase().includes('em'))
    expect(firstInKey).toBeDefined()
  })

  it('minor chords are browsable from a partial root query (no key)', () => {
    // Historically "f#" only offered F# major — F#m was unreachable without
    // typing the full symbol. Now the browse space covers common qualities.
    const r = rankChordSuggestions('f#', undefined, { limit: 24 })
    const labels = r.map((x) => x.label)
    expect(labels).toContain('F#')
    expect(labels).toContain('F#m')
    expect(labels).toContain('F#7')
    expect(labels).toContain('F#m7')
  })

  it('exact-typed chord ranks first and is flagged in-key when diatonic', () => {
    const key = { root: 'A' as const, mode: 'major' as const }
    const r = rankChordSuggestions('f#m', key, { limit: 24 })
    expect(r[0]?.label).toBe('F#m')
    expect(r[0]?.inKey).toBe(true) // vi of A major
  })

  it('in-key beats out-of-key on the same prefix', () => {
    // In A major, typing "e": E (V, diatonic) must rank above Em / E7 etc.
    const key = { root: 'A' as const, mode: 'major' as const }
    const r = rankChordSuggestions('e', key, { limit: 24 })
    const eIdx = r.findIndex((x) => x.label === 'E')
    const emIdx = r.findIndex((x) => x.label === 'Em')
    expect(eIdx).toBeGreaterThanOrEqual(0)
    expect(emIdx).toBeGreaterThanOrEqual(0)
    expect(eIdx).toBeLessThan(emIdx)
    expect(r[eIdx]?.inKey).toBe(true)
  })

  it('common qualities rank before exotic ones on ties', () => {
    const r = rankChordSuggestions('b', undefined, { limit: 24 })
    const order = ['B', 'Bm', 'B7'].map((l) => r.findIndex((x) => x.label === l))
    expect(order[0]).toBeGreaterThanOrEqual(0)
    expect(order[1]).toBeGreaterThan(order[0]!)
    expect(order[2]).toBeGreaterThan(order[1]!)
  })

  it('empty query without a key returns nothing rather than chord soup', () => {
    const r = rankChordSuggestions('', undefined, { limit: 24 })
    expect(r).toEqual([])
  })

  it('flat keys spell the browse space with flats', () => {
    const key = { root: 'E' as const, accidental: 'flat' as const, mode: 'major' as const }
    const r = rankChordSuggestions('bb', key, { limit: 24 })
    expect(r.some((x) => x.label === 'Bb')).toBe(true)
  })

  /**
   * Regression: the picker's "exact parse" slot used the LENIENT entry parser,
   * which silently drops whatever it can't model. `Dm7` came back as `Dmaj7`
   * (a case-sensitivity bug in `parseChordText`) and colored chords collapsed
   * to bare triads — `Bm7b5` offered only `B`. The exact slot now tries the
   * STRICT sheet-import grammar first and falls back to the lenient parser for
   * partial input.
   */
  describe('typed chords come back as typed', () => {
    const key = { root: 'C' as const, mode: 'major' as const }

    it('a minor seventh is never offered as a major seventh', () => {
      const labels = rankChordSuggestions('Dm7', key, { limit: 24 }).map((x) => x.label)
      expect(labels[0]).toBe('Dm7')
      expect(labels).not.toContain('Dmaj7')
    })

    for (const symbol of ['Bm7b5', 'E7b9', 'C6', 'Cm9', 'C7sus4', 'Bdim7', 'Am6']) {
      it(`${symbol} is reachable and keeps its color`, () => {
        const r = rankChordSuggestions(symbol, key, { limit: 24 })
        expect(r[0]?.label).toBe(symbol)
      })
    }

    it('slash chords still resolve', () => {
      const r = rankChordSuggestions('C/E', key, { limit: 24 })
      expect(r[0]?.label).toBe('C/E')
      expect(r[0]?.chord.bass).toBe('E')
    })

    it('partial input still browses (the strict grammar must not swallow it)', () => {
      const labels = rankChordSuggestions('Dm', key, { limit: 24 }).map((x) => x.label)
      expect(labels).toContain('Dm')
      expect(labels).toContain('Dm7')
    })

    it('lowercase partial roots still browse', () => {
      const labels = rankChordSuggestions('f#', key, { limit: 24 }).map((x) => x.label)
      expect(labels).toContain('F#')
      expect(labels).toContain('F#m7')
    })
  })

  describe('lowercase entry — people do not shift-key the root', () => {
    const key = { root: 'C' as const, mode: 'major' as const }

    // The strict grammar demands an uppercase root because it was built for
    // chord SHEETS ("am I wrong" must not parse as Am). In the entry box that
    // rejected `bm7b5`, dropping it onto the lenient parser, which cannot model
    // half-diminished and produced `Bb5`.
    for (const [typed, want] of [
      ['bm7b5', 'Bm7b5'],
      ['f#m7b5', 'F#m7b5'],
      ['c6', 'C6'],
      ['cm9', 'Cm9'],
      ['e7b9', 'E7b9'],
      ['am6', 'Am6'],
      ['bbm7', 'Bbm7'],
      ['c#m7', 'C#m7'],
      ['dm7', 'Dm7'],
      ['bdim7', 'Bdim7'],
      ['c7sus4', 'C7sus4'],
    ] as const) {
      it(`"${typed}" offers ${want}`, () => {
        expect(rankChordSuggestions(typed, key, { limit: 24 })[0]?.label).toBe(want)
      })
    }

    it('uppercase keeps working identically', () => {
      for (const typed of ['Bm7b5', 'C6', 'Cm9']) {
        expect(rankChordSuggestions(typed.toLowerCase(), key, { limit: 24 })[0]?.label).toBe(
          rankChordSuggestions(typed, key, { limit: 24 })[0]?.label,
        )
      }
    })

    it('lowercase partial input still browses rather than resolving', () => {
      const labels = rankChordSuggestions('bm', key, { limit: 24 }).map((x) => x.label)
      expect(labels).toContain('Bm')
      expect(labels).toContain('Bm7')
    })
  })

  describe('coloured chords are discoverable while typing', () => {
    const key = { root: 'C' as const, mode: 'major' as const }
    const labels = (q: string) => rankChordSuggestions(q, key, { limit: 24 }).map((x) => x.label)

    it('surfaces Bm7b5 long before the whole symbol is typed', () => {
      // Previously you had to know the full symbol and type every character:
      // "bm7" offered only Bm7, and "bm7b" offered plain "B".
      expect(labels('bm')).toContain('Bm7b5')
      expect(labels('bm7')).toContain('Bm7b5')
      expect(labels('bm7b')).toContain('Bm7b5')
    })

    it('never proposes a chord the query does not account for', () => {
      // The lenient parser drops what it cannot model; a half-typed symbol must
      // not resolve to a different chord.
      expect(labels('bm7b')).not.toContain('B')
      expect(labels('cm9x')).not.toContain('C')
    })

    it('offers the common colours once a root and quality are typed', () => {
      // A bare "c" matches half the browse space (including C#…), so colours
      // are surfaced as the query narrows rather than all at once.
      for (const [q, want] of [['c6', 'C6'], ['cm', 'Cm9'], ['cadd', 'Cadd9'], ['cdim', 'Cdim7']] as const) {
        expect(labels(q), q).toContain(want)
      }
    })

    it('does not mark coloured variants as in-key just because their base is', () => {
      // `Cmaj9` is not diatonic in C major; flagging it in-key floated it above
      // ordinary chords like Cm and C7.
      const rows = rankChordSuggestions('c', key, { limit: 40 })
      const cmaj9 = rows.find((r) => r.label === 'Cmaj9')
      expect(cmaj9?.inKey ?? false).toBe(false)
      expect(rows.find((r) => r.label === 'C')?.inKey).toBe(true)
    })

    it('plain chords still rank above coloured ones', () => {
      const l = labels('bm')
      expect(l.indexOf('Bm')).toBeLessThan(l.indexOf('Bm7b5'))
    })

    it('unicode accidentals resolve, keeping what was typed', () => {
      // The strict parser preserves the token verbatim, so a typed ♭ stays a ♭.
      expect(labels('E\u266dm')[0]).toBe('E\u266dm')
    })
  })
})
