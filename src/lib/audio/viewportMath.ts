import type { TimeRange } from '$lib/types/timeline'

export const MIN_VIEW_SPAN_SEC = 0.05

export function clampViewportToTimeline(
  timelineSec: number,
  start: number,
  end: number,
  minSpan = MIN_VIEW_SPAN_SEC,
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

export function moveViewport(timelineSec: number, viewStart: number, viewEnd: number, deltaSec: number): TimeRange {
  let vs = viewStart + deltaSec
  let ve = viewEnd + deltaSec
  if (vs < 0) {
    ve -= vs
    vs = 0
  }
  if (ve > timelineSec) {
    vs -= ve - timelineSec
    ve = timelineSec
  }
  if (vs < 0) vs = 0
  return clampViewportToTimeline(timelineSec, vs, ve)
}

export function resizeViewportLeft(
  timelineSec: number,
  viewStart: number,
  viewEnd: number,
  nextLeftSec: number,
): TimeRange {
  if (!(timelineSec > 0) || !Number.isFinite(viewEnd) || !Number.isFinite(nextLeftSec)) {
    return clampViewportToTimeline(timelineSec, viewStart, viewEnd)
  }
  const minLen = Math.max(0.001, MIN_VIEW_SPAN_SEC)
  const fixedRight = Math.max(0, Math.min(viewEnd, timelineSec))
  const minLeft = 0
  const maxLeft = fixedRight - minLen
  const clampedLeft = Math.max(minLeft, Math.min(nextLeftSec, maxLeft))
  return { start: clampedLeft, end: fixedRight }
}

export function resizeViewportRight(
  timelineSec: number,
  viewStart: number,
  viewEnd: number,
  nextRightSec: number,
): TimeRange {
  if (!(timelineSec > 0) || !Number.isFinite(viewStart) || !Number.isFinite(nextRightSec)) {
    return clampViewportToTimeline(timelineSec, viewStart, viewEnd)
  }
  const minLen = Math.max(0.001, MIN_VIEW_SPAN_SEC)
  const fixedLeft = Math.max(0, Math.min(viewStart, timelineSec))
  const minRight = fixedLeft + minLen
  const maxRight = timelineSec
  const clampedRight = Math.max(minRight, Math.min(nextRightSec, maxRight))
  return { start: fixedLeft, end: clampedRight }
}

export function recenterViewport(
  timelineSec: number,
  viewStart: number,
  viewEnd: number,
  centerSec: number,
): TimeRange {
  const span = Math.max(MIN_VIEW_SPAN_SEC, viewEnd - viewStart)
  return moveViewport(timelineSec, centerSec - span * 0.5, centerSec + span * 0.5, 0)
}

export function zoomViewportWithAnchor(
  timelineSec: number,
  viewStart: number,
  viewEnd: number,
  factor: number,
  anchorSec: number,
): TimeRange {
  if (!(factor > 0)) return clampViewportToTimeline(timelineSec, viewStart, viewEnd)
  const span = Math.max(MIN_VIEW_SPAN_SEC, viewEnd - viewStart)
  const newSpan = Math.max(MIN_VIEW_SPAN_SEC, Math.min(timelineSec, span * factor))
  const anchorFrac = span > 0 ? (anchorSec - viewStart) / span : 0.5
  const nextStart = anchorSec - anchorFrac * newSpan
  const nextEnd = nextStart + newSpan
  return clampViewportToTimeline(timelineSec, nextStart, nextEnd)
}
