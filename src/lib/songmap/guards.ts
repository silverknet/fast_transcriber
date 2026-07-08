import { SONGMAP_FORMAT_VERSION } from './version'
import type { SongMap, SongMapV1, SongMapV2 } from './types'

export function isSongMapV1(value: unknown): value is SongMapV1 {
  return isSongMapV2(value)
}

export function isSongMapV2(value: unknown): value is SongMapV2 {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return o.formatVersion === SONGMAP_FORMAT_VERSION
}

export function assertSongMap(value: unknown): asserts value is SongMap {
  if (!isSongMapV2(value)) {
    throw new Error(`Expected SongMap v${SONGMAP_FORMAT_VERSION}`)
  }
}
