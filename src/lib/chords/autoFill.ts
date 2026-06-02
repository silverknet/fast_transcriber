/**
 * Section-aware chord auto-fill.
 *
 * Given a song where the user has placed chords in (say) Verse 1, propose
 * copying that chord pattern to Verse 2 / Verse 3 / Chorus 2 / etc. at
 * matching beat positions within each section. Non-destructive — beats
 * that already have explicit chords are skipped.
 *
 * Section matching is by `kind` only; positions are matched via
 * `(barOffsetWithinSection, indexInBar)`. Target shorter than source →
 * trailing chords drop. Target longer → trailing bars stay empty.
 */

import type { Beat, ChordSymbol, Section, SongMap, HarmonyEvent } from '$lib/songmap/types'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { upsertHarmonyAtBeat, type IdFactory } from '$lib/songmap/harmonyEdit'

/** All beats inside `section`'s bar range, in song time order. */
export function beatsInSection(songMap: SongMap, section: Section): Beat[] {
  const barIdsInSection = new Set(
    songMap.timeline.bars
      .filter(
        (b) =>
          b.index >= section.barRange.startBarIndex &&
          b.index <= section.barRange.endBarIndex,
      )
      .map((b) => b.id),
  )
  const sorted = sortBeatsByTime(songMap.timeline.beats)
  return sorted.filter((beat) => barIdsInSection.has(beat.barId))
}

/** Section containing a beat (by `beat.barId`); null if none. */
export function sectionContainingBeat(
  songMap: SongMap,
  beat: Beat,
): Section | null {
  const bar = songMap.timeline.bars.find((b) => b.id === beat.barId)
  if (!bar) return null
  return (
    songMap.sections.find(
      (s) =>
        bar.index >= s.barRange.startBarIndex &&
        bar.index <= s.barRange.endBarIndex,
    ) ?? null
  )
}

/** One mapping entry in a proposed auto-fill. */
export type ChordAutoFillEntry = {
  sourceBeatId: string
  targetBeatId: string
  chord: ChordSymbol
}

export type ChordAutoFillProposal = {
  sourceSection: Section
  targetSection: Section
  entries: ChordAutoFillEntry[]
  /** Count of beats in the target the proposal will write (non-destructive). */
  fillCount: number
  /** Beats in the target that already have explicit chords and were skipped. */
  skippedExistingCount: number
}

/** Internal lookup keyed by `bar.index` → bar. */
function barsByIndex(songMap: SongMap): Map<number, { id: string; beatIds: string[] }> {
  const m = new Map<number, { id: string; beatIds: string[] }>()
  for (const bar of songMap.timeline.bars) {
    m.set(bar.index, { id: bar.id, beatIds: bar.beatIds })
  }
  return m
}

/** Build a single proposal for one source-section → target-section pair. */
function buildProposal(
  songMap: SongMap,
  source: Section,
  target: Section,
): ChordAutoFillProposal {
  const beatsById = new Map(songMap.timeline.beats.map((b) => [b.id, b]))
  const bars = barsByIndex(songMap)
  const harmonyByBeat = new Map(
    songMap.harmony.filter((h) => h.beatId).map((h) => [h.beatId!, h] as const),
  )

  const sourceEvents: HarmonyEvent[] = songMap.harmony.filter((h) => {
    if (!h.beatId) return false
    const beat = beatsById.get(h.beatId)
    if (!beat) return false
    const bar = bars.get(
      songMap.timeline.bars.find((b) => b.id === beat.barId)?.index ?? -1,
    )
    if (!bar) return false
    // h.barId already encodes the bar; quicker check:
    const sourceBar = songMap.timeline.bars.find((b) => b.id === h.barId)
    if (!sourceBar) return false
    return (
      sourceBar.index >= source.barRange.startBarIndex &&
      sourceBar.index <= source.barRange.endBarIndex
    )
  })

  const entries: ChordAutoFillEntry[] = []
  let skippedExistingCount = 0

  for (const ev of sourceEvents) {
    const sourceBeat = beatsById.get(ev.beatId!)
    if (!sourceBeat) continue
    const sourceBar = songMap.timeline.bars.find((b) => b.id === sourceBeat.barId)
    if (!sourceBar) continue

    const barOffset = sourceBar.index - source.barRange.startBarIndex
    const targetBarIndex = target.barRange.startBarIndex + barOffset
    if (targetBarIndex > target.barRange.endBarIndex) continue // target shorter → drop

    const targetBar = bars.get(targetBarIndex)
    if (!targetBar) continue

    // Find the beat in target bar with same `indexInBar`.
    const targetBeatId = targetBar.beatIds.find((bid) => {
      const b = beatsById.get(bid)
      return b && b.indexInBar === sourceBeat.indexInBar
    })
    if (!targetBeatId) continue

    if (harmonyByBeat.has(targetBeatId)) {
      skippedExistingCount++
      continue
    }

    entries.push({
      sourceBeatId: sourceBeat.id,
      targetBeatId,
      chord: ev.chord,
    })
  }

  return {
    sourceSection: source,
    targetSection: target,
    entries,
    fillCount: entries.length,
    skippedExistingCount,
  }
}

/** Cap on number of proposals returned — keeps the cycle UI manageable. */
export const MAX_AUTOFILL_CANDIDATES = 5

/**
 * Ranked list of section-pair auto-fill proposals.
 *
 * - Groups sections by `kind`; only same-kind pairs are matched.
 * - In each group, the "source" is the section with the most explicit
 *   HarmonyEvents (tie-breaker: chronologically earliest).
 * - Proposals are emitted for every OTHER section in the group; only those
 *   that gain ≥1 chord are kept (fillCount ≥ 1).
 * - Ranked chronologically by target start bar (left-to-right reading).
 * - Capped at MAX_AUTOFILL_CANDIDATES.
 */
export function proposeChordAutoFillCandidates(
  songMap: SongMap,
): ChordAutoFillProposal[] {
  // Count explicit chords per section.
  const explicitCountBySectionId = new Map<string, number>()
  for (const section of songMap.sections) {
    explicitCountBySectionId.set(section.id, 0)
  }
  const beatsById = new Map(songMap.timeline.beats.map((b) => [b.id, b]))
  const barsById = new Map(songMap.timeline.bars.map((b) => [b.id, b]))
  for (const h of songMap.harmony) {
    if (!h.beatId) continue
    const beat = beatsById.get(h.beatId)
    if (!beat) continue
    const bar = barsById.get(beat.barId)
    if (!bar) continue
    for (const section of songMap.sections) {
      if (
        bar.index >= section.barRange.startBarIndex &&
        bar.index <= section.barRange.endBarIndex
      ) {
        explicitCountBySectionId.set(
          section.id,
          (explicitCountBySectionId.get(section.id) ?? 0) + 1,
        )
        break
      }
    }
  }

  // Group sections by kind.
  const byKind = new Map<string, Section[]>()
  for (const section of songMap.sections) {
    const list = byKind.get(section.kind) ?? []
    list.push(section)
    byKind.set(section.kind, list)
  }

  const proposals: ChordAutoFillProposal[] = []
  for (const [, group] of byKind) {
    if (group.length < 2) continue

    // Pick source = section with most chords (tiebreaker earliest).
    const sorted = [...group].sort((a, b) => {
      const ca = explicitCountBySectionId.get(a.id) ?? 0
      const cb = explicitCountBySectionId.get(b.id) ?? 0
      if (ca !== cb) return cb - ca // most chords first
      return a.barRange.startBarIndex - b.barRange.startBarIndex // earlier first
    })
    const source = sorted[0]
    if ((explicitCountBySectionId.get(source.id) ?? 0) === 0) continue

    for (const target of group) {
      if (target.id === source.id) continue
      const proposal = buildProposal(songMap, source, target)
      if (proposal.fillCount > 0) proposals.push(proposal)
    }
  }

  // Sort chronologically by target start bar; cap.
  proposals.sort(
    (a, b) => a.targetSection.barRange.startBarIndex - b.targetSection.barRange.startBarIndex,
  )
  return proposals.slice(0, MAX_AUTOFILL_CANDIDATES)
}

/**
 * Apply a proposal — write every entry into the songMap via the canonical
 * `upsertHarmonyAtBeat` writer. Returns the patched songMap, or an error
 * string on the first failed upsert (shouldn't happen on a sane proposal).
 */
export function applyChordAutoFill(
  map: SongMap,
  proposal: ChordAutoFillProposal,
  newId: IdFactory,
): { ok: true; map: SongMap } | { ok: false; error: string } {
  let current = map
  for (const entry of proposal.entries) {
    const out = upsertHarmonyAtBeat(current, entry.targetBeatId, entry.chord, newId)
    if (!out.ok) return { ok: false, error: out.error }
    current = out.map
  }
  return { ok: true, map: current }
}
