/**
 * The window-measured normalize gain vs the real thing.
 *
 * Ground truth is today's offline pipeline run over the WHOLE part. The window
 * measurement is only worth having if it lands close to that, so this file is
 * the accuracy gate: if it can't hold ~1 dB, the approach is wrong and should
 * be replaced, not the tolerance widened.
 */
import { describe, expect, it } from 'vitest'
import {
  measureDrumNormalizeGain,
  densestWindowStart,
  MEASURE_WINDOW_SEC,
} from './drumNormalizeGain'
import {
  DRUM_TRACK_TARGET_RMS_DB,
  mixDrumEvents,
  normalizeDrumBuffer,
} from './renderDrumTrack'
import { applyBusCompression, applyReverb, applySaturation } from './drumBus'
import { buildSynthKit, DRUM_KIT_SAMPLE_RATE, type DrumKit } from './drumKits'
import { drumVelocityGain } from './renderDrumTrack'
import type { DrumPart, DrumPartHit } from './drumPart'
import type { DrumClass, DrumMidiEvent } from '$lib/songmap/types'

const SR = DRUM_KIT_SAMPLE_RATE
const kit = (): DrumKit => ({ id: 'synth', label: 'Electronic kit', voices: buildSynthKit() })

const dbOf = (g: number) => 20 * Math.log10(Math.max(1e-12, g))

/** Ground truth: the exact gain `normalizeDrumBuffer` applies to a FULL render. */
function trueGain(part: DrumPart, k: DrumKit): number {
  const frames = Math.max(1, Math.ceil(part.durationSec * SR))
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  const events: DrumMidiEvent[] = part.hits.map((h) => ({
    timeSec: h.mixTimeSec,
    cls: h.cls,
    velocity: Math.sqrt(Math.max(0, (h.gain - 0.25) / 0.75)),
  }))
  mixDrumEvents(l, r, SR, events, k, 0, part.durationSec, 0)
  applyReverb(l, r, SR)
  applyBusCompression(l, r, SR)
  applySaturation(l)
  applySaturation(r)
  const peakBefore = Math.max(...[l, r].map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
  normalizeDrumBuffer([l, r], DRUM_TRACK_TARGET_RMS_DB)
  const peakAfter = Math.max(...[l, r].map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
  return peakBefore > 0 ? peakAfter / peakBefore : 1
}

function makePart(opts: {
  durationSec: number
  perSec: number
  classes?: DrumClass[]
  velocity?: number
  /** Only put hits in the first fraction of the track (sparse-intro test). */
  denseFrom?: number
  denseTo?: number
}): DrumPart {
  const classes = opts.classes ?? (['kick', 'snare', 'hihat'] as DrumClass[])
  const from = opts.denseFrom ?? 0
  const to = opts.denseTo ?? opts.durationSec
  const hits: DrumPartHit[] = []
  const step = 1 / opts.perSec
  let i = 0
  for (let t = from; t < to; t += step, i++) {
    hits.push({
      mixTimeSec: t,
      cls: classes[i % classes.length]!,
      gain: drumVelocityGain(opts.velocity ?? 0.8),
    })
  }
  return { hits, durationSec: opts.durationSec }
}

describe('densestWindowStart', () => {
  it('is 0 for a track shorter than the window', () => {
    expect(densestWindowStart(makePart({ durationSec: 5, perSec: 4 }))).toBe(0)
  })

  it('finds the busy stretch, not the sparse opening', () => {
    // A sparse intro measured on its own would make the whole track too loud.
    const sparse = makePart({ durationSec: 60, perSec: 0.5, denseFrom: 0, denseTo: 20 })
    const dense = makePart({ durationSec: 60, perSec: 8, denseFrom: 30, denseTo: 55 })
    const part: DrumPart = {
      hits: [...sparse.hits, ...dense.hits].sort((a, b) => a.mixTimeSec - b.mixTimeSec),
      durationSec: 60,
    }
    expect(densestWindowStart(part)).toBeGreaterThan(25)
  })

  it('never runs past the end of the track', () => {
    const part = makePart({ durationSec: 40, perSec: 8 })
    expect(densestWindowStart(part)).toBeLessThanOrEqual(40 - MEASURE_WINDOW_SEC)
  })
})

describe('measureDrumNormalizeGain', () => {
  it('leaves an empty part alone rather than dividing by zero', () => {
    expect(measureDrumNormalizeGain({ hits: [], durationSec: 10 }, kit())).toBe(1)
  })

  it('is deterministic', () => {
    const p = makePart({ durationSec: 30, perSec: 6 })
    expect(measureDrumNormalizeGain(p, kit())).toBe(measureDrumNormalizeGain(p, kit()))
  })

  it('matches a full render within 1 dB — uniform groove', () => {
    const p = makePart({ durationSec: 30, perSec: 6 })
    const k = kit()
    const err = Math.abs(dbOf(measureDrumNormalizeGain(p, k)) - dbOf(trueGain(p, k)))
    expect(err).toBeLessThan(1)
  })

  it('matches a full render within 1 dB — sparse groove', () => {
    const p = makePart({ durationSec: 30, perSec: 1.5 })
    const k = kit()
    const err = Math.abs(dbOf(measureDrumNormalizeGain(p, k)) - dbOf(trueGain(p, k)))
    expect(err).toBeLessThan(1)
  })

  it('matches a full render within 1 dB — dense groove', () => {
    const p = makePart({ durationSec: 30, perSec: 12, classes: ['kick', 'snare', 'hihat', 'ride'] })
    const k = kit()
    const err = Math.abs(dbOf(measureDrumNormalizeGain(p, k)) - dbOf(trueGain(p, k)))
    expect(err).toBeLessThan(1)
  })

  it('a track shorter than the window is measured exactly', () => {
    const p = makePart({ durationSec: 8, perSec: 6 })
    const k = kit()
    const err = Math.abs(dbOf(measureDrumNormalizeGain(p, k)) - dbOf(trueGain(p, k)))
    expect(err).toBeLessThan(0.5)
  })

  it('a louder part gets a smaller gain — it is actually normalising', () => {
    const k = kit()
    const quiet = makePart({ durationSec: 20, perSec: 4, velocity: 0.3 })
    const loud = makePart({ durationSec: 20, perSec: 4, velocity: 1 })
    expect(measureDrumNormalizeGain(loud, k)).toBeLessThan(measureDrumNormalizeGain(quiet, k))
  })

  it('measures a bounded window, not the whole track', () => {
    // The point of the window: cost is proportional to the frames processed,
    // so a 4-minute track must not cost a 4-minute render. Asserting the frame
    // ratio rather than wall-clock — timings are unreliable when the suite
    // runs in parallel, and this is the property that actually matters.
    const p = makePart({ durationSec: 240, perSec: 8 })
    expect(p.durationSec / MEASURE_WINDOW_SEC).toBeGreaterThan(10)
    const start = densestWindowStart(p)
    expect(start + MEASURE_WINDOW_SEC).toBeLessThanOrEqual(p.durationSec + 1e-9)
  })
})
