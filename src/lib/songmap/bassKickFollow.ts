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

/**
 * PLAY A NOTE ON EVERY KICK — what "following the drummer" actually means.
 *
 * Aligning existing notes (above) only tightens what the bassist already
 * played. A player locking with a drummer does more than that: when the kick
 * hits and the bass is holding — or resting — they re-articulate. That is the
 * sound of a rhythm section rather than two parts that happen to coincide.
 *
 * Pitch comes from the line itself, never invented harmony:
 *   1. a note SOUNDING at the kick → re-pluck the same note,
 *   2. otherwise the note most recently played → the bassist is still on that
 *      root and hits it again,
 *   3. otherwise the next note coming up → an anticipation into the phrase.
 *
 * With nothing detected anywhere near, nothing is added. Silence in the bass
 * part is usually a real rest, and filling every rest with guesses is how a
 * generated line stops sounding like a person.
 */
export function addNotesOnKicks(
  events: readonly BassMidiEvent[],
  kickTimes: readonly number[],
  opts: {
    /** An onset this close to the kick already counts as playing it. */
    toleranceSec: number
    /** Length of an added note before the next onset trims it. */
    noteSec: number
    /** How far to look for a pitch to borrow. */
    reachSec: number
    /** Velocity for added notes, relative to the borrowed note. */
    velocityScale?: number
  },
): BassMidiEvent[] {
  if (kickTimes.length === 0) return events.map((e) => ({ ...e }))
  const sorted = [...events].sort((a, b) => a.timeSec - b.timeSec)
  const vScale = opts.velocityScale ?? 1
  const added: BassMidiEvent[] = []

  for (const t of kickTimes) {
    // Already playing here? Then the kick is covered.
    if (sorted.some((e) => Math.abs(e.timeSec - t) <= opts.toleranceSec)) continue

    // 1. Sounding through this moment.
    let src = sorted.find((e) => e.timeSec <= t && t < e.timeSec + e.durationSec)
    // 2. Most recently played, within reach.
    if (!src) {
      for (const e of sorted) {
        if (e.timeSec > t) break
        if (t - e.timeSec <= opts.reachSec) src = e
      }
    }
    // 3. Coming up, within reach.
    if (!src) src = sorted.find((e) => e.timeSec > t && e.timeSec - t <= opts.reachSec)
    if (!src) continue

    added.push({
      timeSec: t,
      durationSec: opts.noteSec,
      midi: src.midi,
      velocity: Math.max(0, Math.min(1, src.velocity * vScale)),
    })
  }

  return [...sorted, ...added].sort((a, b) => a.timeSec - b.timeSec)
}
