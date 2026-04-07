import { sortBeatsByTime } from './normalize'
import type { Bar, Beat, ChordSymbol, HarmonyEvent, SongMap } from './types'

export type IdFactory = () => string

/** Half-open [startSec, endSec) for the beat in timeline order. */
export function beatHarmonySpan(
  beat: Beat,
  allBeatsSorted: Beat[],
  barsById: Map<string, Bar>,
): { startSec: number; endSec: number } {
  const bar = barsById.get(beat.barId)
  const barEnd = bar?.endSec ?? beat.timeSec + 0.25
  const idx = allBeatsSorted.findIndex((b) => b.id === beat.id)
  const next = idx >= 0 && idx + 1 < allBeatsSorted.length ? allBeatsSorted[idx + 1]! : null
  let endSec = barEnd
  if (next && next.timeSec > beat.timeSec) endSec = Math.min(next.timeSec, barEnd)
  if (!(endSec > beat.timeSec)) endSec = Math.min(beat.timeSec + 0.02, barEnd)
  return { startSec: beat.timeSec, endSec }
}

/**
 * Replace or insert exactly one harmony row for `beatId`, removing any prior row for that beat.
 */
export function upsertHarmonyAtBeat(
  map: SongMap,
  beatId: string,
  chord: ChordSymbol,
  newId: IdFactory,
): { ok: true; map: SongMap } | { ok: false; error: string } {
  const beat = map.timeline.beats.find((b) => b.id === beatId)
  if (!beat) return { ok: false, error: 'Unknown beat' }
  const bar = map.timeline.bars.find((b) => b.id === beat.barId)
  if (!bar) return { ok: false, error: 'Unknown bar for beat' }

  const sorted = sortBeatsByTime(map.timeline.beats)
  const barsById = new Map(map.timeline.bars.map((b) => [b.id, b]))
  const { startSec, endSec } = beatHarmonySpan(beat, sorted, barsById)
  if (!(endSec > startSec)) return { ok: false, error: 'Invalid harmony span' }

  const filtered = map.harmony.filter((h) => h.beatId !== beatId)
  const next: HarmonyEvent = {
    id: newId(),
    barId: beat.barId,
    beatId,
    startSec,
    endSec,
    chord,
    beatAnchor: { indexInBar: beat.indexInBar },
  }
  return {
    ok: true,
    map: { ...map, harmony: [...filtered, next] },
  }
}

/** Remove harmony anchored to `beatId` if any. */
export function clearHarmonyAtBeat(map: SongMap, beatId: string): SongMap {
  return { ...map, harmony: map.harmony.filter((h) => h.beatId !== beatId) }
}
