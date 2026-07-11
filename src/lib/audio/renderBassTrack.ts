/**
 * Offline render of BarBro's own bass track from detected bass notes —
 * `renderDrumTrack.ts`'s sibling. Same plan-derived layout (prelude +
 * prepend preamble baked in), same consistency promise: one synth voice,
 * a fixed velocity→gain curve, RMS normalization to the mixer's BASS
 * loudness target (−18 dB, quieter than drums by design — see mastering.ts).
 *
 * Bus differences from drums, both deliberate:
 *   - NO reverb (reverberant low end reads as mud, and real bass is
 *     recorded DI'd + dry),
 *   - center pan (identical L/R) — bass anchors the middle of the image.
 * Glue compression + tanh saturation are shared; the saturation's added
 * harmonics are what make the line audible on small speakers.
 */
import { audioBufferToWavBlob } from '$lib/audio/trimAudio'
import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { quantizeTimesToGrid } from '$lib/songmap/quantizeToGrid'
import { DRUM_KIT_SAMPLE_RATE } from './drumKits'
import { applyBusCompression, applySaturation } from './drumBus'
import { normalizeDrumBuffer } from './renderDrumTrack'
import type { BassMidiEvent, DrumQuantize, SongMap } from '$lib/songmap/types'

/** Matches the mixer's bass loudness target (see mastering.ts). */
export const BASS_TRACK_TARGET_RMS_DB = -18
/** A bass line wants a flatter dynamic than a kit — quiet notes still carry. */
export function bassVelocityGain(v: number): number {
  const c = Math.max(0, Math.min(1, v))
  return 0.4 + 0.6 * c * c
}

// ── The voice ────────────────────────────────────────────────────────────────
// Plucked-string model: harmonics at 1/k amplitude whose decay speeds up
// with k (highs die first), a fast attack, and a click-free release fade.
// Fully deterministic — no noise, no PRNG.

const HARMONIC_AMPS = [1.0, 0.45, 0.22, 0.1]
const HARMONIC_TAU_SEC = 0.9 // fundamental decay; harmonic k decays at tau/k
const ATTACK_SEC = 0.006
const RELEASE_SEC = 0.05
const NOTE_SCALE = 0.45 // pre-normalize headroom

/** Additively synthesize one note into `dst` starting at `atSec`. Pure. */
export function synthBassNote(
  dst: Float32Array,
  sampleRate: number,
  atSec: number,
  durationSec: number,
  midi: number,
  gain: number,
): void {
  const f0 = 440 * 2 ** ((midi - 69) / 12)
  const start = Math.round(atSec * sampleRate)
  const frames = Math.max(1, Math.floor(durationSec * sampleRate))
  const attackFrames = Math.max(1, Math.min(Math.round(ATTACK_SEC * sampleRate), frames >> 2))
  const releaseFrames = Math.max(1, Math.min(Math.round(RELEASE_SEC * sampleRate), frames >> 1))
  const w = (2 * Math.PI * f0) / sampleRate
  for (let i = 0; i < frames; i++) {
    const idx = start + i
    if (idx < 0) continue
    if (idx >= dst.length) break
    const t = i / sampleRate
    let s = 0
    for (let k = 0; k < HARMONIC_AMPS.length; k++) {
      const h = k + 1
      s += HARMONIC_AMPS[k]! * Math.exp((-t * h) / HARMONIC_TAU_SEC) * Math.sin(w * h * i)
    }
    let env = 1
    if (i < attackFrames) env = i / attackFrames
    const tail = frames - i
    if (tail <= releaseFrames) env *= 0.5 - 0.5 * Math.cos((Math.PI * tail) / releaseFrames)
    dst[idx]! += s * env * gain * NOTE_SCALE
  }
}

/**
 * Monophonic guard: quantizing onsets (or detector jitter) can make a note
 * ring into its successor — trim each note to end where the next begins.
 * Same-pitch notes collapsed onto one slot by the grid merge into one
 * (doubled synthesis = doubled amplitude, audible as a bump).
 */
export function trimBassOverlaps(events: BassMidiEvent[]): BassMidiEvent[] {
  const sorted = [...events].sort((a, b) => a.timeSec - b.timeSec)
  const merged: BassMidiEvent[] = []
  for (const e of sorted) {
    const prev = merged[merged.length - 1]
    if (prev && e.midi === prev.midi && Math.abs(e.timeSec - prev.timeSec) <= 0.001) {
      prev.velocity = Math.max(prev.velocity, e.velocity)
      prev.durationSec = Math.max(prev.durationSec, e.durationSec)
      continue
    }
    merged.push({ ...e })
  }
  return merged.map((e, i) => {
    const next = merged[i + 1]
    if (!next || e.durationSec <= next.timeSec - e.timeSec) return e
    // 20 ms floor: a different-pitch collision still gets a sounding grace
    // note instead of being deleted outright.
    return { ...e, durationSec: Math.max(0.02, next.timeSec - e.timeSec) }
  })
}

/** Pure mixing core (unit-testable). Mono — bass sits dead center. */
export function mixBassEvents(
  dst: Float32Array,
  sampleRate: number,
  events: BassMidiEvent[],
  trimStartSec: number,
  trimEndSec: number,
  shiftSec: number,
): void {
  for (const e of events) {
    if (e.timeSec < trimStartSec || e.timeSec >= trimEndSec) continue
    const dur = Math.min(e.durationSec, trimEndSec - e.timeSec)
    const at = shiftSec + (e.timeSec - trimStartSec)
    synthBassNote(dst, sampleRate, at, dur, e.midi, bassVelocityGain(e.velocity))
  }
}

export type RenderBassTrackResult = {
  blob: Blob
  preludeOffsetSec: number
  durationSec: number
  sampleRate: number
}

export async function renderBassTrackWavBlob(
  sm: SongMap,
  opts: { quantize?: DrumQuantize; transposeSemitones?: number } = {},
): Promise<RenderBassTrackResult> {
  const bm = sm.bassMidi
  if (!bm || bm.events.length === 0) throw new Error('Detect bass first.')
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) {
    throw new Error('Bass track needs audio.trim with end > start')
  }
  const plan = songPlaybackPlan(sm)
  if (!plan) throw new Error('Bass track needs audio.trim with end > start')

  const preludeSec = titleCuePreludeSec(sm)
  const prependSec = plan.prependSec
  const totalSec = preludeSec + prependSec + plan.songDurationSec
  if (!(totalSec > 0)) throw new Error('Bass track duration is zero')

  const quantize = opts.quantize ?? bm.quantize ?? 'off'
  let events: BassMidiEvent[] = bm.events
  // Transposing a SYNTHESIZED lane means shifting the notes — exact pitch,
  // zero time-stretch artifacts (unlike the audio lanes).
  const semis = Math.round(opts.transposeSemitones ?? 0)
  if (semis !== 0) {
    events = events.map((e) => ({
      ...e,
      midi: Math.max(0, Math.min(127, e.midi + semis)),
    }))
  }
  if (quantize !== 'off') {
    const beatsSorted = sortBeatsByTime(sm.timeline.beats)
    const barsById = new Map(sm.timeline.bars.map((b) => [b.id, b]))
    events = quantizeTimesToGrid(events, beatsSorted, barsById, quantize)
  }
  events = trimBassOverlaps(events)

  const sampleRate = DRUM_KIT_SAMPLE_RATE
  const frames = Math.max(1, Math.ceil(totalSec * sampleRate))
  const dataL = new Float32Array(frames)
  mixBassEvents(dataL, sampleRate, events, trim.startSec, trim.endSec, preludeSec + prependSec)
  const dataR = new Float32Array(dataL)
  applyBusCompression(dataL, dataR, sampleRate)
  applySaturation(dataL)
  applySaturation(dataR)
  normalizeDrumBuffer([dataL, dataR], BASS_TRACK_TARGET_RMS_DB)

  const buffer = new AudioBuffer({ length: frames, numberOfChannels: 2, sampleRate })
  buffer.copyToChannel(dataL, 0)
  buffer.copyToChannel(dataR, 1)
  return {
    blob: audioBufferToWavBlob(buffer),
    preludeOffsetSec: preludeSec + prependSec,
    durationSec: totalSec,
    sampleRate,
  }
}
