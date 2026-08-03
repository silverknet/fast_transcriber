/**
 * The rig test signal, rendered offline so its actual output can be measured.
 *
 * This plays into in-ear monitors, sometimes on someone else's head, so the
 * safety properties are tested rather than trusted: the level ceiling holds
 * whatever a caller passes, and nothing ever starts or stops with a click.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEST_LEVEL_DB,
  MAX_TEST_LEVEL_DB,
  clampTestLevelDb,
  dbToGain,
  sideGains,
  startRigTestSignal,
} from './rigTestSignal'

const SR = 44100

async function render(
  opts: Parameters<typeof startRigTestSignal>[2],
  seconds = 1,
): Promise<{ l: Float32Array; r: Float32Array }> {
  const ctx = new OfflineAudioContext(2, Math.floor(SR * seconds), SR)
  const sig = startRigTestSignal(ctx, ctx.destination, opts)
  expect(sig.running).toBe(true)
  const out = await ctx.startRendering()
  return { l: out.getChannelData(0).slice(), r: out.getChannelData(1).slice() }
}

const peak = (b: Float32Array, from = 0, to = b.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(b[i]!))
  return m
}

describe('side selection — the thing you are actually testing for', () => {
  it('left only puts signal on the left and silence on the right', async () => {
    const { l, r } = await render({ side: 'left', pulsed: false })
    expect(peak(l)).toBeGreaterThan(0.01)
    expect(peak(r)).toBeLessThan(1e-4)
  })

  it('right only is the mirror', async () => {
    const { l, r } = await render({ side: 'right', pulsed: false })
    expect(peak(r)).toBeGreaterThan(0.01)
    expect(peak(l)).toBeLessThan(1e-4)
  })

  it('both puts equal signal on each side', async () => {
    const { l, r } = await render({ side: 'both', pulsed: false })
    expect(peak(l)).toBeGreaterThan(0.01)
    expect(Math.abs(peak(l) - peak(r))).toBeLessThan(1e-3)
  })

  it('sideGains is the single definition of that mapping', () => {
    expect(sideGains('left')).toEqual({ left: 1, right: 0 })
    expect(sideGains('right')).toEqual({ left: 0, right: 1 })
    expect(sideGains('both')).toEqual({ left: 1, right: 1 })
  })
})

describe('level safety', () => {
  it('defaults to a level that is clearly audible and clearly safe', async () => {
    const { l } = await render({ pulsed: false })
    expect(peak(l)).toBeGreaterThan(dbToGain(DEFAULT_TEST_LEVEL_DB) * 0.8)
    expect(peak(l)).toBeLessThan(dbToGain(DEFAULT_TEST_LEVEL_DB) * 1.2)
  })

  it('CANNOT be pushed past the ceiling, whatever the caller asks for', async () => {
    // The ceiling lives in the generator, not the UI, so no caller can opt out.
    const { l } = await render({ levelDb: 0, pulsed: false })
    expect(peak(l)).toBeLessThanOrEqual(dbToGain(MAX_TEST_LEVEL_DB) * 1.05)
  })

  it('clamps absurd and non-finite input rather than throwing', () => {
    expect(clampTestLevelDb(999)).toBe(MAX_TEST_LEVEL_DB)
    expect(clampTestLevelDb(-999)).toBe(-60)
    expect(clampTestLevelDb(Number.NaN)).toBe(DEFAULT_TEST_LEVEL_DB)
  })
})

describe('no clicks — this goes into people’s ears', () => {
  it('ramps up rather than switching on', async () => {
    const { l } = await render({ pulsed: false })
    // The first sample must not already be at full level.
    expect(Math.abs(l[0]!)).toBeLessThan(0.01)
  })

  it('a stopped signal decays instead of cutting', async () => {
    const ctx = new OfflineAudioContext(2, SR, SR)
    const sig = startRigTestSignal(ctx, ctx.destination, { pulsed: false })
    sig.stop()
    expect(sig.running).toBe(false)
    const out = await ctx.startRendering()
    const l = out.getChannelData(0)
    // Ramped down within a few ms, and silent thereafter.
    expect(peak(l, Math.floor(0.1 * SR), SR)).toBeLessThan(1e-3)
  })

  it('stopping twice is harmless', () => {
    const ctx = new OfflineAudioContext(2, SR, SR)
    const sig = startRigTestSignal(ctx, ctx.destination, {})
    sig.stop()
    expect(() => sig.stop()).not.toThrow()
  })
})

describe('pulsing', () => {
  it('pulses by default — a steady tone stops reading as "arriving now"', async () => {
    const { l } = await render({}, 2)
    const win = (from: number, to: number) => peak(l, Math.floor(from * SR), Math.floor(to * SR))
    // On near the top of each second, off in between.
    expect(win(0.02, 0.2)).toBeGreaterThan(0.01)
    expect(win(0.5, 0.9)).toBeLessThan(1e-3)
    expect(win(1.02, 1.2)).toBeGreaterThan(0.01)
  })

  it('a steady tone really is continuous', async () => {
    const { l } = await render({ pulsed: false }, 2)
    expect(peak(l, Math.floor(0.5 * SR), Math.floor(0.9 * SR))).toBeGreaterThan(0.01)
  })
})

describe('live changes', () => {
  it('switching side takes effect without restarting', async () => {
    const ctx = new OfflineAudioContext(2, SR * 2, SR)
    const sig = startRigTestSignal(ctx, ctx.destination, { side: 'left', pulsed: false })
    sig.update({ side: 'right' })
    const out = await ctx.startRendering()
    // By the end, the right side carries it.
    expect(peak(out.getChannelData(1), Math.floor(1.5 * SR))).toBeGreaterThan(0.01)
  })

  it('update after stop is ignored rather than resurrecting the tone', async () => {
    const ctx = new OfflineAudioContext(2, SR, SR)
    const sig = startRigTestSignal(ctx, ctx.destination, { pulsed: false })
    sig.stop()
    sig.update({ levelDb: MAX_TEST_LEVEL_DB, side: 'both' })
    const out = await ctx.startRendering()
    expect(peak(out.getChannelData(0), Math.floor(0.2 * SR))).toBeLessThan(1e-3)
  })
})
