import type { SongMap } from '$lib/songmap/types'

/**
 * Single source of truth for "how many count-in beats does this song have."
 *
 * Reads the top-level `countInBeats` (decoupled from `cues.mode`). Returns
 * `0` when absent, non-positive, or not a finite integer. A song with cue
 * speech enabled AND a count-in coexist freely.
 *
 */
export function effectiveCountInBeats(sm: SongMap): number {
  const top = sm.countInBeats
  if (Number.isInteger(top) && (top as number) > 0) return top as number
  return 0
}
