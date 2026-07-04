import { describe, expect, it } from 'vitest'
import { waveformBlockBucketCount } from './waveformBlocks'

describe('waveformBlockBucketCount', () => {
  it('uses one bucket per visual block instead of one bucket per pixel', () => {
    expect(waveformBlockBucketCount(400)).toBe(100)
    expect(waveformBlockBucketCount(401)).toBe(101)
  })

  it('keeps a small minimum so empty or tiny canvases still draw predictably', () => {
    expect(waveformBlockBucketCount(0)).toBe(2)
    expect(waveformBlockBucketCount(1)).toBe(2)
    expect(waveformBlockBucketCount(4)).toBe(2)
  })
})
