import { describe, expect, it } from 'vitest'
import { parseChordText } from './parseChordText'
import { transposeChord } from './transposeChord'

describe('transposeChord', () => {
  it('transposes by semitones', () => {
    const c = parseChordText('C')
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const t = transposeChord(c.chord, 2)
    expect(t.root).toBe('D')
  })
})
