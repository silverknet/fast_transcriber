import { describe, expect, it } from 'vitest'
import { buildSynthKit, buildAcousticFallbackVoices, DRUM_KIT_SAMPLE_RATE } from './drumKits'
import { drumVelocityGain, mixDrumEvents, normalizeDrumBuffer } from './renderDrumTrack'
import type { DrumClass, DrumMidiEvent } from '$lib/songmap/types'

function hashOf(buf: Float32Array): number {
  let h = 5381
  for (let i = 0; i < buf.length; i += 7) {
    h = (h * 33) ^ Math.round(buf[i]! * 1e6)
  }
  return h >>> 0
}

describe('drum kits', () => {
  it('synth kit is deterministic, finite, peak-bounded', () => {
    const a = buildSynthKit()
    const b = buildSynthKit()
    for (const cls of Object.keys(a) as DrumClass[]) {
      expect(hashOf(a[cls])).toBe(hashOf(b[cls])) // seeded PRNG → identical
      let peak = 0
      for (const v of a[cls]) {
        expect(Number.isFinite(v)).toBe(true)
        peak = Math.max(peak, Math.abs(v))
      }
      expect(peak).toBeLessThanOrEqual(1)
      expect(a[cls].length).toBeGreaterThan(100)
    }
  })

  it('acoustic fallback differs audibly from the synth kit', () => {
    const synth = buildSynthKit()
    const ac = buildAcousticFallbackVoices()
    for (const cls of ['kick', 'snare', 'hihat'] as DrumClass[]) {
      expect(hashOf(ac[cls])).not.toBe(hashOf(synth[cls]))
    }
  })
})

describe('mixDrumEvents / normalizeDrumBuffer', () => {
  // Impulse kit: a single full-scale sample per voice → positions/gains are
  // directly observable in the output buffer.
  const impulseKit = {
    id: 'synth' as const,
    label: 'impulse',
    voices: Object.fromEntries(
      (['kick', 'snare', 'hihat', 'tom', 'cymbal'] as DrumClass[]).map((cls) => [
        cls,
        Float32Array.from([1]),
      ]),
    ) as Record<DrumClass, Float32Array>,
  }

  it('places events at shift + (t − trimStart), honors trim bounds', () => {
    const sr = DRUM_KIT_SAMPLE_RATE
    const dst = new Float32Array(sr * 4)
    const events: DrumMidiEvent[] = [
      { timeSec: 10.0, cls: 'kick', velocity: 1 }, // inside trim
      { timeSec: 9.0, cls: 'snare', velocity: 1 }, // before trim → excluded
      { timeSec: 20.5, cls: 'hihat', velocity: 1 }, // after trim → excluded
    ]
    mixDrumEvents(dst, sr, events, impulseKit, 9.5, 20, 1.0)
    const idx = Math.floor((1.0 + (10.0 - 9.5)) * sr)
    expect(dst[idx]).toBeCloseTo(drumVelocityGain(1), 5)
    const nonZero = dst.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)
    expect(nonZero).toBe(1) // the other two events were excluded
  })

  it('velocity curve keeps quiet hits audible and scales up', () => {
    expect(drumVelocityGain(0)).toBeCloseTo(0.25, 6)
    expect(drumVelocityGain(1)).toBeCloseTo(1, 6)
    expect(drumVelocityGain(0.5)).toBeGreaterThan(0.25)
    expect(drumVelocityGain(0.5)).toBeLessThan(1)
  })

  it('normalization brings different event densities to the same RMS', () => {
    const sr = 44100
    const rmsOf = (buf: Float32Array) => {
      let s = 0
      let n = 0
      for (const v of buf) {
        if (Math.abs(v) > 1e-3) {
          s += v * v
          n++
        }
      }
      return Math.sqrt(s / Math.max(1, n))
    }
    const sparse = new Float32Array(sr)
    const dense = new Float32Array(sr)
    for (let i = 0; i < sr; i += 11025) sparse[i] = 0.2
    for (let i = 0; i < sr; i += 1470) dense[i] = 0.7
    normalizeDrumBuffer(sparse)
    normalizeDrumBuffer(dense)
    const dbDiff = 20 * Math.log10(rmsOf(sparse) / rmsOf(dense))
    expect(Math.abs(dbDiff)).toBeLessThan(0.5)
  })

  it('normalization respects the peak ceiling', () => {
    const buf = new Float32Array(1000)
    buf[0] = 0.01 // very quiet → naive RMS gain would blow past 1.0
    normalizeDrumBuffer(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(0.951)
  })
})
