import type { SongMap } from './types'
import { SONGMAP_FORMAT_VERSION } from './version'
import {
  migrateLegacyLiveRouting,
  migrateLegacyLiveStemRefs,
} from './liveRouting'

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
    liveRouting: map.liveRouting ?? migrateLegacyLiveRouting(map),
    liveStemRefs: map.liveStemRefs ?? migrateLegacyLiveStemRefs(map),
  } as SongMap & Record<string, unknown>
  delete out.cues
  delete out.cueTrackExport
  delete out.clickTrackExport
  if (Array.isArray(map.effectBusses)) out.effectBusses = map.effectBusses.map(withLegacyBusMirror)
  return out as SongMap
}

/**
 * Write a bus's FIRST effect back into the pre-chain `{ kind, <settings> }`
 * fields as well as `chain`.
 *
 * Purely for older clients. A build that predates effect chains reads `kind`
 * and ignores `chain`; without a mirror it sees no `kind`, falls back to its
 * default ('reverb'), and if that user then saves, the whole chain is gone. In
 * a collab project one un-reloaded tab could quietly flatten everyone's racks.
 * With the mirror, an old client degrades to the first effect — wrong-ish, but
 * recognisably the user's bus rather than a stray default reverb.
 *
 * Current builds always prefer `chain` when present (see `normalizeEffectBus`),
 * so this is write-only compatibility and never feeds back in.
 */
function withLegacyBusMirror(bus: SongMap['effectBusses'] extends (infer B)[] | undefined ? B : never) {
  const first = bus.chain?.find((u) => !u.bypassed) ?? bus.chain?.[0]
  if (!first) return bus
  const settings = (first as Record<string, unknown>)[first.kind]
  return {
    ...bus,
    kind: first.kind,
    ...(settings ? { [first.kind]: settings } : {}),
  }
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
