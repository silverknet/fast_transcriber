import { describe, expect, it } from 'vitest'
import { computeCountIn } from './computeCountIn'
import type { Bar, Beat, SongMap } from '$lib/songmap/types'

/**
 * Count-in geometry: how much silence to prepend so N metronome clicks fit
 * before the first downbeat. This is what the performer hears BEFORE the song,
 * so a wrong `prependSec` or `beatDurationSec` is an audible timing bug. Locks
 * the happy path, the trim shift, the "already enough lead-in" clamp, and every
 * documented null contract.
 */
function bar(startSec: number, endSec: number, beatCount: number, beatIds: string[]): Bar {
  return { id: 'bar-0', index: 0, startSec, endSec, meter: { numerator: 4, denominator: 4 }, beatCount, beatIds }
}
function beat(id: string, timeSec: number, indexInBar: number): Beat {
  return { id, barId: 'bar-0', indexInBar, timeSec }
}
/** 1 bar over [startSec,endSec] with 4 evenly-spaced beats. */
function song(startSec: number, endSec: number, trimStartSec = 0): SongMap {
  const step = (endSec - startSec) / 4
  const beats = [0, 1, 2, 3].map((i) => beat(`b${i}`, startSec + i * step, i))
  return {
    timeline: { bars: [bar(startSec, endSec, 4, ['b0', 'b1', 'b2', 'b3'])], beats },
    audio: { fileName: 'a.wav', source: 'upload', trim: { startSec: trimStartSec, endSec } },
  } as unknown as SongMap
}

describe('computeCountIn — happy path', () => {
  it('prepends countInBeats × beatDuration when the downbeat sits at t=0', () => {
    const r = computeCountIn(song(0, 2), 4)
    expect(r).not.toBeNull()
    expect(r!.beatDurationSec).toBeCloseTo(0.5, 6) // (2−0)/4
    expect(r!.effectiveFirstDownbeatSec).toBeCloseTo(0, 6)
    expect(r!.prependSec).toBeCloseTo(2.0, 6) // 4 × 0.5, nothing to absorb it
  })

  it('absorbs the count-in into existing lead-in audio → prepend clamps to 0', () => {
    // First downbeat is 5s in; 4 clicks need only 2s, so no silence is added.
    const r = computeCountIn(song(5, 7), 4)
    expect(r!.beatDurationSec).toBeCloseTo(0.5, 6)
    expect(r!.effectiveFirstDownbeatSec).toBeCloseTo(5, 6)
    expect(r!.prependSec).toBe(0)
  })

  it('shifts the downbeat by the trim start', () => {
    // Downbeat at 5s, but 4s is trimmed off the head → effective lead-in is 1s.
    const r = computeCountIn(song(5, 7, 4), 4)
    expect(r!.effectiveFirstDownbeatSec).toBeCloseTo(1, 6) // 5 − 4
    expect(r!.prependSec).toBeCloseTo(1.0, 6) // max(0, 2.0 − 1.0)
  })

  it('scales with countInBeats', () => {
    expect(computeCountIn(song(0, 2), 2)!.prependSec).toBeCloseTo(1.0, 6)
    expect(computeCountIn(song(0, 2), 0)!.prependSec).toBe(0)
  })
})

describe('computeCountIn — null contract', () => {
  it('returns null with no bars or no beats', () => {
    const empty = { timeline: { bars: [], beats: [] } } as unknown as SongMap
    expect(computeCountIn(empty, 4)).toBeNull()
    const noBeats = { timeline: { bars: [bar(0, 2, 4, [])], beats: [] } } as unknown as SongMap
    expect(computeCountIn(noBeats, 4)).toBeNull()
  })

  it('returns null when the start bar has a non-positive beat count', () => {
    const sm = song(0, 2)
    sm.timeline.bars[0]!.beatCount = 0
    expect(computeCountIn(sm, 4)).toBeNull()
  })

  it('returns null when the bar has zero duration (beatDuration not finite/positive)', () => {
    const sm = song(0, 2)
    sm.timeline.bars[0]!.endSec = sm.timeline.bars[0]!.startSec
    expect(computeCountIn(sm, 4)).toBeNull()
  })
})
