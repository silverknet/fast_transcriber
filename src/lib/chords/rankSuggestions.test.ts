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
})
