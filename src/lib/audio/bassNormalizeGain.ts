/**
 * The bass machine's loudness gain — the live equivalent of the offline chain's
 * final `normalizeDrumBuffer(..., -18)`.
 *
 * Same problem and same shape as the drum one: the offline stage measures the
 * whole rendered track, which a live graph can't do, but it reduces to a single
 * scalar. So render a SHORT representative window through the real voice graph
 * and measure that.
 *
 * Unlike drums, the bass voice is Web Audio nodes rather than pure DSP, so the
 * measurement uses an `OfflineAudioContext` — which makes this browser-only and
 * async. It runs once per (part, tone, sound), not per frame.
 */
import { createBassBus, scheduleBassNote, bassVoiceSetup } from './bassVoiceGraph'
import { loadSampleSet } from './renderBassVoice'
import { bassSound } from './bassSounds'
import { BASS_TRACK_TARGET_RMS_DB } from './renderBassTrack'
import type { BassTone } from './bassTone'
import type { BassPart } from './bassPart'

/** Long enough for a phrase, short enough to stay cheap. */
export const BASS_MEASURE_WINDOW_SEC = 12
const MEASURE_SAMPLE_RATE = 44100
/** Matches the offline normalizer's ceiling. */
const PEAK_CEILING = 0.95

/** The busiest stretch — a sparse intro would measure far too quiet. */
export function densestBassWindowStart(part: BassPart, windowSec = BASS_MEASURE_WINDOW_SEC): number {
  const notes = part.notes
  if (notes.length === 0) return 0
  if (part.durationSec <= windowSec) return 0
  let best = 0
  let bestCount = 0
  let lo = 0
  for (let hi = 0; hi < notes.length; hi++) {
    while (notes[lo]!.atSec < notes[hi]!.atSec - windowSec) lo++
    const count = hi - lo + 1
    if (count > bestCount) {
      bestCount = count
      best = notes[lo]!.atSec
    }
  }
  return Math.max(0, Math.min(best, Math.max(0, part.durationSec - windowSec)))
}

/**
 * The gain the offline normalizer would apply. Returns 1 when there is nothing
 * to measure, or when no `OfflineAudioContext` exists (Node tests).
 */
export async function measureBassNormalizeGain(
  part: BassPart,
  tone: BassTone,
  soundId: string | undefined,
  opts: { windowSec?: number; targetRmsDb?: number } = {},
): Promise<number> {
  const windowSec = opts.windowSec ?? BASS_MEASURE_WINDOW_SEC
  if (part.notes.length === 0) return 1
  const Ctor = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext
  if (!Ctor) return 1

  const start = densestBassWindowStart(part, windowSec)
  const end = start + windowSec
  const windowed = part.notes.filter((n) => n.atSec >= start && n.atSec < end)
  if (windowed.length === 0) return 1

  const frames = Math.max(1, Math.ceil(windowSec * MEASURE_SAMPLE_RATE))
  const ctx = new Ctor(1, frames, MEASURE_SAMPLE_RATE)
  const bus = createBassBus(ctx, tone, soundId)
  bus.output.connect(ctx.destination)
  const sound = bassSound(soundId)
  const samples =
    sound.kind === 'sample' ? await loadSampleSet(ctx, sound.dir, sound.roots) : null
  const setup = bassVoiceSetup(soundId, samples)
  for (const n of windowed) {
    scheduleBassNote(ctx, bus.input, n, Math.max(0, n.atSec - start), tone, setup)
  }
  const rendered = (await ctx.startRendering()).getChannelData(0)

  // The same measurement the offline normalizer makes: RMS over frames above a
  // -60 dB floor, with a peak ceiling.
  const floor = 10 ** (-60 / 20)
  let sum = 0
  let n = 0
  let peak = 0
  for (const v of rendered) {
    const a = Math.abs(v)
    if (a > peak) peak = a
    if (a > floor) {
      sum += v * v
      n++
    }
  }
  if (n === 0 || peak <= 0) return 1
  const rms = Math.sqrt(sum / n)
  if (!(rms > 0)) return 1
  const target = 10 ** ((opts.targetRmsDb ?? BASS_TRACK_TARGET_RMS_DB) / 20)
  let g = target / rms
  if (peak * g > PEAK_CEILING) g = PEAK_CEILING / peak
  return g
}
