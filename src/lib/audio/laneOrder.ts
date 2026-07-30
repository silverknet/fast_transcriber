/**
 * Mixer lane ORDER — which row sits above which.
 *
 * The order is simply the order of `mixState.tracks` in the `.smap`; nothing
 * reads that array positionally (every other lookup is by key), so dragging a
 * row to a new position needs no extra schema field.
 *
 * Three rules keep it stable and predictable:
 *   - the ORIGINAL full mix is pinned to the top and cannot be dragged or
 *     displaced — it is the song itself, the reference every other lane is
 *     heard against, so it should never go hunting for it
 *   - a track the song remembers keeps its saved position
 *   - a track the song has never seen (a stem that just finished rendering, a
 *     generated band track) lands at the BOTTOM, in its natural order, rather
 *     than silently jumping into the middle of someone's arrangement
 *
 * Pure — no engine, no Svelte.
 */

/** Lanes that are fixed at the top, in this order, and never reorderable. */
export const PINNED_LANE_KEYS: readonly string[] = ['original']

/** Can this lane be dragged to a new position? */
export function isLaneReorderable(key: string): boolean {
  return !PINNED_LANE_KEYS.includes(key)
}

/**
 * Order `keys` by a remembered key order. Pinned lanes come first whatever the
 * saved order says; then keys in `savedOrder`, in that order; then anything
 * unknown, keeping its relative order. Saved keys that no longer exist are
 * ignored.
 */
export function sortBySavedOrder(
  keys: readonly string[],
  savedOrder: readonly string[],
): string[] {
  const present = new Set(keys)
  const seen = new Set<string>()
  const out: string[] = []
  const take = (k: string) => {
    if (!present.has(k) || seen.has(k)) return
    out.push(k)
    seen.add(k)
  }
  for (const k of PINNED_LANE_KEYS) take(k)
  for (const k of savedOrder) take(k)
  for (const k of keys) take(k)
  return out
}

/**
 * Move `fromKey` to where `toKey` currently sits, shifting the rest. Returns a
 * new array; the input is untouched.
 *
 * A no-op when either key is missing, when they are the same, or when either
 * side is a pinned lane — so no drag can drop a track above the original, and
 * the original itself cannot be dragged away from the top.
 */
export function moveKey(keys: readonly string[], fromKey: string, toKey: string): string[] {
  if (fromKey === toKey) return [...keys]
  if (!isLaneReorderable(fromKey) || !isLaneReorderable(toKey)) return [...keys]
  const from = keys.indexOf(fromKey)
  const to = keys.indexOf(toKey)
  if (from < 0 || to < 0) return [...keys]
  const out = [...keys]
  out.splice(from, 1)
  out.splice(to, 0, fromKey)
  return out
}
