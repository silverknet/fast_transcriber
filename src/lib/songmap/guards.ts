import { SONGMAP_FORMAT_VERSION } from './version'
import type { SongMap, SongMapV1 } from './types'

export function isSongMapV1(value: unknown): value is SongMapV1 {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return o.formatVersion === SONGMAP_FORMAT_VERSION
}

export function assertSongMap(value: unknown): asserts value is SongMap {
  if (!isSongMapV1(value)) {
    throw new Error('Expected SongMap v1')
  }
}
