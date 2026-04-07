import type { TimeRange } from '$lib/types/timeline'

export const MIN_SELECTION_SPAN_SEC = 0.05

export function clampSelectionToTimeline(
  timelineSec: number,
  start: number,
  end: number,
  minSpan = MIN_SELECTION_SPAN_SEC,
): TimeRange {
  if (!(timelineSec > 0) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { start: 0, end: Math.max(0, timelineSec) }
  }
  const minLen = Math.max(0.001, minSpan)
  let s = Math.min(start, end)
  let e = Math.max(start, end)
  s = Math.max(0, Math.min(s, timelineSec))
  e = Math.max(0, Math.min(e, timelineSec))
  if (e - s < minLen) e = Math.min(timelineSec, s + minLen)
  if (e - s < minLen) s = Math.max(0, e - minLen)
  return { start: s, end: e }
}

export function moveSelection(timelineSec: number, start: number, end: number, deltaSec: number): TimeRange {
  const len = Math.max(0, end - start)
  let ns = start + deltaSec
  let ne = end + deltaSec
  if (ns < 0) {
    ns = 0
    ne = len
  }
  if (ne > timelineSec) {
    ne = timelineSec
    ns = timelineSec - len
  }
  return clampSelectionToTimeline(timelineSec, ns, ne)
}

export function resizeSelectionLeft(
  timelineSec: number,
  start: number,
  end: number,
  nextLeftSec: number,
): TimeRange {
  if (!(timelineSec > 0) || !Number.isFinite(end) || !Number.isFinite(nextLeftSec)) {
    return clampSelectionToTimeline(timelineSec, start, end)
  }
  const minLen = Math.max(0.001, MIN_SELECTION_SPAN_SEC)
  const fixedRight = Math.max(0, Math.min(end, timelineSec))
  const minLeft = Math.max(0, fixedRight - timelineSec)
  const maxLeft = fixedRight - minLen
  const clampedLeft = Math.max(minLeft, Math.min(nextLeftSec, maxLeft))
  return { start: clampedLeft, end: fixedRight }
}

export function resizeSelectionRight(
  timelineSec: number,
  start: number,
  end: number,
  nextRightSec: number,
): TimeRange {
  if (!(timelineSec > 0) || !Number.isFinite(start) || !Number.isFinite(nextRightSec)) {
    return clampSelectionToTimeline(timelineSec, start, end)
  }
  const minLen = Math.max(0.001, MIN_SELECTION_SPAN_SEC)
  const fixedLeft = Math.max(0, Math.min(start, timelineSec))
  const minRight = fixedLeft + minLen
  const maxRight = timelineSec
  const clampedRight = Math.max(minRight, Math.min(nextRightSec, maxRight))
  return { start: fixedLeft, end: clampedRight }
}
