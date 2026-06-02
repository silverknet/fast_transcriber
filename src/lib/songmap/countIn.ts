import type { SongMap } from '$lib/songmap/types'

/**
 * Single source of truth for "how many count-in beats does this song have."
 *
 * Reads the top-level `countInBeats` (decoupled from `cues.mode`). Returns
 * `0` when absent, non-positive, or not a finite integer. A song with cue
 * speech enabled AND a count-in coexist freely.
 *
 * Transitional behavior: while `.smap` migration to v2 is still landing,
 * legacy files may carry the value at `cues.countInBeats` only. We honor
 * that as a fallback so renderers keep working on un-migrated content.
 * The fallback is removed in Step 4 of the v2 cutover.
 */
export function effectiveCountInBeats(sm: SongMap): number {
  const top = sm.countInBeats
  if (Number.isInteger(top) && (top as number) > 0) return top as number
  // Legacy fallback — remove once Step 4 migration is in place.
  if (sm.cues.mode === 'countIn' && Number.isInteger(sm.cues.countInBeats) && sm.cues.countInBeats > 0) {
    return sm.cues.countInBeats
  }
  return 0
}
