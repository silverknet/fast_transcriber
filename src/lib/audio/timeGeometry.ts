export function timeToPx(t: number, duration: number, waveWidthPx: number) {
  if (!(duration > 0) || !(waveWidthPx > 0) || !Number.isFinite(t)) return 0
  return (Math.max(0, Math.min(t, duration)) / duration) * waveWidthPx
}

export function timeToPxInView(t: number, viewStart: number, viewEnd: number, waveWidthPx: number) {
  const span = viewEnd - viewStart
  if (!(span > 0) || !(waveWidthPx > 0) || !Number.isFinite(t)) return 0
  const clamped = Math.max(viewStart, Math.min(t, viewEnd))
  return ((clamped - viewStart) / span) * waveWidthPx
}

export function clientXToContentX(clientX: number, scrollEl: HTMLElement) {
  const rect = scrollEl.getBoundingClientRect()
  return clientX - rect.left + scrollEl.scrollLeft
}

export function clientXToTime(clientX: number, scrollEl: HTMLElement, waveWidthPx: number, duration: number) {
  if (!(duration > 0) || !(waveWidthPx > 0)) return 0
  const xInContent = clientXToContentX(clientX, scrollEl)
  const frac = Math.max(0, Math.min(1, xInContent / waveWidthPx))
  return frac * duration
}

export function clientXToTimeInView(
  clientX: number,
  scrollEl: HTMLElement,
  waveWidthPx: number,
  viewStart: number,
  viewEnd: number,
) {
  const span = viewEnd - viewStart
  if (!(span > 0) || !(waveWidthPx > 0)) return viewStart
  const xInContent = clientXToContentX(clientX, scrollEl)
  const frac = Math.max(0, Math.min(1, xInContent / waveWidthPx))
  return viewStart + frac * span
}

export function clampTime(t: number, max: number) {
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.min(t, max))
}
