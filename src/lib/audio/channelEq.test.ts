import { describe, it, expect } from 'vitest'
import {
  clampChannelEq,
  defaultChannelEq,
  isEqActive,
  isEqWorthStoring,
  EQ_BAND_RANGE,
  EQ_GAIN_LIMIT_DB,
  EQ_HPF_MAX,
  type ChannelEq,
} from './channelEq'

describe('defaultChannelEq', () => {
  it('starts flat — a fresh EQ changes nothing', () => {
    expect(isEqActive(defaultChannelEq())).toBe(false)
  })

  it('puts every band inside its own frequency range', () => {
    const eq = defaultChannelEq()
    for (const id of ['low', 'lowMid', 'highMid', 'high'] as const) {
      const { min, max } = EQ_BAND_RANGE[id]
      expect(eq[id]!.freq).toBeGreaterThanOrEqual(min)
      expect(eq[id]!.freq).toBeLessThanOrEqual(max)
    }
  })
})

describe('isEqActive', () => {
  it('is false for absent, flat, or bypassed', () => {
    expect(isEqActive(undefined)).toBe(false)
    expect(isEqActive({})).toBe(false)
    expect(isEqActive({ enabled: false, low: { freq: 90, gain: 6 } })).toBe(false)
  })

  it('is true once a band moves or the high-pass engages', () => {
    expect(isEqActive({ low: { freq: 90, gain: 4 } })).toBe(true)
    expect(isEqActive({ high: { freq: 9000, gain: -3 } })).toBe(true)
    expect(isEqActive({ hpf: 80 })).toBe(true)
  })

  it('treats a hair off zero as flat, so float noise builds no nodes', () => {
    expect(isEqActive({ low: { freq: 90, gain: 0.01 } })).toBe(false)
  })

  it('ignores a high-pass below the usable minimum', () => {
    expect(isEqActive({ hpf: 5 })).toBe(false)
  })
})

describe('isEqWorthStoring', () => {
  it('remembers a deliberately bypassed EQ that is not flat', () => {
    const eq: ChannelEq = { enabled: false, low: { freq: 90, gain: 6 } }
    expect(isEqActive(eq)).toBe(false) // silent now…
    expect(isEqWorthStoring(eq)).toBe(true) // …but do not throw the settings away
  })

  it('does not store a flat EQ', () => {
    expect(isEqWorthStoring(defaultChannelEq())).toBe(false)
    expect(isEqWorthStoring(undefined)).toBe(false)
  })
})

describe('clampChannelEq', () => {
  it('rejects non-objects', () => {
    expect(clampChannelEq(null)).toBeUndefined()
    expect(clampChannelEq('loud')).toBeUndefined()
    expect(clampChannelEq(7)).toBeUndefined()
  })

  it('clamps gain to the limit in both directions', () => {
    const eq = clampChannelEq({ low: { freq: 90, gain: 99 }, high: { freq: 9000, gain: -99 } })!
    expect(eq.low!.gain).toBe(EQ_GAIN_LIMIT_DB)
    expect(eq.high!.gain).toBe(-EQ_GAIN_LIMIT_DB)
  })

  it('clamps each band into its own frequency range', () => {
    const eq = clampChannelEq({ low: { freq: 9000, gain: 2 }, highMid: { freq: 1, gain: 2 } })!
    expect(eq.low!.freq).toBe(EQ_BAND_RANGE.low.max)
    expect(eq.highMid!.freq).toBe(EQ_BAND_RANGE.highMid.min)
  })

  it('clamps the high-pass and drops a zero one', () => {
    expect(clampChannelEq({ hpf: 5000 })!.hpf).toBe(EQ_HPF_MAX)
    expect(clampChannelEq({ hpf: 0 })!.hpf).toBeUndefined()
  })

  it('survives junk bands instead of throwing', () => {
    const eq = clampChannelEq({ low: 'nope', lowMid: { freq: NaN, gain: NaN } })!
    expect(eq.low).toBeUndefined()
    expect(eq.lowMid!.gain).toBe(0)
    expect(Number.isFinite(eq.lowMid!.freq)).toBe(true)
  })

  it('gives the peaking bands a Q and leaves the shelves without one', () => {
    const eq = clampChannelEq({ low: { freq: 90, gain: 1 }, lowMid: { freq: 350, gain: 1 } })!
    expect(eq.low!.q).toBeUndefined()
    expect(eq.lowMid!.q).toBe(1)
  })

  it('clamps an extreme Q into a usable range', () => {
    expect(clampChannelEq({ lowMid: { freq: 350, gain: 1, q: 999 } })!.lowMid!.q).toBeLessThanOrEqual(6)
    expect(clampChannelEq({ lowMid: { freq: 350, gain: 1, q: 0 } })!.lowMid!.q).toBeGreaterThan(0)
  })

  it('round-trips a valid EQ unchanged', () => {
    const eq: ChannelEq = {
      enabled: true,
      hpf: 80,
      low: { freq: 100, gain: 3 },
      lowMid: { freq: 400, gain: -2, q: 1.4 },
      highMid: { freq: 3000, gain: 2, q: 0.8 },
      high: { freq: 10000, gain: 1.5 },
    }
    expect(clampChannelEq(JSON.parse(JSON.stringify(eq)))).toEqual(eq)
  })
})
