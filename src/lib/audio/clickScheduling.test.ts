/**
 * Unit tests for the PURE click / count-in scheduling decisions.
 *
 * These pin the exact arithmetic the `PlaybackController` (and any
 * second engine) relies on: where count-in clicks land, that the
 * downbeat survives the pre-roll, that past clicks are dropped, that the
 * lookahead window selects the right clicks, and that `clickOffsetSec`
 * shifts the fire time. All numbers are declared in their time base —
 * ctx-time for fire times / `ctxStart` / `ctxNow`, plan-time for
 * `planTime` and `clickPoints[].timeSec`.
 */
import { describe, expect, it } from 'vitest'
import {
  CLICK_LOOKAHEAD_SEC,
  CLICK_PAST_GRACE_SEC,
  CLICK_SCHEDULE_LEAD_SEC,
  countInClickTimes,
  dueClicks,
  initialClickIndex,
} from '$lib/audio/clickScheduling'

type CP = { timeSec: number; downbeat: boolean; isCountIn: boolean }
const cp = (timeSec: number, downbeat = false, isCountIn = false): CP => ({
  timeSec,
  downbeat,
  isCountIn,
})
const plan = (clickPoints: CP[]) => ({ clickPoints })

/**
 * Canonical 4-beat count-in (beatDur 0.5, prepend 2.0) followed by four
 * song beats. Count-in at -2/-1.5/-1/-0.5; downbeat (song bar1 beat1) at
 * 0, then 0.5/1.0/1.5.
 */
function countInPlan() {
  return plan([
    cp(-2, false, true),
    cp(-1.5, false, true),
    cp(-1, false, true),
    cp(-0.5, false, true),
    cp(0, true, false),
    cp(0.5, false, false),
    cp(1, false, false),
    cp(1.5, false, false),
  ])
}

describe('countInClickTimes', () => {
  it('lands the count-in clicks before ctxStart at the right offsets', () => {
    const ctxStart = 2.04 // PLAY_START_LOOKAHEAD (0.04) + prepend (2.0)
    const fires = countInClickTimes(countInPlan(), ctxStart, 0, 0)
    // Only the four count-in clicks — song clicks excluded.
    expect(fires.length).toBe(4)
    ;[0.04, 0.54, 1.04, 1.54].forEach((expected, i) => {
      expect(fires[i]!.atCtxTime).toBeCloseTo(expected, 9)
    })
    // Every count-in click fires strictly before the source's ctxStart.
    expect(fires.every((f) => f.atCtxTime < ctxStart)).toBe(true)
    // Even beat spacing, no downbeat accent on count-in.
    for (let i = 1; i < fires.length; i++) {
      expect(fires[i]!.atCtxTime - fires[i - 1]!.atCtxTime).toBeCloseTo(0.5, 9)
    }
    expect(fires.every((f) => f.downbeat === false)).toBe(true)
  })

  it('clickOffsetSec shifts count-in fire times later (positive) / earlier (negative)', () => {
    const ctxStart = 2.04
    const later = countInClickTimes(countInPlan(), ctxStart, 0.1, 0)
    ;[0.14, 0.64, 1.14, 1.64].forEach((expected, i) => {
      expect(later[i]!.atCtxTime).toBeCloseTo(expected, 9)
    })
    const earlier = countInClickTimes(countInPlan(), ctxStart, -0.03, 0)
    expect(earlier[0]!.atCtxTime).toBeCloseTo(0.01, 9)
  })

  it('drops count-in clicks whose fire time already slipped past the lead floor', () => {
    // ctxNow close to ctxStart: the first two count-in clicks (0.04, 0.54)
    // are already behind `ctxNow + CLICK_SCHEDULE_LEAD_SEC` and get dropped.
    const ctxStart = 2.04
    const fires = countInClickTimes(countInPlan(), ctxStart, 0, 1.0)
    // Keep only clicks with fireAt >= 1.0 + 0.002 → 1.04 and 1.54.
    expect(fires.map((f) => f.atCtxTime)).toEqual([1.04, 1.54])
  })
})

describe('initialClickIndex', () => {
  it('skips count-in clicks and starts at the downbeat during the pre-roll', () => {
    // Deep-negative plan-time (mid pre-roll). The downbeat at timeSec 0 is
    // the first non-count-in click and must NOT be dropped.
    const p = countInPlan()
    const idx = initialClickIndex(p, -2.04)
    expect(idx).toBe(4)
    expect(p.clickPoints[idx]!.timeSec).toBe(0)
    expect(p.clickPoints[idx]!.downbeat).toBe(true)
  })

  it('drops song clicks already in the past', () => {
    const p = plan([cp(0, true), cp(0.5), cp(1), cp(1.5)])
    // planTime 1.0 → drop clicks with timeSec < 1.0 − CLICK_PAST_GRACE_SEC.
    const idx = initialClickIndex(p, 1.0)
    expect(idx).toBe(2)
    expect(p.clickPoints[idx]!.timeSec).toBe(1)
  })

  it('returns clickPoints.length when there is no eligible click', () => {
    // All count-in, all negative → no click satisfies the findIndex predicate.
    const p = plan([cp(-1, false, true), cp(-0.5, false, true)])
    expect(initialClickIndex(p, -5)).toBe(2)
  })
})

describe('dueClicks', () => {
  it('does not fire the downbeat while plan-time is still deep in the pre-roll', () => {
    const p = countInPlan()
    // Starting at the downbeat index (4) but plan-time far before 0: the
    // window `timeSec <= planTime + CLICK_LOOKAHEAD_SEC` excludes it.
    const { fires, nextIdx, done } = dueClicks(p, 4, -2.04, 0, 0)
    expect(fires).toEqual([])
    expect(nextIdx).toBe(4)
    expect(done).toBe(false)
  })

  it('fires the downbeat exactly as plan-time reaches it', () => {
    const p = countInPlan()
    const ctxNow = 10
    // planTime just inside the lookahead window of the downbeat.
    const planTime = -0.02
    const { fires, nextIdx } = dueClicks(p, 4, planTime, ctxNow, 0)
    expect(fires.length).toBe(1)
    expect(fires[0]!.downbeat).toBe(true)
    // atCtxTime = ctxNow + max(lead, (0 − planTime) + offset) = 10 + 0.02.
    expect(fires[0]!.atCtxTime).toBeCloseTo(ctxNow + 0.02, 9)
    expect(nextIdx).toBe(5)
  })

  it('drops past clicks then fires the one at plan-time', () => {
    const p = plan([cp(0, true), cp(0.5), cp(1), cp(1.5)])
    const { fires, nextIdx, done } = dueClicks(p, 0, 1.0, 100, 0)
    // 0 and 0.5 are dropped (past-grace); 1.0 fires; 1.5 is beyond the window.
    expect(fires.length).toBe(1)
    expect(fires[0]!.idx).toBe(2)
    expect(fires[0]!.atCtxTime).toBeCloseTo(100 + Math.max(CLICK_SCHEDULE_LEAD_SEC, 0), 9)
    expect(nextIdx).toBe(3)
    expect(done).toBe(false)
  })

  it('lookahead window selects every click within CLICK_LOOKAHEAD_SEC', () => {
    // Two clicks within the 0.025 s window fire together; the third does not.
    const p = plan([cp(0, true), cp(CLICK_LOOKAHEAD_SEC - 0.001), cp(0.5)])
    const { fires, nextIdx } = dueClicks(p, 0, 0, 5, 0)
    expect(fires.map((f) => f.idx)).toEqual([0, 1])
    expect(nextIdx).toBe(2)
  })

  it('clickOffsetSec shifts fire time later and can be floored by the lead', () => {
    // Click must sit inside the lookahead window, so delta ≤ CLICK_LOOKAHEAD_SEC.
    // planTime 0.48, click 0.5 → delta 0.02, and 0.5 ≤ 0.48 + 0.025.
    const p = plan([cp(0.5, false)])
    const ctxNow = 5
    const base = dueClicks(p, 0, 0.48, ctxNow, 0)
    expect(base.fires[0]!.atCtxTime).toBeCloseTo(ctxNow + 0.02, 9)
    // +offset pushes it later.
    const later = dueClicks(p, 0, 0.48, ctxNow, 0.05)
    expect(later.fires[0]!.atCtxTime).toBeCloseTo(ctxNow + 0.07, 9)
    // −offset pulls it earlier.
    const earlier = dueClicks(p, 0, 0.48, ctxNow, -0.01)
    expect(earlier.fires[0]!.atCtxTime).toBeCloseTo(ctxNow + 0.01, 9)
    // A large negative offset can't drag it before the schedule lead floor.
    const floored = dueClicks(p, 0, 0.48, ctxNow, -1)
    expect(floored.fires[0]!.atCtxTime).toBeCloseTo(ctxNow + CLICK_SCHEDULE_LEAD_SEC, 9)
  })

  it('skips count-in clicks in the window but still steps past them', () => {
    // A count-in click sitting inside the window is not fired, but nextIdx
    // advances beyond it (it was pre-scheduled in play()).
    const p = plan([cp(-0.001, false, true), cp(0, true, false)])
    const { fires, nextIdx } = dueClicks(p, 0, 0, 3, 0)
    // Only the downbeat fires; the count-in entry is stepped over.
    expect(fires.map((f) => f.idx)).toEqual([1])
    expect(nextIdx).toBe(2)
  })

  it('reports done when the plan is exhausted', () => {
    const p = plan([cp(0, true)])
    const { fires, nextIdx, done } = dueClicks(p, 0, 0, 1, 0)
    expect(fires.length).toBe(1)
    expect(nextIdx).toBe(1)
    expect(done).toBe(true)
  })
})

describe('exported constants', () => {
  it('match the values the controller relied on', () => {
    expect(CLICK_LOOKAHEAD_SEC).toBe(0.025)
    expect(CLICK_SCHEDULE_LEAD_SEC).toBe(0.002)
    expect(CLICK_PAST_GRACE_SEC).toBe(0.018)
  })
})
