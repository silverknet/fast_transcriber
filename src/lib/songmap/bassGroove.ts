/**
 * The "confident bassist" pass — `inferDrumGroove`'s sibling for bass.
 *
 * Raw detection played verbatim sounds like a nervous player: every note at
 * a different level, stutter-gaps between nearly-legato notes, 80 ms stabs,
 * the odd octave flake leaping out of register. Measured on a real song
 * (Dum av dig): 4.4 dB level swing p10→p90, median 46 ms gaps, 10% of notes
 * under 100 ms. A real bassist is the OPPOSITE of all of that.
 *
 * Deliberate liberties, in order:
 *   1. REGISTER — isolated octave flakes (≥10 semitones from BOTH
 *      neighbors) fold back by an octave toward the local line.
 *   2. TIMING — onsets snap to 8th-note slots on the actual beat grid.
 *   3. PHRASING — gaps shorter than a beat become legato (note holds to the
 *      next onset); longer silences are REAL rests and stay. Stabs stretch
 *      to at least ~half a beat.
 *   4. DYNAMICS — velocities flatten to a narrow band; a bassline's
 *      steadiness IS its groove.
 *
 * Pure and unit-testable: events + timeline in, events out.
 */
import { beatAtTime } from './beatAtTime'
import { sortBeatsByTime } from './normalize'
import { quantizeTimesToGrid } from './quantizeToGrid'
import type { BassMidiEvent, Beat, SongMap } from './types'

/** Semitones from BOTH neighbors that marks a note as out of register. */
const REGISTER_LEAP = 10
/** Flattened dynamics: v' = floor + (1 − floor) · v. */
const VELOCITY_FLOOR = 0.85
/** Gaps shorter than this many beats get filled — legato. */
const LEGATO_MAX_GAP_BEATS = 1
/** Small breath between legato notes so repeated notes re-articulate. */
const LEGATO_GAP_SEC = 0.015
/** Stabs stretch to at least this fraction of a beat. */
const MIN_NOTE_BEATS = 0.45

/** Length of the beat span owning time `t` (next beat or bar end bounds it). */
function beatLenAt(
  beatsSorted: Beat[],
  barEndById: Map<string, number>,
  t: number,
  fallback: number,
): number {
  const beat = beatAtTime(beatsSorted, t)
  if (!beat) return fallback
  const idx = beatsSorted.indexOf(beat)
  const next = idx + 1 < beatsSorted.length ? beatsSorted[idx + 1]!.timeSec : undefined
  const barEnd = barEndById.get(beat.barId)
  const end = Math.min(next ?? Infinity, barEnd ?? Infinity)
  const span = end - beat.timeSec
  return Number.isFinite(span) && span > 0 ? span : fallback
}

export function inferBassGroove(sm: SongMap, events: BassMidiEvent[]): BassMidiEvent[] {
  if (events.length === 0) return events
  const beatsSorted = sortBeatsByTime(sm.timeline.beats)
  const barsById = new Map(sm.timeline.bars.map((b) => [b.id, b]))
  const barEndById = new Map(sm.timeline.bars.map((b) => [b.id, b.endSec]))
  // Median beat length as the no-grid fallback.
  const spans: number[] = []
  for (let i = 1; i < beatsSorted.length; i++) {
    const s = beatsSorted[i]!.timeSec - beatsSorted[i - 1]!.timeSec
    if (s > 0.1 && s < 3) spans.push(s)
  }
  const fallbackBeat = spans.length
    ? spans.sort((a, b) => a - b)[spans.length >> 1]!
    : 0.5

  // ── 1. Register: fold isolated octave flakes back toward the line ──
  let out = [...events].sort((a, b) => a.timeSec - b.timeSec).map((e) => ({ ...e }))
  for (let i = 0; i < out.length; i++) {
    const prev = i > 0 ? out[i - 1]!.midi : null
    const next = i + 1 < out.length ? out[i + 1]!.midi : null
    if (prev === null || next === null) continue
    const e = out[i]!
    const dPrev = e.midi - prev
    const dNext = e.midi - next
    if (Math.abs(dPrev) < REGISTER_LEAP || Math.abs(dNext) < REGISTER_LEAP) continue
    // Both neighbors agree the note is far away in the same direction —
    // fold one octave toward them if that lands it in register.
    if (dPrev > 0 !== dNext > 0) continue
    const folded = e.midi + (dPrev > 0 ? -12 : 12)
    if (Math.abs(folded - prev) < Math.abs(dPrev) && Math.abs(folded - next) < Math.abs(dNext)) {
      e.midi = folded
    }
  }

  // ── 2. Timing: snap onsets to 8th slots on the real grid ──
  out = quantizeTimesToGrid(out, beatsSorted, barsById, '1/8')
  out.sort((a, b) => a.timeSec - b.timeSec)

  // Same-slot collisions after the snap: one bassist, one note — keep the
  // louder (same-pitch merging happens later in trimBassOverlaps).
  const merged: BassMidiEvent[] = []
  for (const e of out) {
    const prev = merged[merged.length - 1]
    if (prev && Math.abs(e.timeSec - prev.timeSec) <= 0.001) {
      if (e.velocity > prev.velocity) merged[merged.length - 1] = e
      continue
    }
    merged.push(e)
  }
  out = merged

  // ── 3. Phrasing: legato through small gaps, keep real rests ──
  for (let i = 0; i < out.length; i++) {
    const e = out[i]!
    const beatLen = beatLenAt(beatsSorted, barEndById, e.timeSec, fallbackBeat)
    const next = i + 1 < out.length ? out[i + 1]! : null
    if (next) {
      const gap = next.timeSec - (e.timeSec + e.durationSec)
      if (gap < LEGATO_MAX_GAP_BEATS * beatLen) {
        e.durationSec = Math.max(0.02, next.timeSec - e.timeSec - LEGATO_GAP_SEC)
        continue
      }
    }
    // Before a real rest (or at the end): no stabs — let the note speak.
    e.durationSec = Math.max(e.durationSec, MIN_NOTE_BEATS * beatLen)
  }

  // ── 4. Dynamics: a steady hand ──
  for (const e of out) {
    e.velocity = Math.min(1, VELOCITY_FLOOR + (1 - VELOCITY_FLOOR) * e.velocity)
  }

  return out
}
