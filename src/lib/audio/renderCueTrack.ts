/**
 * Offline metronome cue WAV aligned to SongMap trim + count-in prepend.
 * Optional spoken cues (title + count-in numbers + section callouts) via desktop Piper when reachable.
 */
import { buildCueSpeechEvents } from '$lib/audio/cueTrackSpeechSchedule'
import { audioBufferToWavBlob } from '$lib/audio/trimAudio'
import { fetchDesktopTtsSynthesizeWav } from '$lib/client/desktopBridge'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import type { SongMap } from '$lib/songmap/types'

const CUE_SAMPLE_RATE = 44100
/** How loud spoken clips are mixed vs clicks (still peak-limited at end). */
const SPEECH_MIX_GAIN = 1.04
/** Count-in number clips: slightly shorter than Piper default so the grid feels tighter. */
const COUNT_TTS_SPEEDUP = 1.11

function resampleMonoSpeedup(src: Float32Array, speed: number): Float32Array {
  if (!(speed > 1) || src.length < 2) return src
  const outLen = Math.max(1, Math.floor(src.length / speed))
  const out = new Float32Array(outLen)
  for (let j = 0; j < outLen; j++) {
    const pos = j * speed
    const i = Math.floor(pos)
    const frac = pos - i
    const i1 = Math.min(i + 1, src.length - 1)
    out[j] = (1 - frac) * (src[i] ?? 0) + frac * (src[i1] ?? 0)
  }
  return out
}

function mixClickKernel(
  samples: Float32Array,
  sampleRate: number,
  tSec: number,
  downbeat: boolean,
): void {
  const start = Math.floor(tSec * sampleRate)
  const freq = downbeat ? 1040 : 720
  const durSec = downbeat ? 0.058 : 0.044
  const peak = downbeat ? 0.86 : 0.5
  const len = Math.ceil(durSec * sampleRate)
  for (let i = 0; i < len; i++) {
    const idx = start + i
    if (idx < 0 || idx >= samples.length) continue
    const t = i / sampleRate
    const envLin = Math.min(1, i / (0.0025 * sampleRate))
    const envExp = Math.exp(-t * (downbeat ? 36 : 46))
    const env = Math.min(1, envLin) * envExp * peak
    samples[idx] += Math.sin(2 * Math.PI * freq * t) * env
  }
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

/** Sum resampled mono clip into `dst` starting at `offsetSec` on `dstRate` timeline. */
function addClipAtOffset(
  dst: Float32Array,
  dstRate: number,
  clipMono: Float32Array,
  clipRate: number,
  offsetSec: number,
  gain: number,
): number {
  if (clipMono.length === 0) return 0
  const offsetSamples = Math.floor(offsetSec * dstRate)
  const destLen = Math.max(1, Math.ceil(clipMono.length * (dstRate / clipRate)))
  const resampled = linearResampleMono(clipMono, clipRate, destLen, dstRate)
  const durSec = resampled.length / dstRate
  for (let j = 0; j < resampled.length; j++) {
    const idx = offsetSamples + j
    if (idx < 0 || idx >= dst.length) continue
    dst[idx] += resampled[j]! * gain
  }
  return durSec
}

/** Total duration in seconds, or null if trim/timeline is unusable. */
export function cueTrackTotalDurationSec(sm: SongMap): number | null {
  if (sm.timeline.beats.length === 0) return null
  const plan = songPlaybackPlan(sm)
  if (!plan) return null
  return plan.titlePreludeSec + plan.prependSec + plan.songDurationSec
}

export type RenderCueTrackResult = {
  blob: Blob
  /**
   * Silence + count-in clicks at the start of the WAV before the first
   * song-aligned beat lands, in seconds. Equals `titleCuePreludeSec(sm) +
   * computeCountIn(...)?.prependSec`. Exposed so consumers don't recompute
   * (and risk drift) when storing the value alongside the WAV.
   */
  preludeOffsetSec: number
  /** Set when Piper was not used so the user knows spoken lines are missing. */
  speechSkippedReason?: string
}

/**
 * Render a mono 44.1 kHz WAV: silence for prepend, sine clicks on beats, optional Piper speech
 * (desktop sidecar). Both layers are independently controllable so callers
 * can build the four useful variants:
 *
 *   - `{ includeClicks: true, includeSpeech: true }`  — legacy "cue track"
 *   - `{ includeClicks: true, includeSpeech: false }` — pure click track
 *   - `{ includeClicks: false, includeSpeech: true }` — pure speech ("cue v2")
 *   - `{ includeClicks: false, includeSpeech: false }` — silence (rare; debug)
 *
 * Same prelude/prepend math regardless of layers, so all variants are
 * sample-aligned with each other.
 */
export async function renderCueTrackWavBlob(
  sm: SongMap,
  opts: { includeSpeech?: boolean; includeClicks?: boolean } = {},
): Promise<RenderCueTrackResult> {
  const includeSpeech = opts.includeSpeech !== false
  const includeClicks = opts.includeClicks !== false
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) {
    throw new Error('Cue track needs audio.trim with end > start')
  }
  if (sm.timeline.beats.length === 0) throw new Error('Cue track needs at least one beat')

  // ── Single derivation: every layout value below comes from one plan. ──
  const plan = songPlaybackPlan(sm)
  if (!plan) throw new Error('Cue track needs audio.trim with end > start')

  const preludeSec = plan.titlePreludeSec
  const prependSec = plan.prependSec
  const trimLen = plan.songDurationSec
  const totalSec = preludeSec + prependSec + trimLen
  if (!(totalSec > 0)) throw new Error('Cue track duration is zero')

  const sampleRate = CUE_SAMPLE_RATE
  const frames = Math.max(1, Math.ceil(totalSec * sampleRate))
  const data = new Float32Array(frames)

  if (includeClicks) {
    // Single click-emission loop. Count-in and song clicks come from
    // the same `plan.clickPoints` source of truth (audio-element time);
    // shifting by `preludeSec + prependSec` puts them on the cue-WAV
    // timeline. The relationship "N count-in clicks end exactly one
    // beat before the song starts" is enforced inside `songPlaybackPlan`.
    const shift = preludeSec + prependSec
    for (const c of plan.clickPoints) {
      const tClick = c.timeSec + shift
      if (tClick < 0 || tClick >= totalSec - 1e-6) continue
      mixClickKernel(data, sampleRate, tClick, c.downbeat)
    }
  }

  let speechOk = true
  let speechFail: string | null = null

  const ac = new AudioContext({ sampleRate })
  try {
    if (!includeSpeech) {
      // Click-only mode — skip the TTS round-trips entirely.
    } else {
      const events = buildCueSpeechEvents(sm)
      type SpeechMixRow = { t: number; text: string; speedup?: number; order: number }
      const speechRows: SpeechMixRow[] = []
      let mixOrder = 0
      for (const e of events) {
        if (e.kind === 'title') {
          speechRows.push({ t: Math.max(0, e.tSec), text: e.text, order: mixOrder++ })
        } else if (e.kind === 'count') {
          speechRows.push({
            t: e.tSec,
            text: e.text,
            speedup: COUNT_TTS_SPEEDUP,
            order: mixOrder++,
          })
        } else if (e.kind === 'section') {
          speechRows.push({ t: e.tSec, text: e.text, order: mixOrder++ })
        }
      }
      speechRows.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.order - b.order))

      const mixSpeechAt = async (t: number, text: string, opts?: { speedup?: number }): Promise<number> => {
        const r = await fetchDesktopTtsSynthesizeWav(text)
        if (!r.ok) {
          speechOk = false
          speechFail = speechFail ?? r.error
          return 0
        }
        let buf: AudioBuffer
        try {
          buf = await ac.decodeAudioData(await r.blob.arrayBuffer())
        } catch {
          speechOk = false
          speechFail = speechFail ?? 'Could not decode speech WAV'
          return 0
        }
        let ch0 =
          buf.numberOfChannels > 0 ? buf.getChannelData(0) : new Float32Array(0)
        const sp = opts?.speedup ?? 1
        if (sp > 1 && ch0.length > 0) ch0 = new Float32Array(resampleMonoSpeedup(ch0, sp))
        return addClipAtOffset(data, sampleRate, ch0, buf.sampleRate, t, SPEECH_MIX_GAIN)
      }

      for (const row of speechRows) {
        const t = Math.max(0, row.t)
        await mixSpeechAt(t, row.text, row.speedup ? { speedup: row.speedup } : undefined)
      }
    }
  } finally {
    await ac.close().catch(() => {})
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

  const ctx2 = new AudioContext({ sampleRate })
  try {
    const buf = ctx2.createBuffer(1, frames, sampleRate)
    buf.copyToChannel(data, 0, 0)
    const blob = await audioBufferToWavBlob(buf)
    return {
      blob,
      preludeOffsetSec: preludeSec + prependSec,
      speechSkippedReason: !includeSpeech || speechOk
        ? undefined
        : `No voice in this file — ${speechFail ?? 'desktop unreachable'}. Run BarBro desktop and set up Piper (TTS debug page).`,
    }
  } finally {
    await ctx2.close().catch(() => {})
  }
}
