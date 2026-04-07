import type { SongMap } from './types'

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

/**
 * Serialize `SongMap` to JSON string. Key order follows object literal construction order
 * from `parse` / factories (stable round-trip if you parse and serialize again).
 */
export function serializeSongMap(map: SongMap, options: SerializeSongMapOptions = {}): string {
  const { pretty = true, omitUndefined = true } = options
  const payload = omitUndefined ? (omitUndefinedDeep(map) as SongMap) : map
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
}
