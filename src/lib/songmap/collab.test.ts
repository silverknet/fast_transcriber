import { describe, expect, it } from 'vitest'
import { mergeLocalIntoCollab, toCollabSongMap } from './collab'
import type { SongMap } from './types'
import { SONGMAP_FORMAT_VERSION } from './version'

function mapWithRenderedCue(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Shared song',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'song.wav',
      trim: { startSec: 0, endSec: 10 },
      originalPath: 'audio/song.wav',
      source: 'upload',
    },
    timeline: { bars: [], beats: [] },
    sections: [],
    harmony: [],
    transpose: { baseSemitones: 2 },
    lyrics: {
      words: [{ text: 'Hey', startSec: 1, endSec: 1.5, line: 0, aligned: true }],
      sourceText: 'Hey',
    },
    cueTracks: [
      {
        id: 'main',
        name: 'Main cues',
        enabled: true,
        events: [
          {
            id: 'intro',
            kind: 'intro',
            enabled: true,
            anchor: { kind: 'time', timeSec: 0 },
            text: 'Intro',
            source: 'custom',
          },
        ],
        suppressedGeneratedKeys: [],
        renderExport: {
          fingerprint: 'cue-fp',
          durationSec: 10,
          sampleRate: 44100,
          generatedAt: '2020-01-02T00:00:00.000Z',
          preludeOffsetSec: 1,
          relativePath: 'cue/tracks/main/cue-track.wav',
        },
      },
    ],
    clickExport: {
      fingerprint: 'click-fp',
      durationSec: 10,
      sampleRate: 44100,
      generatedAt: '2020-01-02T00:00:00.000Z',
      preludeOffsetSec: 1,
      relativePath: 'cue/click-track.wav',
    },
  }
}

describe('collaborative SongMap cue fields', () => {
  it('keeps shared cue data but strips local render paths before upload', () => {
    const collab = toCollabSongMap(mapWithRenderedCue())
    expect(collab.audio?.originalPath).toBeUndefined()
    expect(collab.transpose).toEqual({ baseSemitones: 2 })
    // Lyrics are shared musical data — must survive the collab strip.
    expect(collab.lyrics?.sourceText).toBe('Hey')
    expect(collab.lyrics?.words).toHaveLength(1)
    expect(collab.cueTracks[0]?.events[0]?.text).toBe('Intro')
    expect(collab.cueTracks[0]?.renderExport?.fingerprint).toBe('cue-fp')
    expect(collab.cueTracks[0]?.renderExport?.relativePath).toBeUndefined()
    expect(collab.clickExport?.fingerprint).toBe('click-fp')
    expect(collab.clickExport?.relativePath).toBeUndefined()
  })

  it('restores local render paths when merging cloud data back to disk', () => {
    const local = mapWithRenderedCue()
    const cloud = toCollabSongMap(local)
    const merged = mergeLocalIntoCollab(local, cloud)
    expect(merged.audio?.originalPath).toBe('audio/song.wav')
    expect(merged.cueTracks[0]?.renderExport?.relativePath).toBe('cue/tracks/main/cue-track.wav')
    expect(merged.clickExport?.relativePath).toBe('cue/click-track.wav')
  })
})
