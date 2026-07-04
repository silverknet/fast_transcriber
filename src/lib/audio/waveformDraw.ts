import { drawBlockPeaksToCanvas } from '$lib/audio/waveformBlocks'

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
  drawBlockPeaksToCanvas(canvas, peakData, w, h, strokeFromCanvasParent(canvas))
}
