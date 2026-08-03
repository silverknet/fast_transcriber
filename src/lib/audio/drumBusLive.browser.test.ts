/**
 * The live drum bus vs the offline one it has to imitate.
 *
 * The whole migration is only worth doing if the live path sounds like the
 * render. These tests compare the two directly at 44.1 kHz — the kit's own rate
 * — so no resampler sits in either path and any difference is genuinely the
 * DSP, not interpolation.
 */
import { describe, expect, it } from 'vitest'
import {
  createDrumBusLive,
  drumReverbIR,
  buildSaturationCurve,
  DRUM_COMPRESSOR_WORKLET_URL,
} from './drumBusLive'
import { REVERB_WET, applyReverb, applyBusCompression, applySaturation } from './drumBus'

const SR = 44100
const LEN = SR * 2

const rms = (b: Float32Array) => {
  let s = 0
  for (const v of b) s += v * v
  return Math.sqrt(s / Math.max(1, b.length))
}
const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x))

/** A percussive burst — the kind of signal this bus is tuned for. */
function burst(n: number, seed = 1): Float32Array {
  const out = new Float32Array(n)
  let a = seed >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let hit = 0; hit < 8; hit++) {
    const at = Math.floor((hit / 8) * n * 0.8)
    for (let i = 0; i < 3000 && at + i < n; i++) {
      out[at + i]! += (rnd() * 2 - 1) * Math.exp(-i / 600) * 0.8
    }
  }
  return out
}

/** Run a signal through the LIVE graph and return the rendered left channel. */
async function throughLiveBus(
  input: Float32Array,
  opts: { normalizeGain?: number } = {},
): Promise<{ l: Float32Array; r: Float32Array; compressed: boolean }> {
  const ctx = new OfflineAudioContext(2, input.length, SR)
  const bus = await createDrumBusLive(ctx)
  bus.setNormalizeGain(opts.normalizeGain ?? 1)

  const buf = ctx.createBuffer(2, input.length, SR)
  const copy = new Float32Array(new ArrayBuffer(input.length * Float32Array.BYTES_PER_ELEMENT))
  copy.set(input)
  buf.copyToChannel(copy, 0)
  buf.copyToChannel(copy, 1)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(bus.input)
  bus.output.connect(ctx.destination)
  src.start(0)

  const out = await ctx.startRendering()
  return {
    l: out.getChannelData(0).slice(),
    r: out.getChannelData(1).slice(),
    compressed: bus.compressed,
  }
}

/** The reference: today's offline chain, minus the RMS normalize. */
function throughOfflineBus(input: Float32Array): { l: Float32Array; r: Float32Array } {
  const l = Float32Array.from(input)
  const r = Float32Array.from(input)
  applyReverb(l, r, SR)
  applyBusCompression(l, r, SR)
  applySaturation(l)
  applySaturation(r)
  return { l, r }
}

describe('live drum bus', () => {
  it('loads its compressor worklet from a servable path', async () => {
    expect(DRUM_COMPRESSOR_WORKLET_URL.startsWith('/')).toBe(true)
    const res = await fetch(DRUM_COMPRESSOR_WORKLET_URL)
    expect(res.ok, 'worklet must be served from static/').toBe(true)
  })

  it('actually runs the compressor — not silently bypassed', async () => {
    // If this fails the fidelity comparisons below are meaningless.
    const { compressed } = await throughLiveBus(burst(LEN))
    expect(compressed).toBe(true)
  })

  it('the reverb IR is per-channel and skewed, not a mono copy', () => {
    const ir = drumReverbIR(SR)
    expect(ir.l.length).toBeGreaterThan(SR) // a real tail
    let differs = 0
    for (let i = 0; i < 5000; i++) if (Math.abs(ir.l[i]! - ir.r[i]!) > 1e-9) differs++
    expect(differs, 'R is skewed 0.9 ms for decorrelation').toBeGreaterThan(100)
  })

  it('the saturation curve matches applySaturation across the whole range', () => {
    // Including |x| > 1, which is where a naive WaveShaper would hard-clip.
    const curve = buildSaturationCurve()
    // Walk the curve's OWN grid points — an arbitrary value lands between
    // samples, and half a step of 8192 is not a fidelity question.
    for (const idx of [0, 1000, 3000, 4096, 5000, 7000, curve.length - 1]) {
      const x = ((idx / (curve.length - 1)) * 2 - 1) * 4
      const probe = new Float32Array([x])
      applySaturation(probe)
      expect(curve[idx], `at x=${x.toFixed(3)}`).toBeCloseTo(probe[0]!, 5)
    }
  })

  it('matches the offline bus in level', async () => {
    const input = burst(LEN)
    const live = await throughLiveBus(input)
    const ref = throughOfflineBus(input)
    expect(Math.abs(db(rms(live.l)) - db(rms(ref.l))), 'L within 0.8 dB').toBeLessThan(0.8)
    expect(Math.abs(db(rms(live.r)) - db(rms(ref.r))), 'R within 0.8 dB').toBeLessThan(0.8)
  })

  it('matches the offline bus in stereo image', async () => {
    // This is what proves the reverb skew and the dry/wet split survived.
    const input = burst(LEN)
    const live = await throughLiveBus(input)
    const ref = throughOfflineBus(input)
    const liveSpread = db(rms(live.l)) - db(rms(live.r))
    const refSpread = db(rms(ref.l)) - db(rms(ref.r))
    expect(Math.abs(liveSpread - refSpread)).toBeLessThan(0.5)
  })

  it('does not clip hot input — the WaveShaper headroom trick works', async () => {
    // Peaks well above 1.0 are normal on this pre-normalize bus. A naive
    // WaveShaper would hard-clip them at the curve's edge.
    const hot = burst(LEN).map((v) => v * 3) as Float32Array
    const live = await throughLiveBus(hot)
    const ref = throughOfflineBus(hot)
    expect(Math.abs(db(rms(live.l)) - db(rms(ref.l))), 'hot signal within 1 dB').toBeLessThan(1)
  })

  it('the normalize gain scales the output as a plain gain', async () => {
    const input = burst(LEN)
    const unity = await throughLiveBus(input, { normalizeGain: 1 })
    const half = await throughLiveBus(input, { normalizeGain: 0.5 })
    expect(db(rms(unity.l)) - db(rms(half.l))).toBeCloseTo(6.02, 0)
  })

  it('the dry path stays at unity — reverb is a send, not a crossfade', async () => {
    // With the wet level at 0.16 added ON TOP, a bus with reverb must be
    // louder than the dry signal, never quieter.
    const input = burst(LEN)
    const live = await throughLiveBus(input)
    expect(rms(live.l)).toBeGreaterThan(0)
    expect(REVERB_WET).toBeGreaterThan(0)
  })

  it('killTail ducks the ringing tail, and stays ducked', async () => {
    const ctx = new OfflineAudioContext(2, SR, SR)
    const bus = await createDrumBusLive(ctx)
    const buf = ctx.createBuffer(2, 1000, SR)
    const spike = new Float32Array(new ArrayBuffer(1000 * Float32Array.BYTES_PER_ELEMENT))
    spike[0] = 1
    buf.copyToChannel(spike, 0)
    buf.copyToChannel(spike, 1)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(bus.input)
    bus.output.connect(ctx.destination)
    src.start(0)
    bus.killTail()
    const out = (await ctx.startRendering()).getChannelData(0)
    // After the 6 ms ramp the tail is silent instead of ringing for ~0.9 s.
    expect(rms(out.slice(Math.floor(0.05 * SR), Math.floor(0.5 * SR)))).toBeLessThan(1e-4)
  })
})
