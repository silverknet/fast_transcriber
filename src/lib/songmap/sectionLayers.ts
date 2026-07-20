/**
 * Parallel section layouts (v5) — the sections twin of `chordLayers.ts`.
 *
 * `SongMap.sections` is ALWAYS the active layout; inactive alternatives live
 * in `sectionLayers`. Switching swaps a layer in while the outgoing layout is
 * preserved as a layer — nothing is ever silently discarded. The chord-sheet
 * importer uses this so its derived sections never destroy hand-made ones.
 */
import type { SectionLayer, SongMap } from './types'
import type { IdFactory } from './harmonyEdit'

export const DEFAULT_ACTIVE_SECTION_LAYER_NAME = 'My sections'

/** Name shown for the currently-active section layout. */
export function activeSectionLayoutName(map: SongMap): string {
  return map.activeSectionLayerName ?? DEFAULT_ACTIVE_SECTION_LAYER_NAME
}

/** Content fingerprint: two layouts equal iff same (range, kind, label) rows. */
function sectionsContentKey(sections: SongMap['sections']): string {
  return sections
    .map((s) => `${s.barRange.startBarIndex}-${s.barRange.endBarIndex}·${s.kind}·${s.label}`)
    .sort()
    .join('|')
}

/**
 * Snapshot the CURRENT sections into a new inactive layer. No-op when empty
 * or when an existing layer already holds the identical layout.
 */
export function stashActiveSections(
  map: SongMap,
  newId: IdFactory,
  opts?: { name?: string; source?: SectionLayer['source'] },
): SongMap {
  if (map.sections.length === 0) return map
  const activeKey = sectionsContentKey(map.sections)
  if ((map.sectionLayers ?? []).some((l) => sectionsContentKey(l.sections) === activeKey)) {
    return map
  }
  const name = opts?.name ?? activeSectionLayoutName(map)
  const layer: SectionLayer = {
    id: newId(),
    name: uniqueSectionLayerName(map, name),
    source: opts?.source ?? 'manual',
    createdAt: new Date().toISOString(),
    sections: map.sections.map((s) => ({ ...s, barRange: { ...s.barRange } })),
  }
  return { ...map, sectionLayers: [...(map.sectionLayers ?? []), layer] }
}

/**
 * Make `layerId` the active section layout; the outgoing layout takes the
 * layer's place under the outgoing name. Lossless in both directions.
 */
export function switchToSectionLayer(
  map: SongMap,
  layerId: string,
  newId: IdFactory,
): { ok: true; map: SongMap } | { ok: false; error: string } {
  const layers = map.sectionLayers ?? []
  const target = layers.find((l) => l.id === layerId)
  if (!target) return { ok: false, error: 'Unknown section layout' }

  const nextLayers = layers.filter((l) => l.id !== layerId)
  const remaining = { ...map, sectionLayers: nextLayers }
  const activeKey = sectionsContentKey(map.sections)
  // Identical content: absorb the layer instead of duplicating (see chordLayers).
  if (sectionsContentKey(target.sections) === activeKey) {
    return {
      ok: true,
      map: {
        ...map,
        sectionLayers: nextLayers.length > 0 ? nextLayers : undefined,
        activeSectionLayerName: target.name,
      },
    }
  }
  const alreadyKept = nextLayers.some((l) => sectionsContentKey(l.sections) === activeKey)
  const outgoing: SectionLayer | null =
    map.sections.length > 0 && !alreadyKept
      ? {
          id: newId(),
          name: uniqueSectionLayerName(remaining, activeSectionLayoutName(map)),
          source: 'manual',
          createdAt: new Date().toISOString(),
          sections: map.sections.map((s) => ({ ...s, barRange: { ...s.barRange } })),
        }
      : null
  if (outgoing) nextLayers.push(outgoing)

  return {
    ok: true,
    map: {
      ...map,
      sections: target.sections.map((s) => ({ ...s, barRange: { ...s.barRange } })),
      sectionLayers: nextLayers.length > 0 ? nextLayers : undefined,
      activeSectionLayerName: target.name,
    },
  }
}

/** Delete an inactive section layer (the active layout is untouchable here). */
export function deleteSectionLayer(map: SongMap, layerId: string): SongMap {
  const nextLayers = (map.sectionLayers ?? []).filter((l) => l.id !== layerId)
  return { ...map, sectionLayers: nextLayers.length > 0 ? nextLayers : undefined }
}

function uniqueSectionLayerName(map: SongMap, base: string): string {
  const taken = new Set((map.sectionLayers ?? []).map((l) => l.name))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate)) return candidate
  }
}
