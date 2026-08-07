/**
 * A 45-second countdown — pure timing and geometry, no audio, no DOM.
 *
 * Deliberately standalone: this route shares nothing with the song editor, the
 * mixer, or the playback engine. It imports nothing from `$lib` and nothing
 * imports it, so it can be deleted whole without touching the app.
 */

/** Fixed. The whole point of this route is that it is always the same 45 s. */
export const TIMER_SECONDS = 45

/** A clock face is 60 units around; the hand starts a quarter of the way in. */
const DIAL_SECONDS = 60
const START_SECOND = 15

/**
 * Where the hand points, in degrees clockwise from 12 o'clock.
 *
 * It starts at quarter past (90°) and sweeps forward the whole 45 s, so it
 * finishes back at the top — three quarters of the dial, ending on 00. Angles
 * keep increasing past 360° rather than wrapping, so a CSS/SVG rotation
 * animates smoothly through the top instead of snapping backwards.
 */
export function handAngleDeg(elapsedSec: number): number {
  const t = clamp(elapsedSec, 0, TIMER_SECONDS)
  return ((START_SECOND + t) / DIAL_SECONDS) * 360
}

/** Whole seconds left, for the readout. Counts 45 → 0 and never shows −1. */
export function remainingSec(elapsedSec: number): number {
  return Math.max(0, Math.ceil(TIMER_SECONDS - clamp(elapsedSec, 0, TIMER_SECONDS)))
}

/** 0…1 through the countdown. */
export function progress(elapsedSec: number): number {
  return clamp(elapsedSec, 0, TIMER_SECONDS) / TIMER_SECONDS
}

export function isFinished(elapsedSec: number): boolean {
  return elapsedSec >= TIMER_SECONDS
}

/**
 * The ticks speed UP as the time runs out — that is what makes it feel urgent
 * rather than merely loud. One per second for the first half, then doubling,
 * then doubling again for the final run-in.
 */
const TICK_RATE_STEPS: { fromSec: number; perSecond: number }[] = [
  { fromSec: 0, perSecond: 1 },
  { fromSec: 30, perSecond: 2 },
  { fromSec: 40, perSecond: 4 },
]

/**
 * Every tick time in the countdown, in seconds from the start.
 *
 * Returned as a list so the caller can pre-schedule the whole run on the audio
 * clock in one go: a `setInterval` would drift against the sound, and the last
 * seconds are exactly where drift would be heard.
 */
export function tickTimes(): number[] {
  const times: number[] = []
  for (let i = 0; i < TICK_RATE_STEPS.length; i++) {
    const step = TICK_RATE_STEPS[i]!
    const until = TICK_RATE_STEPS[i + 1]?.fromSec ?? TIMER_SECONDS
    const interval = 1 / step.perSecond
    // `1e-9` keeps a tick that lands exactly on a boundary out of the next
    // block, so no time gets two ticks.
    for (let t = step.fromSec; t < until - 1e-9; t += interval) times.push(round6(t))
  }
  return times
}

/**
 * How hard a tick at `atSec` hits, 0…1. Rises through the countdown so the
 * ticking closes in — combined with the rate steps above, the last few seconds
 * are fast AND loud.
 */
export function tickIntensity(atSec: number): number {
  const p = progress(atSec)
  // Eased so most of the growth happens late; a linear ramp sounds like a
  // fade-in rather than a build.
  return clamp(0.25 + 0.75 * p * p, 0, 1)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
