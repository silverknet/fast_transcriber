import { describe, expect, it } from 'vitest'
import {
  AUDIO_FINGERPRINT_BUCKETS,
  FINGERPRINT_MATCH_THRESHOLD,
  compareFingerprints,
  computeAudioFingerprint,
  fingerprintSimilarity,
} from './audioFingerprint'

const SR = 44100

/** Deterministic PRNG so these tests never flake. */
function mulberry(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A synthetic "recording": noise shaped by a sequence of section loudnesses.
 * Different `seed`s stand in for the sample-level differences a transcode
 * introduces; `gain` stands in for a quieter master.
 */
function recording(seconds: number, sections: number[], seed = 1, gain = 1): Float32Array {
  const rnd = mulberry(seed)
  const n = Math.floor(seconds * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = sections[Math.min(sections.length - 1, Math.floor((i / n) * sections.length))]!
    out[i] = (rnd() * 2 - 1) * s * gain
  }
  return out
}

const ARRANGEMENT = [0.1, 0.5, 0.9, 0.5, 0.9, 0.3, 1.0, 0.2]
const master = recording(180, ARRANGEMENT, 1)
const fpMaster = computeAudioFingerprint([master], SR)!

describe('computeAudioFingerprint', () => {
  it('produces a fixed-size envelope', () => {
    expect(fpMaster.envelope).toHaveLength(AUDIO_FINGERPRINT_BUCKETS)
    expect(fpMaster.durationSec).toBeCloseTo(180, 2)
  })

  it('quantises into the byte range', () => {
    for (const v of fpMaster.envelope) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })

  it('is deterministic for the same input', () => {
    expect(computeAudioFingerprint([master], SR)).toEqual(fpMaster)
  })

  it('returns null rather than a degenerate fingerprint for empty audio', () => {
    expect(computeAudioFingerprint([], SR)).toBeNull()
    expect(computeAudioFingerprint([new Float32Array(0)], SR)).toBeNull()
    expect(computeAudioFingerprint([master], 0)).toBeNull()
  })

  it('survives JSON round-tripping (it is stored in the .smap)', () => {
    expect(JSON.parse(JSON.stringify(fpMaster))).toEqual(fpMaster)
  })
})

describe('the same recording, differently encoded, still matches', () => {
  const cases: Array<[string, Float32Array[]]> = [
    ['byte-identical', [master]],
    ['different samples (transcode)', [recording(180, ARRANGEMENT, 99)]],
    ['quarter gain (quieter master)', [recording(180, ARRANGEMENT, 1, 0.25)]],
    ['stereo instead of mono', [master, recording(180, ARRANGEMENT, 7)]],
  ]
  for (const [name, channels] of cases) {
    it(name, () => {
      const fp = computeAudioFingerprint(channels, SR)!
      expect(fingerprintSimilarity(fpMaster, fp)!).toBeGreaterThanOrEqual(
        FINGERPRINT_MATCH_THRESHOLD,
      )
      expect(compareFingerprints(fpMaster, fp)).toBe('same')
    })
  }

  it('heavy dynamics processing still matches', () => {
    // dB + Pearson is scale- and offset-invariant, so compression that lifts
    // quiet passages does not break identity.
    const squashed = Float32Array.from(master, (v) => Math.sign(v) * Math.sqrt(Math.abs(v)))
    expect(compareFingerprints(fpMaster, computeAudioFingerprint([squashed], SR)!)).toBe('same')
  })
})

describe('a different recording is rejected', () => {
  it('a different arrangement of the same length', () => {
    const other = recording(180, [0.9, 0.2, 0.3, 1.0, 0.1, 0.8, 0.4, 0.6], 5)
    expect(compareFingerprints(fpMaster, computeAudioFingerprint([other], SR)!)).toBe('different')
  })

  it('a different song entirely', () => {
    const other = recording(180, [1.0, 1.0, 0.1, 0.1, 1.0, 0.1, 1.0, 1.0], 42)
    expect(compareFingerprints(fpMaster, computeAudioFingerprint([other], SR)!)).toBe('different')
  })

  it('the same music shifted by 3 s of head silence', () => {
    // THE case that matters most: same performance, but every stored
    // `Bar.startSec` would now be 3 s early. Must not be called "same".
    const pad = new Float32Array(3 * SR)
    const music = recording(177, ARRANGEMENT, 1)
    const shifted = new Float32Array(pad.length + music.length)
    shifted.set(pad)
    shifted.set(music, pad.length)
    expect(compareFingerprints(fpMaster, computeAudioFingerprint([shifted], SR)!)).toBe('different')
  })

  it('a longer cut is rejected on duration alone', () => {
    // Duration is gated independently, before any correlation: an extra outro
    // is decisive even if the loudness shape correlates well.
    const longer = recording(200, ARRANGEMENT, 1)
    expect(compareFingerprints(fpMaster, computeAudioFingerprint([longer], SR)!)).toBe('different')
  })
})

describe('undecided rather than guessing', () => {
  it('when either side has no fingerprint', () => {
    expect(compareFingerprints(fpMaster, undefined)).toBe('undecided')
    expect(compareFingerprints(undefined, fpMaster)).toBe('undecided')
    expect(compareFingerprints(undefined, undefined)).toBe('undecided')
  })

  it('when a side is flat — digital silence must not match other silence', () => {
    const silence = computeAudioFingerprint([new Float32Array(SR * 10)], SR)!
    expect(fingerprintSimilarity(silence, silence)).toBeNull()
    expect(compareFingerprints(fpMaster, silence)).toBe('different') // duration differs
    const silence2 = computeAudioFingerprint([new Float32Array(SR * 10)], SR)!
    expect(compareFingerprints(silence, silence2)).toBe('undecided')
  })

  it('across incompatible fingerprint versions', () => {
    const future = { ...fpMaster, version: 2 as unknown as typeof fpMaster.version }
    expect(compareFingerprints(fpMaster, future)).toBe('undecided')
    expect(fingerprintSimilarity(fpMaster, future)).toBeNull()
  })

  it('across mismatched envelope lengths', () => {
    const truncated = { ...fpMaster, envelope: fpMaster.envelope.slice(0, 32) }
    expect(fingerprintSimilarity(fpMaster, truncated)).toBeNull()
  })
})
