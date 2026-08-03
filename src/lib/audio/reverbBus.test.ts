import { describe, expect, it } from 'vitest'
import { DEFAULT_REVERB, REVERB_PRESETS, normalizeReverb } from './reverbBus'

describe('reverb settings', () => {
  it('fills in a partial setting rather than producing nothing', () => {
    const r = normalizeReverb({ sizeSec: 2.5 })
    expect(r.sizeSec).toBe(2.5)
    expect(r.dampHz).toBe(DEFAULT_REVERB.dampHz)
    expect(r.preDelaySec).toBe(DEFAULT_REVERB.preDelaySec)
  })

  it('clamps nonsense into a usable range', () => {
    const r = normalizeReverb({ sizeSec: 999, dampHz: -5, preDelaySec: 10 })
    expect(r.sizeSec).toBeLessThanOrEqual(8)
    expect(r.dampHz).toBeGreaterThanOrEqual(500)
    expect(r.preDelaySec).toBeLessThanOrEqual(0.25)
  })

  it('every preset is already normalized', () => {
    for (const p of REVERB_PRESETS) {
      expect(normalizeReverb(p.settings), p.id).toEqual(p.settings)
    }
  })

  it('presets differ in size — that is what makes them presets', () => {
    const sizes = REVERB_PRESETS.map((p) => p.settings.sizeSec)
    expect(new Set(sizes).size).toBe(sizes.length)
  })
})
