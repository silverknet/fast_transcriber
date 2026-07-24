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
