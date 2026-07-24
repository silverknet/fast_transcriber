/**
 * Process-wide cache of desktop TTS results, keyed by the SPOKEN TEXT.
 *
 * A spoken word ("Chorus", "one", the song title) only needs the sidecar once —
 * it never changes unless the text itself changes. Positioning/linking of cues
 * is pure frontend, so moving a section, retiming bars, etc. re-lays-out cues
 * from ALREADY-cached word audio without touching the sidecar. The sidecar is
 * hit only for genuinely new text (a renamed section, a new custom cue).
 */
import { fetchDesktopTtsSynthesizeWav, type TtsSynthesizeResult } from '$lib/client/desktopBridge'

const MAX_ENTRIES = 256
const cache = new Map<string, Blob>()

/** TTS for `text`, served from cache when the same words were synthesized before. */
export async function fetchTtsWavCached(text: string): Promise<TtsSynthesizeResult> {
  const key = text.trim()
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key) // refresh LRU position
    cache.set(key, hit)
    return { ok: true, blob: hit }
  }
  const r = await fetchDesktopTtsSynthesizeWav(key)
  if (r.ok) {
    cache.set(key, r.blob)
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  return r
}

/** Test/utility: forget everything. */
export function clearTtsCache(): void {
  cache.clear()
}
