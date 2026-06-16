/**
 * Undo / redo history on the `songMap` store.
 *
 * We test the user-facing flow: edit → undo restores the previous map;
 * edit → redo walks back the undo; load a different song → history
 * resets; an invalid patch doesn't push noise onto the stack; the
 * history cap kicks in when the past grows.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  canRedo,
  canUndo,
  clearSongMap,
  patchSongMap,
  redoSongMap,
  setSongMap,
  songMap,
  undoSongMap,
} from './songMap'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { SongMap } from '$lib/songmap/types'

function fresh(): SongMap {
  return createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
}

beforeEach(() => {
  clearSongMap()
})

describe('songMap undo / redo', () => {
  it('starts with no undo or redo available', () => {
    setSongMap(fresh())
    expect(get(canUndo)).toBe(false)
    expect(get(canRedo)).toBe(false)
  })

  it('a successful patch enables undo', () => {
    setSongMap(fresh())
    const r = patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'A' } }))
    expect(r.ok).toBe(true)
    expect(get(canUndo)).toBe(true)
    expect(get(canRedo)).toBe(false)
    expect(get(songMap)!.metadata.title).toBe('A')
  })

  it('undo restores the previous map', () => {
    setSongMap(fresh())
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'A' } }))
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'B' } }))
    expect(get(songMap)!.metadata.title).toBe('B')
    undoSongMap()
    expect(get(songMap)!.metadata.title).toBe('A')
    expect(get(canRedo)).toBe(true)
    undoSongMap()
    expect(get(songMap)!.metadata.title).toBe('Untitled') // empty map default
    expect(get(canUndo)).toBe(false)
  })

  it('redo walks back an undo', () => {
    setSongMap(fresh())
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'A' } }))
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'B' } }))
    undoSongMap()
    expect(get(songMap)!.metadata.title).toBe('A')
    redoSongMap()
    expect(get(songMap)!.metadata.title).toBe('B')
    expect(get(canRedo)).toBe(false)
  })

  it('a fresh edit after undo clears the redo stack', () => {
    setSongMap(fresh())
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'A' } }))
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'B' } }))
    undoSongMap()
    expect(get(canRedo)).toBe(true)
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'C' } }))
    expect(get(canRedo)).toBe(false)
  })

  it('failed patch does not push noise onto the undo stack', () => {
    setSongMap(fresh())
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'A' } }))
    // Invalid update: drop the formatVersion (validator will reject).
    const r = patchSongMap((m) => {
      const { formatVersion: _, ...rest } = m
      return rest as SongMap
    })
    expect(r.ok).toBe(false)
    // The undo stack still holds exactly one entry from the successful
    // patch — the failed one didn't push.
    expect(get(canUndo)).toBe(true)
    undoSongMap()
    expect(get(canUndo)).toBe(false)
  })

  it('setSongMap resets history (loading a different song)', () => {
    setSongMap(fresh())
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'A' } }))
    expect(get(canUndo)).toBe(true)
    // Load a brand-new song. History should reset — we don't want to
    // undo into the previous project.
    setSongMap(fresh())
    expect(get(canUndo)).toBe(false)
    expect(get(canRedo)).toBe(false)
  })

  it('clearSongMap resets history', () => {
    setSongMap(fresh())
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: 'A' } }))
    expect(get(canUndo)).toBe(true)
    clearSongMap()
    expect(get(canUndo)).toBe(false)
    expect(get(canRedo)).toBe(false)
  })

  it('caps the history stack — oldest entries drop when full', () => {
    setSongMap(fresh())
    // 105 patches → cap (100) kicks in; only the latest 100 stay reachable.
    for (let i = 0; i < 105; i++) {
      patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: `n${i}` } }))
    }
    // Pop the entire stack. We should be able to undo exactly 100 times.
    let undoCount = 0
    while (undoSongMap()) undoCount++
    expect(undoCount).toBe(100)
    // After 100 undos we land at the OLDEST kept state — `n4`, the
    // post-state of patch #5 (= the state stashed when patch #6 ran).
    // The earlier 5 states fell off the back of the cap.
    expect(get(songMap)!.metadata.title).toBe('n4')
  })
})
