import type { SongMap } from './types'
import { SONGMAP_FORMAT_VERSION } from './version'

export type SerializeSongMapOptions = {
  /** Default true — JSON with 2-space indent for `.smap` diffs */
  pretty?: boolean
  /** Omit keys whose value is `undefined` */
  omitUndefined?: boolean
}

function omitUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((v) => omitUndefinedDeep(v)).filter((v) => v !== undefined)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const next = omitUndefinedDeep(v)
    if (next !== undefined) out[k] = next
  }
  return out
}

export function canonicalizeSongMapForSerialize(map: SongMap): SongMap {
  const out = {
    ...(map as SongMap & Record<string, unknown>),
    formatVersion: SONGMAP_FORMAT_VERSION,
    cueTracks: Array.isArray(map.cueTracks) ? map.cueTracks : [],
  } as SongMap & Record<string, unknown>
  delete out.cues
  delete out.cueTrackExport
  delete out.clickTrackExport
  return out as SongMap
}

/**
 * Serialize `SongMap` to JSON string. Key order follows object literal construction order
 * from `parse` / factories (stable round-trip if you parse and serialize again).
 */
export function serializeSongMap(map: SongMap, options: SerializeSongMapOptions = {}): string {
  const { pretty = true, omitUndefined = true } = options
  const canonical = canonicalizeSongMapForSerialize(map)
  const payload = omitUndefined ? (omitUndefinedDeep(canonical) as SongMap) : canonical
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
}
