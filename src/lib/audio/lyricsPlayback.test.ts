import { describe, expect, it } from 'vitest'
import {
  HALO_TUNING,
  activeWordIndexAt,
  lyricSegmentAt,
  smootherstep,
  wordConfidence,
} from './lyricsPlayback'

const words = [
  { startSec: 0, endSec: 0.5, aligned: true }, // heard
  { startSec: 0.5, endSec: 1.0, aligned: true }, // heard
  { startSec: 1.0, endSec: 1.4, aligned: false }, // guessed
  { startSec: 1.4, endSec: 2.0, aligned: true }, // heard
]

describe('wordConfidence', () => {
  it('is high for heard (aligned) words, low for interpolated', () => {
    expect(wordConfidence({ startSec: 0, aligned: true })).toBe(1)
    expect(wordConfidence({ startSec: 0, aligned: false })).toBeLessThan(0.3)
    expect(wordConfidence({ startSec: 0 })).toBeLessThan(0.3) // missing = guessed
  })
})

describe('activeWordIndexAt', () => {
  it('picks the last word that has started; -1 before the first', () => {
    expect(activeWordIndexAt(words, -1)).toBe(-1)
    expect(activeWordIndexAt(words, 0)).toBe(0)
    expect(activeWordIndexAt(words, 0.7)).toBe(1)
    expect(activeWordIndexAt(words, 1.2)).toBe(2)
    expect(activeWordIndexAt(words, 5)).toBe(3)
  })
})

describe('lyricSegmentAt', () => {
  it('returns null before the first word', () => {
    expect(lyricSegmentAt(words, -0.5)).toBeNull()
  })

  it('reports the fraction into the current word interval', () => {
    const s = lyricSegmentAt(words, 0.25)! // quarter into word 0 (0..0.5)
    expect(s.i).toBe(0)
    expect(s.frac).toBeCloseTo(0.5, 5)
    expect(s.confidence).toBe(1) // heard → heard
  })

  it('eases confidence from a heard word toward a following guessed word', () => {
    // Word 1 (heard) → word 2 (guessed): halfway in, confidence is between.
    const s = lyricSegmentAt(words, 0.75)!
    expect(s.i).toBe(1)
    expect(s.confidence).toBeLessThan(1)
    expect(s.confidence).toBeGreaterThan(wordConfidence(words[2]!))
  })

  it('at the onset of a guessed word the confidence is low', () => {
    // It then eases UP toward the following heard word (anticipatory tighten),
    // so we check right at the word onset where frac = 0.
    const s = lyricSegmentAt(words, 1.0)!
    expect(s.i).toBe(2)
    expect(s.confidence).toBeCloseTo(wordConfidence(words[2]!), 5)
    expect(s.confidence).toBeLessThan(0.3)
  })
})

describe('smootherstep', () => {
  it('is clamped and monotone with zero slope at the ends', () => {
    expect(smootherstep(-1)).toBe(0)
    expect(smootherstep(0)).toBe(0)
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 5)
    expect(smootherstep(1)).toBe(1)
    expect(smootherstep(2)).toBe(1)
    // near the ends it barely moves (eased)
    expect(smootherstep(0.05)).toBeLessThan(0.05)
  })
})

describe('HALO_TUNING', () => {
  it('carries the user-tuned defaults', () => {
    expect(HALO_TUNING.roundness).toBe(0)
    expect(HALO_TUNING.tauPos).toBeGreaterThan(0)
    expect(HALO_TUNING.baseOpacity).toBeGreaterThan(0.5)
  })
})
