import { timeToPxInView } from './timeGeometry'

const HANDLE_HIT_HALF_PX = 16
const HANDLE_CORE_HALF_PX = 8
const VIEWPORT_HANDLE_HIT_HALF_PX = 12
const VIEWPORT_HANDLE_CORE_HALF_PX = 6

export type HitTarget = 'left-handle' | 'right-handle' | 'body' | 'outside'

export function hitTestSelectionTarget(
  xContentPx: number,
  rangeStart: number,
  rangeEnd: number,
  viewStart: number,
  viewEnd: number,
  waveWidthPx: number,
): HitTarget {
  const span = viewEnd - viewStart
  if (!(span > 0) || !(waveWidthPx > 0)) return 'outside'

  const leftPx = timeToPxInView(rangeStart, viewStart, viewEnd, waveWidthPx)
  const rightPx = timeToPxInView(rangeEnd, viewStart, viewEnd, waveWidthPx)
  const lo = Math.min(leftPx, rightPx)
  const hi = Math.max(leftPx, rightPx)
  const spanPx = hi - lo
  const midPx = (leftPx + rightPx) * 0.5
  const dL = Math.abs(xContentPx - leftPx)
  const dR = Math.abs(xContentPx - rightPx)
  const inSelection = xContentPx >= lo && xContentPx <= hi

  const nearLeftCore = dL <= HANDLE_CORE_HALF_PX && xContentPx <= midPx
  const nearRightCore = dR <= HANDLE_CORE_HALF_PX && xContentPx > midPx
  if (nearLeftCore) return 'left-handle'
  if (nearRightCore) return 'right-handle'

  const bodyInset = Math.min(HANDLE_CORE_HALF_PX, Math.max(1, spanPx * 0.2))
  const bodyL = lo + bodyInset
  const bodyR = hi - bodyInset
  const inBody = inSelection && bodyL <= bodyR && xContentPx >= bodyL && xContentPx <= bodyR
  if (inBody) return 'body'

  let nearL = dL <= HANDLE_HIT_HALF_PX && xContentPx <= hi
  let nearR = dR <= HANDLE_HIT_HALF_PX && xContentPx >= lo
  if (nearL && nearR) {
    if (dL <= dR) nearR = false
    else nearL = false
  }
  if (nearL) return 'left-handle'
  if (nearR) return 'right-handle'
  if (inSelection) return 'body'
  return 'outside'
}

export function hitTestViewportTarget(
  xPx: number,
  viewStart: number,
  viewEnd: number,
  timelineSec: number,
  minimapWidthPx: number,
): HitTarget {
  if (!(timelineSec > 0) || !(minimapWidthPx > 0)) return 'outside'
  const leftPx = (Math.max(0, Math.min(viewStart, timelineSec)) / timelineSec) * minimapWidthPx
  const rightPx = (Math.max(0, Math.min(viewEnd, timelineSec)) / timelineSec) * minimapWidthPx
  const lo = Math.min(leftPx, rightPx)
  const hi = Math.max(leftPx, rightPx)
  const midPx = (leftPx + rightPx) * 0.5
  const dL = Math.abs(xPx - leftPx)
  const dR = Math.abs(xPx - rightPx)
  const nearLeftCore = dL <= VIEWPORT_HANDLE_CORE_HALF_PX && xPx <= midPx
  const nearRightCore = dR <= VIEWPORT_HANDLE_CORE_HALF_PX && xPx > midPx
  if (nearLeftCore) return 'left-handle'
  if (nearRightCore) return 'right-handle'

  if (xPx >= lo && xPx <= hi) {
    const spanPx = hi - lo
    const bodyInset = Math.min(VIEWPORT_HANDLE_CORE_HALF_PX, Math.max(1, spanPx * 0.15))
    if (xPx >= lo + bodyInset && xPx <= hi - bodyInset) return 'body'
  }

  if (dL <= VIEWPORT_HANDLE_HIT_HALF_PX && dL <= dR) return 'left-handle'
  if (dR <= VIEWPORT_HANDLE_HIT_HALF_PX && dR < dL) return 'right-handle'
  if (xPx >= lo && xPx <= hi) return 'body'
  return 'outside'
}
