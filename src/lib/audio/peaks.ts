/**
 * Compute downsampled min/max peaks for a single channel of an AudioBuffer
 * over a time range. Returns a flat `[min0, max0, min1, max1, ...]` array
 * of length `2 * bucketCount` ready for canvas rendering.
 *
 * Channel handling: if the buffer has multiple channels, the first channel
 * is summed mono-style with the second (averaged) for a representative
 * peak view. For mono buffers this is just the single channel.
 */
export function computePeaks(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  bucketCount: number,
): Float32Array {
  const out = new Float32Array(bucketCount * 2)
  if (bucketCount <= 0 || buffer.length === 0) return out

  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  const sr = buffer.sampleRate
  const i0 = Math.max(0, Math.floor(startSec * sr))
  const i1 = Math.min(buffer.length, Math.max(i0 + 1, Math.ceil(endSec * sr)))
  const totalSamples = Math.max(1, i1 - i0)
  const samplesPerBucket = totalSamples / bucketCount

  for (let b = 0; b < bucketCount; b++) {
    const sStart = i0 + Math.floor(b * samplesPerBucket)
    const sEnd = Math.min(i1, i0 + Math.floor((b + 1) * samplesPerBucket))
    let min = 0
    let max = 0
    for (let i = sStart; i < sEnd; i++) {
      const s = ch1 ? ((ch0[i] ?? 0) + (ch1[i] ?? 0)) * 0.5 : ch0[i] ?? 0
      if (s < min) min = s
      if (s > max) max = s
    }
    out[b * 2] = min
    out[b * 2 + 1] = max
  }
  return out
}

/**
 * Render `[min, max, min, max, ...]` peaks to a canvas as vertical
 * line strokes. Centered around `height / 2`. Color via the canvas's
 * current `strokeStyle`.
 */
export function drawPeaksToCanvas(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  width: number,
  height: number,
): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(width * dpr))
  canvas.height = Math.max(1, Math.floor(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, width, height)
  ctx.beginPath()
  const mid = height / 2
  const buckets = peaks.length / 2
  for (let b = 0; b < buckets; b++) {
    const x = (b / buckets) * width
    const min = peaks[b * 2] ?? 0
    const max = peaks[b * 2 + 1] ?? 0
    const yTop = mid - max * mid
    const yBot = mid - min * mid
    ctx.moveTo(x + 0.5, yTop)
    ctx.lineTo(x + 0.5, yBot < yTop + 1 ? yTop + 1 : yBot)
  }
  ctx.stroke()
}
