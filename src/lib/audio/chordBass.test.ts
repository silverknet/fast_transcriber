import { describe, it, expect } from 'vitest'
import { buildBassHits, bassMidiFor } from './chordBass'

// Two bars, four beats each, one beat = 0.5s.
const beats = Array.from({ length: 8 }, (_, i) => ({
  timeSec: i * 0.5,
  barId: i < 4 ? 'bar1' : 'bar2',
  bassPc: 0 as number | null, // C throughout
}))

describe('buildBassHits', () => {
  it('1/1 → one hit per bar (downbeats)', () => {
    const hits = buildBassHits(beats, '1/1')
    expect(hits.map((h) => h.timeSec)).toEqual([0, 2]) // bar starts
  })

  it('4/4 → one hit per beat', () => {
    const hits = buildBassHits(beats, '4/4')
    expect(hits.length).toBe(8)
    expect(hits.map((h) => h.timeSec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  })

  it('8/8 → two per beat (interpolated to the next beat)', () => {
    const hits = buildBassHits(beats, '8/8')
    expect(hits.length).toBe(16)
    expect(hits[0]!.timeSec).toBeCloseTo(0, 6)
    expect(hits[1]!.timeSec).toBeCloseTo(0.25, 6) // halfway to beat 2
    expect(hits[2]!.timeSec).toBeCloseTo(0.5, 6)
  })

  it('16/16 → four per beat', () => {
    const hits = buildBassHits(beats, '16/16')
    expect(hits.length).toBe(32)
    expect(hits[1]!.timeSec).toBeCloseTo(0.125, 6)
  })

  it('skips beats with no chord (null bassPc)', () => {
    const gapped = beats.map((b, i) => ({ ...b, bassPc: i < 4 ? (0 as number | null) : null }))
    const hits = buildBassHits(gapped, '4/4')
    expect(hits.length).toBe(4) // only the first bar has a chord
  })

  it('places the bass low and on the right pitch class', () => {
    const midi = bassMidiFor(0) // C
    expect(midi % 12).toBe(0)
    expect(midi).toBeGreaterThanOrEqual(24)
    expect(midi).toBeLessThanOrEqual(72)
    expect(bassMidiFor(0, 1)).toBe(midi + 12) // octave offset shifts up
  })
})
