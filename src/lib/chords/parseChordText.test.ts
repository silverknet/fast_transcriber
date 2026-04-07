import { describe, expect, it } from 'vitest'
import { parseChordText } from './parseChordText'

describe('parseChordText', () => {
  it('parses major triads and qualities', () => {
    const c = parseChordText('C')
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.chord.quality).toBe('major')

    const em = parseChordText('Em')
    expect(em.ok).toBe(true)
    if (em.ok) expect(em.chord.quality).toBe('minor')
  })

  it('parses slash chords', () => {
    const r = parseChordText('C/E')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.chord.root).toBe('C')
      expect(r.chord.bass).toBe('E')
    }
  })

  it('accepts unicode accidentals', () => {
    const r = parseChordText('E♭m')
    expect(r.ok).toBe(true)
  })
})
