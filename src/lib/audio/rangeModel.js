/**
 * Keeps selection [start, end] valid relative to timeline duration.
 */

const MIN_LEN = 0.05

/**
 * @param {number} duration
 * @param {number} start
 * @param {number} end
 */
export function clampRangeToDuration(duration, start, end) {
  if (!(duration > 0) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { start: 0, end: Math.max(0, duration) }
  }
  let s = Math.min(start, end)
  let e = Math.max(start, end)
  s = Math.max(0, Math.min(s, duration))
  e = Math.max(0, Math.min(e, duration))
  if (e - s < MIN_LEN) {
    e = Math.min(duration, s + MIN_LEN)
  }
  if (e <= s) {
    e = Math.min(duration, s + MIN_LEN)
  }
  return { start: s, end: e }
}

/**
 * After duration changes (e.g. metadata), clamp existing range.
 * @param {number} duration
 * @param {number} start
 * @param {number} end
 */
export function reconcileRangeAfterDurationChange(duration, start, end) {
  return clampRangeToDuration(duration, start, end)
}
