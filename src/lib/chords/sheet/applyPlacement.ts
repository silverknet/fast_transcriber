/**
 * Write a `ChordPlacementPlan` into a SongMap — the same per-beat upsert loop
 * as `applyChordAutoFill` (autoFill.ts), so imported chords behave exactly
 * like hand-placed ones (replace-per-beat, beatAnchor stamped).
 */
import type { SongMap } from '$lib/songmap/types'
import { upsertHarmonyAtBeat, type IdFactory } from '$lib/songmap/harmonyEdit'
import type { ChordPlacementPlan } from './placeChords'

export function applyChordPlacements(
  map: SongMap,
  plan: ChordPlacementPlan,
  newId: IdFactory,
): { map: SongMap; applied: number; failed: number } {
  let out = map
  let applied = 0
  let failed = 0
  for (const p of plan.placements) {
    const r = upsertHarmonyAtBeat(out, p.beatId, p.chord, newId)
    if (r.ok) {
      out = r.map
      applied++
    } else {
      failed++
    }
  }
  return { map: out, applied, failed }
}
