import { describe, it, expect } from 'vitest'
import {
  bufferSecToWallSec,
  varispeedRate,
  varispeedSemitones,
  varispeedTempoPercent,
  wallSecToBufferSec,
  varispeedPlan,
  heldTempoPercent,
} from './varispeed'

describe('varispeedRate', () => {
  it('is exactly 1 at no transpose — playback must be bit-identical', () => {
    expect(varispeedRate(0)).toBe(1)
  })

  it('an octave up doubles the speed, an octave down halves it', () => {
    expect(varispeedRate(12)).toBeCloseTo(2, 12)
    expect(varispeedRate(-12)).toBeCloseTo(0.5, 12)
  })

  it('one semitone is the usual ~5.95%', () => {
    expect(varispeedRate(1)).toBeCloseTo(1.059463, 5)
  })

  it('is monotonic in the semitone offset', () => {
    for (let n = -12; n < 12; n++) {
      expect(varispeedRate(n + 1)).toBeGreaterThan(varispeedRate(n))
    }
  })

  it('treats junk as no transpose rather than producing a silent/insane rate', () => {
    expect(varispeedRate(NaN)).toBe(1)
    expect(varispeedRate(Infinity)).toBe(1)
  })
})

describe('the round-trip identity: transpose⁻¹(transpose(audio)) === audio', () => {
  /**
   * The guarantee is that we return to a rate of EXACTLY 1, because the state
   * kept is the integer semitone and the rate is always recomputed from it.
   */
  it('returns to exactly 1 after any there-and-back, for every offset', () => {
    for (let n = -12; n <= 12; n++) {
      const there = n
      const back = there - n // the user undid it: net offset 0
      expect(varispeedRate(back)).toBe(1)
    }
  })

  it('composing rates instead would NOT be exact — which is why we do not', () => {
    // Documents the trap: this is the implementation we deliberately avoid.
    let composed = 1
    for (let i = 0; i < 7; i++) composed *= varispeedRate(1)
    for (let i = 0; i < 7; i++) composed *= varispeedRate(-1)
    expect(composed).not.toBe(1) // drifts off unity…
    expect(composed).toBeCloseTo(1, 12) // …only slightly, which is why it hides
    // Recomputing from the semitone is exact, every time.
    expect(varispeedRate(7 - 7)).toBe(1)
  })

  it('semitone → rate → semitone survives the trip', () => {
    for (let n = -12; n <= 12; n++) {
      expect(varispeedSemitones(varispeedRate(n))).toBeCloseTo(n, 10)
    }
  })
})

describe('time-base conversion', () => {
  it('is the identity at no transpose', () => {
    expect(bufferSecToWallSec(3.7, 1)).toBe(3.7)
    expect(wallSecToBufferSec(3.7, 1)).toBe(3.7)
  })

  it('up a semitone: the song finishes sooner in wall time', () => {
    const rate = varispeedRate(2)
    expect(bufferSecToWallSec(100, rate)).toBeLessThan(100)
    expect(bufferSecToWallSec(100, rate)).toBeCloseTo(100 / rate, 9)
  })

  it('down a semitone: the song takes longer', () => {
    expect(bufferSecToWallSec(100, varispeedRate(-2))).toBeGreaterThan(100)
  })

  it('the two conversions invert each other at every offset', () => {
    for (let n = -12; n <= 12; n++) {
      const rate = varispeedRate(n)
      expect(wallSecToBufferSec(bufferSecToWallSec(12.34, rate), rate)).toBeCloseTo(12.34, 9)
    }
  })

  it('never divides by zero on a degenerate rate', () => {
    expect(bufferSecToWallSec(5, 0)).toBe(5)
    expect(bufferSecToWallSec(5, -1)).toBe(5)
  })
})

describe('varispeedTempoPercent', () => {
  it('is 0 at no transpose and positive going up', () => {
    expect(varispeedTempoPercent(0)).toBe(0)
    expect(varispeedTempoPercent(2)).toBeCloseTo(12.2, 1)
    expect(varispeedTempoPercent(-2)).toBeCloseTo(-10.9, 1)
  })
})

describe('varispeedPlan — splitting the transpose between rate and stretch', () => {
  it('h=0 is pure varispeed and BYPASSES the stretcher (shift exactly 0)', () => {
    for (let n = -12; n <= 12; n++) {
      const p = varispeedPlan(n, 0)
      expect(p.shiftSemitones).toBe(0) // exactly — the node must be bypassed
      expect(p.rate).toBe(varispeedRate(n))
    }
  })

  it('h=1 keeps tempo: rate exactly 1, the stretcher does all of it', () => {
    for (let n = -12; n <= 12; n++) {
      const p = varispeedPlan(n, 1)
      expect(p.rate).toBe(1) // exactly — no resampling at all
      expect(p.shiftSemitones).toBeCloseTo(n, 12)
    }
  })

  it('no transpose is neutral at ANY hold amount', () => {
    for (const h of [0, 0.25, 0.5, 1]) {
      expect(varispeedPlan(0, h)).toEqual({ rate: 1, shiftSemitones: 0 })
    }
  })

  it('the two halves always sum back to the requested transpose', () => {
    for (let n = -12; n <= 12; n++) {
      for (const h of [0, 0.15, 0.4, 0.5, 0.85, 1]) {
        const p = varispeedPlan(n, h)
        const fromRate = varispeedSemitones(p.rate)
        expect(fromRate + p.shiftSemitones).toBeCloseTo(n, 9)
      }
    }
  })

  it('more hold → less tempo change AND more work for the stretcher', () => {
    const n = 4
    let prevTempo = Infinity
    let prevShift = -Infinity
    for (const h of [0, 0.25, 0.5, 0.75, 1]) {
      const p = varispeedPlan(n, h)
      expect(p.rate).toBeLessThan(prevTempo) // tempo change shrinks
      expect(Math.abs(p.shiftSemitones)).toBeGreaterThan(prevShift) // artifacts grow
      prevTempo = p.rate
      prevShift = Math.abs(p.shiftSemitones)
    }
  })

  it('half hold splits the work evenly', () => {
    const p = varispeedPlan(2, 0.5)
    expect(p.shiftSemitones).toBeCloseTo(1, 9)
    expect(varispeedSemitones(p.rate)).toBeCloseTo(1, 9)
  })

  it('clamps junk hold values', () => {
    expect(varispeedPlan(3, -1)).toEqual(varispeedPlan(3, 0))
    expect(varispeedPlan(3, 5)).toEqual(varispeedPlan(3, 1))
    expect(varispeedPlan(3, NaN)).toEqual(varispeedPlan(3, 0))
  })
})

describe('heldTempoPercent', () => {
  it('full hold means no tempo change at all', () => {
    for (let n = -12; n <= 12; n++) expect(heldTempoPercent(n, 1)).toBe(0)
  })

  it('no hold matches the plain varispeed tempo change', () => {
    expect(heldTempoPercent(2, 0)).toBeCloseTo(varispeedTempoPercent(2), 9)
  })

  it('partial hold lands between the two', () => {
    const partial = heldTempoPercent(2, 0.5)
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(varispeedTempoPercent(2))
  })
})
