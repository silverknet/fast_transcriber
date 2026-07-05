import {
  computeStableVisualBlockPeaksFromChannels,
  computeVisualBlockPeaksFromChannels,
} from '$lib/audio/waveformBlocks'

export function computePeaks(buf: AudioBuffer, bucketCount: number) {
  const ch0 = buf.getChannelData(0)
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null
  return computeVisualBlockPeaksFromChannels(ch0, ch1, 0, ch0.length, bucketCount)
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
  return computeVisualBlockPeaksFromChannels(ch0, ch1, iStart, iEnd, bucketCount)
}

export function computeStablePeaksForTimeRange(
  buf: AudioBuffer,
  timeStartSec: number,
  timeEndSec: number,
  widthPx: number,
  previousFramesPerBlock = 0,
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
  return computeStableVisualBlockPeaksFromChannels(ch0, ch1, iStart, iEnd, widthPx, previousFramesPerBlock)
}
