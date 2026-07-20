import { describe, expect, it } from 'vitest'
import { isPlausibleSongMap } from './cloudRepo'

function validSongMap(): Record<string, unknown> {
  return {
    formatVersion: 4,
    metadata: { title: 'Song', createdAt: 'x', updatedAt: 'x' },
    timeline: { bars: [], beats: [] },
    sections: [],
    cueTracks: [],
  }
}

describe('isPlausibleSongMap', () => {
  it('accepts a well-formed collaborative song map', () => {
    expect(isPlausibleSongMap(validSongMap())).toBe(true)
  })

  it('rejects non-objects and shapes without the required fields', () => {
    expect(isPlausibleSongMap(null)).toBe(false)
    expect(isPlausibleSongMap(undefined)).toBe(false)
    expect(isPlausibleSongMap('song')).toBe(false)
    expect(isPlausibleSongMap(42)).toBe(false)
    expect(isPlausibleSongMap([])).toBe(false) // an array has no `.metadata`
    expect(isPlausibleSongMap({})).toBe(false)
  })

  it('rejects a payload missing metadata.title (the exact shape that broke joins)', () => {
    const sm = validSongMap()
    delete (sm as { metadata?: unknown }).metadata
    expect(isPlausibleSongMap(sm)).toBe(false)
  })

  it('rejects a payload with a non-string title', () => {
    const sm = validSongMap()
    ;(sm.metadata as Record<string, unknown>).title = 42
    expect(isPlausibleSongMap(sm)).toBe(false)
  })

  it('rejects a payload missing timeline.bars/beats', () => {
    const sm = validSongMap()
    sm.timeline = { bars: [] } // beats missing
    expect(isPlausibleSongMap(sm)).toBe(false)
  })

  it('rejects a payload missing cueTracks or sections', () => {
    const noCue = validSongMap()
    delete (noCue as { cueTracks?: unknown }).cueTracks
    expect(isPlausibleSongMap(noCue)).toBe(false)

    const noSections = validSongMap()
    delete (noSections as { sections?: unknown }).sections
    expect(isPlausibleSongMap(noSections)).toBe(false)
  })
})
