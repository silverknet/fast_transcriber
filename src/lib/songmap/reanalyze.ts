/**
 * Re-analysis merge that tries to KEEP the user's chord + section
 * work intact when the new analyzer output is structurally compatible
 * with the old timeline.
 *
 * Decision rule (per user direction):
 *
 *   - If `newBeats.length === oldBeats.length` AND
 *     `newBars.length === oldBars.length`, the new timeline is "the
 *     same shape" — re-anchor each `HarmonyEvent.beatId` to the new
 *     beat at the same sorted-time position, and leave `sections`
 *     untouched (they reference `bar.index`, which is positional and
 *     survives a bar-count-preserving re-analysis).
 *
 *   - Otherwise the shapes don't match. Caller is expected to confirm
 *     with the user; if confirmed they drop `harmony` and `sections`
 *     entirely via the `dropOnMismatch` flag.
 *
 * The function never re-runs the analyzer. The caller supplies the
 * fresh `bars` + `beats` arrays from `beatsToSongMap` (or similar) and
 * we merge them in.
 */
import { sortBeatsByTime } from './normalize'
import type { Bar, Beat, HarmonyEvent, Section, SongMap } from './types'

export type ReanalyzeShapeMatch = 'match' | 'mismatch'

export type ReanalyzeResult = {
  /** New SongMap with bars + beats replaced, harmony + sections handled per `shape`. */
  map: SongMap
  /** `match` when both counts equal; `mismatch` otherwise. */
  shape: ReanalyzeShapeMatch
  /** Number of chords re-anchored to new beats (only when `shape = match`). */
  chordsKept: number
  /** Number of chords dropped because no anchor could be found (only when `dropOnMismatch`). */
  chordsDropped: number
  /** Sections kept (preserved on shape-match OR when `dropOnMismatch` is false). */
  sectionsKept: number
  /** Sections dropped on shape-mismatch + `dropOnMismatch`. */
  sectionsDropped: number
}

/**
 * Inspect the proposed re-analysis without applying it. Used by the
 * UI to decide whether to prompt the user before committing.
 */
export function reanalyzeShape(
  current: SongMap,
  newBars: Bar[],
  newBeats: Beat[],
): ReanalyzeShapeMatch {
  if (current.timeline.beats.length !== newBeats.length) return 'mismatch'
  if (current.timeline.bars.length !== newBars.length) return 'mismatch'
  return 'match'
}

/**
 * Compute the merged SongMap.
 *
 * Shape match: every chord gets a new `beatId` pointing at the new
 * beat at the same sorted-time position; sections pass through
 * unchanged (bar.index is positional, and bar count is preserved by
 * definition on a match).
 *
 * Shape mismatch: harmony and sections are emptied. Caller is
 * expected to have warned the user before calling.
 */
export function reanalyzeWithHarmony(
  current: SongMap,
  newBars: Bar[],
  newBeats: Beat[],
): ReanalyzeResult {
  const shape = reanalyzeShape(current, newBars, newBeats)
  const oldSorted = sortBeatsByTime(current.timeline.beats)
  const newSorted = sortBeatsByTime(newBeats)
  const oldIdxById = new Map(oldSorted.map((b, i) => [b.id, i]))

  let nextHarmony: HarmonyEvent[] = []
  let nextSections: Section[] = current.sections
  let chordsKept = 0
  let chordsDropped = 0
  let sectionsKept = current.sections.length
  let sectionsDropped = 0

  if (shape === 'match') {
    for (const h of current.harmony) {
      // Skip chords without a beat anchor — they're legacy / bar-anchored
      // and the rest of the codebase already handles them by other means.
      const idx = h.beatId === undefined ? undefined : oldIdxById.get(h.beatId)
      if (idx === undefined || idx >= newSorted.length) {
        chordsDropped++
        continue
      }
      nextHarmony.push({ ...h, beatId: newSorted[idx]!.id })
      chordsKept++
    }
  } else {
    chordsDropped = current.harmony.length
    sectionsDropped = current.sections.length
    sectionsKept = 0
    nextHarmony = []
    nextSections = []
  }

  return {
    map: {
      ...current,
      timeline: {
        ...current.timeline,
        bars: newBars,
        beats: newBeats,
        original: {
          bars: newBars.map((b) => ({ ...b, beatIds: [...b.beatIds] })),
          beats: newBeats.map((b) => ({ ...b })),
        },
      },
      harmony: nextHarmony,
      sections: nextSections,
    },
    shape,
    chordsKept,
    chordsDropped,
    sectionsKept,
    sectionsDropped,
  }
}
