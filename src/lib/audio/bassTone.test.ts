import { describe, expect, it } from 'vitest'
import {
  BASS_TONE_PRESETS,
  DEFAULT_BASS_TONE,
  normalizeBassTone,
  type BassTone,
} from './bassTone'
import { BASS_PATCH } from './chordBass'

describe('bass tone parameters', () => {
  it("defaults to the chords view's bass patch, field for field", () => {
    // The whole point of the default is that it IS the sound already in the
    // app — including the oscillator LEVELS, which carry much of its weight.
    expect(DEFAULT_BASS_TONE.waveA).toBe(BASS_PATCH.oscA.type)
    expect(DEFAULT_BASS_TONE.waveB).toBe(BASS_PATCH.oscB.type)
    expect(DEFAULT_BASS_TONE.levelA).toBe(BASS_PATCH.oscA.level)
    expect(DEFAULT_BASS_TONE.levelB).toBe(BASS_PATCH.oscB.level)
    expect(DEFAULT_BASS_TONE.detuneA).toBe(BASS_PATCH.oscA.detune)
    expect(DEFAULT_BASS_TONE.detuneB).toBe(BASS_PATCH.oscB.detune)
    expect(DEFAULT_BASS_TONE.cutoffHz).toBe(BASS_PATCH.filter.cutoffHz)
    expect(DEFAULT_BASS_TONE.resonance).toBe(BASS_PATCH.filter.resonance)
    expect(DEFAULT_BASS_TONE.velToCutoff).toBe(BASS_PATCH.filter.velToCutoff)
    expect(DEFAULT_BASS_TONE.attack).toBe(BASS_PATCH.env.attack)
    expect(DEFAULT_BASS_TONE.decay).toBe(BASS_PATCH.env.decay)
    expect(DEFAULT_BASS_TONE.sustain).toBe(BASS_PATCH.env.sustain)
    expect(DEFAULT_BASS_TONE.release).toBe(BASS_PATCH.env.release)
    expect(DEFAULT_BASS_TONE.drive).toBe(BASS_PATCH.fx.drive)
  })

  it('fills in a partial tone rather than rendering silence', () => {
    const t = normalizeBassTone({ cutoffHz: 900 })
    expect(t.cutoffHz).toBe(900)
    expect(t.waveA).toBe(DEFAULT_BASS_TONE.waveA)
    expect(t.decay).toBe(DEFAULT_BASS_TONE.decay)
  })

  it('clamps nonsense into range', () => {
    const t = normalizeBassTone({
      cutoffHz: 1e9,
      resonance: -5,
      levelA: 9,
      detuneA: 9999,
      waveA: 'kazoo' as never,
    } as Partial<BassTone>)
    expect(t.cutoffHz).toBeLessThanOrEqual(8000)
    expect(t.resonance).toBeGreaterThanOrEqual(0)
    expect(t.levelA).toBeLessThanOrEqual(1)
    expect(Math.abs(t.detuneA)).toBeLessThanOrEqual(50)
    expect(t.waveA).toBe(DEFAULT_BASS_TONE.waveA)
  })

  it('every preset is a complete, valid tone', () => {
    for (const p of BASS_TONE_PRESETS) {
      expect(normalizeBassTone(p.tone), p.id).toEqual(p.tone)
    }
  })

  it('presets are actually distinct from each other', () => {
    const seen = new Set(BASS_TONE_PRESETS.map((p) => JSON.stringify(p.tone)))
    expect(seen.size).toBe(BASS_TONE_PRESETS.length)
  })
})
