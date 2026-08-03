/**
 * Locking the bass to the kick. The promises here are the ones that keep it
 * musical: it aligns, it never invents or drops a note, and it refuses to drag
 * a note that simply is not near a kick.
 */
import { describe, expect, it } from 'vitest'
import { followKick, kickTimesFrom } from './bassKickFollow'
import type { BassMidiEvent } from './types'

const note = (timeSec: number, midi = 40): BassMidiEvent => ({
  timeSec,
  durationSec: 0.4,
  midi,
  velocity: 0.8,
})

describe('pulling bass onsets onto the kick', () => {
  it('full amount lands the note exactly on the kick', () => {
    const out = followKick([note(1.03)], [1.0], 1, 0.2)
    expect(out[0]!.timeSec).toBeCloseTo(1.0, 9)
  })

  it('half amount moves it halfway — a bassist behind the kick still grooves', () => {
    const out = followKick([note(1.04)], [1.0], 0.5, 0.2)
    expect(out[0]!.timeSec).toBeCloseTo(1.02, 9)
  })

  it('amount 0 changes nothing at all', () => {
    const src = [note(1.04), note(2.5)]
    expect(followKick(src, [1.0, 2.0], 0, 0.2).map((e) => e.timeSec)).toEqual([1.04, 2.5])
  })

  it('a note far from any kick is left alone, not dragged across the bar', () => {
    // Kick at 1.0, note at 1.9 — 900 ms away, with a 200 ms reach.
    const out = followKick([note(1.9)], [1.0], 1, 0.2)
    expect(out[0]!.timeSec).toBeCloseTo(1.9, 9)
  })

  it('pulls to the NEAREST kick, forwards or backwards', () => {
    expect(followKick([note(1.96)], [1.0, 2.0], 1, 0.2)[0]!.timeSec).toBeCloseTo(2.0, 9)
    expect(followKick([note(1.04)], [1.0, 2.0], 1, 0.2)[0]!.timeSec).toBeCloseTo(1.0, 9)
  })

  it('never loses a note, and never invents one', () => {
    const src = [note(1.02), note(1.9), note(2.03), note(9.9)]
    const out = followKick(src, [1.0, 2.0, 3.0], 1, 0.2)
    expect(out).toHaveLength(src.length)
    expect(out.map((e) => e.midi)).toEqual(src.map((e) => e.midi))
  })

  it('keeps note lengths — this moves starts, not phrasing', () => {
    const out = followKick([note(1.05)], [1.0], 1, 0.2)
    expect(out[0]!.durationSec).toBeCloseTo(0.4, 9)
  })

  it('returns events in time order after moving them', () => {
    const out = followKick([note(2.02), note(1.02)], [1.0, 2.0], 1, 0.2)
    expect(out.map((e) => e.timeSec)).toEqual([1.0, 2.0])
  })

  it('no kicks, or no notes, is a safe no-op', () => {
    expect(followKick([note(1)], [], 1, 0.2)[0]!.timeSec).toBe(1)
    expect(followKick([], [1, 2], 1, 0.2)).toEqual([])
  })

  it('an out-of-range amount is clamped rather than exaggerated', () => {
    expect(followKick([note(1.1)], [1.0], 5, 0.2)[0]!.timeSec).toBeCloseTo(1.0, 9)
    expect(followKick([note(1.1)], [1.0], -3, 0.2)[0]!.timeSec).toBeCloseTo(1.1, 9)
  })

  it('never produces a negative time', () => {
    expect(followKick([note(0.01)], [0], 1, 0.2)[0]!.timeSec).toBeGreaterThanOrEqual(0)
  })
})

describe('reading kicks out of a drum part', () => {
  it('takes only the kicks, in time order', () => {
    expect(
      kickTimesFrom([
        { timeSec: 2, cls: 'kick' },
        { timeSec: 0.5, cls: 'snare' },
        { timeSec: 1, cls: 'kick' },
        { timeSec: 1.5, cls: 'hihat' },
      ]),
    ).toEqual([1, 2])
  })

  it('no kicks means no times — the caller then does nothing', () => {
    expect(kickTimesFrom([{ timeSec: 1, cls: 'snare' }])).toEqual([])
  })
})
