import { get, writable } from 'svelte/store'
import { mergeAudioReferenceFromSession } from '$lib/songmap/session'
import { validateSongMap, type SongMap } from '$lib/songmap'
import { audioSession } from './audioSession'

/**
 * In-memory durable song document (bars, beats, harmony, …). Playable bytes live in `audioSession`;
 * after each successful patch we merge trim/file info into `map.audio` when a file is loaded.
 * Full snapshot: `RestorableSongState` + `hydrateRestorableSong`.
 */
export const songMap = writable<SongMap | null>(null)

export function setSongMap(map: SongMap | null) {
  songMap.set(map)
}

export function clearSongMap() {
  songMap.set(null)
}

/**
 * Apply an immutable update to the current map. On validation failure the store is unchanged.
 */
export function patchSongMap(
  updater: (map: SongMap) => SongMap,
): { ok: true } | { ok: false; errors: string[] } {
  let result: { ok: true } | { ok: false; errors: string[] } = { ok: false, errors: ['No song map loaded'] }
  songMap.update((sm) => {
    if (!sm) return sm
    let next = updater(sm)
    const sess = get(audioSession)
    if (sess.file) {
      next = mergeAudioReferenceFromSession(next, sess)
    }
    const v = validateSongMap(next)
    if (!v.ok) {
      result = { ok: false, errors: v.errors }
      return sm
    }
    result = { ok: true }
    const now = new Date().toISOString()
    return {
      ...next,
      metadata: { ...next.metadata, updatedAt: now },
    }
  })
  return result
}
