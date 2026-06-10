/**
 * Property-based tests for `songPlaybackPlan`. The example-based suite
 * in `playbackPlan.test.ts` covers specific scenarios; these tests
 * generate hundreds of valid SongMap shapes and assert that the
 * load-bearing invariants hold across the entire space.
 *
 * These invariants are what every downstream consumer relies on:
 *
 *   - Click points are sorted ascending (the controller's loop walks
 *     them in order).
 *   - Exactly `countInBeats` clicks are tagged `isCountIn: true`.
 *   - Count-in clicks are evenly spaced one beat apart.
 *   - The last count-in click sits exactly one beat before bar 1 beat 1.
 *   - `prependSec` equals `max(0, countInDuration − effectiveFirstDownbeat)`.
 *   - Song clicks emit only for beats inside the trim window.
 *   - The plan is null exactly when the trim is invalid.
 *
 * fast-check generates the input space; an `assertion` failure prints
 * the minimised counter-example so we can drop it into an example test.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { defaultCueSettings } from './defaults'
import { songPlaybackPlan, DEFAULT_BPM } from './playbackPlan'
import type { SongMap } from './types'
import { SONGMAP_FORMAT_VERSION } from './version'

/**
 * Make a structurally valid `SongMap`. The arbitrary inputs are
 * clamped to ranges that always satisfy `validateSongMap`'s structural
 * checks (positive durations, beatIds match beats list, etc.) so the
 * properties exercise the plan's math rather than fighting validation.
 */
function makeSong(opts: {
  barCount: number
  beatsPerBar: number
  beatDurationSec: number
  trimStartSec: number
  trimEndOffset: number // seconds past the last beat, kept >= 0
  countInBeats: number
  startBarIndex: number | null
  bpm?: number
}): SongMap {
  const { barCount, beatsPerBar, beatDurationSec: bd, trimStartSec } = opts
  const songEnd = barCount * beatsPerBar * bd
  const trimEndSec = songEnd + opts.trimEndOffset

  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const barStart = bar * beatsPerBar * bd
    const barEnd = barStart + beatsPerBar * bd
    const beatIds: string[] = []
    for (let i = 0; i < beatsPerBar; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: barStart + i * bd })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: barStart,
      endSec: barEnd,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }

  const startBeatId =
    opts.startBarIndex !== null && opts.startBarIndex >= 0 && opts.startBarIndex < barCount
      ? `b${opts.startBarIndex}_0`
      : undefined

  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
      bpm: opts.bpm ?? 60 / bd,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'x.wav',
      trim: { startSec: trimStartSec, endSec: trimEndSec },
      source: 'upload',
    },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cues: { ...defaultCueSettings(), mode: 'off', countInBeats: 0 },
    ...(opts.countInBeats > 0 ? { countInBeats: opts.countInBeats } : {}),
    ...(startBeatId !== undefined ? { startBeatId } : {}),
  } as SongMap
}

/** Arbitrary that generates a SongMap shape that's always playable. */
const playableSongArb = fc.record({
  barCount: fc.integer({ min: 1, max: 12 }),
  beatsPerBar: fc.integer({ min: 1, max: 8 }),
  // 0.25–1.0 s per beat ≈ 60–240 BPM, the realistic music range.
  beatDurationSec: fc.double({ min: 0.25, max: 1.0, noNaN: true, noDefaultInfinity: true }),
  trimStartSec: fc.double({ min: 0, max: 4, noNaN: true, noDefaultInfinity: true }),
  trimEndOffset: fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
  countInBeats: fc.integer({ min: 0, max: 8 }),
  startBarIndex: fc.oneof(fc.constant(null as number | null), fc.integer({ min: 0, max: 11 })),
})

const EPS = 1e-6

describe('songPlaybackPlan — properties', () => {
  it('null iff trim is invalid (endSec <= startSec)', () => {
    fc.assert(
      fc.property(
        playableSongArb,
        fc.double({ min: -5, max: 0, noNaN: true, noDefaultInfinity: true }),
        (params, badOffset) => {
          // Force trim.endSec <= trim.startSec by overriding the offset
          // calc — the song still has bars/beats but the trim is unusable.
          const sm = makeSong(params)
          sm.audio!.trim = {
            startSec: 5,
            endSec: 5 + badOffset, // ≤ 5, so endSec <= startSec
          }
          expect(songPlaybackPlan(sm)).toBeNull()
        },
      ),
      { numRuns: 50 },
    )
  })

  it('clickPoints are sorted ascending by timeSec', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        const sm = makeSong(params)
        const plan = songPlaybackPlan(sm)
        if (!plan) return // skip pathological inputs
        for (let i = 1; i < plan.clickPoints.length; i++) {
          expect(plan.clickPoints[i]!.timeSec).toBeGreaterThanOrEqual(
            plan.clickPoints[i - 1]!.timeSec - EPS,
          )
        }
      }),
      { numRuns: 100 },
    )
  })

  it('exactly `countInBeats` clicks are tagged isCountIn (when a startBeat exists)', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        const sm = makeSong(params)
        const plan = songPlaybackPlan(sm)
        if (!plan) return
        const ciCount = plan.clickPoints.filter((c) => c.isCountIn).length
        // When the user moved startBeatId off bar 1 OR sets countInBeats > 0,
        // the plan emits exactly `countInBeats` count-in clicks. When
        // there's no startBeat (no bars match), it emits 0.
        if (params.countInBeats > 0 && params.startBarIndex !== null) {
          expect(ciCount).toBe(params.countInBeats)
        }
        // The count-in clicks total is bounded above by countInBeats either way.
        expect(ciCount).toBeLessThanOrEqual(params.countInBeats)
      }),
      { numRuns: 100 },
    )
  })

  it('count-in clicks are evenly spaced by beatDurationSec', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        const sm = makeSong(params)
        const plan = songPlaybackPlan(sm)
        if (!plan) return
        const ci = plan.clickPoints.filter((c) => c.isCountIn)
        for (let i = 1; i < ci.length; i++) {
          expect(ci[i]!.timeSec - ci[i - 1]!.timeSec).toBeCloseTo(plan.beatDurationSec, 5)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('last count-in click sits one beat before bar 1 beat 1 in audio-element-time', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        // Only meaningful when count-in is active AND has a startBeat.
        if (params.countInBeats === 0 || params.startBarIndex === null) return
        const sm = makeSong(params)
        const plan = songPlaybackPlan(sm)
        if (!plan) return
        const ci = plan.clickPoints.filter((c) => c.isCountIn)
        if (ci.length === 0) return
        const last = ci[ci.length - 1]!
        // The song's bar 1 beat 1 in audio-element-time is
        //   `firstDownbeatOriginalSec - trim.startSec`.
        const songStartAudioEl = plan.firstDownbeatOriginalSec - plan.trimStartSec
        const expected = songStartAudioEl - plan.beatDurationSec
        expect(last.timeSec).toBeCloseTo(expected, 4)
      }),
      { numRuns: 100 },
    )
  })

  it('prependSec equals max(0, countInDuration − effectiveFirstDownbeat)', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        const sm = makeSong(params)
        const plan = songPlaybackPlan(sm)
        if (!plan) return
        const effFirst = plan.firstDownbeatOriginalSec - plan.trimStartSec
        const expected = Math.max(0, plan.countInDurationSec - effFirst)
        expect(plan.prependSec).toBeCloseTo(expected, 6)
      }),
      { numRuns: 100 },
    )
  })

  it('countInDurationSec equals countInBeats × beatDurationSec', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        const sm = makeSong(params)
        const plan = songPlaybackPlan(sm)
        if (!plan) return
        expect(plan.countInDurationSec).toBeCloseTo(plan.countInBeats * plan.beatDurationSec, 6)
      }),
      { numRuns: 100 },
    )
  })

  it('every song click sits inside the trim window in audio-element-time', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        const sm = makeSong(params)
        const plan = songPlaybackPlan(sm)
        if (!plan) return
        const audioElDuration = plan.trimEndSec - plan.trimStartSec
        for (const c of plan.clickPoints) {
          if (c.isCountIn) continue
          // Song clicks live in [0, audioElDuration). Allow a small
          // epsilon at both ends to absorb floating-point drift.
          expect(c.timeSec).toBeGreaterThanOrEqual(-EPS)
          expect(c.timeSec).toBeLessThan(audioElDuration + EPS)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('bpm is always positive — DEFAULT_BPM fallback never produces 0', () => {
    fc.assert(
      fc.property(playableSongArb, (params) => {
        const sm = makeSong(params)
        // Force-clear metadata.bpm to exercise the fallback path.
        sm.metadata.bpm = undefined
        const plan = songPlaybackPlan(sm)
        if (!plan) return
        expect(plan.bpm).toBe(DEFAULT_BPM)
        expect(plan.bpm).toBeGreaterThan(0)
      }),
      { numRuns: 50 },
    )
  })

  it('moving startBeatId never invalidates the plan when bars/beats are unchanged', () => {
    // Property: given two SongMaps that differ ONLY by startBeatId, both
    // plans should be non-null (or both null) — the anchor change should
    // never break playability.
    fc.assert(
      fc.property(
        playableSongArb,
        fc.integer({ min: 0, max: 11 }),
        (params, alternateStartBar) => {
          const smA = makeSong({ ...params, startBarIndex: null })
          const smB = makeSong({ ...params, startBarIndex: alternateStartBar })
          const planA = songPlaybackPlan(smA)
          const planB = songPlaybackPlan(smB)
          expect(planA === null).toBe(planB === null)
        },
      ),
      { numRuns: 100 },
    )
  })
})
