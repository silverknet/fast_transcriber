import {
  computeVisualBlockPeaksFromChannels,
  drawBlockPeaksToCanvas,
} from '$lib/audio/waveformBlocks'

/**
 * Compute downsampled visual peaks for a waveform lane over a time range.
 * Returns a flat `[min0, max0, min1, max1, ...]` array of length
 * `2 * bucketCount` ready for canvas rendering.
 *
 * Channel handling: stereo channels are inspected independently so
 * opposite-polarity left/right material does not cancel to silence.
 */
export function computePeaks(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  bucketCount: number,
): Float32Array {
  if (bucketCount <= 0 || buffer.length === 0) return new Float32Array(0)

  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  const sr = buffer.sampleRate
  const i0 = Math.max(0, Math.floor(startSec * sr))
  const i1 = Math.min(buffer.length, Math.max(i0 + 1, Math.ceil(endSec * sr)))
  return computeVisualBlockPeaksFromChannels(ch0, ch1, i0, i1, bucketCount)
}

/**
 * Render `[min, max, min, max, ...]` visual peaks to a canvas as block
 * columns. Color via the canvas's current `strokeStyle`.
 */
export function drawPeaksToCanvas(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  width: number,
  height: number,
): void {
  const ctx = canvas.getContext('2d')
  const fill = typeof ctx?.strokeStyle === 'string' ? ctx.strokeStyle : '#000'
  drawBlockPeaksToCanvas(canvas, peaks, width, height, fill)
}
