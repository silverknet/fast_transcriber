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
  batchDepth = 0
  batchStartState = null
  songMap.set(map)
}

export function clearSongMap() {
  history.set({ past: [], future: [] })
  batchDepth = 0
  batchStartState = null
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
 * Coalesce a sequence of `patchSongMap` calls into a single history
 * entry. Used by the drag handlers in the bar strip / waveform so a
 * pointer drag from boundary X to boundary Y produces ONE undo step,
 * not one per pointermove frame.
 *
 * Usage:
 *
 *   beginPatchBatch()
 *   try {
 *     // ... many patchSongMap(...) calls
 *   } finally {
 *     endPatchBatch()
 *   }
 *
 * Nested batches share the outermost batch — the stack only commits
 * once per outermost `endPatchBatch()`. While a batch is active,
 * intermediate patches update the store but do NOT push to history;
 * the redo stack is cleared on first patch (consistent with single
 * patches). On `endPatchBatch`, the PRE-BATCH state goes onto the
 * undo stack as ONE entry.
 */
let batchDepth = 0
let batchStartState: SongMap | null = null

export function beginPatchBatch(): void {
  if (batchDepth === 0) {
    batchStartState = get(songMap)
  }
  batchDepth++
}

export function endPatchBatch(): void {
  if (batchDepth === 0) return
  batchDepth--
  if (batchDepth !== 0) return
  const start = batchStartState
  batchStartState = null
  const current = get(songMap)
  // Push only when the batch actually moved the map. No-op batches
  // (start === current) leave history untouched.
  if (start && current && start !== current) {
    history.update((h) => {
      const past = [...h.past, start]
      if (past.length > MAX_HISTORY) past.shift()
      return { past, future: [] }
    })
  }
}

/**
 * Apply an immutable update to the current map. On validation failure the store is unchanged.
 * On success the PREVIOUS map is pushed onto the undo stack and the
 * redo stack is cleared (a fresh edit invalidates any forward path).
 *
 * While a `beginPatchBatch()` is active, the per-patch history push is
 * suppressed — `endPatchBatch()` pushes ONE entry for the whole batch.
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
    if (batchDepth > 0) {
      // Inside a batch: don't push per-patch entries. The future stack
      // still clears, since any patch invalidates redo regardless.
      history.update((h) => ({ past: h.past, future: [] }))
    } else {
      history.update((h) => {
        const past = [...h.past, prev!]
        if (past.length > MAX_HISTORY) past.shift()
        return { past, future: [] }
      })
    }
  }
  return result
}
