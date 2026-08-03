/**
 * HOW MANY CLICKS, AND HOW MUCH TIME DOES THE SONG GROW BY?
 *
 * Two numbers a person has to be able to trust before a show: set 8 clicks and
 * you get exactly 8, and the song starts exactly where it did before plus
 * whatever silence was genuinely needed.
 *
 * The interesting case is the one the grid makes possible. The song's start is
 * marked in the Grid tab and can be beat 5, or beat 9 — anywhere. When there is
 * already audio before that anchor, the count-in rings OVER it and the song
 * grows by NOTHING. Only when the count-in is longer than the available lead-in
 * does silence get prepended. So "8 clicks" means two different things
 * depending on the song, and both must be right.
 */
import { describe, expect, it } from 'vitest'
import { computeCountIn } from './computeCountIn'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { SongMap } from '$lib/songmap/types'

const BPM = 120
/** 4/4 at 120 bpm: half a second per beat, two seconds per bar. */
const BEAT = 60 / BPM
const BAR = BEAT * 4

/**
 * A plain 4/4 song. `startBeatIndex` is the Grid tab's song-start anchor,
 * counted in beats from the top of the file.
 */
function song(opts: { bars?: number; startBeatIndex?: number; countInBeats?: number } = {}): SongMap {
  const barCount = opts.bars ?? 8
  const bars = Array.from({ length: barCount }, (_, i) => ({
    id: `bar${i}`,
    index: i,
    startSec: i * BAR,
    endSec: (i + 1) * BAR,
    beatCount: 4,
    beatIds: Array.from({ length: 4 }, (_, k) => `b${i}_${k}`),
  }))
  const beats = bars.flatMap((bar, bi) =>
    Array.from({ length: 4 }, (_, k) => ({
      id: `b${bi}_${k}`,
      barId: bar.id,
      indexInBar: k,
      timeSec: bar.startSec + k * BEAT,
    })),
  )
  const sm = createEmptySongMap()
  const startIdx = opts.startBeatIndex ?? 0
  return {
    ...sm,
    timeline: { ...sm.timeline, bars, beats },
    startBeatId: beats[startIdx]!.id,
    countInBeats: opts.countInBeats,
    audio: { ...sm.audio!, trim: { startSec: 0, endSec: barCount * BAR } },
  } as SongMap
}

/** The plan, asserted to exist — a null plan is a test failure, not a skip. */
function plan(sm: SongMap) {
  const p = songPlaybackPlan(sm)
  expect(p, 'songPlaybackPlan returned nothing for this fixture').not.toBeNull()
  return p!
}

const countInClicks = (sm: SongMap) => plan(sm).clickPoints.filter((p) => p.isCountIn)

describe('the number of clicks is the number you asked for', () => {
  it('gives exactly N count-in clicks', () => {
    for (const n of [1, 2, 4, 8, 12]) {
      const sm = song({ startBeatIndex: 0, countInBeats: n })
      expect(countInClicks(sm), `${n} clicks requested`).toHaveLength(n)
    }
  })

  it('gives none when the count-in is off', () => {
    expect(countInClicks(song({ countInBeats: 0 }))).toHaveLength(0)
    expect(countInClicks(song({ countInBeats: undefined }))).toHaveLength(0)
  })

  it('counts the same number whether or not silence had to be added', () => {
    // 8 clicks is 8 clicks — a late song start changes WHERE they land, never
    // how many there are.
    const fromTheTop = song({ startBeatIndex: 0, countInBeats: 8 })
    const lateStart = song({ startBeatIndex: 9, countInBeats: 8 })
    expect(countInClicks(fromTheTop)).toHaveLength(8)
    expect(countInClicks(lateStart)).toHaveLength(8)
  })

  it('spaces them one beat apart, ending one beat before the song start', () => {
    const sm = song({ startBeatIndex: 9, countInBeats: 4 })
    const times = countInClicks(sm)
      .map((p) => p.timeSec)
      .sort((a, b) => a - b)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeCloseTo(BEAT, 5)
    }
    const start = sm.timeline.beats[9]!.timeSec
    expect(times[times.length - 1]!).toBeCloseTo(start - BEAT, 5)
  })
})

describe('how much time the count-in adds', () => {
  it('adds the full count-in when the song starts at the very top', () => {
    // Nothing before bar 1 beat 1, so all N beats need new silence.
    for (const n of [4, 8]) {
      const r = computeCountIn(song({ startBeatIndex: 0, countInBeats: n }), n)!
      expect(r.prependSec).toBeCloseTo(n * BEAT, 6)
      expect(r.beatDurationSec).toBeCloseTo(BEAT, 6)
    }
  })

  it('adds NOTHING when there is already enough audio before the start beat', () => {
    // Song starts at beat 9 → 4.0 s of lead-in. An 8-beat count-in is 4.0 s, so
    // it fits exactly inside the existing intro: the clicks play over the music
    // and the song does not get any longer.
    const sm = song({ startBeatIndex: 9, countInBeats: 8 })
    const r = computeCountIn(sm, 8)!
    expect(r.effectiveFirstDownbeatSec).toBeCloseTo(9 * BEAT, 6)
    expect(r.prependSec).toBe(0)
  })

  it('adds only the SHORTFALL when the lead-in is not quite enough', () => {
    // Start at beat 5 → 2.5 s of lead-in; 8 beats is 4.0 s; so 1.5 s of silence.
    const r = computeCountIn(song({ startBeatIndex: 5, countInBeats: 8 }), 8)!
    expect(r.prependSec).toBeCloseTo(8 * BEAT - 5 * BEAT, 6)
  })

  it('never returns a negative prepend', () => {
    // A long intro with a short count-in must not pull the song EARLIER.
    const r = computeCountIn(song({ startBeatIndex: 20, countInBeats: 2 }), 2)!
    expect(r.prependSec).toBe(0)
  })

  it('the plan agrees with the calculation', () => {
    // Two derivations of the same number; CLAUDE.md invariant 3 says there is
    // only one timing function, so they must not disagree.
    for (const startBeatIndex of [0, 3, 5, 9, 16]) {
      const sm = song({ startBeatIndex, countInBeats: 8 })
      const r = computeCountIn(sm, 8)!
      expect(plan(sm).prependSec).toBeCloseTo(r.prependSec, 6)
    }
  })
})

describe('the count-in refuses to guess', () => {
  it('returns null for a song with no grid', () => {
    expect(computeCountIn(createEmptySongMap(), 4)).toBeNull()
  })
})
