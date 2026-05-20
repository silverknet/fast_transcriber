/**
 * Section tagging on bar index ranges (SongMap.sections).
 */

import type { Section, SectionKind, SongMap } from './types'

type IdFactory = () => string

export type SectionEditError = { ok: false; error: string }
export type SectionEditOk = { ok: true; map: SongMap }
export type SectionEditResult = SectionEditOk | SectionEditError

function ok(map: SongMap): SectionEditOk {
  return { ok: true, map }
}

function fail(error: string): SectionEditError {
  return { ok: false, error }
}

/** All kinds for pickers (order = common song flow). */
export const SECTION_KIND_OPTIONS: { kind: SectionKind; label: string }[] = [
  { kind: 'intro', label: 'Intro' },
  { kind: 'verse', label: 'Verse' },
  { kind: 'preChorus', label: 'Pre-chorus' },
  { kind: 'chorus', label: 'Chorus' },
  { kind: 'bridge', label: 'Bridge' },
  { kind: 'solo', label: 'Solo' },
  { kind: 'riff', label: 'Riff' },
  { kind: 'break', label: 'Break' },
  { kind: 'outro', label: 'Outro' },
  { kind: 'custom', label: 'Custom' },
]

export function defaultSectionLabel(kind: SectionKind): string {
  const row = SECTION_KIND_OPTIONS.find((o) => o.kind === kind)
  return row?.label ?? kind
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return !(a1 < b0 || b1 < a0)
}

/** Inclusive ranges that touch (border) or overlap — `[0..3]` and `[4..7]` are adjacent. */
function rangesOverlapOrAdjacent(a0: number, a1: number, b0: number, b1: number): boolean {
  return !(a1 + 1 < b0 || b1 + 1 < a0)
}

/**
 * Assigns a section to an inclusive bar index range.
 *
 * Behavior:
 *   - **Same-kind neighbors** that overlap *or border* the new range are folded
 *     into one larger section spanning the union of all touched ranges. Tagging
 *     bars 4-7 as Chorus next to an existing Chorus 0-3 produces a single
 *     Chorus 0-7, not two 4-bar choruses.
 *   - **Different-kind sections** that overlap the (merged) range are dropped —
 *     the new tag wins, same as before.
 *
 * `labelOverride` (when non-empty) replaces the default label. Otherwise, if a
 * same-kind neighbor is being merged in and had a non-default label
 * (e.g. "Big Chorus"), that label is preserved. Falls back to the default for
 * the kind.
 */
export function setSectionForBarRange(
  map: SongMap,
  startBarIndex: number,
  endBarIndex: number,
  kind: SectionKind,
  idFactory: IdFactory,
  labelOverride?: string,
): SectionEditResult {
  const n = map.timeline.bars.length
  if (n === 0) return fail('No bars in timeline')
  const a = Math.max(0, Math.min(startBarIndex, endBarIndex))
  const b = Math.min(n - 1, Math.max(startBarIndex, endBarIndex))
  if (a > b) return fail('Invalid bar range')

  // 1. Find same-kind neighbors that overlap or border the new range — these
  //    fold into the merged section.
  const sameKindNeighbors = map.sections.filter(
    (s) =>
      s.kind === kind &&
      rangesOverlapOrAdjacent(s.barRange.startBarIndex, s.barRange.endBarIndex, a, b),
  )

  // 2. Compute the union span.
  const unionStart = Math.min(a, ...sameKindNeighbors.map((s) => s.barRange.startBarIndex))
  const unionEnd = Math.max(b, ...sameKindNeighbors.map((s) => s.barRange.endBarIndex))

  // 3. Drop the same-kind neighbors we're folding in AND any *different-kind*
  //    section that overlaps the merged span.
  const neighborIds = new Set(sameKindNeighbors.map((s) => s.id))
  const filtered = map.sections.filter((s) => {
    if (neighborIds.has(s.id)) return false
    return !rangesOverlap(s.barRange.startBarIndex, s.barRange.endBarIndex, unionStart, unionEnd)
  })

  // 4. Resolve the label. Explicit override wins; otherwise inherit a custom
  //    label from one of the merged neighbors; otherwise default for the kind.
  const fallback = defaultSectionLabel(kind)
  const trimmedOverride = labelOverride?.trim()
  let label = fallback
  if (trimmedOverride && trimmedOverride.length > 0) {
    label = trimmedOverride
  } else {
    const inherited = sameKindNeighbors.find((s) => s.label && s.label !== fallback)
    if (inherited) label = inherited.label
  }

  const section: Section = {
    id: idFactory(),
    kind,
    label,
    barRange: { startBarIndex: unionStart, endBarIndex: unionEnd },
  }

  return ok({
    ...map,
    sections: [...filtered, section],
  })
}

/**
 * Resize an existing section to a new bar range. Preserves the section's id
 * and label. Allows shrinking (unlike re-tagging through `setSectionForBarRange`,
 * which only ever grows the union). Same overlap conventions as
 * `setSectionForBarRange`: same-kind neighbors that border or overlap the new
 * range fold in; different-kind overlaps are dropped.
 *
 * Used by edge-drag in the bar strip to grow / shrink a section.
 */
export function resizeSectionRange(
  map: SongMap,
  sectionId: string,
  newStartBarIndex: number,
  newEndBarIndex: number,
): SectionEditResult {
  const existing = map.sections.find((s) => s.id === sectionId)
  if (!existing) return fail('Section not found')

  const n = map.timeline.bars.length
  if (n === 0) return fail('No bars in timeline')
  const a = Math.max(0, Math.min(newStartBarIndex, newEndBarIndex))
  const b = Math.min(n - 1, Math.max(newStartBarIndex, newEndBarIndex))
  if (a > b) return fail('Invalid bar range')

  // Strip the section being resized so the merge logic doesn't fold it back
  // in (which would prevent shrinking).
  const others = map.sections.filter((s) => s.id !== sectionId)

  const sameKindNeighbors = others.filter(
    (s) =>
      s.kind === existing.kind &&
      rangesOverlapOrAdjacent(s.barRange.startBarIndex, s.barRange.endBarIndex, a, b),
  )
  const unionStart = Math.min(a, ...sameKindNeighbors.map((s) => s.barRange.startBarIndex))
  const unionEnd = Math.max(b, ...sameKindNeighbors.map((s) => s.barRange.endBarIndex))

  const neighborIds = new Set(sameKindNeighbors.map((s) => s.id))
  const filtered = others.filter((s) => {
    if (neighborIds.has(s.id)) return false
    return !rangesOverlap(s.barRange.startBarIndex, s.barRange.endBarIndex, unionStart, unionEnd)
  })

  const updated: Section = {
    ...existing,
    barRange: { startBarIndex: unionStart, endBarIndex: unionEnd },
  }

  return ok({
    ...map,
    sections: [...filtered, updated],
  })
}

/**
 * Move the shared edge between two adjacent sections — left.endBarIndex + 1 ===
 * right.startBarIndex — by setting a new boundary bar index. The left section
 * ends at `newBoundaryBarIndex - 1`, the right starts at `newBoundaryBarIndex`.
 *
 * Both sections must stay at least 1 bar wide; the boundary is clamped into
 * `[left.start + 1, right.end]`. Used by the boundary drag handle in the bar
 * strip — one drag, two sections updated, no gaps, no dropped sections.
 */
export function resizeSectionBoundary(
  map: SongMap,
  leftSectionId: string,
  rightSectionId: string,
  newBoundaryBarIndex: number,
): SectionEditResult {
  const left = map.sections.find((s) => s.id === leftSectionId)
  const right = map.sections.find((s) => s.id === rightSectionId)
  if (!left || !right) return fail('Section not found')

  const minBoundary = left.barRange.startBarIndex + 1
  const maxBoundary = right.barRange.endBarIndex
  if (minBoundary > maxBoundary) return fail('Sections cannot both stay non-empty')

  const b = Math.max(minBoundary, Math.min(maxBoundary, newBoundaryBarIndex))

  const updatedSections = map.sections.map((s) => {
    if (s.id === leftSectionId) {
      return { ...s, barRange: { ...s.barRange, endBarIndex: b - 1 } }
    }
    if (s.id === rightSectionId) {
      return { ...s, barRange: { ...s.barRange, startBarIndex: b } }
    }
    return s
  })

  return ok({ ...map, sections: updatedSections })
}
