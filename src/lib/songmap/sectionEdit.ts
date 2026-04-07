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

/**
 * Assigns a section to an inclusive bar index range. Drops existing sections that overlap
 * the range, then appends the new section.
 */
export function setSectionForBarRange(
  map: SongMap,
  startBarIndex: number,
  endBarIndex: number,
  kind: SectionKind,
  idFactory: IdFactory,
): SectionEditResult {
  const n = map.timeline.bars.length
  if (n === 0) return fail('No bars in timeline')
  const a = Math.max(0, Math.min(startBarIndex, endBarIndex))
  const b = Math.min(n - 1, Math.max(startBarIndex, endBarIndex))
  if (a > b) return fail('Invalid bar range')

  const filtered = map.sections.filter((s) => {
    return !rangesOverlap(
      s.barRange.startBarIndex,
      s.barRange.endBarIndex,
      a,
      b,
    )
  })

  const section: Section = {
    id: idFactory(),
    kind,
    label: defaultSectionLabel(kind),
    barRange: { startBarIndex: a, endBarIndex: b },
  }

  return ok({
    ...map,
    sections: [...filtered, section],
  })
}
