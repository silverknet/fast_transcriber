/**
 * PURE click / count-in scheduling DECISION logic.
 *
 * These functions answer **what click fires and when**, on a plain
 * `AudioContext` timeline, with no `AudioContext`, no DOM, and no Svelte
 * state involved. An engine feeds them numbers it already owns (the
 * source's scheduled `ctxStart`, the signed plan-time it derives from
 * its own clock, `ctx.currentTime`, the user's calibration offset) and
 * gets back the fire times; the engine still owns HOW to make the sound
 * (`playMetronomeClick`) and WHEN to poll (rAF).
 *
 * The math here is lifted verbatim out of `PlaybackController` — same
 * comparisons, same epsilons, same `Math.max` — so any second engine
 * (offline renderer, mixer preview, …) can reuse the exact,
 * parity-critical, test-pinned decisions instead of re-deriving them.
 *
 * Time bases (declare which one every number is in — mixing them has
 * burned this code before):
 *
 *   - **ctx-time** — seconds on the shared `AudioContext` clock. Fire
 *     times (`atCtxTime`), `ctxStart`, and `ctxNow` live here.
 *   - **plan-time** — the audio-element timeline of
 *     `plan.clickPoints[].timeSec` (song-start = 0; count-in beats are
 *     negative). The engine converts its own position into plan-time as
 *     `planTime = schedulingPositionSec − mediaTimeOffsetSec` before
 *     calling in.
 */
import type { PlaybackPlan } from '$lib/songmap/playbackPlan'
import { bufferSecToWallSec } from './varispeed'

/** rAF lookahead for click scheduling. */
export const CLICK_LOOKAHEAD_SEC = 0.025
/** Web Audio scheduling lead-time so clicks aren't audibly late. */
export const CLICK_SCHEDULE_LEAD_SEC = 0.002
/** Grace window for "click happened just now". */
export const CLICK_PAST_GRACE_SEC = 0.018
/** Lookahead before we schedule the BufferSource to start. Same as MixerEngine. */
export const PLAY_START_LOOKAHEAD_SEC = 0.04

/**
 * A click the engine should hand to its sound maker: fire it at
 * `atCtxTime` (ctx-time) with `downbeat` accenting.
 */
export type ClickFire = {
  atCtxTime: number
  downbeat: boolean
}

/**
 * A due song-click, carrying the raw values the engine's debug log
 * wants alongside the fire decision. `idx` is the index into
 * `plan.clickPoints`; `delta` is `c.timeSec − planTime`.
 */
export type DueClick = ClickFire & {
  idx: number
  delta: number
}

/**
 * Only the field these decisions read. Accepting a `Pick` keeps the
 * functions callable with either a full `PlaybackPlan` or a minimal
 * `{ clickPoints }` stub in tests.
 */
type ClickPlan = Pick<PlaybackPlan, 'clickPoints'>

/**
 * First index the click rAF loop should start from, given the current
 * signed `planTime`.
 *
 * Skips count-in clicks (they are pre-scheduled up front by
 * `countInClickTimes`; the downbeat at `timeSec === 0` is intentionally
 * NOT skipped — `timeSec >= -1e-9` keeps it), then skips song-clicks
 * already too far in the past (`timeSec < planTime − CLICK_PAST_GRACE_SEC`).
 */
export function initialClickIndex(plan: ClickPlan, planTime: number): number {
  const pts = plan.clickPoints
  let i = pts.findIndex((c) => !c.isCountIn || c.timeSec >= -1e-9)
  if (i < 0) i = pts.length
  while (i < pts.length && pts[i]!.timeSec < planTime - CLICK_PAST_GRACE_SEC) i++
  return i
}

/**
 * Fire times for the count-in clicks to PRE-schedule inside `play()`.
 *
 * Each count-in click's `timeSec` is in `[−prependSec, 0)`, so it lands
 * `ctxStart + c.timeSec` behind the source's own `ctxStart` (negative
 * shift), plus the user's `clickOffsetSec`. A click whose fire time has
 * already slipped past `ctxNow + CLICK_SCHEDULE_LEAD_SEC` is dropped —
 * it's too late to schedule.
 *
 * `rate` is the varispeed playback rate (1 = untransposed). `c.timeSec` is
 * PLAN-time (i.e. audio seconds), so the gap back to `ctxStart` shrinks by the
 * rate — otherwise a transposed song counts in at the wrong tempo and the band
 * comes in early. `clickOffsetSec` is a real-world latency calibration and
 * stays in ctx-time, so it is NOT scaled.
 */
export function countInClickTimes(
  plan: ClickPlan,
  ctxStart: number,
  clickOffsetSec: number,
  ctxNow: number,
  rate = 1,
): ClickFire[] {
  const out: ClickFire[] = []
  for (const c of plan.clickPoints) {
    if (!c.isCountIn) continue
    // c.timeSec is in [−prependSec, 0). The Nth count-in click lands
    // `prependSec + c.timeSec` seconds before song start, i.e.
    // `ctxStart + c.timeSec` (negative shift behind ctxStart).
    const fireAt = ctxStart + bufferSecToWallSec(c.timeSec, rate) + clickOffsetSec
    if (fireAt < ctxNow + CLICK_SCHEDULE_LEAD_SEC) continue
    out.push({ atCtxTime: fireAt, downbeat: c.downbeat })
  }
  return out
}

/**
 * One rAF tick's worth of scheduling decisions for the NON-count-in
 * (song) clicks, starting at `fromIdx`.
 *
 *   1. Drop clicks too far in the past (`timeSec < planTime −
 *      CLICK_PAST_GRACE_SEC`).
 *   2. Fire every click inside the lookahead window (`timeSec <=
 *      planTime + CLICK_LOOKAHEAD_SEC`). Count-in clicks encountered in
 *      the window are skipped from `fires` (already pre-scheduled) but
 *      still stepped over. A song click fires at
 *      `ctxNow + max(CLICK_SCHEDULE_LEAD_SEC, delta + clickOffsetSec)`
 *      where `delta = c.timeSec − planTime`.
 *
 * Returns the clicks to fire this tick, the advanced index the engine
 * should store, and whether the plan is exhausted (`nextIdx` reached the
 * end) so the caller can stop its loop.
 */
export function dueClicks(
  plan: ClickPlan,
  fromIdx: number,
  planTime: number,
  ctxNow: number,
  clickOffsetSec: number,
  rate = 1,
): { fires: DueClick[]; nextIdx: number; done: boolean } {
  const pts = plan.clickPoints
  let idx = fromIdx

  // The lookahead and grace windows are WALL-clock spans; at rate r they cover
  // r× as much plan-time, so widen them before comparing against plan times.
  const lookahead = CLICK_LOOKAHEAD_SEC * rate
  const grace = CLICK_PAST_GRACE_SEC * rate

  // Drop clicks too far in the past.
  while (idx < pts.length && pts[idx]!.timeSec < planTime - grace) {
    idx++
  }

  const fires: DueClick[] = []
  while (idx < pts.length && pts[idx]!.timeSec <= planTime + lookahead) {
    const c = pts[idx]!
    // Skip count-in clicks — those were pre-scheduled in `play()`.
    if (c.timeSec >= -1e-9) {
      const delta = c.timeSec - planTime // plan-time (audio seconds)
      // → wall seconds before it should sound. The calibration offset is
      // already in ctx-time and is added after the conversion, not scaled.
      const waitSec = bufferSecToWallSec(delta, rate)
      const atCtxTime = ctxNow + Math.max(CLICK_SCHEDULE_LEAD_SEC, waitSec + clickOffsetSec)
      fires.push({ atCtxTime, downbeat: c.downbeat, idx, delta })
    }
    idx++
  }

  return { fires, nextIdx: idx, done: idx >= pts.length }
}
