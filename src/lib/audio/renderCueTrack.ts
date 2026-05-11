/**
 * Offline metronome cue WAV aligned to SongMap trim + count-in prepend.
 * Used for DAW-side click tracks; length = prependSec + (trim.end − trim.start).
 */
import { computeCountIn } from '$lib/audio/computeCountIn'
import { audioBufferToWavBlob } from '$lib/audio/trimAudio'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { SongMap } from '$lib/songmap/types'

const END_EPS = 0.028
const CUE_SAMPLE_RATE = 44100

function mixClickKernel(
  samples: Float32Array,
  sampleRate: number,
  tSec: number,
  downbeat: boolean,
): void {
  const start = Math.floor(tSec * sampleRate)
  const freq = downbeat ? 1040 : 720
  const durSec = downbeat ? 0.052 : 0.038
  const peak = downbeat ? 0.42 : 0.2
  const len = Math.ceil(durSec * sampleRate)
  for (let i = 0; i < len; i++) {
    const idx = start + i
    if (idx < 0 || idx >= samples.length) continue
    const t = i / sampleRate
    const envLin = Math.min(1, i / (0.0025 * sampleRate))
    const envExp = Math.exp(-t * (downbeat ? 38 : 48))
    const env = Math.min(1, envLin) * envExp * peak
    samples[idx] += Math.sin(2 * Math.PI * freq * t) * env
  }
}

/** Total duration in seconds, or null if trim/timeline is unusable. */
export function cueTrackTotalDurationSec(sm: SongMap): number | null {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) return null
  if (sm.timeline.beats.length === 0) return null

  let prependSec = 0
  if (sm.cues.mode === 'countIn' && sm.cues.countInBeats > 0) {
    const ci = computeCountIn(sm, sm.cues.countInBeats)
    if (ci) prependSec = ci.prependSec
  }
  return prependSec + (trim.endSec - trim.startSec)
}

/**
 * Render a mono 44.1 kHz WAV: silence for prepend, then short sine clicks on
 * every beat that falls inside the trimmed reference window.
 */
export async function renderCueTrackWavBlob(sm: SongMap): Promise<Blob> {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) {
    throw new Error('Cue track needs audio.trim with end > start')
  }
  const sorted = sortBeatsByTime(sm.timeline.beats)
  if (sorted.length === 0) throw new Error('Cue track needs at least one beat')

  let prependSec = 0
  if (sm.cues.mode === 'countIn' && sm.cues.countInBeats > 0) {
    const ci = computeCountIn(sm, sm.cues.countInBeats)
    if (ci) prependSec = ci.prependSec
  }

  const trimLen = trim.endSec - trim.startSec
  const totalSec = prependSec + trimLen
  if (!(totalSec > 0)) throw new Error('Cue track duration is zero')

  const sampleRate = CUE_SAMPLE_RATE
  const frames = Math.max(1, Math.ceil(totalSec * sampleRate))
  const data = new Float32Array(frames)

  const trimStart = trim.startSec
  const trimEnd = trim.endSec

  for (const b of sorted) {
    if (b.timeSec < trimStart - 1e-9) continue
    if (b.timeSec >= trimEnd - END_EPS) continue
    const tClick = prependSec + (b.timeSec - trimStart)
    if (tClick < 0 || tClick >= totalSec - 1e-6) continue
    mixClickKernel(data, sampleRate, tClick, b.indexInBar === 0)
  }

  let peak = 0
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i])
    if (a > peak) peak = a
  }
  if (peak > 0.99 && peak > 0) {
    const s = 0.99 / peak
    for (let i = 0; i < data.length; i++) data[i] *= s
  }

  const ctx = new AudioContext({ sampleRate })
  try {
    const buf = ctx.createBuffer(1, frames, sampleRate)
    buf.copyToChannel(data, 0, 0)
    return audioBufferToWavBlob(buf)
  } finally {
    await ctx.close().catch(() => {})
  }
}
