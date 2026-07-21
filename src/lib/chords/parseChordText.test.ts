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

  /**
   * Regression: `/^M7(?![a-z])/i` carried the `/i` flag, so the MAJOR-seventh
   * rule matched lowercase `m7` too — and being earlier in the pattern list it
   * won, turning every minor seventh into a major seventh. `Dm7` came back as
   * `Dmaj7`, and the chord picker offered that as its first hit.
   */
  describe('seventh chords — case decides major vs minor', () => {
    const minorSevenths = ['Dm7', 'Am7', 'Cm7', 'F#m7', 'Bbm7', 'Dmin7', 'Dmi7', 'D-7']
    for (const input of minorSevenths) {
      it(`${input} is a MINOR seventh`, () => {
        const r = parseChordText(input)
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.chord.quality).toBe('min7')
      })
    }

    const majorSevenths = ['Cmaj7', 'CMaj7', 'CMAJ7', 'CM7', 'Cma7']
    for (const input of majorSevenths) {
      it(`${input} is a MAJOR seventh`, () => {
        const r = parseChordText(input)
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.chord.quality).toBe('maj7')
      })
    }

    it('round-trips a minor seventh through displayRaw', () => {
      const r = parseChordText('Dm7')
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.chord.displayRaw).toBe('Dm7')
    })

    it('bare `m` is minor and bare `M` is major', () => {
      const lower = parseChordText('Cm')
      const upper = parseChordText('CM')
      expect(lower.ok && lower.chord.quality).toBe('minor')
      expect(upper.ok && upper.chord.quality).toBe('major')
    })

    it('dominant sevenths are unaffected', () => {
      const r = parseChordText('G7')
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.chord.quality).toBe('7')
    })
  })
})
