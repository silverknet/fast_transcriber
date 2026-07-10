import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { SongMap } from '$lib/songmap/types'

export type ChordSuggestionVisibilityState = {
  explicitBeatIds: Set<string>
  coveredBeatIds: Set<string>
  coveredFromStartSectionIds: Set<string>
}

/**
 * Suggestions are hints for un-chorded space, not competing chord labels.
 *
 * Harmony rows are chord-change points, so a user-entered chord covers later
 * beats in the same section until another section starts. This keeps analyzer
 * ghosts from appearing between the real chords a user has already placed.
 */
export function chordSuggestionVisibilityState(songMap: SongMap): ChordSuggestionVisibilityState {
  const explicitBeatIds = new Set(songMap.harmony.map((h) => h.beatId).filter(Boolean) as string[])
  const coveredBeatIds = new Set<string>()
  const coveredFromStartSectionIds = new Set<string>()
  const barsById = new Map(songMap.timeline.bars.map((bar) => [bar.id, bar]))
  const sortedBeats = sortBeatsByTime(songMap.timeline.beats)

  for (const section of songMap.sections) {
    const sectionBeats = sortedBeats.filter((beat) => {
      const bar = barsById.get(beat.barId)
      return (
        !!bar &&
        bar.index >= section.barRange.startBarIndex &&
        bar.index <= section.barRange.endBarIndex
      )
    })
    const firstCoveredIndex = sectionBeats.findIndex((beat) => explicitBeatIds.has(beat.id))
    if (firstCoveredIndex < 0) continue

    if (firstCoveredIndex === 0) coveredFromStartSectionIds.add(section.id)
    for (let index = firstCoveredIndex; index < sectionBeats.length; index += 1) {
      coveredBeatIds.add(sectionBeats[index]!.id)
    }
  }

  return { explicitBeatIds, coveredBeatIds, coveredFromStartSectionIds }
}
