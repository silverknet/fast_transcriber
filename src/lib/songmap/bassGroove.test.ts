import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { inferBassGroove } from './bassGroove'
import type { Bar, BassMidiEvent, Beat, SongMap } from './types'

/** 4 bars of 4/4, 1 s per bar → beats every 0.25 s, 8th slots every 0.125 s. */
function withGrid(sm: SongMap, barCount = 4, beatsPerBar = 4): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < barCount; i++) {
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: i,
      endSec: i + 1,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds: Array.from({ length: beatsPerBar }, (_, j) => `b${i}_${j}`),
    })
    for (let j = 0; j < beatsPerBar; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: i + j / beatsPerBar })
    }
  }
  return { ...sm, timeline: { bars, beats } }
}

function note(timeSec: number, midi = 40, durationSec = 0.2, velocity = 0.7): BassMidiEvent {
  return { timeSec, durationSec, midi, velocity }
}

const sm = withGrid(createEmptySongMap())

describe('inferBassGroove', () => {
  it('flattens dynamics into a narrow band', () => {
    const out = inferBassGroove(sm, [
      note(0, 40, 0.2, 0.3),
      note(0.5, 42, 0.2, 1.0),
      note(1.0, 43, 0.2, 0.55),
    ])
    const vels = out.map((e) => e.velocity)
    expect(Math.min(...vels)).toBeGreaterThanOrEqual(0.85)
    expect(Math.max(...vels) - Math.min(...vels)).toBeLessThan(0.12)
  })

  it('snaps onsets to 8th slots on the grid', () => {
    const out = inferBassGroove(sm, [note(0.06, 40), note(0.52, 42), note(1.19, 43)])
    for (const e of out) {
      const slot = e.timeSec / 0.125
      expect(Math.abs(slot - Math.round(slot))).toBeLessThan(1e-6)
    }
  })

  it('plays legato through stutter gaps but keeps real rests', () => {
    const out = inferBassGroove(sm, [
      note(0, 40, 0.18), // 70 ms stutter-gap to the next → legato
      note(0.25, 42, 0.2), // then a rest longer than a beat → stays a rest
      note(1.5, 43, 0.2),
    ])
    // First note holds until just before the second (0.25 − 0.015).
    expect(out[0]!.durationSec).toBeCloseTo(0.25 - 0.015, 3)
    // Second note does NOT stretch across the rest to 1.5s…
    expect(out[1]!.timeSec + out[1]!.durationSec).toBeLessThan(0.6)
    // …but stabs before a rest still speak for ~half a beat.
    expect(out[1]!.durationSec).toBeGreaterThanOrEqual(0.45 * 0.25 - 1e-9)
  })

  it('folds an isolated octave flake back into register', () => {
    const out = inferBassGroove(sm, [
      note(0, 40),
      note(0.5, 52), // +12 from both neighbors → folds to 40
      note(1.0, 41),
    ])
    expect(out[1]!.midi).toBe(40)
  })

  it('leaves a genuine octave walk alone', () => {
    const out = inferBassGroove(sm, [
      note(0, 40),
      note(0.5, 52),
      note(1.0, 52), // neighbor agrees — the line really went up
      note(1.5, 40),
    ])
    expect(out[1]!.midi).toBe(52)
    expect(out[2]!.midi).toBe(52)
  })

  it('same-slot collisions collapse to one note (the louder)', () => {
    const out = inferBassGroove(sm, [note(0.5, 40, 0.2, 0.4), note(0.51, 45, 0.2, 0.9)])
    expect(out.filter((e) => e.timeSec === 0.5)).toHaveLength(1)
    expect(out.find((e) => e.timeSec === 0.5)!.midi).toBe(45)
  })

  it('no grid → events still get dynamics/phrasing treatment without crashing', () => {
    const bare = createEmptySongMap()
    const out = inferBassGroove(bare, [note(0, 40, 0.1, 0.3), note(0.4, 42, 0.1, 0.9)])
    expect(out).toHaveLength(2)
    expect(out[0]!.velocity).toBeGreaterThanOrEqual(0.85)
  })
})
