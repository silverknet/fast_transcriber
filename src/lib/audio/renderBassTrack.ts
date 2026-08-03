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
import { generateBassGroove } from '$lib/songmap/generateBassGroove'
import { normalizeBassTone, type BassTone } from './bassTone'
import { renderBassVoice } from './renderBassVoice'
import { transposeMidiNote } from './midiTranspose'
import { inferBassGroove } from '$lib/songmap/bassGroove'
import { followKick, kickTimesFrom } from '$lib/songmap/bassKickFollow'
import { generateDrumGroove } from '$lib/songmap/generateDrumGroove'
import { DRUM_KIT_SAMPLE_RATE } from './drumKits'
import { applyBusCompression, applySaturation } from './drumBus'
import { normalizeDrumBuffer } from './renderDrumTrack'
import type { BassMidiEvent, DrumQuantize, SongMap } from '$lib/songmap/types'

/** Matches the mixer's bass loudness target (see mastering.ts). */
export const BASS_TRACK_TARGET_RMS_DB = -18
/** Lighter than the drum bus — sustained bass distorts much faster. */
export const BASS_SATURATION_DRIVE = 1.15
/** A bass line wants a flatter dynamic than a kit — quiet notes still carry. */
export function bassVelocityGain(v: number): number {
  const c = Math.max(0, Math.min(1, v))
  return 0.4 + 0.6 * c * c
}

// ── The voice ────────────────────────────────────────────────────────────────
// Plucked-string model, tuned against a real DI'd bass stem (band-energy
// bench in the repo history): the low end comes from a 1/k^1.25 harmonic
// stack whose decay speeds up with k (highs die first); the 500 Hz–5 kHz
// "hear it through the band" region — which pure low harmonics can't reach
// for low notes — comes from a bright pluck transient plus a quiet sustained
// string-rattle noise layer. Deterministic: the noise is seeded per pitch.

const HARMONIC_COUNT = 12
const HARMONIC_ROLLOFF = 1.25 // amp_k = 1 / k^rolloff
const HARMONIC_TAU_SEC = 1.1 // fundamental decay; harmonic k decays at tau/k
/** Upper harmonics scale with velocity: soft notes are rounder. */
const BRIGHTNESS_FLOOR = 0.55
const ATTACK_SEC = 0.006
const RELEASE_SEC = 0.05
const NOTE_SCALE = 0.4 // pre-normalize headroom

/** Pluck: a short bright burst of upper partials at note start. */
const PLUCK_TAU_SEC = 0.02
const PLUCK_GAIN = 0.4
const PLUCK_PARTIALS = [5, 7, 9, 12, 16] // × f0, capped below Nyquist

/** String rattle: band-limited noise riding the note envelope. */
const RATTLE_GAIN = 0.005
const RATTLE_LP_HZ = 2800
const RATTLE_HP_HZ = 700
const RATTLE_TAU_SEC = 0.5

/** Bench-fit body/definition shelves (vs the real stem's band profile):
 * harmonics 2-3 carry the "body" (120-250 Hz) and get a lift; 4-6 carry
 * 250-500 Hz and sit ~7 dB down or the voice turns honky; 7+ only whisper
 * (500 Hz-1 kHz definition — the rattle and pluck carry that region). */
const H23_LIFT = 1.25
const H46_SHELF = 0.45
const H7PLUS_SHELF = 0.18

/** mulberry32 — same deterministic PRNG the drum kits use. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Additively synthesize one note into `dst` starting at `atSec`. Pure. */
export function synthBassNote(
  dst: Float32Array,
  sampleRate: number,
  atSec: number,
  durationSec: number,
  midi: number,
  gain: number,
  velocity = 1,
): void {
  const f0 = 440 * 2 ** ((midi - 69) / 12)
  const start = Math.round(atSec * sampleRate)
  const frames = Math.max(1, Math.floor(durationSec * sampleRate))
  const attackFrames = Math.max(1, Math.min(Math.round(ATTACK_SEC * sampleRate), frames >> 2))
  const releaseFrames = Math.max(1, Math.min(Math.round(RELEASE_SEC * sampleRate), frames >> 1))
  const w = (2 * Math.PI * f0) / sampleRate
  const nyquist = sampleRate / 2

  const brightness = BRIGHTNESS_FLOOR + (1 - BRIGHTNESS_FLOOR) * Math.max(0, Math.min(1, velocity))
  const harmAmps: number[] = []
  for (let h = 1; h <= HARMONIC_COUNT; h++) {
    if (f0 * h >= nyquist) break
    let a = (h === 1 ? 1 : brightness) / h ** HARMONIC_ROLLOFF
    if (h === 2 || h === 3) a *= H23_LIFT
    else if (h >= 4 && h <= 6) a *= H46_SHELF
    else if (h >= 7) a *= H7PLUS_SHELF
    harmAmps.push(a)
  }
  const pluckPartials = PLUCK_PARTIALS.filter((p) => f0 * p < nyquist)

  // One-pole band-limit state for the rattle noise.
  const rnd = mulberry32(0xba55 + midi)
  const lpCoef = Math.exp((-2 * Math.PI * RATTLE_LP_HZ) / sampleRate)
  const hpCoef = Math.exp((-2 * Math.PI * RATTLE_HP_HZ) / sampleRate)
  let lpState = 0
  let hpState = 0

  for (let i = 0; i < frames; i++) {
    const idx = start + i
    if (idx < 0) continue
    if (idx >= dst.length) break
    const t = i / sampleRate
    let s = 0
    for (let k = 0; k < harmAmps.length; k++) {
      const h = k + 1
      s += harmAmps[k]! * Math.exp((-t * h) / HARMONIC_TAU_SEC) * Math.sin(w * h * i)
    }
    if (t < PLUCK_TAU_SEC * 6) {
      const pluckEnv = Math.exp(-t / PLUCK_TAU_SEC) * PLUCK_GAIN * brightness
      for (const p of pluckPartials) {
        s += (pluckEnv / p) * Math.sin(w * p * i)
      }
    }
    // Rattle: white noise → one-pole LP, minus a slower LP (= band-pass).
    const white = rnd() * 2 - 1
    lpState = white + (lpState - white) * lpCoef
    hpState = lpState + (hpState - lpState) * hpCoef
    s += (lpState - hpState) * RATTLE_GAIN * brightness * Math.exp(-t / RATTLE_TAU_SEC)

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
    synthBassNote(dst, sampleRate, at, dur, e.midi, bassVelocityGain(e.velocity), e.velocity)
  }
}

export type RenderBassTrackResult = {
  blob: Blob
  preludeOffsetSec: number
  durationSec: number
  sampleRate: number
}

/**
 * Render a finished note list to a WAV blob. Shared by the DETECTED bass track
 * and the programmed bass machine — everything above differs (where the notes
 * come from), everything below is identical, and the two must not drift.
 */
async function renderBassEventsToWav(
  sm: SongMap,
  events: BassMidiEvent[],
  tone?: BassTone,
  soundId?: string,
): Promise<RenderBassTrackResult> {
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

  const sampleRate = DRUM_KIT_SAMPLE_RATE
  const frames = Math.max(1, Math.ceil(totalSec * sampleRate))
  let dataL: Float32Array<ArrayBuffer>
  if (tone) {
    // The MACHINE plays the chords-view patch through real Web Audio nodes,
    // and gets ONLY that patch's own bus (highpass + drive). The compression
    // and saturation below were tuned for the DETECTED bass; stacking them on
    // top saturated the line twice and squashed it flat.
    const shift = preludeSec + prependSec
    dataL = await renderBassVoice(
      events
        .filter((e) => e.timeSec >= trim.startSec && e.timeSec < trim.endSec)
        .map((e) => ({
          atSec: shift + (e.timeSec - trim.startSec),
          durationSec: e.durationSec,
          midi: e.midi,
          velocity: e.velocity,
        })),
      tone,
      frames,
      sampleRate,
      soundId,
    )
    const dataRr = new Float32Array(new ArrayBuffer(frames * Float32Array.BYTES_PER_ELEMENT))
    dataRr.set(dataL)
    normalizeDrumBuffer([dataL, dataRr], BASS_TRACK_TARGET_RMS_DB)
    const buf = new AudioBuffer({ length: frames, numberOfChannels: 2, sampleRate })
    buf.copyToChannel(dataL, 0)
    buf.copyToChannel(dataRr, 1)
    return {
      blob: audioBufferToWavBlob(buf),
      preludeOffsetSec: preludeSec + prependSec,
      durationSec: totalSec,
      sampleRate,
    }
  }
  dataL = new Float32Array(frames)
  {
    mixBassEvents(dataL, sampleRate, events, trim.startSec, trim.endSec, preludeSec + prependSec)
  }
  const dataR = new Float32Array(dataL)
  applyBusCompression(dataL, dataR, sampleRate)
  applySaturation(dataL, BASS_SATURATION_DRIVE)
  applySaturation(dataR, BASS_SATURATION_DRIVE)
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

/**
 * The PROGRAMMED bass track — played from `sm.bassMachine` plus the chords,
 * timeline and sections. Needs no bass stem, and coexists with the detected
 * track rather than replacing it.
 */
export async function renderBassMachineWavBlob(
  sm: SongMap,
  opts: { transposeSemitones?: number } = {},
): Promise<RenderBassTrackResult> {
  const machine = sm.bassMachine
  if (!machine || !machine.enabled) throw new Error('No bass machine track on this song.')
  let events = generateBassGroove(sm, machine)
  if (events.length === 0) throw new Error('Bass machine produced no notes — are there chords?')
  const semis = Math.round(opts.transposeSemitones ?? 0)
  if (semis !== 0) {
    events = events.map((e) => ({ ...e, midi: transposeMidiNote(e.midi, semis) }))
  }
  return renderBassEventsToWav(
    sm,
    trimBassOverlaps(events),
    normalizeBassTone(machine.tone),
    machine.sound,
  )
}

/**
 * The detected bass's notes, after transpose, feel and timing are applied.
 *
 * Extracted so the LIVE instrument and the offline render play the same line.
 * They used to be one code path only because the live version did not exist;
 * two copies of "what the bass plays" is exactly the drift this codebase keeps
 * paying for, so there is one.
 */
export function detectedBassEvents(
  sm: SongMap,
  opts: { quantize?: DrumQuantize; transposeSemitones?: number } = {},
): BassMidiEvent[] {
  const bm = sm.bassMidi
  if (!bm || bm.events.length === 0) return []
  const quantize = opts.quantize ?? bm.quantize ?? 'off'
  const style = bm.style ?? 'steady'
  let events: BassMidiEvent[] = bm.events
  // Transposing a SYNTHESIZED lane means shifting the notes — exact pitch,
  // zero time-stretch artifacts (unlike the audio lanes).
  const semis = Math.round(opts.transposeSemitones ?? 0)
  if (semis !== 0) {
    events = events.map((e) => ({ ...e, midi: transposeMidiNote(e.midi, semis) }))
  }
  if (style === 'steady') {
    // Confident-bassist pass — already grid-locked, so no extra quantize.
    events = inferBassGroove(sm, events)
  } else if (quantize !== 'off') {
    const beatsSorted = sortBeatsByTime(sm.timeline.beats)
    const barsById = new Map(sm.timeline.bars.map((b) => [b.id, b]))
    events = quantizeTimesToGrid(events, beatsSorted, barsById, quantize)
  }
  // LAST: lock onto the kick. After the grid pass, so it has the final word on
  // where a note starts — the kick is the thing a bassist actually plays with,
  // and a note snapped to the grid a hair off the kick still sounds loose.
  return applyKickFollow(sm, events, bm.kickFollow ?? 0)
}

/**
 * Pull bass onsets onto the kick, using the drum machine's kicks when it is
 * playing and the detected drums otherwise. Reach is half a beat: far enough
 * to catch a late note, short enough that it can never pull a note onto the
 * wrong beat.
 */
function applyKickFollow(sm: SongMap, events: BassMidiEvent[], amount: number): BassMidiEvent[] {
  if (!(amount > 0) || events.length === 0) return events
  const machineKicks = sm.drumMachine?.enabled
    ? kickTimesFrom(generateDrumGroove(sm, sm.drumMachine))
    : []
  const kicks = machineKicks.length > 0 ? machineKicks : kickTimesFrom(sm.drumMidi?.events ?? [])
  if (kicks.length === 0) return events
  const beats = sortBeatsByTime(sm.timeline.beats)
  const spans: number[] = []
  for (let i = 1; i < beats.length; i++) {
    const s = beats[i]!.timeSec - beats[i - 1]!.timeSec
    if (s > 0.1 && s < 3) spans.push(s)
  }
  const beatSec = spans.length ? spans.sort((a, b) => a - b)[spans.length >> 1]! : 0.5
  return followKick(events, kicks, amount, beatSec / 2)
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

  const events = detectedBassEvents(sm, opts)
  // The detected bass gets a VOICE the same way the machine does. Without a
  // saved sound this passes undefined and falls through to the original fixed
  // tone, so songs that never chose one sound exactly as they did before.
  return renderBassEventsToWav(
    sm,
    trimBassOverlaps(events),
    bm.tone ? normalizeBassTone(bm.tone) : undefined,
    bm.sound,
  )
}
