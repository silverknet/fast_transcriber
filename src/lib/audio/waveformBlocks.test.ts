import { describe, expect, it } from 'vitest'
import {
  computeStableVisualBlockPeaksFromChannels,
  computeVisualBlockPeaksFromChannels,
  normalizeBlockPeaks,
  waveformBlockBucketCount,
} from './waveformBlocks'

describe('waveformBlockBucketCount', () => {
  it('uses small visual block buckets', () => {
    expect(waveformBlockBucketCount(400)).toBe(100)
    expect(waveformBlockBucketCount(401)).toBe(101)
  })

  it('keeps a small minimum so empty or tiny canvases still draw predictably', () => {
    expect(waveformBlockBucketCount(0)).toBe(2)
    expect(waveformBlockBucketCount(1)).toBe(2)
    expect(waveformBlockBucketCount(4)).toBe(2)
  })
})

describe('computeVisualBlockPeaksFromChannels', () => {
  it('does not let one isolated spike turn a whole zoomed-out block full height', () => {
    const ch0 = new Float32Array(512).fill(0.08)
    ch0[128] = 1

    const peaks = computeVisualBlockPeaksFromChannels(ch0, null, 0, ch0.length, 1)

    expect(peaks[1]).toBeGreaterThan(0.05)
    expect(peaks[1]).toBeLessThan(0.35)
  })

  it('keeps sustained local energy visibly louder than quiet sections', () => {
    const ch0 = new Float32Array(512)
    ch0.fill(0.1, 0, 256)
    ch0.fill(0.55, 256)

    const peaks = computeVisualBlockPeaksFromChannels(ch0, null, 0, ch0.length, 2)

    expect(peaks[3]).toBeGreaterThan((peaks[1] ?? 0) + 0.2)
    expect(peaks[0]).toBeCloseTo(-(peaks[1] ?? 0))
    expect(peaks[2]).toBeCloseTo(-(peaks[3] ?? 0))
  })

  it('keeps narrow visible dynamic range from flattening completely', () => {
    const ch0 = new Float32Array(1024)
    ch0.fill(0.38, 0, 256)
    ch0.fill(0.44, 256, 512)
    ch0.fill(0.5, 512, 768)
    ch0.fill(0.56, 768)

    const peaks = computeVisualBlockPeaksFromChannels(ch0, null, 0, ch0.length, 4)
    const heights = [peaks[1], peaks[3], peaks[5], peaks[7]]

    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.08)
  })
})

describe('normalizeBlockPeaks (read-only/live auto-gain)', () => {
  // build a quiet song: peaks well below full scale, with real dynamics
  function quietLane() {
    const ch0 = new Float32Array(4096)
    for (let i = 0; i < ch0.length; i++) {
      const loud = i > 2048 // second half louder
      ch0[i] = Math.sin(i / 9) * (loud ? 0.22 : 0.06)
    }
    return computeVisualBlockPeaksFromChannels(ch0, null, 0, ch0.length, 64)
  }

  it('scales a quiet master up so the loudest bar fills the height', () => {
    const raw = quietLane()
    const rawMax = Math.max(...raw)
    expect(rawMax).toBeLessThan(0.4) // absolute lane is short

    const norm = normalizeBlockPeaks(raw)
    const normMax = Math.max(...norm)
    expect(normMax).toBeGreaterThan(0.9) // now fills the height
  })

  it('preserves loud-vs-quiet ordering (still represents the sound)', () => {
    const norm = normalizeBlockPeaks(quietLane())
    const buckets = norm.length / 2
    const firstHalf = norm[Math.floor(buckets * 0.25) * 2 + 1] ?? 0
    const secondHalf = norm[Math.floor(buckets * 0.75) * 2 + 1] ?? 0
    expect(secondHalf).toBeGreaterThan(firstHalf + 0.15)
  })

  it('leaves a silent lane alone instead of amplifying noise to full height', () => {
    const silent = new Float32Array(2048)
    const raw = computeVisualBlockPeaksFromChannels(silent, null, 0, silent.length, 32)
    const norm = normalizeBlockPeaks(raw)
    expect(Math.max(...norm)).toBeLessThan(0.05)
  })
})

describe('stable waveform blocks', () => {
  it('turns a tiny pan into an offset change instead of new bar heights', () => {
    const ch0 = new Float32Array(4096)
    for (let i = 0; i < ch0.length; i++) {
      ch0[i] = Math.sin(i / 17) * (0.18 + (i % 700) / 1400)
    }

    const first = computeStableVisualBlockPeaksFromChannels(ch0, null, 0, 1024, 400)
    const panned = computeStableVisualBlockPeaksFromChannels(
      ch0,
      null,
      24,
      1048,
      400,
      first.framesPerBlock,
    )

    expect(panned.framesPerBlock).toBe(first.framesPerBlock)
    expect(panned.waveform.pitchPx).toBe(first.waveform.pitchPx)
    expect(panned.waveform.peaks.length).toBe(first.waveform.peaks.length)
    expect(panned.waveform.peaks.slice(0, 12)).toEqual(first.waveform.peaks.slice(0, 12))
    expect(panned.waveform.offsetPx).toBeLessThan(first.waveform.offsetPx ?? 0)
  })
})
