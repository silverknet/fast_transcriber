/**
 * The one number the live drum bus can't compute for itself.
 *
 * The offline chain ends in `normalizeDrumBuffer`, which measures the whole
 * rendered track's RMS and scales it to −16 dBFS (with a 0.95 peak ceiling).
 * That is what makes every song land at the same level regardless of how busy
 * its groove is — and it needs the entire buffer, so a live graph can't do it.
 *
 * But the result is a single scalar, so live it collapses to one `GainNode`.
 * The only question is how to obtain the number without rendering the track.
 *
 * The approach: render a SHORT, representative window through the real offline
 * DSP — the same `mixDrumEvents` → reverb → compression → saturation the WAV
 * path uses — and measure that. It's a fraction of a full render, it's
 * deterministic (so the level never drifts while you listen), and because it
 * runs the actual pipeline it accounts for what the bus does to the level,
 * which an analytic estimate could not.
 *
 * The window is chosen by DENSITY, not position: a song that opens with a
 * sparse intro would otherwise be measured on its quietest moment and come out
 * far too loud.
 */
import {
  DRUM_TRACK_TARGET_RMS_DB,
  mixDrumEvents,
  normalizeDrumBuffer,
} from './renderDrumTrack'
import { applyBusCompression, applyReverb, applySaturation } from './drumBus'
import { DRUM_KIT_SAMPLE_RATE, type DrumKit } from './drumKits'
import type { DrumPart } from './drumPart'
import type { DrumMidiEvent } from '$lib/songmap/types'

/** Long enough to cover a phrase, short enough to stay cheap. */
export const MEASURE_WINDOW_SEC = 15

/**
 * Find the densest window. Hits are already sorted by time, so this is a
 * two-pointer sweep rather than a scan per candidate.
 */
export function densestWindowStart(part: DrumPart, windowSec = MEASURE_WINDOW_SEC): number {
  const hits = part.hits
  if (hits.length === 0) return 0
  if (part.durationSec <= windowSec) return 0
  let best = 0
  let bestCount = 0
  let lo = 0
  for (let hi = 0; hi < hits.length; hi++) {
    while (hits[lo]!.mixTimeSec < hits[hi]!.mixTimeSec - windowSec) lo++
    const count = hi - lo + 1
    if (count > bestCount) {
      bestCount = count
      best = hits[lo]!.mixTimeSec
    }
  }
  return Math.max(0, Math.min(best, Math.max(0, part.durationSec - windowSec)))
}

/**
 * The gain the offline normalizer would apply, measured on a window.
 *
 * Returns 1 for an empty part — silence needs no correction, and dividing by a
 * zero RMS would produce Infinity.
 */
export function measureDrumNormalizeGain(
  part: DrumPart,
  kit: DrumKit,
  opts: { windowSec?: number; targetRmsDb?: number } = {},
): number {
  const windowSec = opts.windowSec ?? MEASURE_WINDOW_SEC
  if (part.hits.length === 0) return 1

  const start = densestWindowStart(part, windowSec)
  const end = start + windowSec
  const sampleRate = DRUM_KIT_SAMPLE_RATE
  const frames = Math.max(1, Math.ceil(windowSec * sampleRate))
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)

  // `mixDrumEvents` speaks ORIGINAL time and does its own trim/shift, so feed
  // it synthetic events whose "original" time is already mix time, with the
  // window's start as the trim in-point and no extra shift. The window then
  // lands at 0 in the scratch buffer.
  const windowed: DrumMidiEvent[] = []
  for (const h of part.hits) {
    if (h.mixTimeSec < start || h.mixTimeSec >= end) continue
    // Undo the velocity curve — `mixDrumEvents` re-applies it. Storing the
    // gain rather than the velocity is what keeps the live path cheap, so the
    // inverse lives here rather than making the part carry both.
    windowed.push({ timeSec: h.mixTimeSec, cls: h.cls, velocity: inverseVelocityGain(h.gain) })
  }
  if (windowed.length === 0) return 1

  mixDrumEvents(l, r, sampleRate, windowed, kit, start, end, 0)
  applyReverb(l, r, sampleRate)
  applyBusCompression(l, r, sampleRate)
  applySaturation(l)
  applySaturation(r)

  // Measure by asking the real normalizer what it would do: run it on a copy
  // and read back the ratio, so the two can't disagree about floors, the peak
  // ceiling, or the target.
  const probeL = Float32Array.from(l)
  const probeR = Float32Array.from(r)
  const before = peakOf(probeL, probeR)
  normalizeDrumBuffer([probeL, probeR], opts.targetRmsDb ?? DRUM_TRACK_TARGET_RMS_DB)
  const after = peakOf(probeL, probeR)
  if (!(before > 0) || !(after > 0)) return 1
  return after / before
}

function peakOf(a: Float32Array, b: Float32Array): number {
  let p = 0
  for (const v of a) p = Math.max(p, Math.abs(v))
  for (const v of b) p = Math.max(p, Math.abs(v))
  return p
}

/** Inverse of `drumVelocityGain(v) = 0.25 + 0.75·v²`. */
function inverseVelocityGain(gain: number): number {
  const v = Math.sqrt(Math.max(0, (gain - 0.25) / 0.75))
  return Math.max(0, Math.min(1, v))
}
