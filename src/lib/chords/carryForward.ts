import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { Beat, ChordSymbol, HarmonyEvent, SongMap } from '$lib/songmap/types'

/**
 * For each beat in timeline order, resolve the sounding chord (carry-forward from last defined).
 * Beats before the first harmony yield `null`.
 */
export function resolveChordAtEachBeat(map: SongMap): Map<string, ChordSymbol | null> {
  const beats = sortBeatsByTime(map.timeline.beats)
  const byBeat = new Map(map.harmony.filter((h) => h.beatId).map((h) => [h.beatId!, h]))
  const out = new Map<string, ChordSymbol | null>()
  let carry: ChordSymbol | null = null
  for (const b of beats) {
    const ev = byBeat.get(b.id)
    if (ev) carry = ev.chord
    out.set(b.id, carry)
  }
  return out
}

/** Single beat resolution (requires full map for carry chain). */
export function chordAtBeat(map: SongMap, beatId: string): ChordSymbol | null {
  return resolveChordAtEachBeat(map).get(beatId) ?? null
}
