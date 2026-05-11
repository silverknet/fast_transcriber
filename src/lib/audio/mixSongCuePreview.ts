/**
 * Offline mix: trimmed reference (mono sum) + generated cue WAV for headphone preview.
 * Timeline matches the cue file: length = cue buffer frames / sample rate.
 */
import type { BeatClickPoint } from '$lib/audio/debugClickTrack'
import { computeCountIn } from '$lib/audio/computeCountIn'
import { audioBufferToWavBlob } from '$lib/audio/trimAudio'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { SongMap } from '$lib/songmap/types'

const END_EPS = 0.028

/**
 * Click times on the **mix** timeline (0 = start of the mixed preview / cue file):
 * `prependSec + (beat.timeSec - trimStart)` for beats inside the trim window.
 */
export function mixTimelineClickPoints(
  sm: SongMap,
  trimStart: number,
  trimEnd: number,
  prependSec: number,
): BeatClickPoint[] {
  const out: BeatClickPoint[] = []
  for (const b of sortBeatsByTime(sm.timeline.beats)) {
    if (b.timeSec < trimStart - 1e-9) continue
    if (b.timeSec >= trimEnd - END_EPS) continue
    const t = prependSec + (b.timeSec - trimStart)
    if (t >= 0) out.push({ timeSec: t, downbeat: b.indexInBar === 0 })
  }
  return out
}

function linearResampleMono(
  src: Float32Array,
  srcRate: number,
  destLen: number,
  destRate: number,
): Float32Array {
  const out = new Float32Array(destLen)
  if (destLen === 0 || src.length === 0) return out
  for (let j = 0; j < destLen; j++) {
    const srcPos = (j / destRate) * srcRate
    const i = Math.floor(srcPos)
    const frac = srcPos - i
    const i1 = Math.min(i + 1, src.length - 1)
    const s0 = src[i] ?? 0
    const s1 = src[i1] ?? 0
    out[j] = (1 - frac) * s0 + frac * s1
  }
  return out
}

/**
 * Sum trimmed song (first channel) with cue buffer. Throws if cue length disagrees
 * with map-derived layout (caller should regenerate cue).
 */
export async function buildSongCueMixWavBlob(
  sm: SongMap,
  mainAudioFile: File,
  cueBlob: Blob,
): Promise<Blob> {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) {
    throw new Error('Song needs audio.trim for mix preview')
  }

  let prependSec = 0
  if (sm.cues.mode === 'countIn' && sm.cues.countInBeats > 0) {
    const ci = computeCountIn(sm, sm.cues.countInBeats)
    if (ci) prependSec = ci.prependSec
  }

  const ac = new AudioContext()
  try {
    const songBuf = await ac.decodeAudioData(await mainAudioFile.arrayBuffer())
    const cueBuf = await ac.decodeAudioData(await cueBlob.arrayBuffer())
    const sr = cueBuf.sampleRate
    const cueCh = cueBuf.numberOfChannels > 0 ? cueBuf.getChannelData(0) : new Float32Array(0)
    const targetLen = cueCh.length
    if (targetLen < 16) throw new Error('Cue buffer too short')

    const prependSamples = Math.min(Math.floor(prependSec * sr), targetLen)
    const songSlots = Math.max(0, targetLen - prependSamples)

    const i0 = Math.max(0, Math.floor(trim.startSec * songBuf.sampleRate))
    const i1 = Math.min(songBuf.length, Math.max(i0 + 1, Math.ceil(trim.endSec * songBuf.sampleRate)))
    const songCh0 =
      songBuf.numberOfChannels > 0 ? songBuf.getChannelData(0) : new Float32Array(0)
    const srcSeg = songCh0.subarray(i0, i1)

    const songResampled =
      songSlots > 0 ? linearResampleMono(srcSeg, songBuf.sampleRate, songSlots, sr) : new Float32Array(0)

    const out = new Float32Array(targetLen)
    for (let i = 0; i < targetLen; i++) {
      const songSamp = i < prependSamples ? 0 : songResampled[i - prependSamples] ?? 0
      out[i] = songSamp + cueCh[i]!
    }

    let peak = 0
    for (let i = 0; i < targetLen; i++) peak = Math.max(peak, Math.abs(out[i]))
    if (peak > 0.98 && peak > 0) {
      const sc = 0.98 / peak
      for (let i = 0; i < targetLen; i++) out[i] *= sc
    }

    const outBuf = ac.createBuffer(1, targetLen, sr)
    outBuf.copyToChannel(out, 0, 0)
    return audioBufferToWavBlob(outBuf)
  } finally {
    await ac.close().catch(() => {})
  }
}
