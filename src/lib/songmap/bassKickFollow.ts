/**
 * PULL THE BASS ONTO THE KICK.
 *
 * A bass line and a kick drum locking together is most of what makes a rhythm
 * section sound like one player rather than two. Detection gets bass onsets
 * roughly right but rarely exactly on the kick, and a few tens of milliseconds
 * late reads as "loose" even when every note is correct.
 *
 * This nudges each bass onset toward the nearest kick, by an AMOUNT rather
 * than snapping: a bassist who plays fractionally behind the kick is grooving,
 * one welded to it is a sequencer, and which you want is a musical choice.
 * Notes with no kick nearby are left exactly where they were — this aligns
 * what is already there and never invents a note.
 *
 * Pure: events + kick times in, events out.
 */
import type { BassMidiEvent } from './types'

/** Nearest value in a SORTED list, or null when the list is empty. */
function nearest(sorted: readonly number[], t: number): number | null {
  if (sorted.length === 0) return null
  let lo = 0
  let hi = sorted.length - 1
  if (t <= sorted[lo]!) return sorted[lo]!
  if (t >= sorted[hi]!) return sorted[hi]!
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! <= t) lo = mid
    else hi = mid
  }
  return t - sorted[lo]! <= sorted[hi]! - t ? sorted[lo]! : sorted[hi]!
}

/**
 * Move each bass onset a fraction `amount` of the way to the nearest kick
 * within `maxPullSec`. The note keeps its length, so phrasing is unchanged —
 * only where it starts moves.
 *
 * `amount` 0 returns the events untouched; 1 lands them exactly on the kick.
 */
export function followKick(
  events: readonly BassMidiEvent[],
  kickTimes: readonly number[],
  amount: number,
  maxPullSec: number,
): BassMidiEvent[] {
  const a = Math.max(0, Math.min(1, amount))
  if (a === 0 || events.length === 0 || kickTimes.length === 0 || !(maxPullSec > 0)) {
    return events.map((e) => ({ ...e }))
  }
  const kicks = [...kickTimes].sort((x, y) => x - y)
  const out = events.map((e) => {
    const k = nearest(kicks, e.timeSec)
    if (k === null) return { ...e }
    const delta = k - e.timeSec
    // Out of reach: this note is not "near" a kick, so it is not one of the
    // notes the player would be locking in. Leave it alone rather than
    // dragging it across the bar.
    if (Math.abs(delta) > maxPullSec) return { ...e }
    const moved = e.timeSec + delta * a
    return { ...e, timeSec: Math.max(0, moved) }
  })
  out.sort((x, y) => x.timeSec - y.timeSec)
  return out
}

/** Kick onsets from a drum event list, sorted. */
export function kickTimesFrom(events: readonly { timeSec: number; cls: string }[]): number[] {
  return events
    .filter((e) => e.cls === 'kick')
    .map((e) => e.timeSec)
    .sort((a, b) => a - b)
}
