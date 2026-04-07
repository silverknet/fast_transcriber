import type { SongMap, SongMapAnalysisFragment } from './types'
import { validateSongMap } from './validate'

/**
 * Merges analysis fragments into a copy of `map` and bumps `metadata.updatedAt`.
 * Replaces `timeline.bars` / `timeline.beats` when the fragment includes them.
 */
export function mergeAnalysisIntoSongMap(map: SongMap, fragment: SongMapAnalysisFragment): SongMap {
  const now = new Date().toISOString()
  const next: SongMap = {
    ...map,
    metadata: {
      ...map.metadata,
      updatedAt: now,
    },
    timeline: {
      bars: fragment.bars ?? map.timeline.bars,
      beats: fragment.beats ?? map.timeline.beats,
    },
  }
  const v = validateSongMap(next)
  if (!v.ok) {
    throw new Error(`mergeAnalysisIntoSongMap: invalid result — ${v.errors.join('; ')}`)
  }
  return next
}
