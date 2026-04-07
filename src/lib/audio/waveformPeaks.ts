/** Min/max sample in a range across all channels (avoids stereo L+R averaging cancelling to silence). */
function sampleMinMax(ch0: Float32Array, ch1: Float32Array | null, j: number): { min: number; max: number } {
  let min = ch0[j]
  let max = ch0[j]
  if (ch1) {
    const b = ch1[j]
    if (b < min) min = b
    if (b > max) max = b
  }
  return { min, max }
}

export function computePeaks(buf: AudioBuffer, bucketCount: number) {
  const ch0 = buf.getChannelData(0)
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null
  const len = ch0.length
  const buckets = Math.max(2, bucketCount)
  const out = new Float32Array(buckets * 2)

  for (let i = 0; i < buckets; i++) {
    const t0 = Math.floor((i / buckets) * len)
    const t1 = Math.max(t0 + 1, Math.floor(((i + 1) / buckets) * len))
    let min = 0
    let max = 0
    let first = true
    for (let j = t0; j < t1; j++) {
      const { min: a, max: b } = sampleMinMax(ch0, ch1, j)
      if (first) {
        min = a
        max = b
        first = false
      } else {
        if (a < min) min = a
        if (b > max) max = b
      }
    }
    out[i * 2] = min
    out[i * 2 + 1] = max
  }
  return out
}

export function computePeaksForTimeRange(
  buf: AudioBuffer,
  timeStartSec: number,
  timeEndSec: number,
  bucketCount: number,
) {
  const ch0 = buf.getChannelData(0)
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null
  const nFrames = ch0.length
  const sr = buf.sampleRate
  const dur = buf.duration
  const t0 = Math.max(0, Math.min(timeStartSec, dur))
  const t1 = Math.max(t0, Math.min(timeEndSec, dur))
  const iStart = Math.min(nFrames - 1, Math.max(0, Math.floor(t0 * sr)))
  const iEnd = Math.min(nFrames, Math.max(iStart + 1, Math.ceil(t1 * sr)))
  const segLen = iEnd - iStart
  const buckets = Math.max(2, bucketCount)
  const out = new Float32Array(buckets * 2)

  for (let i = 0; i < buckets; i++) {
    const relA = Math.floor((i / buckets) * segLen)
    const relB = Math.max(relA + 1, Math.floor(((i + 1) / buckets) * segLen))
    const a = iStart + relA
    const b = iStart + relB
    const bClamped = Math.min(b, iEnd)
    let min = 0
    let max = 0
    let first = true
    for (let j = a; j < bClamped; j++) {
      const { min: lo, max: hi } = sampleMinMax(ch0, ch1, j)
      if (first) {
        min = lo
        max = hi
        first = false
      } else {
        if (lo < min) min = lo
        if (hi > max) max = hi
      }
    }
    out[i * 2] = min
    out[i * 2 + 1] = max
  }
  return out
}
