import { describe, expect, it } from 'vitest'
import type { ProjectMastering } from '$lib/project/types'
import {
  channelsRmsDb,
  dbToGain,
  loudnessMatchGainDb,
  stemCompressorPreset,
  stemKindForLaneKey,
  stemTotalGainDb,
} from './mastering'

describe('stemKindForLaneKey', () => {
  it('maps stem lanes by filename', () => {
    expect(stemKindForLaneKey('stem:bass.wav')).toBe('bass')
    expect(stemKindForLaneKey('stem:drums.wav')).toBe('drums')
    expect(stemKindForLaneKey('stem:vocals.wav')).toBe('vocals')
    expect(stemKindForLaneKey('stem:other.wav')).toBe('other')
    expect(stemKindForLaneKey('stem:Bass_v2.wav')).toBe('bass')
  })

  it('unknown stem filenames fall back to other', () => {
    expect(stemKindForLaneKey('stem:guitar.wav')).toBe('other')
  })

  it('never classifies original / cue / click lanes', () => {
    expect(stemKindForLaneKey('original')).toBeNull()
    expect(stemKindForLaneKey('cue')).toBeNull()
    expect(stemKindForLaneKey('click')).toBeNull()
  })
})

describe('channelsRmsDb', () => {
  it('full-scale square wave is 0 dBFS', () => {
    const ch = new Float32Array(1000).fill(1)
    expect(channelsRmsDb([ch])).toBeCloseTo(0, 5)
  })

  it('a full-scale sine is ~-3.01 dBFS', () => {
    const n = 44100
    const ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = Math.sin((2 * Math.PI * 100 * i) / n)
    expect(channelsRmsDb([ch])).toBeCloseTo(-3.01, 1)
  })

  it('silence is -Infinity', () => {
    expect(channelsRmsDb([new Float32Array(100)])).toBe(-Infinity)
  })
})

describe('loudnessMatchGainDb', () => {
  it('brings a quiet bass toward the -18 dB target', () => {
    expect(loudnessMatchGainDb('bass', -24)).toBeCloseTo(6, 5)
  })

  it('brings a hot drum stem down toward -16 dB', () => {
    expect(loudnessMatchGainDb('drums', -10)).toBeCloseTo(-6, 5)
  })

  it('clamps to ±12 dB', () => {
    expect(loudnessMatchGainDb('bass', -40)).toBe(12)
    expect(loudnessMatchGainDb('drums', 2)).toBe(-12)
  })

  it('never boosts a near-silent stem (noise floor guard)', () => {
    expect(loudnessMatchGainDb('bass', -60)).toBe(0)
    expect(loudnessMatchGainDb('bass', -Infinity)).toBe(0)
  })
})

describe('stemCompressorPreset', () => {
  it('off / absent → null', () => {
    expect(stemCompressorPreset('bass', 'off')).toBeNull()
    expect(stemCompressorPreset('bass', undefined)).toBeNull()
  })

  it('firm compresses harder than light', () => {
    const light = stemCompressorPreset('bass', 'light')!
    const firm = stemCompressorPreset('bass', 'firm')!
    expect(firm.ratio).toBeGreaterThan(light.ratio)
    expect(firm.thresholdDb).toBeLessThan(light.thresholdDb)
  })

  it('drums keep a slower attack than bass (transient punch)', () => {
    expect(stemCompressorPreset('drums', 'light')!.attackSec).toBeGreaterThan(
      stemCompressorPreset('bass', 'light')!.attackSec,
    )
  })
})

describe('stemTotalGainDb', () => {
  const base: ProjectMastering = { enabled: true, matchLoudness: false }

  it('sums user trim with loudness match and make-up', () => {
    const cfg: ProjectMastering = {
      ...base,
      matchLoudness: true,
      stems: { bass: { intensity: 'off', trimDb: 3 } },
    }
    // match: -24 → -18 = +6; trim +3.
    expect(stemTotalGainDb('bass', cfg, -24)).toBeCloseTo(9, 5)
  })

  it('clamps the trim to ±9 dB', () => {
    const up: ProjectMastering = { ...base, stems: { bass: { trimDb: 40 } } }
    const down: ProjectMastering = { ...base, stems: { bass: { trimDb: -40 } } }
    expect(stemTotalGainDb('bass', up, -18)).toBe(9)
    expect(stemTotalGainDb('bass', down, -18)).toBe(-9)
  })

  it('includes the compressor make-up when evening is on', () => {
    const cfg: ProjectMastering = { ...base, stems: { bass: { intensity: 'firm' } } }
    expect(stemTotalGainDb('bass', cfg, -18)).toBeCloseTo(4, 5) // firm bass makeup
  })

  it('is 0 for an untouched stem', () => {
    expect(stemTotalGainDb('vocals', base, -18)).toBe(0)
  })
})

describe('dbToGain', () => {
  it('0 dB = 1, +6 dB ≈ 2, -6 dB ≈ 0.5', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(6.0206)).toBeCloseTo(2, 3)
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 3)
  })
})
