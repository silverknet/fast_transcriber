import { get } from 'svelte/store'
import { audioSessionFromMapAndBlob, type RestorableSongState } from '$lib/songmap/session'
import { audioSession } from './audioSession'
import { clearSongMap, setSongMap, songMap } from './songMap'

/**
 * Apply a full restorable snapshot: durable `SongMap` plus playable blob into app stores.
 * Call after loading `.smap` JSON + sidecar audio, or when hydrating from DB + blob storage.
 */
export function hydrateRestorableSong(state: RestorableSongState): void {
  setSongMap(state.songMap)
  audioSession.set(audioSessionFromMapAndBlob(state.songMap, state.audioBlob))
}

/** True when the in-memory editor has a loaded song + audio clip. */
export function hasActiveSongSession(): boolean {
  return get(songMap) !== null && get(audioSession).file !== null
}

/** Clears song document + audio session (same as closing the project in memory). */
export function clearFullAppSongState(): void {
  clearSongMap()
  audioSession.set({ file: null, name: '', startSec: 0, endSec: 0 })
  if (typeof document !== 'undefined') {
    document.cookie = 'barbro_session=; Max-Age=0; Path=/; SameSite=Lax'
  }
}
