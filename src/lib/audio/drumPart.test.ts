/**
 * The original-time → mix-time mapping.
 *
 * This is the anti-drift test. The live instrument and the WAV renderer must
 * place hits at exactly the same moment; if they diverge even a few
 * milliseconds the drums feel late against the click and nothing else fails.
 * So the expectations here are stated as the renderer's own arithmetic, not as
 * hardcoded numbers.
 */
import { describe, expect, it } from 'vitest'
import { buildDrumPart, drumTrackLayout, type DrumTrackLayout } from './drumPart'
import { drumVelocityGain } from './renderDrumTrack'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Bar, Beat, DrumMidiEvent, SongMap } from '$lib/songmap/types'

function song(trimStart = 2, trimEnd = 10): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < 8; i++) {
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: trimStart + i,
      endSec: trimStart + i + 1,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
    })
    for (let j = 0; j < 4; j++) {
      beats.push({
        id: `b${i}_${j}`,
        barId: `bar${i}`,
        indexInBar: j,
        timeSec: trimStart + i + j / 4,
      })
    }
  }
  return {
    ...createEmptySongMap(),
    timeline: { bars, beats },
    audio: { trim: { startSec: trimStart, endSec: trimEnd } } as SongMap['audio'],
  }
}

const hit = (timeSec: number, velocity = 0.8): DrumMidiEvent => ({
  timeSec,
  cls: 'kick',
  velocity,
})

const layoutOf = (sm: SongMap): DrumTrackLayout => {
  const l = drumTrackLayout(sm)
  expect(l).not.toBeNull()
  return l!
}

describe('drumTrackLayout', () => {
  it('is null without a usable trim — the same condition the renderer throws on', () => {
    expect(drumTrackLayout(createEmptySongMap())).toBeNull()
    const bad = { ...song(), audio: { trim: { startSec: 5, endSec: 5 } } } as SongMap
    expect(drumTrackLayout(bad)).toBeNull()
  })

  it('reports the trim window and a positive duration', () => {
    const l = layoutOf(song(2, 10))
    expect(l.trimStartSec).toBe(2)
    expect(l.trimEndSec).toBe(10)
    expect(l.durationSec).toBeGreaterThan(0)
    expect(l.shiftSec).toBeGreaterThanOrEqual(0)
  })

  it('duration covers the preamble plus the trimmed song', () => {
    const l = layoutOf(song(2, 10))
    expect(l.durationSec).toBeCloseTo(l.shiftSec + (l.trimEndSec - l.trimStartSec), 6)
  })
})

describe('buildDrumPart', () => {
  it('shifts original time onto the mix timeline', () => {
    const sm = song(2, 10)
    const l = layoutOf(sm)
    const part = buildDrumPart([hit(2), hit(5.5)], l)
    expect(part.hits[0]!.mixTimeSec).toBeCloseTo(l.shiftSec + 0, 9)
    expect(part.hits[1]!.mixTimeSec).toBeCloseTo(l.shiftSec + 3.5, 9)
  })

  it('drops events outside the trim, with the renderer’s exact boundaries', () => {
    // `mixDrumEvents` uses `< trimStart || >= trimEnd` — start inclusive, end
    // exclusive. Getting either end wrong loses or duplicates a hit.
    const sm = song(2, 10)
    const l = layoutOf(sm)
    // 1.99 is before the start; 10 and 10.1 are at/after the end. Only 2 and
    // 9.999 survive.
    const part = buildDrumPart([hit(1.99), hit(2), hit(9.999), hit(10), hit(10.1)], l)
    expect(part.hits.length).toBe(2)
    expect(part.hits[0]!.mixTimeSec).toBeCloseTo(l.shiftSec, 9)
    expect(part.hits[1]!.mixTimeSec).toBeCloseTo(l.shiftSec + 7.999, 6)
  })

  it('applies the renderer’s velocity curve, not a linear one', () => {
    const l = layoutOf(song())
    const part = buildDrumPart([hit(3, 0.5)], l)
    expect(part.hits[0]!.gain).toBeCloseTo(drumVelocityGain(0.5), 9)
    expect(part.hits[0]!.gain).not.toBeCloseTo(0.5, 3)
  })

  it('sorts by time so a scheduler can walk it in order', () => {
    const l = layoutOf(song())
    const part = buildDrumPart([hit(6), hit(3), hit(4.5)], l)
    const times = part.hits.map((h) => h.mixTimeSec)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('keeps the class, so each hit reaches its own voice and pan', () => {
    const l = layoutOf(song())
    const events: DrumMidiEvent[] = [
      { timeSec: 3, cls: 'kick', velocity: 1 },
      { timeSec: 3.25, cls: 'ride', velocity: 0.5 },
    ]
    expect(buildDrumPart(events, l).hits.map((h) => h.cls)).toEqual(['kick', 'ride'])
  })

  it('carries the layout duration through, so the lane knows its length', () => {
    const l = layoutOf(song())
    expect(buildDrumPart([hit(3)], l).durationSec).toBe(l.durationSec)
  })

  it('an empty part is empty, not a crash', () => {
    const l = layoutOf(song())
    expect(buildDrumPart([], l).hits).toEqual([])
  })
})
