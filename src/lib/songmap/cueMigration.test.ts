import { describe, expect, it } from 'vitest'
import { parseSongMap } from './parse'
import { serializeSongMap } from './serialize'
import type { SongMap } from './types'

const baseLegacy = {
  formatVersion: 1,
  metadata: {
    title: 'Legacy song',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  },
  timeline: { bars: [], beats: [] },
  sections: [],
  harmony: [],
}

const rendered = {
  fingerprint: 'abc123',
  durationSec: 12,
  sampleRate: 44100,
  generatedAt: '2020-01-02T00:00:00.000Z',
  preludeOffsetSec: 1.5,
  relativePath: 'cue/cue-track.wav',
}

describe('SongMap cue v1 migration', () => {
  it('migrates legacy spokenIntroText and render exports into v3 cueTracks', () => {
    const sm = parseSongMap(
      JSON.stringify({
        ...baseLegacy,
        cues: {
          mode: 'countIn',
          countInBeats: 4,
          useSectionLabels: true,
          spokenIntroText: 'Valerie',
        },
        cueTrackExport: rendered,
        clickTrackExport: {
          ...rendered,
          relativePath: 'cue/click-track.wav',
        },
      }),
    )

    expect(sm.formatVersion).toBe(3)
    expect(sm.countInBeats).toBe(4)
    expect(sm.cueTracks).toHaveLength(1)
    expect(sm.cueTracks[0]?.events[0]).toMatchObject({
      kind: 'intro',
      text: 'Valerie',
      source: 'imported',
    })
    expect(sm.cueTracks[0]?.renderExport?.relativePath).toBe('cue/cue-track.wav')
    expect(sm.clickExport?.relativePath).toBe('cue/click-track.wav')
  })

  it('starts v3 cueTracks empty when a v1 file has no meaningful cue data', () => {
    const sm = parseSongMap(
      JSON.stringify({
        ...baseLegacy,
        cues: {
          mode: 'off',
          countInBeats: 4,
          useSectionLabels: true,
        },
      }),
    )

    expect(sm.cueTracks).toEqual([])
    expect(sm.countInBeats).toBeUndefined()
  })

  it('serializes v3 only and strips legacy cue fields defensively', () => {
    const sm = parseSongMap(
      JSON.stringify({
        ...baseLegacy,
        cues: {
          mode: 'off',
          countInBeats: 0,
          useSectionLabels: true,
          spokenIntroText: 'Legacy',
        },
      }),
    ) as SongMap & Record<string, unknown>
    sm.cues = { mode: 'off', countInBeats: 0, useSectionLabels: true }
    sm.cueTrackExport = rendered
    sm.clickTrackExport = rendered

    const serialized = JSON.parse(serializeSongMap(sm as SongMap)) as Record<string, unknown>
    expect(serialized.formatVersion).toBe(3)
    expect(serialized.cueTracks).toBeDefined()
    expect(serialized.cues).toBeUndefined()
    expect(serialized.cueTrackExport).toBeUndefined()
    expect(serialized.clickTrackExport).toBeUndefined()
  })
})
