/**
 * Session-scoped cache of PRE-DECODED stem buffers for live mode, so switching
 * to the next song is instant instead of watching its stems decode. The buffers
 * are bound to `MixerEngine`'s single persistent `AudioContext`, so MixerView
 * OWNS the lifetime — it clears this on mount (fresh engine) and unmount (context
 * closed → buffers invalid). The reactive Sets drive the setlist "ready" lights.
 *
 * Pairs with the pure policy in `livePrefetch.ts` (what to decode / evict / fetch).
 */
import { writable } from 'svelte/store'

/** Songs whose stems are fully pre-decoded → an instant switch. */
export const liveReadySongs = writable<Set<string>>(new Set())
/** Songs whose bytes are warmed (cloud IndexedDB) → a quick decode on switch. */
export const liveFetchedSongs = writable<Set<string>>(new Set())

/** songId → (stem laneKey → decoded buffer on the engine's context). NOT reactive. */
const decodedStems = new Map<string, Map<string, AudioBuffer>>()

export function getPreloadedStems(songId: string): Map<string, AudioBuffer> | undefined {
  return decodedStems.get(songId)
}

export function putPreloadedStems(songId: string, stems: Map<string, AudioBuffer>): void {
  if (stems.size === 0) return
  decodedStems.set(songId, stems)
  liveReadySongs.update((s) => (s.has(songId) ? s : new Set(s).add(songId)))
}

export function evictPreloaded(songId: string): void {
  if (!decodedStems.has(songId)) return
  decodedStems.delete(songId)
  liveReadySongs.update((s) => {
    const next = new Set(s)
    next.delete(songId)
    return next
  })
}

export function markFetched(songId: string): void {
  liveFetchedSongs.update((s) => (s.has(songId) ? s : new Set(s).add(songId)))
}

/** Song ids currently holding decoded stems (for the prefetch policy). */
export function decodedSongIds(): Set<string> {
  return new Set(decodedStems.keys())
}

/** Drop everything — call on engine (re)create so no stale-context buffers linger. */
export function clearLiveAudioCache(): void {
  decodedStems.clear()
  liveReadySongs.set(new Set())
  liveFetchedSongs.set(new Set())
}
