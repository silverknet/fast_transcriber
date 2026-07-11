/**
 * Parallel chord tracks (v5).
 *
 * `SongMap.harmony` is ALWAYS the active track — the grid, lead sheet, mixer
 * chord rail, PDF and Ableton exports keep reading it untouched. Inactive
 * alternatives live in `chordLayers`; switching swaps a layer's events into
 * `harmony` while the previous active set is preserved as a layer under
 * `activeChordLayerName`. Nothing is ever silently discarded.
 */
import type { ChordLayer, SongMap } from './types'
import type { IdFactory } from './harmonyEdit'

export const DEFAULT_ACTIVE_LAYER_NAME = 'My chords'

/** Name shown for the currently-active chord track. */
export function activeChordTrackName(map: SongMap): string {
  return map.activeChordLayerName ?? DEFAULT_ACTIVE_LAYER_NAME
}

/** Content fingerprint: two chord sets equal iff same (beat, symbol) pairs. */
function harmonyContentKey(harmony: SongMap['harmony']): string {
  return harmony
    .map((h) => `${h.beatId ?? h.startSec}·${h.chord.displayRaw}`)
    .sort()
    .join('|')
}

/**
 * Snapshot the CURRENT active chords into a new inactive layer. No-op when
 * there are no chords to keep — or when an existing layer already holds the
 * IDENTICAL chords (repeated imports/switches were piling up duplicate
 * "Sheet import 2/3…" layers and turning the picker into a shell game).
 */
export function stashActiveChords(
  map: SongMap,
  newId: IdFactory,
  opts?: { name?: string; source?: ChordLayer['source'] },
): SongMap {
  if (map.harmony.length === 0) return map
  const activeKey = harmonyContentKey(map.harmony)
  if ((map.chordLayers ?? []).some((l) => harmonyContentKey(l.harmony) === activeKey)) {
    return map // already preserved verbatim — don't duplicate
  }
  const name = opts?.name ?? activeChordTrackName(map)
  const layer: ChordLayer = {
    id: newId(),
    name: uniqueLayerName(map, name),
    source: opts?.source ?? 'manual',
    createdAt: new Date().toISOString(),
    harmony: map.harmony.map((h) => ({ ...h })),
  }
  return { ...map, chordLayers: [...(map.chordLayers ?? []), layer] }
}

/**
 * Make `layerId` the active chord track. The outgoing active chords take the
 * layer's place (keeping the outgoing track's name), so switching is always
 * reversible and total chord data is conserved.
 */
export function switchToChordLayer(
  map: SongMap,
  layerId: string,
  newId: IdFactory,
): { ok: true; map: SongMap } | { ok: false; error: string } {
  const layers = map.chordLayers ?? []
  const target = layers.find((l) => l.id === layerId)
  if (!target) return { ok: false, error: 'Unknown chord track' }

  const nextLayers = layers.filter((l) => l.id !== layerId)
  const remaining = { ...map, chordLayers: nextLayers }
  const activeKey = harmonyContentKey(map.harmony)
  // Switching to a layer with IDENTICAL content: absorb it (drop the layer,
  // take its name) — otherwise every flip mints another duplicate.
  if (harmonyContentKey(target.harmony) === activeKey) {
    return {
      ok: true,
      map: {
        ...map,
        chordLayers: nextLayers.length > 0 ? nextLayers : undefined,
        activeChordLayerName: target.name,
      },
    }
  }
  const alreadyKept = nextLayers.some((l) => harmonyContentKey(l.harmony) === activeKey)
  const outgoing: ChordLayer | null =
    map.harmony.length > 0 && !alreadyKept
      ? {
          id: newId(),
          name: uniqueLayerName(remaining, activeChordTrackName(map)),
          source: 'manual',
          createdAt: new Date().toISOString(),
          harmony: map.harmony.map((h) => ({ ...h })),
        }
      : null
  if (outgoing) nextLayers.push(outgoing)

  return {
    ok: true,
    map: {
      ...map,
      harmony: target.harmony.map((h) => ({ ...h })),
      chordLayers: nextLayers.length > 0 ? nextLayers : undefined,
      activeChordLayerName: target.name,
    },
  }
}

/** Delete an inactive layer (the active track is untouchable here). */
export function deleteChordLayer(map: SongMap, layerId: string): SongMap {
  const nextLayers = (map.chordLayers ?? []).filter((l) => l.id !== layerId)
  return { ...map, chordLayers: nextLayers.length > 0 ? nextLayers : undefined }
}

/** Avoid two layers with the same display name ("Sheet import 2"). */
function uniqueLayerName(map: SongMap, base: string): string {
  const taken = new Set((map.chordLayers ?? []).map((l) => l.name))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate)) return candidate
  }
}
