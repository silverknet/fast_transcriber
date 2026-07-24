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

// ── OFF-GRID chords (edge case): N evenly-spaced chords across ONE bar ────────
// Stored as `barFraction` chords (fractions 0, 1/n, … (n-1)/n) anchored to the
// bar, not to any beat. The beat grid / click are untouched.

/** All chords that live in `barId` (either beat-anchored or fraction-anchored). */
function chordsInBar(map: SongMap, barId: string): HarmonyEvent[] {
  const beatIdsInBar = new Set(
    map.timeline.beats.filter((b) => b.barId === barId).map((b) => b.id),
  )
  return map.harmony.filter(
    (h) => h.barId === barId || (h.beatId && beatIdsInBar.has(h.beatId)),
  )
}

/** startSec/endSec for a fraction chord: linear within the bar, ending at the
 *  next fraction (or the bar end for the last one). */
function fractionSpan(
  bar: Bar,
  fraction: number,
  nextFraction: number | null,
): { startSec: number; endSec: number } {
  const dur = bar.endSec - bar.startSec
  const startSec = bar.startSec + Math.max(0, Math.min(1, fraction)) * dur
  const endSec = nextFraction == null ? bar.endSec : bar.startSec + nextFraction * dur
  return { startSec, endSec: Math.max(endSec, startSec + 0.02) }
}

/**
 * Replace a bar's chords with `n` evenly-spaced OFF-GRID chords, each seeded
 * with `seedChord`. `n <= 1` reverts the bar to normal beat-grid chords (drops
 * any fraction chords). Only touches chords in `barId`.
 */
export function setBarChordDivision(
  map: SongMap,
  barId: string,
  n: number,
  seedChord: ChordSymbol,
  newId: IdFactory,
): { ok: true; map: SongMap } | { ok: false; error: string } {
  const bar = map.timeline.bars.find((b) => b.id === barId)
  if (!bar) return { ok: false, error: 'Unknown bar' }
  const inBarIds = new Set(chordsInBar(map, barId).map((h) => h.id))
  const rest = map.harmony.filter((h) => !inBarIds.has(h.id))
  if (!(n >= 2)) return { ok: true, map: { ...map, harmony: rest } } // revert to beat grid
  const added: HarmonyEvent[] = []
  for (let i = 0; i < n; i++) {
    const fraction = i / n
    const { startSec, endSec } = fractionSpan(bar, fraction, i + 1 < n ? (i + 1) / n : null)
    added.push({ id: newId(), barId, startSec, endSec, chord: seedChord, barFraction: fraction })
  }
  return { ok: true, map: { ...map, harmony: [...rest, ...added] } }
}

/** Set the chord of one OFF-GRID slot (by bar + fraction). */
export function setBarFractionChord(
  map: SongMap,
  barId: string,
  fraction: number,
  chord: ChordSymbol,
): SongMap {
  return {
    ...map,
    harmony: map.harmony.map((h) =>
      h.barId === barId && h.barFraction != null && Math.abs(h.barFraction - fraction) < 1e-6
        ? { ...h, chord }
        : h,
    ),
  }
}

/** How many off-grid chords a bar has (0 = normal beat-grid bar). */
export function barChordDivision(map: SongMap, barId: string): number {
  return map.harmony.filter((h) => h.barId === barId && h.barFraction != null).length
}
