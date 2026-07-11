/**
 * Time → beat resolution, shared by chord-sheet placement (and eventually the
 * grid components, which currently carry a private copy of the same math).
 *
 * Ownership is half-open `[beat.timeSec, min(nextBeat.timeSec, bar.endSec))` —
 * identical to `beatHarmonySpan` in harmonyEdit.ts.
 */
import type { Bar, Beat } from './types'

/**
 * When a time falls in the trailing fraction of its beat, snap to the NEXT
 * beat: sung syllables are transcribed slightly late relative to the chord
 * change on the beat, so a word starting at 96% of beat N almost always
 * means "chord on beat N+1". Genuine anticipation earlier in the beat keeps
 * the floor beat.
 */
export const CHORD_SNAP_FORWARD_RATIO = 0.3

/** Last beat with `timeSec <= t` (clamped to the first beat). Null iff no beats. */
export function beatAtTime(beatsSorted: Beat[], t: number): Beat | null {
  if (beatsSorted.length === 0) return null
  if (t <= beatsSorted[0]!.timeSec) return beatsSorted[0]!
  let lo = 0
  let hi = beatsSorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (beatsSorted[mid]!.timeSec <= t) lo = mid
    else hi = mid - 1
  }
  return beatsSorted[lo]!
}

/**
 * Beat a chord at time `t` belongs on: the owning beat, snapped forward when
 * `t` is within `CHORD_SNAP_FORWARD_RATIO` of the beat's end.
 */
export function snapChordTimeToBeat(beatsSorted: Beat[], barsById: Map<string, Bar>, t: number): Beat | null {
  const floor = beatAtTime(beatsSorted, t)
  if (!floor) return null
  const idx = beatsSorted.indexOf(floor)
  const next = idx + 1 < beatsSorted.length ? beatsSorted[idx + 1]! : null
  if (!next) return floor
  const barEnd = barsById.get(floor.barId)?.endSec ?? next.timeSec
  const end = Math.min(next.timeSec, barEnd)
  const dur = end - floor.timeSec
  if (dur > 0 && t >= floor.timeSec && end - t < CHORD_SNAP_FORWARD_RATIO * dur) return next
  return floor
}
