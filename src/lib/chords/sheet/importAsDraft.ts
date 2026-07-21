/**
 * Chord-sheet import → ONE new song draft.
 *
 * This is the orchestration the editor's "Import chord sheet" button runs. It
 * lives here, out of `routes/edit/+page.svelte`, because the interesting part
 * is not any single step but the ORDER of the steps: chords are built on a
 * scratch map first, the sections are derived from where those chords actually
 * landed, and only then do both go into the map together as one draft.
 *
 * That ordering is the whole point of the v6 rewrite. In v5 the import wrote
 * chords and sections as two independent layers paired only by a name string;
 * the names drifted apart (`Sheet import 3 2` against `Sheet import 2`) and the
 * pairing silently broke. A draft holds sections + chords + lyrics as one unit,
 * so there is no seam left to drift.
 *
 * Split in two so the caller keeps its existing shape: `prepareSheetImport` is
 * the pure read-only half (it can fail, and the editor shows that error without
 * touching the document), `applySheetImport` is the map transform that runs
 * inside `patchSongMap`'s updater — where it sees the CURRENT store map, which
 * is what the new draft's lyrics must come from.
 */
import { addDraftAndActivate, ensureActiveDraftIdentity } from '$lib/songmap/drafts'
import type { IdFactory } from '$lib/songmap/harmonyEdit'
import type { HarmonyEvent, Section, SongMap } from '$lib/songmap/types'
import { applyChordPlacements } from './applyPlacement'
import { deriveSectionsFromSheet } from './deriveSections'
import type { ParsedChordSheet } from './parseChordSheet'
import { placeChords, type ChordPlacementPlan } from './placeChords'

/** Base name for an imported draft; collisions get " 2", " 3", … appended. */
export const SHEET_IMPORT_DRAFT_NAME = 'Sheet import'

export type PreparedSheetImport = {
  /** The placement plan — kept for the caller's stats copy and origin badges. */
  plan: ChordPlacementPlan
  /** The sheet's chords, and ONLY the sheet's chords (no prior harmony). */
  harmony: HarmonyEvent[]
  /** Sections derived from where those exact chords landed. */
  sections: Section[]
}

export type PrepareSheetImportResult =
  | { ok: true; prepared: PreparedSheetImport }
  | { ok: false; error: string }

/**
 * Project the sheet onto the song's grid without touching the document.
 *
 * The chords are written into a scratch copy with `harmony: []` so the draft
 * contains the sheet's chords alone — an import is a fresh take on the song,
 * not a merge into whatever was already there. The old chords are not lost;
 * `applySheetImport` keeps them as their own draft.
 */
export function prepareSheetImport(
  sheet: ParsedChordSheet,
  map: SongMap,
  newId: IdFactory,
): PrepareSheetImportResult {
  const placed = placeChords(sheet, map)
  if (!placed.ok) return { ok: false, error: placed.error }

  const scratch = applyChordPlacements({ ...map, harmony: [] }, placed.plan, newId).map
  const sections = deriveSectionsFromSheet(sheet, placed.plan, scratch, newId)

  return { ok: true, prepared: { plan: placed.plan, harmony: scratch.harmony, sections } }
}

/**
 * Land the prepared import as a new active draft.
 *
 * Never destroys existing work: whatever was at the root — sections, chords
 * AND lyrics — is preserved as a stored draft the user can switch back to.
 * The lyrics carry over into the new draft because the sheet was placed
 * against THOSE words; a draft with the sheet's chords but no lyrics would
 * have no record of what anchored them.
 */
export function applySheetImport(
  map: SongMap,
  prepared: PreparedSheetImport,
  newId: IdFactory,
): SongMap {
  return addDraftAndActivate(
    ensureActiveDraftIdentity(map, newId),
    { sections: prepared.sections, harmony: prepared.harmony, lyrics: map.lyrics },
    SHEET_IMPORT_DRAFT_NAME,
    newId,
  )
}
