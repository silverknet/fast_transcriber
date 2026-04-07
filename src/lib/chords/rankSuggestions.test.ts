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
})
