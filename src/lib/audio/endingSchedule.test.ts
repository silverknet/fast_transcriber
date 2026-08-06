/**
 * The ending decision, pinned. Preview and stage both run this, so anything
 * wrong here is wrong in the rehearsal AND at the gig — which is the point:
 * they cannot disagree.
 */
import { describe, expect, it } from 'vitest'
import {
  defaultEndingEffect,
  endWarningMixerSec,
  planEnding,
  type EndingTiming,
} from './endingSchedule'

const TIMING: EndingTiming = { endMixerSec: 200, beatDurationSec: 0.5, barDurationSec: 2 }

const fadeOf = (s: ReturnType<typeof planEnding>) =>
  s.actions.find((a) => a.kind === 'programme-fade') as
    | { kind: 'programme-fade'; fromSec: number; toSec: number }
    | undefined

describe('clean cut', () => {
  it('ramps only long enough to avoid a click, ending exactly on the anchor', () => {
    const s = planEnding({ type: 'cut', cut: { softnessMs: 20 } }, TIMING)
    expect(s.stopsAtEnd).toBe(true)
    expect(fadeOf(s)).toEqual({ kind: 'programme-fade', fromSec: 199.98, toSec: 200 })
    expect(s.actions.some((a) => a.kind === 'drum-hit')).toBe(false)
  })

  it('never rings out — a cut that faded would not be a cut', () => {
    const s = planEnding({ type: 'cut', cut: { softnessMs: 500 } }, TIMING)
    expect(fadeOf(s)!.toSec - fadeOf(s)!.fromSec).toBeLessThanOrEqual(0.5)
  })
})

describe('band hit', () => {
  const HIT = { type: 'hit' as const, hit: { kickLevel: 0.9, crashLevel: 0.7, softnessMs: 24 } }

  it('lands kick and crash together ON the anchor', () => {
    const s = planEnding(HIT, TIMING)
    const hits = s.actions.filter((a) => a.kind === 'drum-hit')
    expect(hits).toEqual([
      { kind: 'drum-hit', cls: 'kick', atSec: 200, level: 0.9 },
      { kind: 'drum-hit', cls: 'cymbal', atSec: 200, level: 0.7 },
    ])
  })

  it('stops the backing under the hit', () => {
    expect(fadeOf(planEnding(HIT, TIMING))!.toSec).toBe(200)
  })

  it('omits a voice set to silence rather than scheduling a silent hit', () => {
    const s = planEnding(
      { type: 'hit', hit: { kickLevel: 0, crashLevel: 0.7, softnessMs: 24 } },
      TIMING,
    )
    expect(s.actions.filter((a) => a.kind === 'drum-hit')).toHaveLength(1)
  })
})

describe('fade', () => {
  it('is measured in BARS, so it lasts the same musical length at any tempo', () => {
    const s = planEnding({ type: 'fade', fade: { bars: 2 } }, TIMING)
    expect(fadeOf(s)).toEqual({ kind: 'programme-fade', fromSec: 196, toSec: 200 })

    const slower = planEnding(
      { type: 'fade', fade: { bars: 2 } },
      { ...TIMING, barDurationSec: 4 },
    )
    expect(fadeOf(slower)!.fromSec).toBe(192)
  })

  it('a fade longer than the song starts at zero, it does not go negative', () => {
    const s = planEnding({ type: 'fade', fade: { bars: 32 } }, { ...TIMING, endMixerSec: 10 })
    expect(fadeOf(s)!.fromSec).toBe(0)
    expect(fadeOf(s)!.toSec).toBe(10)
  })
})

describe('echo is left alone', () => {
  it('schedules nothing and must NOT be stopped at the anchor', () => {
    // The echo hands off under its own tail. Stopping the transport at the
    // anchor would cut the very thing the ending is made of.
    const s = planEnding(
      { type: 'echo', echo: {} as never },
      TIMING,
    )
    expect(s.actions).toEqual([])
    expect(s.stopsAtEnd).toBe(false)
    expect(s.endSec).toBe(200)
  })
})

describe('degenerate timing cannot produce nonsense', () => {
  it('falls back when beat/bar are missing', () => {
    const s = planEnding(
      { type: 'fade', fade: { bars: 1 } },
      { endMixerSec: 100, beatDurationSec: 0, barDurationSec: 0 },
    )
    // beat → 0.5, bar → beat*4 = 2
    expect(fadeOf(s)).toEqual({ kind: 'programme-fade', fromSec: 98, toSec: 100 })
  })

  it('a negative anchor clamps to zero', () => {
    const s = planEnding({ type: 'cut', cut: { softnessMs: 20 } }, { ...TIMING, endMixerSec: -5 })
    expect(s.endSec).toBe(0)
    expect(fadeOf(s)!.fromSec).toBe(0)
  })
})

describe('defaults for a newly chosen ending', () => {
  it('gives every simple type something usable', () => {
    expect(defaultEndingEffect('cut')).toEqual({ type: 'cut', cut: { softnessMs: 18 } })
    expect(defaultEndingEffect('hit')?.type).toBe('hit')
    expect(defaultEndingEffect('fade')).toEqual({ type: 'fade', fade: { bars: 2 } })
  })

  it('refuses to guess echo, which the lab tunes', () => {
    expect(defaultEndingEffect('echo')).toBeNull()
  })
})

describe('the spoken warning before the ending', () => {
  it('lands the requested number of BARS before the anchor', () => {
    expect(endWarningMixerSec({ leadBars: 2 }, TIMING)).toBe(196)
    expect(endWarningMixerSec({ leadBars: 4 }, TIMING)).toBe(192)
  })

  it('is musical, not clock-based — same bars, different tempo, different seconds', () => {
    expect(endWarningMixerSec({ leadBars: 2 }, { ...TIMING, barDurationSec: 4 })).toBe(192)
  })

  it('is dropped rather than promised when it would fall before the song starts', () => {
    // A cue at a negative time is either silently dropped or fires instantly at
    // zero. Both are worse than not offering a warning at all.
    expect(endWarningMixerSec({ leadBars: 8 }, { ...TIMING, endMixerSec: 3 })).toBeNull()
    expect(endWarningMixerSec({ leadBars: 2 }, { ...TIMING, endMixerSec: 4 })).toBeNull()
  })

  it('is absent when no warning was authored', () => {
    expect(endWarningMixerSec(undefined, TIMING)).toBeNull()
  })

  it('falls back sanely with no grid to measure', () => {
    expect(
      endWarningMixerSec({ leadBars: 1 }, { endMixerSec: 100, beatDurationSec: 0, barDurationSec: 0 }),
    ).toBe(98)
  })
})
