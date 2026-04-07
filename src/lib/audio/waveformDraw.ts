function strokeFromCanvasParent(canvas: HTMLCanvasElement): string {
  if (typeof window === 'undefined') return 'rgba(255, 255, 255, 0.88)'
  const parent = canvas.parentElement
  if (!parent) return 'rgba(255, 255, 255, 0.88)'
  const c = getComputedStyle(parent).color
  if (!c || c === 'rgba(0, 0, 0, 0)') return 'rgba(255, 255, 255, 0.88)'
  return c
}

export function drawPeaksToCanvas(canvas: HTMLCanvasElement, peakData: Float32Array, w: number, h: number) {
  if (!canvas || w < 2) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(w * dpr)
  canvas.height = Math.floor(h * dpr)
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const cols = peakData.length / 2
  ctx.strokeStyle = strokeFromCanvasParent(canvas)
  ctx.lineWidth = 1
  ctx.lineCap = 'round'
  ctx.beginPath()

  for (let x = 0; x < cols; x++) {
    const min = peakData[x * 2]
    const max = peakData[x * 2 + 1]
    const y1 = (1 - max) * 0.5 * h
    const y2 = (1 - min) * 0.5 * h
    const xf = x + 0.5
    ctx.moveTo(xf, y1)
    ctx.lineTo(xf, y2)
  }
  ctx.stroke()
}
