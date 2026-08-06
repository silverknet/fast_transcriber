/**
 * The bed under the gap. Its whole job is to be the NEXT song's tempo and key,
 * so the gap stops being dead air and becomes an open-ended count-in.
 */
import { describe, expect, it } from 'vitest'
import { holdBedIsSilent, holdBedPattern, HOLD_BED_KINDS, type HoldBedInput } from './holdBed'

const base: HoldBedInput = { kind: 'kick', bpm: 120, tonicMidi: 60, level: 1 }

describe('tempo comes from the INCOMING song', () => {
  it('translates bpm into a beat length', () => {
    expect(holdBedPattern({ ...base, bpm: 120 }).beatDurationSec).toBeCloseTo(0.5, 6)
    expect(holdBedPattern({ ...base, bpm: 90 }).beatDurationSec).toBeCloseTo(2 / 3, 6)
  })

  it('falls back to a walkable tempo rather than dividing by nothing', () => {
    for (const bpm of [undefined, 0, -1, Number.NaN]) {
      expect(holdBedPattern({ ...base, bpm: bpm as never }).beatDurationSec).toBeCloseTo(0.6, 6)
    }
  })

  it('clamps a mis-detected double-time or a typo', () => {
    expect(holdBedPattern({ ...base, bpm: 5 }).beatDurationSec).toBeCloseTo(60 / 40, 6)
    expect(holdBedPattern({ ...base, bpm: 900 }).beatDurationSec).toBeCloseTo(60 / 220, 6)
  })
})

describe('the beds', () => {
  it('kick is four to the floor, with a stronger one', () => {
    const p = holdBedPattern({ ...base, kind: 'kick' })
    expect(p.drums.map((d) => d.atBeat)).toEqual([0, 1, 2, 3])
    expect(p.drums.every((d) => d.cls === 'kick')).toBe(true)
    expect(p.drums[0].level).toBeGreaterThan(p.drums[1].level)
    expect(p.notes).toEqual([])
  })

  it('kick + root note carries tempo AND key', () => {
    const p = holdBedPattern({ ...base, kind: 'kick-bass', tonicMidi: 62 })
    expect(p.drums).toHaveLength(4)
    expect(p.notes).toHaveLength(4)
    // An octave below the tonic — under the kick, not fighting it.
    expect(p.notes.every((n) => n.midi === 50)).toBe(true)
  })

  it('kick + hats puts the hats off the beat', () => {
    const p = holdBedPattern({ ...base, kind: 'kick-hat' })
    expect(p.drums.filter((d) => d.cls === 'hihat').map((d) => d.atBeat)).toEqual([0.5, 1.5, 2.5, 3.5])
  })

  it('pad is the new key breathing — no drums at all', () => {
    const p = holdBedPattern({ ...base, kind: 'pad', tonicMidi: 60 })
    expect(p.drums).toEqual([])
    expect(p.notes.map((n) => n.midi)).toEqual([60, 67]) // root + fifth
    expect(p.notes.every((n) => n.beats === p.loopBeats)).toBe(true)
  })
})

describe('an unknown key never guesses', () => {
  it('falls back to drums rather than playing a wrong root', () => {
    // A wrong key under a gap is worse than no key: the band tunes into it and
    // then the song starts somewhere else.
    const p = holdBedPattern({ ...base, kind: 'kick-bass', tonicMidi: null })
    expect(p.notes).toEqual([])
    expect(p.drums).toHaveLength(4)
  })

  it('a pad with no key becomes a pulse rather than silence', () => {
    const p = holdBedPattern({ ...base, kind: 'pad', tonicMidi: null })
    expect(holdBedIsSilent(p)).toBe(false)
    expect(p.drums).toHaveLength(4)
  })
})

describe('one level rides the whole bed', () => {
  it('scales everything and never exceeds it', () => {
    const p = holdBedPattern({ ...base, kind: 'kick-hat', level: 0.5 })
    for (const d of p.drums) expect(d.level).toBeLessThanOrEqual(0.5)
    expect(p.drums.some((d) => d.level > 0)).toBe(true)
  })

  it('level 0 is silent, and says so', () => {
    const p = holdBedPattern({ ...base, kind: 'kick-bass', level: 0 })
    expect(p.drums.every((d) => d.level === 0)).toBe(true)
    expect(p.notes.every((n) => n.level === 0)).toBe(true)
  })

  it('clamps a runaway level', () => {
    const p = holdBedPattern({ ...base, level: 99 })
    for (const d of p.drums) expect(d.level).toBeLessThanOrEqual(1)
  })
})

describe('every bed is playable', () => {
  it('no kind produces an empty loop with a known key', () => {
    for (const kind of HOLD_BED_KINDS) {
      const p = holdBedPattern({ ...base, kind })
      expect(holdBedIsSilent(p), kind).toBe(false)
      expect(p.loopBeats).toBe(4)
    }
  })
})
