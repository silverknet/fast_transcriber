/**
 * Offline render of BarBro's own drum track from detected drum events.
 *
 * Layout matches `renderCueTrack.ts` exactly (same plan, same prelude +
 * prepend preamble baked into the WAV) so the mixer lane aligns with the
 * cue/click lanes sample-for-sample.
 *
 * Consistency is the feature: fixed kit voices + a fixed velocity→gain
 * curve + post-mix RMS normalization to the mixer's drums loudness target,
 * then a hard peak ceiling. Two songs rendered with the same kit land at
 * the same loudness.
 */
import { audioBufferToWavBlob } from '$lib/audio/trimAudio'
import { addClipAtOffset } from '$lib/audio/renderCueTrack'
import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { quantizeTimesToGrid, dedupeDrumEvents } from '$lib/songmap/quantizeToGrid'
import { inferDrumGroove } from '$lib/songmap/drumGroove'
import { DRUM_KIT_SAMPLE_RATE, loadDrumKit } from './drumKits'
import type { DrumKit, DrumKitId } from './drumKits'
import { applyBusCompression, applyReverb, applySaturation, voicePanGains } from './drumBus'
import type { DrumMidiEvent, DrumQuantize, SongMap } from '$lib/songmap/types'

/** Matches the mixer's drums loudness target (see mastering.ts). */
const DRUM_TRACK_TARGET_RMS_DB = -16
const PEAK_CEILING = 0.95

/** Fixed velocity curve — quiet hits stay audible, loud hits stay dynamic. */
export function drumVelocityGain(v: number): number {
  const c = Math.max(0, Math.min(1, v))
  return 0.25 + 0.75 * c * c
}

/** Pure mixing core (unit-testable with an impulse kit). Stereo: per-voice
 * constant-power panning puts hats/toms slightly off-center like a real kit. */
export function mixDrumEvents(
  dstL: Float32Array,
  dstR: Float32Array,
  sampleRate: number,
  events: DrumMidiEvent[],
  kit: DrumKit,
  trimStartSec: number,
  trimEndSec: number,
  shiftSec: number,
): void {
  for (const e of events) {
    if (e.timeSec < trimStartSec || e.timeSec >= trimEndSec) continue
    const voice = kit.voices[e.cls]
    if (!voice || voice.length === 0) continue
    const g = drumVelocityGain(e.velocity)
    const pan = voicePanGains(e.cls)
    const at = shiftSec + (e.timeSec - trimStartSec)
    addClipAtOffset(dstL, sampleRate, voice, DRUM_KIT_SAMPLE_RATE, at, g * pan.l)
    addClipAtOffset(dstR, sampleRate, voice, DRUM_KIT_SAMPLE_RATE, at, g * pan.r)
  }
}

/** RMS over frames above the silence floor; scale to target; hard-ceiling.
 * Multi-channel: the gain is computed jointly and applied to every channel. */
export function normalizeDrumBuffer(
  channels: Float32Array[] | Float32Array,
  targetRmsDb = DRUM_TRACK_TARGET_RMS_DB,
): void {
  const chs = Array.isArray(channels) ? channels : [channels]
  const floor = 10 ** (-60 / 20)
  let sum = 0
  let n = 0
  let peak = 0
  for (const data of chs) {
    for (const v of data) {
      const a = Math.abs(v)
      peak = Math.max(peak, a)
      if (a > floor) {
        sum += v * v
        n++
      }
    }
  }
  if (n === 0) return
  const rms = Math.sqrt(sum / n)
  if (rms <= 0) return
  const target = 10 ** (targetRmsDb / 20)
  let g = target / rms
  if (peak * g > PEAK_CEILING) g = PEAK_CEILING / peak
  for (const data of chs) {
    for (let i = 0; i < data.length; i++) data[i]! *= g
  }
}

export type RenderDrumTrackResult = {
  blob: Blob
  preludeOffsetSec: number
  durationSec: number
  sampleRate: number
}

export async function renderDrumTrackWavBlob(
  sm: SongMap,
  opts: { kitId?: DrumKitId; quantize?: DrumQuantize; customKit?: DrumKit } = {},
): Promise<RenderDrumTrackResult> {
  const dm = sm.drumMidi
  if (!dm || dm.events.length === 0) throw new Error('Detect drums first.')
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) {
    throw new Error('Drum track needs audio.trim with end > start')
  }
  const plan = songPlaybackPlan(sm)
  if (!plan) throw new Error('Drum track needs audio.trim with end > start')

  const preludeSec = titleCuePreludeSec(sm)
  const prependSec = plan.prependSec
  const totalSec = preludeSec + prependSec + plan.songDurationSec
  if (!(totalSec > 0)) throw new Error('Drum track duration is zero')

  const kitId =
    opts.kitId ?? (dm.kit === 'acoustic' || dm.kit === 'custom' ? (dm.kit as DrumKitId) : 'synth')
  const quantize = opts.quantize ?? dm.quantize ?? 'off'
  const style = dm.style ?? 'steady'

  let events: DrumMidiEvent[] = dm.events
  if (style === 'steady') {
    // The groove engine outputs grid-locked events already — no quantize.
    events = inferDrumGroove(sm, events)
  } else if (quantize !== 'off') {
    const beatsSorted = sortBeatsByTime(sm.timeline.beats)
    const barsById = new Map(sm.timeline.bars.map((b) => [b.id, b]))
    events = dedupeDrumEvents(quantizeTimesToGrid(events, beatsSorted, barsById, quantize))
  }

  // The caller resolves "Your kit" (project files) and passes it in;
  // without it, loadDrumKit('custom') degrades to the built-in fallbacks.
  const kit = kitId === 'custom' && opts.customKit ? opts.customKit : await loadDrumKit(kitId)
  const sampleRate = DRUM_KIT_SAMPLE_RATE
  const frames = Math.max(1, Math.ceil(totalSec * sampleRate))
  const dataL = new Float32Array(frames)
  const dataR = new Float32Array(frames)

  mixDrumEvents(dataL, dataR, sampleRate, events, kit, trim.startSec, trim.endSec, preludeSec + prependSec)
  // The mix bus — room reverb, glue compression, a little warmth — is what
  // makes the kit blend into the song instead of sitting dry on top.
  applyReverb(dataL, dataR, sampleRate)
  applyBusCompression(dataL, dataR, sampleRate)
  applySaturation(dataL)
  applySaturation(dataR)
  normalizeDrumBuffer([dataL, dataR])

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
