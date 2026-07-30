import { describe, expect, it } from 'vitest'
import { buildChannelEqChain, defaultChannelEq, type ChannelEq } from './channelEq'

/**
 * An EQ's only claim is about FREQUENCY RESPONSE, so measure it: render a sine
 * at a known frequency through the real biquad chain and compare its level with
 * and without the EQ. Real Chromium biquads — a mocked context has no response
 * curve at all.
 */

const SR = 44100
const SECONDS = 0.5

/** Render a steady sine through the EQ; returns RMS of the settled portion. */
async function rmsThroughEq(freqHz: number, eq: ChannelEq | undefined): Promise<number> {
  const len = Math.floor(SR * SECONDS)
  const ctx = new OfflineAudioContext(1, len, SR)
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freqHz

  const chain = buildChannelEqChain(ctx, eq)
  if (chain) {
    osc.connect(chain.input)
    chain.output.connect(ctx.destination)
  } else {
    osc.connect(ctx.destination)
  }
  osc.start(0)
  osc.stop(SECONDS)

  const out = await ctx.startRendering()
  const d = out.getChannelData(0)
  // Skip the first 100 ms so filter settling doesn't skew the measurement.
  const from = Math.floor(0.1 * SR)
  let sum = 0
  for (let i = from; i < d.length; i++) sum += d[i]! * d[i]!
  return Math.sqrt(sum / (d.length - from))
}

/** Level change the EQ applies at a frequency, in dB. */
async function gainDbAt(freqHz: number, eq: ChannelEq): Promise<number> {
  const dry = await rmsThroughEq(freqHz, undefined)
  const wet = await rmsThroughEq(freqHz, eq)
  return 20 * Math.log10(Math.max(wet, 1e-9) / Math.max(dry, 1e-9))
}

describe('channel EQ — measured response (real browser)', () => {
  it('a flat EQ builds no chain at all', () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    expect(buildChannelEqChain(ctx, defaultChannelEq())).toBeNull()
    expect(buildChannelEqChain(ctx, undefined)).toBeNull()
  })

  it('a low-shelf boost lifts the lows and leaves the highs alone', async () => {
    const eq: ChannelEq = { low: { freq: 90, gain: 8 } }
    expect(await gainDbAt(60, eq)).toBeGreaterThan(5)
    expect(Math.abs(await gainDbAt(8000, eq))).toBeLessThan(1)
  }, 30_000)

  it('a low-shelf cut drops the lows', async () => {
    expect(await gainDbAt(60, { low: { freq: 90, gain: -8 } })).toBeLessThan(-5)
  }, 30_000)

  it('a high-shelf boost lifts the highs and leaves the lows alone', async () => {
    const eq: ChannelEq = { high: { freq: 8000, gain: 8 } }
    expect(await gainDbAt(12000, eq)).toBeGreaterThan(5)
    expect(Math.abs(await gainDbAt(100, eq))).toBeLessThan(1)
  }, 30_000)

  it('a mid peak is local — it moves its own frequency, not its neighbours', async () => {
    const eq: ChannelEq = { lowMid: { freq: 500, gain: 10, q: 2 } }
    expect(await gainDbAt(500, eq)).toBeGreaterThan(7)
    expect(Math.abs(await gainDbAt(60, eq))).toBeLessThan(1.5)
    expect(Math.abs(await gainDbAt(10000, eq))).toBeLessThan(1.5)
  }, 30_000)

  it('a narrow Q is tighter than a wide one at the same boost', async () => {
    const at = 1200
    const narrow = await gainDbAt(at, { lowMid: { freq: 400, gain: 10, q: 4 } })
    const wide = await gainDbAt(at, { lowMid: { freq: 400, gain: 10, q: 0.5 } })
    expect(narrow).toBeLessThan(wide) // less bleed an octave and a half up
  }, 30_000)

  it('the high-pass removes lows and passes the rest', async () => {
    const eq: ChannelEq = { hpf: 200 }
    expect(await gainDbAt(50, eq)).toBeLessThan(-12)
    expect(Math.abs(await gainDbAt(2000, eq))).toBeLessThan(1)
  }, 30_000)

  it('bypass really bypasses — no chain, whatever the bands say', () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const eq: ChannelEq = { enabled: false, hpf: 200, low: { freq: 90, gain: 12 } }
    expect(buildChannelEqChain(ctx, eq)).toBeNull()
  })

  it('stacks bands — a boost and a cut both land', async () => {
    const eq: ChannelEq = { low: { freq: 90, gain: 8 }, high: { freq: 8000, gain: -8 } }
    expect(await gainDbAt(60, eq)).toBeGreaterThan(5)
    expect(await gainDbAt(12000, eq)).toBeLessThan(-5)
  }, 30_000)
})
