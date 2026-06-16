import { derived, get, writable } from 'svelte/store'
import { fingerprintCueTrackInputs } from '$lib/songmap/cueTrackFingerprint'
import { mergeAudioReferenceFromSession } from '$lib/songmap/session'
import { validateSongMap, type SongMap } from '$lib/songmap'
import { audioSession } from './audioSession'

/**
 * In-memory durable song document (bars, beats, harmony, …). Playable bytes live in `audioSession`;
 * after each successful patch we merge trim/file info into `map.audio` when a file is loaded.
 * Full snapshot: `RestorableSongState` + `hydrateRestorableSong`.
 */
export const songMap = writable<SongMap | null>(null)

/**
 * Undo / redo history. Each successful `patchSongMap` pushes the
 * PREVIOUS `SongMap` reference onto `past` and clears `future`.
 * `undoSongMap()` pops `past` → current → `future`. Snapshots are
 * just references (`SongMap` is treated immutably throughout the
 * codebase) so the stack is cheap.
 *
 * `setSongMap` / `clearSongMap` reset the stack — switching projects
 * shouldn't let you undo into someone else's document.
 *
 * Capped at `MAX_HISTORY` so a long editing session doesn't grow
 * unbounded. Oldest entries dropped when full.
 */
const MAX_HISTORY = 100
const history = writable<{ past: SongMap[]; future: SongMap[] }>({ past: [], future: [] })

export const canUndo = derived(history, (h) => h.past.length > 0)
export const canRedo = derived(history, (h) => h.future.length > 0)

export function setSongMap(map: SongMap | null) {
  history.set({ past: [], future: [] })
  songMap.set(map)
}

export function clearSongMap() {
  history.set({ past: [], future: [] })
  songMap.set(null)
}

/**
 * Roll back the previous `patchSongMap`. No-op when the past stack is
 * empty. The current state moves onto `future` so `redoSongMap()` can
 * walk it back.
 */
export function undoSongMap(): boolean {
  const h = get(history)
  if (h.past.length === 0) return false
  const current = get(songMap)
  if (!current) return false
  const prev = h.past[h.past.length - 1]!
  history.set({
    past: h.past.slice(0, -1),
    future: [...h.future, current],
  })
  songMap.set(prev)
  return true
}

/** Walk forward past an undo. No-op when `future` is empty. */
export function redoSongMap(): boolean {
  const h = get(history)
  if (h.future.length === 0) return false
  const current = get(songMap)
  if (!current) return false
  const nextState = h.future[h.future.length - 1]!
  history.set({
    past: [...h.past, current],
    future: h.future.slice(0, -1),
  })
  songMap.set(nextState)
  return true
}

/**
 * Apply an immutable update to the current map. On validation failure the store is unchanged.
 * On success the PREVIOUS map is pushed onto the undo stack and the
 * redo stack is cleared (a fresh edit invalidates any forward path).
 */
export function patchSongMap(
  updater: (map: SongMap) => SongMap,
): { ok: true } | { ok: false; errors: string[] } {
  let result: { ok: true } | { ok: false; errors: string[] } = { ok: false, errors: ['No song map loaded'] }
  let prev: SongMap | null = null
  songMap.update((sm) => {
    if (!sm) return sm
    let next = updater(sm)
    const sess = get(audioSession)
    if (sess.file) {
      next = mergeAudioReferenceFromSession(next, sess)
    }
    if (next.cueTrackExport || next.clickTrackExport) {
      const fp = fingerprintCueTrackInputs(next)
      if (next.cueTrackExport && fp !== next.cueTrackExport.fingerprint) {
        next = { ...next, cueTrackExport: undefined }
      }
      if (next.clickTrackExport && fp !== next.clickTrackExport.fingerprint) {
        next = { ...next, clickTrackExport: undefined }
      }
    }
    const v = validateSongMap(next)
    if (!v.ok) {
      result = { ok: false, errors: v.errors }
      return sm
    }
    result = { ok: true }
    prev = sm
    const now = new Date().toISOString()
    return {
      ...next,
      metadata: { ...next.metadata, updatedAt: now },
    }
  })
  if (prev !== null) {
    history.update((h) => {
      const past = [...h.past, prev!]
      if (past.length > MAX_HISTORY) past.shift()
      return { past, future: [] }
    })
  }
  return result
}
