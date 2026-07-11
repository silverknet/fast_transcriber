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

/**
 * Snapshot the CURRENT active chords into a new inactive layer. No-op when
 * there are no chords to keep. Used before a sheet import replaces `harmony`.
 */
export function stashActiveChords(
  map: SongMap,
  newId: IdFactory,
  opts?: { name?: string; source?: ChordLayer['source'] },
): SongMap {
  if (map.harmony.length === 0) return map
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

  const remaining = { ...map, chordLayers: layers.filter((l) => l.id !== layerId) }
  const outgoing: ChordLayer | null =
    map.harmony.length > 0
      ? {
          id: newId(),
          name: uniqueLayerName(remaining, activeChordTrackName(map)),
          source: 'manual',
          createdAt: new Date().toISOString(),
          harmony: map.harmony.map((h) => ({ ...h })),
        }
      : null

  const nextLayers = layers.filter((l) => l.id !== layerId)
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
