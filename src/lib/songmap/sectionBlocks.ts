import type { Bar, Section } from './types'

export type SectionBlock = {
  start: number
  end: number
  section: Section | null
}

type NormalizedSection = {
  start: number
  end: number
  order: number
  section: Section
}

function clampBarIndex(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.trunc(value)))
}

function normalizeRange(section: Section): { start: number; end: number } | null {
  const start = Math.trunc(section.barRange.startBarIndex)
  const end = Math.trunc(section.barRange.endBarIndex)
  return end >= start ? { start, end } : null
}

export function buildSectionBlocksForBars(
  sections: readonly Section[],
  bars: readonly Pick<Bar, 'index'>[],
): SectionBlock[] {
  if (bars.length === 0) return []
  const normalized: NormalizedSection[] = sections
    .map((section, order) => {
      const range = normalizeRange(section)
      if (!range) return null
      return { ...range, order, section }
    })
    .filter((s): s is NormalizedSection => s !== null)
    .sort((a, b) => a.start - b.start || a.order - b.order)

  const owners: (Section | null)[] = Array.from({ length: bars.length }, () => null)
  for (const { start, end, section } of normalized) {
    for (let i = 0; i < bars.length; i++) {
      const barIndex = bars[i]!.index
      if (barIndex >= start && barIndex <= end) owners[i] = section
    }
  }

  const blocks: SectionBlock[] = []
  let start = 0
  let owner = owners[0] ?? null
  for (let i = 1; i < bars.length; i++) {
    const nextOwner = owners[i] ?? null
    if (nextOwner !== owner) {
      blocks.push({ start, end: i - 1, section: owner })
      start = i
      owner = nextOwner
    }
  }
  blocks.push({ start, end: bars.length - 1, section: owner })
  return blocks
}

/**
 * Build non-overlapping, gap-preserving arrangement blocks.
 *
 * The canonical section model is inclusive: adjacent sections should be
 * `[0..3]` then `[4..7]`. Imported or hand-edited maps can still end up with
 * a shared boundary like `[0..4]` then `[4..7]`. In that case the later
 * section owns the overlap, so generators do not play two patterns on bar 4.
 */
export function buildSectionBlocks(
  sections: readonly Section[],
  barCount: number,
): SectionBlock[] {
  if (barCount <= 0) return []
  const lastBar = barCount - 1
  const bars = Array.from({ length: barCount }, (_, index) => ({ index }))
  const blocks = buildSectionBlocksForBars(
    sections.map((section) => {
      const start = clampBarIndex(section.barRange.startBarIndex, lastBar)
      const end = clampBarIndex(section.barRange.endBarIndex, lastBar)
      return { ...section, barRange: { startBarIndex: start, endBarIndex: end } }
    }),
    bars,
  )
  return blocks.length > 0 ? blocks : [{ start: 0, end: lastBar, section: null }]
}

export function buildSectionRanges(
  sections: readonly Section[],
  barCount: number,
): { start: number; end: number }[] {
  return buildSectionBlocks(sections, barCount).map(({ start, end }) => ({ start, end }))
}

export function buildSectionRangesForBars(
  sections: readonly Section[],
  bars: readonly Pick<Bar, 'index'>[],
): { start: number; end: number }[] {
  return buildSectionBlocksForBars(sections, bars).map(({ start, end }) => ({ start, end }))
}
