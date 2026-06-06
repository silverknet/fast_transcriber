import type { SongMap, SongMapAnalysisFragment } from './types'
import { validateSongMap } from './validate'

/**
 * Merges analysis fragments into a copy of `map` and bumps `metadata.updatedAt`.
 * Replaces `timeline.bars` / `timeline.beats` when the fragment includes them.
 *
 * Full analyses (`bars` AND `beats` present) capture a snapshot into
 * `timeline.original` so the editor can offer a "Reset grid" affordance.
 * Partial fragments (just bars or just beats) preserve any existing
 * snapshot — they're patching, not redefining the baseline.
 */
export function mergeAnalysisIntoSongMap(map: SongMap, fragment: SongMapAnalysisFragment): SongMap {
  const now = new Date().toISOString()
  const newBars = fragment.bars ?? map.timeline.bars
  const newBeats = fragment.beats ?? map.timeline.beats
  const isFullAnalysis = fragment.bars !== undefined && fragment.beats !== undefined
  // Deep-copy on snapshot capture so later in-place edits to the live
  // timeline can't mutate the saved baseline.
  const original = isFullAnalysis
    ? {
        bars: newBars.map((b) => ({ ...b, beatIds: [...b.beatIds] })),
        beats: newBeats.map((b) => ({ ...b })),
      }
    : map.timeline.original
  const next: SongMap = {
    ...map,
    metadata: {
      ...map.metadata,
      updatedAt: now,
    },
    timeline: {
      bars: newBars,
      beats: newBeats,
      ...(original ? { original } : {}),
    },
  }
  const v = validateSongMap(next)
  if (!v.ok) {
    throw new Error(`mergeAnalysisIntoSongMap: invalid result — ${v.errors.join('; ')}`)
  }
  return next
}
