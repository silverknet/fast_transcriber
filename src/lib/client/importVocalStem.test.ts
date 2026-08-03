import { describe, it, expect } from 'vitest'
import { classifyAlignment } from './importVocalStem'
import type { AudioAlignment } from './desktopBridge'

function align(over: Partial<AudioAlignment> = {}): AudioAlignment {
  return {
    offsetSec: 0,
    confidence: 0.8,
    sameRecording: true,
    driftSec: 0,
    durationRefSec: 230,
    durationTargetSec: 230,
    sampleRate: 22050,
    perWindow: [],
    ...over,
  }
}

const SONG = 230

describe('classifyAlignment', () => {
  it('accepts a clean same-recording match', () => {
    const v = classifyAlignment(align(), SONG)
    expect(v.ok).toBe(true)
    expect(v.reasons).toHaveLength(0)
  })

  it('accepts a same-master-different-trim match (large constant offset, no drift)', () => {
    // e.g. Tur instrumental vs YouTube: 8.7s offset, drift ~0, conf 0.67.
    const v = classifyAlignment(
      align({ offsetSec: 8.7, confidence: 0.67, durationTargetSec: 216 }),
      SONG,
    )
    // offset eats 8.7s but overlap (216-8.7)=207/230 = 90% ≥ 85% → still fine.
    expect(v.ok).toBe(true)
  })

  it('warns on low confidence', () => {
    const v = classifyAlignment(align({ confidence: 0.2 }), SONG)
    expect(v.ok).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/confidence/i)
  })

  it('warns on timing drift (different speed/version)', () => {
    const v = classifyAlignment(align({ driftSec: 0.6 }), SONG)
    expect(v.ok).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/drift/i)
  })

  it('warns when the upload covers too little of the song', () => {
    // Target is only 120s of a 230s song → ~52% overlap.
    const v = classifyAlignment(align({ durationTargetSec: 120 }), SONG)
    expect(v.ok).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/covers/i)
  })

  it('accumulates multiple reasons', () => {
    const v = classifyAlignment(
      align({ confidence: 0.1, driftSec: 0.9, durationTargetSec: 50 }),
      SONG,
    )
    expect(v.ok).toBe(false)
    expect(v.reasons.length).toBeGreaterThanOrEqual(2)
  })
})

describe('speed-shifted uploads — the "(Kom så ska vi) Leva livet" case', () => {
  /**
   * Real numbers, measured from the actual files: a karaoke cut of the song in
   * the project, and a with-vocals copy from a video site playing 0.769% fast.
   * The old waveform-only aligner reported 12% confidence, a 717 ms drift and
   * "only covers 76%" — three scary numbers about a file that is genuinely the
   * same recording. The chord-level stage measures the speed instead.
   */
  const LEVA: AudioAlignment = {
    offsetSec: 0,
    speedRatio: 1.00769231,
    method: 'harmonic',
    confidence: 1,
    sameRecording: true,
    driftSec: 0.093, // one chroma frame — the measurement floor, not an error
    durationRefSec: 212.375,
    durationTargetSec: 213.093,
    sampleRate: 22050,
    perWindow: [],
  }

  it('accepts it — no warning dialog for a correct match', () => {
    const v = classifyAlignment(LEVA, 212.375)
    expect(v.reasons).toEqual([])
    expect(v.ok).toBe(true)
  })

  it('coverage is judged AFTER the speed correction, not on the raw duration', () => {
    // Judged raw this once said "only covers 76% of the song".
    const v = classifyAlignment(LEVA, 212.375)
    expect(v.reasons.some((r) => /covers/.test(r))).toBe(false)
  })

  it('a chord-level match is still rejected when the leftover drift is real', () => {
    // Beyond the chroma measurement floor ⇒ genuinely a different performance.
    const v = classifyAlignment({ ...LEVA, driftSec: 0.9 }, 212.375)
    expect(v.ok).toBe(false)
    expect(v.reasons.some((r) => /drifts/.test(r))).toBe(true)
  })

  it('the WAVEFORM path keeps its strict 40 ms drift limit', () => {
    // A same-master pair must still align to the sample; the looser limit is
    // only licensed by the chord method's coarser resolution.
    const v = classifyAlignment(
      { ...LEVA, method: 'waveform', speedRatio: 1, driftSec: 0.093 },
      212.375,
    )
    expect(v.ok).toBe(false)
    expect(v.reasons.some((r) => /drifts/.test(r))).toBe(true)
  })
})
