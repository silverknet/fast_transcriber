/**
 * Offline metronome cue WAV aligned to SongMap trim + count-in prepend.
 * Optional spoken cues (title + count-in numbers + section callouts) via desktop Piper when reachable.
 */
import { buildCueSpeechEvents } from '$lib/audio/cueTrackSpeechSchedule'
import {
  createClickSoundResources,
  PROJECT_CLICK_SOUND,
  scheduleClickSound,
} from '$lib/audio/clickSounds'
import { audioBufferToWavBlob } from '$lib/audio/trimAudio'
import { fetchTtsWavCached } from '$lib/client/ttsCache'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import type { CueTrack, SongMap } from '$lib/songmap/types'

export const CUE_SAMPLE_RATE = 44100
/** How loud spoken clips are mixed vs clicks (still peak-limited at end). */
export const SPEECH_MIX_GAIN = 1.04
/** Count-in number clips: slightly shorter than Piper default so the grid feels tighter. */
export const COUNT_TTS_SPEEDUP = 1.11

export function resampleMonoSpeedup(src: Float32Array, speed: number): Float32Array {
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

/** Previous sine-click renderer, retained for reference and rollback. */
export function mixLegacyClickKernel(
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

export function linearResampleMono(
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
 * Drop the leading (near-)silence a TTS clip has before the first sound, so the
 * word's AUDIBLE onset — not the clip's file start — lands on the scheduled time.
 * Without this, count-in numbers and callouts arrive 50–150 ms late and feel off.
 * A tiny pre-roll is kept so the attack transient isn't clipped.
 */
export function trimLeadingSilence(samples: Float32Array, sampleRate: number, threshold = 0.02): Float32Array {
  let i = 0
  while (i < samples.length && Math.abs(samples[i]!) < threshold) i++
  if (i === 0) return samples
  const preRoll = Math.floor(0.004 * sampleRate) // keep ~4 ms before the onset
  const start = Math.max(0, i - preRoll)
  return start > 0 ? samples.slice(start) : samples
}

/** Sum resampled mono clip into `dst` starting at `offsetSec` on `dstRate` timeline. */
export function addClipAtOffset(
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
export function cueTrackTotalDurationSec(sm: SongMap, cueTrack?: CueTrack): number | null {
  if (sm.timeline.beats.length === 0) return null
  const plan = songPlaybackPlan(sm)
  if (!plan) return null
  return titleCuePreludeSec(sm, cueTrack) + plan.prependSec + plan.songDurationSec
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
 * Render a mono 44.1 kHz WAV: silence for prepend, project clicks on beats, optional Piper speech
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
/**
 * A context for DECODING and buffer allocation — never for playback.
 *
 * Deliberately offline: a browser caps hardware `AudioContext`s at roughly six
 * per page, and this app already holds several long-lived ones (the editor
 * transport, the mixer engine, and one per chord-jam voice). Taking another for
 * work that makes no sound would push it over the limit, and the constructor
 * throws when it does.
 */
function makeDecodeContext(sampleRate: number): OfflineAudioContext {
  return new OfflineAudioContext(1, 1, sampleRate)
}

/**
 * The click track as RAW SAMPLES, for playing inside the app.
 *
 * `renderCueTrackWavBlob` exists to write a FILE — Ableton export, the disk
 * cache. The mixer and live mode were loading the click through it too, which
 * meant: render the clicks, encode ~20 MB of WAV, hand the blob to
 * `decodeAudioData` to get the samples back out, and resample 44.1 → 48 kHz on
 * the way. Seconds of work to arrive at data we already had — and in live mode
 * those seconds sit between "load the song" and "the band has a click".
 *
 * This renders once, at the DESTINATION context's own rate (no resample), and
 * returns the samples. The caller wraps them in an `AudioBuffer` directly.
 * Same plan, same click voice, same layout maths as the WAV path — the timeline
 * placement is shared, so the two cannot drift.
 */

/**
 * The click VOICE, rendered once per (rate, accent) as a short kernel.
 *
 * The full-length click used to be produced by scheduling every click as its
 * own node graph in one song-length `OfflineAudioContext` — ~460 voices across
 * four minutes, measured at ~13-16 SECONDS to render. That render was the
 * entire "Loading Click…" wait; the WAV round-trip everyone suspected was only
 * ~1 s of it.
 *
 * A click is the same waveform every time it fires. So: render the voice ONCE
 * into a ~quarter-second kernel (one tiny offline render per accent), then mix
 * that kernel into the output at each click time with plain adds. Same sound,
 * same placement, milliseconds instead of seconds.
 */
const CLICK_KERNEL_SEC = 0.25
const clickKernelCache = new Map<string, Promise<Float32Array>>()

function renderClickKernel(sampleRate: number, downbeat: boolean): Promise<Float32Array> {
  const key = `${sampleRate}:${downbeat ? 'down' : 'off'}`
  let hit = clickKernelCache.get(key)
  if (!hit) {
    hit = (async () => {
      const frames = Math.ceil(CLICK_KERNEL_SEC * sampleRate)
      const ctx = new OfflineAudioContext(1, frames, sampleRate)
      scheduleClickSound({
        ctx,
        destination: ctx.destination,
        resources: createClickSoundResources(ctx),
        sound: PROJECT_CLICK_SOUND,
        startTime: 0,
        downbeat,
      })
      const rendered = await ctx.startRendering()
      return new Float32Array(rendered.getChannelData(0))
    })()
    clickKernelCache.set(key, hit)
  }
  return hit
}

/** Mix `kernel` into `data` starting at `atSec`, clipped to the buffer. */
function stampKernel(data: Float32Array, sampleRate: number, atSec: number, kernel: Float32Array): void {
  const start = Math.round(atSec * sampleRate)
  const from = Math.max(0, start)
  const to = Math.min(data.length, start + kernel.length)
  for (let i = from; i < to; i++) data[i] += kernel[i - start]!
}

export async function renderClickTrackData(
  sm: SongMap,
  opts: { cueTrack?: CueTrack; sampleRate: number },
): Promise<{ data: Float32Array; sampleRate: number; preludeOffsetSec: number }> {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) {
    throw new Error('Click track needs audio.trim with end > start')
  }
  if (sm.timeline.beats.length === 0) throw new Error('Click track needs at least one beat')
  const plan = songPlaybackPlan(sm)
  if (!plan) throw new Error('Click track needs audio.trim with end > start')

  // Identical layout derivation to the WAV path — one timeline, two consumers.
  // Clicks only — DELIBERATELY the no-announce layout. In live mode the
  // announcement is spoken dynamically and the START is delayed instead, so a
  // baked announcement prelude here would double the gap.
  const preludeSec = titleCuePreludeSec(sm, opts.cueTrack)
  const prependSec = plan.prependSec
  const totalSec = preludeSec + prependSec + plan.songDurationSec
  if (!(totalSec > 0)) throw new Error('Click track duration is zero')

  const sampleRate = opts.sampleRate
  const frames = Math.max(1, Math.ceil(totalSec * sampleRate))
  const data = new Float32Array(frames)
  const [down, off] = await Promise.all([
    renderClickKernel(sampleRate, true),
    renderClickKernel(sampleRate, false),
  ])
  const shift = preludeSec + prependSec
  for (const c of plan.clickPoints) {
    const tClick = c.timeSec + shift
    if (tClick < 0 || tClick >= totalSec - 1e-6) continue
    stampKernel(data, sampleRate, tClick, c.downbeat ? down : off)
  }
  return { data, sampleRate, preludeOffsetSec: shift }
}

export async function renderCueTrackWavBlob(
  sm: SongMap,
  opts: {
    includeSpeech?: boolean
    includeClicks?: boolean
    cueTrack?: CueTrack
    /** Speak the song title from the PROJECT setting — no intro event needed.
     *  Explicit per consumer: baked cue WAVs pass the setting; the in-app
     *  click lane passes nothing (live speaks dynamically instead). */
    announceTitle?: boolean
  } = {},
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

  const preludeSec = titleCuePreludeSec(sm, opts.cueTrack, { announceTitle: opts.announceTitle })
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
    //
    // Kernel-stamped, exactly like `renderClickTrackData`: rendering every
    // click as its own node graph across a song-length OfflineAudioContext
    // measured at ~13 s for a four-minute song, and this path feeds the disk
    // cache and the Ableton export — the same wait, just moved.
    const [down, off] = await Promise.all([
      renderClickKernel(sampleRate, true),
      renderClickKernel(sampleRate, false),
    ])
    const shift = preludeSec + prependSec
    for (const c of plan.clickPoints) {
      const tClick = c.timeSec + shift
      if (tClick < 0 || tClick >= totalSec - 1e-6) continue
      stampKernel(data, sampleRate, tClick, c.downbeat ? down : off)
    }
  }

  let speechOk = true
  let speechFail: string | null = null

  // OFFLINE, not a hardware AudioContext. This one only decodes; it never
  // plays. A browser allows about six hardware contexts per page and the app
  // already holds several (the transport, the mixer, and one per chord voice),
  // so taking another just to decode would throw — which is what "paused in
  // debugger" on this line was.
  const ac = makeDecodeContext(sampleRate)
  {
    if (!includeSpeech) {
      // Click-only mode — skip the TTS round-trips entirely.
    } else {
      const events = buildCueSpeechEvents(sm, opts.cueTrack, { announceTitle: opts.announceTitle })
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
        const r = await fetchTtsWavCached(text)
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
        let ch0: Float32Array =
          buf.numberOfChannels > 0 ? new Float32Array(buf.getChannelData(0)) : new Float32Array(0)
        // Align the audible onset (not the file start) to the scheduled beat.
        if (ch0.length > 0) ch0 = trimLeadingSilence(ch0, buf.sampleRate)
        const sp = opts?.speedup ?? 1
        if (sp > 1 && ch0.length > 0) ch0 = new Float32Array(resampleMonoSpeedup(ch0, sp))
        return addClipAtOffset(data, sampleRate, ch0, buf.sampleRate, t, SPEECH_MIX_GAIN)
      }

      for (const row of speechRows) {
        const t = Math.max(0, row.t)
        await mixSpeechAt(t, row.text, row.speedup ? { speedup: row.speedup } : undefined)
      }
    }
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

  // Offline as well — this exists purely to allocate the buffer the WAV is
  // written from.
  const ctx2 = makeDecodeContext(sampleRate)
  {
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
  }
}
