export const WAVEFORM_BLOCK_PITCH_PX = 4
export const WAVEFORM_BLOCK_GAP_PX = 1

const WAVEFORM_BLOCK_HEIGHT_STEP_PX = 2
const MAX_SAMPLES_PER_BLOCK = 512

// ── How a block becomes a bar height ─────────────────────────────────────────
// The waveform is a LOUDNESS envelope: each block's level is its RMS. RMS tracks
// perceived loudness, so the bar follows the song's real dynamics (loud chorus
// tall, quiet verse short) instead of collapsing to a flat mean as blocks grow,
// and a single-sample click can't blow a whole block full-height.
//
// This CORE stays ABSOLUTE and stable — the editor relies on steady bar heights
// while panning, and the unit tests pin this per-block shape (spike robustness,
// sustained-vs-quiet, narrow-range). Auto-normalisation (fill-the-height, per
// song) is a SEPARATE step — `normalizeBlockPeaks` — applied only by the
// read-only/live waveform, where the whole clip is always in view so scaling to
// its own robust peak is well-defined and stable.
//
// Chosen empirically: rms → normalise → gamma won a variability-vs-fidelity
// sweep against peak, percentile, dB and local-adaptive methods. It shapes drawn
// pixels only — audio buffers and playback are never touched.
export const WAVEFORM_NORM_PERCENTILE = 0.97 // robust "loudest block" reference
export const WAVEFORM_DYNAMICS_GAMMA = 1.4 // perceptual contrast after normalising

export type BlockWaveformData = {
  peaks: Float32Array
  pitchPx?: number
  offsetPx?: number
}

export function waveformBlockBucketCount(widthPx: number, pitchPx = WAVEFORM_BLOCK_PITCH_PX): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 2
  return Math.max(2, Math.ceil(widthPx / Math.max(1, pitchPx)))
}

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

function sampleMagnitude(ch0: Float32Array, ch1: Float32Array | null, frame: number): number {
  const a = Math.abs(ch0[frame] ?? 0)
  const b = ch1 ? Math.abs(ch1[frame] ?? 0) : 0
  return Math.max(a, b)
}

// RMS loudness of one block. Takes the louder channel per frame so opposite-
// polarity stereo can't cancel to silence. Strided for very large blocks — RMS
// is an average, so subsampling barely moves it.
function blockRms(
  ch0: Float32Array,
  ch1: Float32Array | null,
  frameStart: number,
  frameEnd: number,
): number {
  const start = Math.max(0, Math.min(ch0.length, Math.floor(frameStart)))
  const end = Math.max(start + 1, Math.min(ch0.length, Math.ceil(frameEnd)))
  const stride = Math.max(1, Math.floor((end - start) / MAX_SAMPLES_PER_BLOCK))

  let sumSq = 0
  let count = 0
  for (let frame = start; frame < end; frame += stride) {
    const magnitude = Math.min(1, sampleMagnitude(ch0, ch1, frame))
    sumSq += magnitude * magnitude
    count++
  }

  return count > 0 ? Math.sqrt(sumSq / count) : 0
}

/**
 * Raw, absolute `[min,max,…]` block peaks (symmetric ±RMS per block, lightly
 * de-jittered). Stable and untouched by any gain — the editor draws these
 * directly. For the read-only/live waveform, pass the result through
 * {@link normalizeBlockPeaks} to fill the height per song.
 */
export function computeVisualBlockPeaksFromChannels(
  ch0: Float32Array,
  ch1: Float32Array | null,
  frameStart: number,
  frameEnd: number,
  bucketCount: number,
): Float32Array {
  const buckets = Math.max(2, bucketCount)
  const out = new Float32Array(buckets * 2)
  const start = Math.max(0, Math.min(ch0.length, Math.floor(frameStart)))
  const end = Math.max(start + 1, Math.min(ch0.length, Math.ceil(frameEnd)))
  const frames = end - start
  const raw = new Float32Array(buckets)

  for (let i = 0; i < buckets; i++) {
    const a = start + (i / buckets) * frames
    const b = start + ((i + 1) / buckets) * frames
    raw[i] = blockRms(ch0, ch1, a, b)
  }

  for (let i = 0; i < buckets; i++) {
    const prev = raw[Math.max(0, i - 1)] ?? 0
    const cur = raw[i] ?? 0
    const next = raw[Math.min(buckets - 1, i + 1)] ?? 0
    // Very light neighbour smoothing (de-jitter) — kept small so real detail
    // isn't averaged away. No gain here; that's normalizeBlockPeaks' job.
    const amp = clamp01(prev * 0.04 + cur * 0.92 + next * 0.04)
    out[i * 2] = -amp
    out[i * 2 + 1] = amp
  }

  return out
}

/**
 * Auto-normalise a `[min,max,…]` peak array to the lane's own robust peak
 * (the {@link WAVEFORM_NORM_PERCENTILE}th percentile of block heights) and apply
 * a perceptual gamma. This is what makes a quiet OR a hot master fill the height
 * and show its true dynamic range with no manual gain — the empirically-chosen
 * rms→normalise→gamma pipeline.
 *
 * Use only where the whole clip is in view (the read-only/live waveform). The
 * editor keeps the absolute core so bar heights stay steady while panning.
 * Shapes drawn pixels only — the AudioBuffer and playback are never touched, so
 * this is safe regardless of local-HD vs cloud audio source.
 */
export function normalizeBlockPeaks(
  peaks: Float32Array,
  percentile = WAVEFORM_NORM_PERCENTILE,
  gamma = WAVEFORM_DYNAMICS_GAMMA,
): Float32Array {
  const buckets = Math.floor(peaks.length / 2)
  if (buckets <= 0) return peaks

  const amps = new Float32Array(buckets)
  for (let i = 0; i < buckets; i++) amps[i] = Math.abs(peaks[i * 2 + 1] ?? 0)

  const sorted = Float32Array.from(amps).sort()
  const refIdx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * clamp01(percentile))),
  )
  const ref = sorted[refIdx] ?? 0
  if (ref <= 1e-4) return peaks // silent lane — nothing meaningful to scale

  const norm = 1 / ref
  const out = new Float32Array(peaks.length)
  for (let i = 0; i < buckets; i++) {
    const amp = clamp01(Math.pow(clamp01((peaks[i * 2 + 1] ?? 0) * norm), gamma))
    out[i * 2] = -amp
    out[i * 2 + 1] = amp
  }
  return out
}

export function computeStableVisualBlockPeaksFromChannels(
  ch0: Float32Array,
  ch1: Float32Array | null,
  frameStart: number,
  frameEnd: number,
  widthPx: number,
  _previousFramesPerBlock = 0,
): { waveform: BlockWaveformData; framesPerBlock: number } {
  const start = Math.max(0, Math.min(ch0.length, Math.floor(frameStart)))
  const end = Math.max(start + 1, Math.min(ch0.length, Math.ceil(frameEnd)))
  const visibleFrames = Math.max(1, end - start)
  const visibleBlocks = waveformBlockBucketCount(widthPx)
  const framesPerBlock = visibleFrames / visibleBlocks
  const firstBlockIndex = Math.floor(start / framesPerBlock)
  const firstFrame = Math.max(0, (firstBlockIndex - 2) * framesPerBlock)
  const pitchPx = widthPx / visibleBlocks
  const offsetPx = ((firstFrame - start) / visibleFrames) * widthPx
  const blockCount = visibleBlocks + 6

  const peaks = computeVisualBlockPeaksFromChannels(
    ch0,
    ch1,
    firstFrame,
    firstFrame + blockCount * framesPerBlock,
    blockCount,
  )

  return {
    waveform: { peaks, pitchPx, offsetPx },
    framesPerBlock,
  }
}

export function drawBlockPeaksToCanvas(
  canvas: HTMLCanvasElement,
  peakInput: Float32Array | BlockWaveformData,
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

  const peaks = peakInput instanceof Float32Array ? peakInput : peakInput.peaks
  const buckets = Math.floor(peaks.length / 2)
  if (buckets <= 0) return

  const dataPitch = peakInput instanceof Float32Array ? 0 : peakInput.pitchPx
  const dataOffset = peakInput instanceof Float32Array ? null : peakInput.offsetPx
  const pitch = Math.max(1, Math.round(dataPitch || width / buckets))
  const usedWidth = pitch * buckets
  const offsetX = dataOffset == null ? Math.max(0, Math.floor((width - usedWidth) / 2)) : Math.round(dataOffset)
  const gap = pitch >= 4 ? WAVEFORM_BLOCK_GAP_PX : 0
  const blockW = Math.max(1, pitch - gap)
  const mid = height / 2
  const minH = height >= 32 ? 2 : 1
  const heightStep = height >= 42 ? WAVEFORM_BLOCK_HEIGHT_STEP_PX : 2

  for (let i = 0; i < buckets; i++) {
    const min = Math.max(-1, Math.min(1, peaks[i * 2] ?? 0))
    const max = Math.max(-1, Math.min(1, peaks[i * 2 + 1] ?? 0))
    const yTop = (1 - max) * 0.5 * height
    const yBot = (1 - min) * 0.5 * height
    const rawH = Math.max(0, yBot - yTop)
    const blockH = Math.max(minH, Math.round(rawH / heightStep) * heightStep)
    const center = rawH < minH ? mid : (yTop + yBot) / 2
    const x = offsetX + i * pitch
    if (x > width) break
    if (x + blockW < 0) continue
    ctx.fillRect(x, Math.round(center - blockH / 2), blockW, blockH)
  }
}
