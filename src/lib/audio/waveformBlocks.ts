export const WAVEFORM_BLOCK_PITCH_PX = 4
export const WAVEFORM_BLOCK_GAP_PX = 1

export function waveformBlockBucketCount(widthPx: number, pitchPx = WAVEFORM_BLOCK_PITCH_PX): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 2
  return Math.max(2, Math.ceil(widthPx / Math.max(1, pitchPx)))
}

export function drawBlockPeaksToCanvas(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  width: number,
  height: number,
  fillStyle: string,
): void {
  if (!canvas || width < 2 || height < 2) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(width * dpr))
  canvas.height = Math.max(1, Math.floor(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = fillStyle

  const buckets = Math.floor(peaks.length / 2)
  if (buckets <= 0) return

  const colW = width / buckets
  const gap = colW >= 3 ? Math.min(WAVEFORM_BLOCK_GAP_PX, colW * 0.28) : 0
  const blockW = Math.max(1, Math.round(colW - gap))
  const mid = height / 2
  const minH = height >= 32 ? 2 : 1

  for (let i = 0; i < buckets; i++) {
    const min = Math.max(-1, Math.min(1, peaks[i * 2] ?? 0))
    const max = Math.max(-1, Math.min(1, peaks[i * 2 + 1] ?? 0))
    const yTop = (1 - max) * 0.5 * height
    const yBot = (1 - min) * 0.5 * height
    const rawH = Math.max(0, yBot - yTop)
    const blockH = Math.max(minH, Math.round(rawH))
    const x = Math.round(i * colW + gap * 0.5)
    const y = Math.round(rawH < minH ? mid - blockH / 2 : yTop)
    ctx.fillRect(x, y, blockW, blockH)
  }
}
