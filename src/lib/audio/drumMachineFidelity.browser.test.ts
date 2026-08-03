/**
 * "Does the live drum track sound like the render?" — measured, end to end.
 *
 * The other tests check pieces (the bus, the scheduler, the loudness gain).
 * This one takes a REAL generated part — `generateDrumGroove` over a real grid
 * with sections, fills and per-section overrides — and renders it BOTH ways:
 *
 *   reference: mixDrumEvents → applyReverb → applyBusCompression
 *              → applySaturation → normalizeDrumBuffer      (today's WAV path)
 *   live:      createDrumMidiInstrument → schedule → OfflineAudioContext
 *
 * then compares them as a listener would: overall level, spectral balance,
 * stereo image, and where the transients actually land.
 *
 * Everything runs at 44.1 kHz — the kit's own rate — so neither path has a
 * resampler in it and any difference is genuinely the signal chain.
 */
import { describe, expect, it } from 'vitest'
import { createDrumMidiInstrument } from './drumMidiInstrument'
import { buildDrumPart, drumTrackLayout } from './drumPart'
import { measureDrumNormalizeGain } from './drumNormalizeGain'
import { generateDrumGroove } from '$lib/songmap/generateDrumGroove'
import {
  DRUM_TRACK_TARGET_RMS_DB,
  mixDrumEvents,
  normalizeDrumBuffer,
} from './renderDrumTrack'
import { applyBusCompression, applyReverb, applySaturation } from './drumBus'
import { buildSynthKit, type DrumKit } from './drumKits'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Bar, Beat, Section, SongMap } from '$lib/songmap/types'

const SR = 44100
const kit = (): DrumKit => ({ id: 'synth', label: 'Electronic kit', voices: buildSynthKit() })

const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x))
const rms = (b: Float32Array, from = 0, to = b.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

/** One-pole band energy — enough to compare spectral balance robustly. */
function bandRms(b: Float32Array, loHz: number, hiHz: number): number {
  const a1 = Math.exp((-2 * Math.PI * loHz) / SR)
  const a2 = Math.exp((-2 * Math.PI * hiHz) / SR)
  let lp1 = 0
  let lp2 = 0
  let s = 0
  for (let i = 0; i < b.length; i++) {
    lp1 = b[i]! + (lp1 - b[i]!) * a1 // below hi
    lp2 = b[i]! + (lp2 - b[i]!) * a2 // below lo
    const v = lp1 - lp2
    s += v * v
  }
  return Math.sqrt(s / Math.max(1, b.length))
}

/** ~16 s of real song: 4/4, two sections, so fills and overrides are exercised. */
function song(): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  const trimStart = 1
  for (let i = 0; i < 8; i++) {
    const start = trimStart + i * 2
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: start,
      endSec: start + 2,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
    })
    for (let j = 0; j < 4; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: start + j * 0.5 })
    }
  }
  const sections: Section[] = [
    { id: 'v1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 3 } },
    { id: 'c1', kind: 'chorus', label: 'Chorus', barRange: { startBarIndex: 4, endBarIndex: 7 } },
  ]
  return {
    ...createEmptySongMap(),
    timeline: { bars, beats },
    sections,
    audio: { trim: { startSec: trimStart, endSec: trimStart + 16 } } as SongMap['audio'],
    drumMachine: {
      enabled: true,
      style: 'rock',
      fills: 1,
      perSection: { c1: { style: 'disco', complexity: 0.9 } },
    },
  }
}

/** Today's WAV pipeline, in full. */
function referenceRender(sm: SongMap, k: DrumKit) {
  const layout = drumTrackLayout(sm)!
  const events = generateDrumGroove(sm, sm.drumMachine!)
  const frames = Math.max(1, Math.ceil(layout.durationSec * SR))
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  mixDrumEvents(l, r, SR, events, k, layout.trimStartSec, layout.trimEndSec, layout.shiftSec)
  applyReverb(l, r, SR)
  applyBusCompression(l, r, SR)
  applySaturation(l)
  applySaturation(r)
  normalizeDrumBuffer([l, r], DRUM_TRACK_TARGET_RMS_DB)
  return { l, r, frames }
}

/** The live instrument, rendered offline. */
async function liveRender(sm: SongMap, k: DrumKit, frames: number) {
  const layout = drumTrackLayout(sm)!
  const part = buildDrumPart(generateDrumGroove(sm, sm.drumMachine!), layout)
  const ctx = new OfflineAudioContext(2, frames, SR)
  const inst = await createDrumMidiInstrument(ctx, {
    part,
    kit: k,
    normalizeGain: measureDrumNormalizeGain(part, k),
  })
  inst.output.connect(ctx.destination)
  inst.schedule(0, 0, 1)
  // The instrument schedules a ROLLING WINDOW, so the transport tops it up each
  // frame. Offline there is no transport, so drive it here — without this only
  // the first window's hits exist and the comparison silently measures a
  // truncated track (it showed up as a 3.3 dB level gap and 0.61 envelope
  // correlation, which looks like a fidelity bug but is a harness gap).
  const totalSec = frames / SR
  for (let p = 0; p < totalSec; p += 1) inst.tick?.(p)
  const out = await ctx.startRendering()
  return { l: out.getChannelData(0).slice(), r: out.getChannelData(1).slice() }
}

describe('drum machine: live vs rendered', () => {
  it('is the same track by every measure a listener would notice', async () => {
    const sm = song()
    const k = kit()
    const ref = referenceRender(sm, k)
    const live = await liveRender(sm, k, ref.frames)

    // 1. Overall level — the thing the normalize stage exists to control.
    const levelErr = Math.abs(db(rms(live.l)) - db(rms(ref.l)))
    console.log(`level err ${levelErr.toFixed(2)} dB`)
    expect(levelErr, `level within 1.5 dB (was ${levelErr.toFixed(2)})`).toBeLessThan(1.5)

    // 2. Spectral balance — catches a wrong filter, a missing reverb, a
    //    saturation stage that clips instead of saturating.
    const bands: [number, number][] = [
      [40, 120],
      [120, 400],
      [400, 1200],
      [1200, 4000],
      [4000, 12000],
    ]
    for (const [lo, hi] of bands) {
      const err = Math.abs(db(bandRms(live.l, lo, hi)) - db(bandRms(ref.l, lo, hi)))
      console.log(`band ${lo}-${hi}Hz err ${err.toFixed(2)} dB`)
      expect(err, `${lo}-${hi} Hz within 2.5 dB (was ${err.toFixed(2)})`).toBeLessThan(2.5)
    }

    // 3. Stereo image — proves the per-voice pans and the reverb's L/R skew.
    const spread = (a: Float32Array, b: Float32Array) => db(rms(a)) - db(rms(b))
    const imgErr = Math.abs(spread(live.l, live.r) - spread(ref.l, ref.r))
    console.log(`stereo image err ${imgErr.toFixed(2)} dB`)
    expect(imgErr, `stereo image within 0.6 dB (was ${imgErr.toFixed(2)})`).toBeLessThan(0.6)

    // 4. Peak — a hidden clipper would show up here.
    const peakErr = Math.abs(db(peak(live.l)) - db(peak(ref.l)))
    expect(peakErr, `peak within 2 dB (was ${peakErr.toFixed(2)})`).toBeLessThan(2)
  })

  it('the hits land at the same moments — no drift across the whole track', async () => {
    // Energy per 100 ms window. If the live part were even slightly ahead or
    // behind, the busy windows would stop lining up by the end of the track.
    const sm = song()
    const k = kit()
    const ref = referenceRender(sm, k)
    const live = await liveRender(sm, k, ref.frames)

    const win = Math.floor(0.1 * SR)
    const refE: number[] = []
    const liveE: number[] = []
    for (let i = 0; i + win < ref.frames; i += win) {
      refE.push(rms(ref.l, i, i + win))
      liveE.push(rms(live.l, i, i + win))
    }
    // Correlate the two envelopes; drift would drop this well below 1.
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    const mr = mean(refE)
    const ml = mean(liveE)
    let num = 0
    let dr = 0
    let dl = 0
    for (let i = 0; i < refE.length; i++) {
      num += (refE[i]! - mr) * (liveE[i]! - ml)
      dr += (refE[i]! - mr) ** 2
      dl += (liveE[i]! - ml) ** 2
    }
    const corr = num / Math.sqrt(Math.max(1e-12, dr * dl))
    console.log(`envelope correlation ${corr.toFixed(4)}`)
    expect(corr, `envelope correlation (was ${corr.toFixed(4)})`).toBeGreaterThan(0.97)
  })
})
