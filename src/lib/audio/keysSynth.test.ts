import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, DEFAULT_PATCH, midiNoteToFreq, structuredClonePatch, velocityToGain } from './keysSynth'

describe('midiNoteToFreq', () => {
  it('maps standard reference notes', () => {
    expect(midiNoteToFreq(69)).toBeCloseTo(440, 6) // A4
    expect(midiNoteToFreq(81)).toBeCloseTo(880, 6) // A5
    expect(midiNoteToFreq(57)).toBeCloseTo(220, 6) // A3
    expect(midiNoteToFreq(60)).toBeCloseTo(261.6256, 3) // middle C
  })
  it('is monotonic across the keybed range (48..72)', () => {
    for (let n = 48; n < 72; n++) {
      expect(midiNoteToFreq(n + 1)).toBeGreaterThan(midiNoteToFreq(n))
    }
  })
})

describe('velocityToGain', () => {
  it('is bounded and monotone', () => {
    expect(velocityToGain(0)).toBeCloseTo(0.25, 5) // a soft floor, never silent
    expect(velocityToGain(127)).toBeCloseTo(1, 5)
    expect(velocityToGain(64)).toBeGreaterThan(velocityToGain(20))
    expect(velocityToGain(20)).toBeGreaterThanOrEqual(0.25)
  })
  it('clamps out-of-range input', () => {
    expect(velocityToGain(-10)).toBeCloseTo(0.25, 5)
    expect(velocityToGain(999)).toBeCloseTo(1, 5)
  })
})

describe('BUILTIN_PRESETS', () => {
  it('are all well-formed, uniquely-named patches', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThan(4)
    const names = BUILTIN_PRESETS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length) // unique
    for (const p of BUILTIN_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.oscA.level).toBeGreaterThan(0)
      expect(p.env.release).toBeGreaterThan(0)
      expect(p.fx.reverbSize).toBeGreaterThan(0)
    }
  })
})

describe('structuredClonePatch', () => {
  it('deep-copies so edits do not mutate the source', () => {
    const copy = structuredClonePatch(DEFAULT_PATCH)
    copy.oscA.type = 'square'
    copy.fx.reverbMix = 0.9
    expect(DEFAULT_PATCH.oscA.type).not.toBe('square')
    expect(DEFAULT_PATCH.fx.reverbMix).not.toBe(0.9)
  })
})
