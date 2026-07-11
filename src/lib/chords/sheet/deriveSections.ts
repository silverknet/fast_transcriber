/**
 * Derive song sections from a chord sheet's markers + the placed chords.
 *
 * Only for songs with NO sections yet — the boundaries come from where each
 * sheet section's first chord actually landed, so they inherit the accuracy
 * of the lyric alignment. Sections are built directly (NOT via
 * `setSectionForBarRange`, which merges same-kind neighbors and would fuse
 * back-to-back Verse 1 / Verse 2).
 */
import type { Section, SectionKind, SongMap } from '$lib/songmap/types'
import type { IdFactory } from '$lib/songmap/harmonyEdit'
import type { ParsedChordSheet } from './parseChordSheet'
import type { ChordPlacementPlan } from './placeChords'

/** Map a sheet marker label ("Pre-Chorus", "Verse 2") to a SectionKind. */
export function sectionKindFromSheetLabel(label: string): SectionKind {
  const l = label.trim().toLowerCase()
  if (/^intro/.test(l)) return 'intro'
  if (/^verse/.test(l)) return 'verse'
  if (/^pre[\s-]?chorus/.test(l)) return 'preChorus'
  if (/^(chorus|hook|refrain)/.test(l)) return 'chorus'
  if (/^bridge/.test(l)) return 'bridge'
  if (/^(solo|guitar solo)/.test(l)) return 'solo'
  if (/^riff/.test(l)) return 'riff'
  if (/^(break|instrumental|interlude)/.test(l)) return 'break'
  if (/^outro/.test(l)) return 'outro'
  return 'custom'
}

/**
 * Build sections for an empty-section song: section i spans from the bar of
 * its first placed chord to the bar before section i+1's first placed chord
 * (first section extends back to bar 0, last one to the final bar). Sheet
 * sections whose chords all failed to place are skipped.
 */
export function deriveSectionsFromSheet(
  sheet: ParsedChordSheet,
  plan: ChordPlacementPlan,
  map: SongMap,
  newId: IdFactory,
): Section[] {
  if (map.sections.length > 0) return []
  const lastBarIndex = Math.max(-1, ...map.timeline.bars.map((b) => b.index))
  if (lastBarIndex < 0) return []

  // First placed bar per sheet section, in sheet order.
  const firstBarBySection = new Map<number, number>()
  for (const p of plan.placements) {
    if (p.barIndex < 0) continue
    const cur = firstBarBySection.get(p.sectionIdx)
    if (cur === undefined || p.barIndex < cur) firstBarBySection.set(p.sectionIdx, p.barIndex)
  }

  const present = sheet.sections
    .map((s, idx) => ({ label: s.label, idx, firstBar: firstBarBySection.get(idx) }))
    .filter((s): s is { label: string; idx: number; firstBar: number } => s.firstBar !== undefined)
  if (present.length === 0) return []

  // Guard against alignment hiccups: starts must be strictly increasing in
  // sheet order, or the ranges wouldn't tile — drop offenders.
  const ordered: typeof present = []
  for (const s of present) {
    if (ordered.length === 0 || s.firstBar > ordered[ordered.length - 1]!.firstBar) ordered.push(s)
  }

  const out: Section[] = []
  for (let i = 0; i < ordered.length; i++) {
    const startBarIndex = i === 0 ? 0 : ordered[i]!.firstBar
    const endBarIndex = i + 1 < ordered.length ? ordered[i + 1]!.firstBar - 1 : lastBarIndex
    if (endBarIndex < startBarIndex) continue
    const label = ordered[i]!.label
    const kind = sectionKindFromSheetLabel(label)
    out.push({
      id: newId(),
      kind,
      label: label || 'Section',
      barRange: { startBarIndex, endBarIndex },
    })
  }
  return out
}
