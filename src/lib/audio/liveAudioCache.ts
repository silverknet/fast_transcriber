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

/**
 * How many songs may hold decoded stems at once — current, next, one behind.
 *
 * This was UNBOUNDED, and it took down a real rig: a browsing session kept
 * every visited song's decoded buffers (~0.5 GB per 6-minute song) until the
 * tab refused allocations — "createBuffer failed", stems silently missing on
 * the longest song of the set. Instant switches are promised for the
 * NEIGHBORHOOD you're playing in, not for the whole setlist; nobody's RAM
 * affords twelve decoded songs, and a dead tab is slower than any decode.
 */
export const PRELOADED_SONG_CAP = 3

export function getPreloadedStems(songId: string): Map<string, AudioBuffer> | undefined {
  const hit = decodedStems.get(songId)
  if (hit) {
    // Refresh recency: the song being OPENED must never be the next eviction.
    decodedStems.delete(songId)
    decodedStems.set(songId, hit)
  }
  return hit
}

export function putPreloadedStems(songId: string, stems: Map<string, AudioBuffer>): void {
  if (stems.size === 0) return
  decodedStems.delete(songId) // re-insert at the recent end
  decodedStems.set(songId, stems)
  liveReadySongs.update((s) => (s.has(songId) ? s : new Set(s).add(songId)))
  while (decodedStems.size > PRELOADED_SONG_CAP) {
    const oldest = decodedStems.keys().next().value
    if (oldest === undefined) break
    evictPreloaded(oldest) // keeps the "ready" lights truthful
  }
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

// ── Rendered click tracks ────────────────────────────────────────────────────
//
// The click is synthesized (an offline render of the whole song), and it was
// re-synthesized on every mixer mount and every song switch — seconds of work
// producing bit-identical samples. Keyed by the click fingerprint (which
// already encodes count-in, start beat, grid and cue-track inputs) plus sample
// rate, so any musical change naturally misses.
const clickRenders = new Map<string, { data: Float32Array; preludeOffsetSec: number }>()

export function getCachedClickRender(
  key: string,
): { data: Float32Array; preludeOffsetSec: number } | undefined {
  return clickRenders.get(key)
}

export function putCachedClickRender(
  key: string,
  render: { data: Float32Array; preludeOffsetSec: number },
): void {
  // A handful of full-length mono tracks is tens of MB — bound it.
  if (clickRenders.size >= 6) {
    const oldest = clickRenders.keys().next().value
    if (oldest !== undefined) clickRenders.delete(oldest)
  }
  clickRenders.set(key, render)
}
