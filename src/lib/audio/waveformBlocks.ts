export const WAVEFORM_BLOCK_PITCH_PX = 4
export const WAVEFORM_BLOCK_GAP_PX = 1

const WAVEFORM_BLOCK_HEIGHT_STEP_PX = 2
const MAX_SAMPLES_PER_BLOCK = 192
const QUANTILE_BINS = 24

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

function blockAmplitude(
  ch0: Float32Array,
  ch1: Float32Array | null,
  frameStart: number,
  frameEnd: number,
  bins: Uint16Array,
): number {
  const start = Math.max(0, Math.min(ch0.length, Math.floor(frameStart)))
  const end = Math.max(start + 1, Math.min(ch0.length, Math.ceil(frameEnd)))
  const stride = Math.max(1, Math.floor((end - start) / MAX_SAMPLES_PER_BLOCK))

  bins.fill(0)
  let sumSq = 0
  let count = 0
  let peak = 0

  for (let frame = start; frame < end; frame += stride) {
    const magnitude = Math.min(1, sampleMagnitude(ch0, ch1, frame))
    sumSq += magnitude * magnitude
    peak = Math.max(peak, magnitude)
    bins[Math.min(QUANTILE_BINS - 1, Math.floor(magnitude * QUANTILE_BINS))]++
    count++
  }

  if (count <= 0) return 0

  const targetRank = Math.max(1, Math.ceil(count * 0.78))
  let seen = 0
  let quantileBin = 0
  for (let i = 0; i < QUANTILE_BINS; i++) {
    seen += bins[i]
    if (seen >= targetRank) {
      quantileBin = i
      break
    }
  }

  const rms = Math.sqrt(sumSq / count)
  const quantile = (quantileBin + 0.5) / QUANTILE_BINS
  const representative = rms * 0.72 + quantile * 0.22 + peak * 0.06

  return clamp01(Math.pow(representative, 1.12))
}

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
  const bins = new Uint16Array(QUANTILE_BINS)
  const raw = new Float32Array(buckets)

  for (let i = 0; i < buckets; i++) {
    const a = start + (i / buckets) * frames
    const b = start + ((i + 1) / buckets) * frames
    raw[i] = blockAmplitude(ch0, ch1, a, b, bins)
  }

  for (let i = 0; i < buckets; i++) {
    const prev = raw[Math.max(0, i - 1)] ?? 0
    const cur = raw[i] ?? 0
    const next = raw[Math.min(buckets - 1, i + 1)] ?? 0
    const amp = clamp01(prev * 0.06 + cur * 0.88 + next * 0.06)
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
