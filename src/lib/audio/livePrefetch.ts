/**
 * Pure prefetch POLICY for live mode — decides, from the setlist + where you are
 * in it, which songs to pre-DECODE (so the next switch is instant), which to
 * EVICT (so RAM stays bounded), and which bytes to background-FETCH (so no song
 * ever waits on the network). No engine, no DOM, no I/O — just the plan. The
 * MixerView wiring executes it.
 *
 * Why a window and not "decode everything": a decoded stem set is ~0.4-0.5 GB,
 * so a full set held decoded is 5-10 GB → the tab OOMs. We keep only the current
 * + next `window` songs decoded-resident and evict the rest.
 */

/** How warmed a song is, for the setlist "ready" light. */
export type ReadyState =
  | 'cold' // nothing local — a full fetch + decode on switch
  | 'fetched' // bytes are local (cloud IDB / disk) — a quick decode on switch
  | 'ready' // fully pre-decoded — instant switch

export type PrefetchPlan = {
  /** Song ids to pre-decode now, nearest-first (current first, then upcoming). */
  decode: string[]
  /** Decoded-resident song ids to drop (outside the keep window) — frees RAM. */
  evict: string[]
  /** Song ids whose bytes to warm, nearest-first, not yet fetched (whole set). */
  fetch: string[]
}

/** Nearest-first order of setlist indices around `current` (ties prefer forward). */
function nearestFirst(count: number, current: number): number[] {
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => {
    const da = Math.abs(a - current)
    const db = Math.abs(b - current)
    if (da !== db) return da - db
    // Same distance → the upcoming song wins over the previous one.
    const fa = a >= current ? 0 : 1
    const fb = b >= current ? 0 : 1
    return fa - fb
  })
}

/**
 * The set of song ids kept fully DECODED: the current song plus the next
 * `window` (default 1 → {current, next}). Clamped to the setlist; never exceeds
 * `maxDecoded`.
 */
export function decodedKeepSet(
  setlist: readonly string[],
  currentIndex: number,
  window = 1,
  maxDecoded = window + 1,
): string[] {
  if (currentIndex < 0 || currentIndex >= setlist.length) return []
  const keep: string[] = []
  for (let i = currentIndex; i <= currentIndex + window && i < setlist.length; i += 1) {
    if (keep.length >= maxDecoded) break
    keep.push(setlist[i]!)
  }
  return keep
}

export function prefetchPlan(opts: {
  setlist: readonly string[]
  currentIndex: number
  /** Song ids currently decoded-resident. */
  decoded: Iterable<string>
  /** Song ids whose bytes are already warmed (cloud IDB / local disk). */
  fetched: Iterable<string>
  window?: number
  maxDecoded?: number
}): PrefetchPlan {
  const { setlist, currentIndex, window = 1 } = opts
  const maxDecoded = opts.maxDecoded ?? window + 1
  const decoded = new Set(opts.decoded)
  const fetched = new Set(opts.fetched)

  const keep = new Set(decodedKeepSet(setlist, currentIndex, window, maxDecoded))

  // Decode the keep-set songs not yet resident, nearest-first.
  const decode = nearestFirst(setlist.length, currentIndex)
    .map((i) => setlist[i]!)
    .filter((id) => keep.has(id) && !decoded.has(id))

  // Evict anything decoded that's outside the keep window.
  const evict = [...decoded].filter((id) => !keep.has(id))

  // Warm every song's bytes, nearest-first, that isn't warmed yet.
  const fetch = nearestFirst(setlist.length, currentIndex)
    .map((i) => setlist[i]!)
    .filter((id) => !fetched.has(id))

  return { decode, evict, fetch }
}

export function readyState(
  songId: string,
  decoded: ReadonlySet<string>,
  fetched: ReadonlySet<string>,
): ReadyState {
  if (decoded.has(songId)) return 'ready'
  if (fetched.has(songId)) return 'fetched'
  return 'cold'
}
