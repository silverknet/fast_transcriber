import { describe, expect, it } from 'vitest'
import {
  createDefaultCueTrack,
  generateCueTrackFromSections,
  generatedCountKey,
  generatedSectionKey,
} from './cueTracks'
import type { CueEvent, CueTrack, SongMap } from './types'
import { SONGMAP_FORMAT_VERSION } from './version'

function mapWithSections(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Cue song',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'song.wav',
      trim: { startSec: 0, endSec: 8 },
      source: 'upload',
    },
    timeline: {
      bars: [
        {
          id: 'bar0',
          index: 0,
          startSec: 0,
          endSec: 2,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds: ['b0', 'b1', 'b2', 'b3'],
        },
        {
          id: 'bar1',
          index: 1,
          startSec: 2,
          endSec: 4,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds: ['b4', 'b5', 'b6', 'b7'],
        },
      ],
      beats: [
        { id: 'b0', barId: 'bar0', indexInBar: 0, timeSec: 0 },
        { id: 'b1', barId: 'bar0', indexInBar: 1, timeSec: 0.5 },
        { id: 'b2', barId: 'bar0', indexInBar: 2, timeSec: 1 },
        { id: 'b3', barId: 'bar0', indexInBar: 3, timeSec: 1.5 },
        { id: 'b4', barId: 'bar1', indexInBar: 0, timeSec: 2 },
        { id: 'b5', barId: 'bar1', indexInBar: 1, timeSec: 2.5 },
        { id: 'b6', barId: 'bar1', indexInBar: 2, timeSec: 3 },
        { id: 'b7', barId: 'bar1', indexInBar: 3, timeSec: 3.5 },
      ],
    },
    sections: [
      {
        id: 'verse-a',
        kind: 'verse',
        label: 'Verse',
        barRange: { startBarIndex: 1, endBarIndex: 1 },
      },
    ],
    harmony: [],
    cueTracks: [],
  }
}

describe('generateCueTrackFromSections', () => {
  it('anchors generated section and count cues to section start with an explicit one-bar lead', () => {
    const sm = mapWithSections()
    const track = generateCueTrackFromSections(sm, createDefaultCueTrack())
    const section = sm.sections[0]!
    const sectionEvent = track.events.find((event) => event.generatedKey === generatedSectionKey(section))
    expect(sectionEvent).toMatchObject({
      kind: 'section',
      enabled: true,
      anchor: { kind: 'beat', beatId: 'b4', leadBars: 1 },
      generatedSource: { kind: 'section', sectionId: 'verse-a', leadBars: 1 },
      text: 'Verse',
    })
    const counts = track.events.filter((event) => event.kind === 'count')
    expect(counts.map((event) => event.text)).toEqual(['one', 'two', 'three', 'four'])
    expect(counts.every((event) => event.anchor.kind === 'beat' && event.anchor.leadBars === 1)).toBe(true)
  })

  it('preserves custom, edited, disabled, and deleted generated cues on regeneration', () => {
    const sm = mapWithSections()
    const section = sm.sections[0]!
    const base = generateCueTrackFromSections(sm, createDefaultCueTrack())
    const sectionKey = generatedSectionKey(section)
    const disabledKey = generatedCountKey(section, 0)
    const deletedKey = generatedCountKey(section, 1)
    const custom: CueEvent = {
      id: 'custom-a',
      kind: 'custom-text',
      enabled: true,
      anchor: { kind: 'time', timeSec: 1.25 },
      text: 'Look up',
      source: 'custom',
    }
    const changed: CueTrack = {
      ...base,
      suppressedGeneratedKeys: [deletedKey],
      events: [
        ...base.events
          .filter((event) => event.generatedKey !== deletedKey)
          .map((event) =>
            event.generatedKey === sectionKey
              ? { ...event, text: 'Edited verse', edited: true }
              : event.generatedKey === disabledKey
                ? { ...event, enabled: false }
                : event,
          ),
        custom,
      ],
    }

    const regenerated = generateCueTrackFromSections(sm, changed)
    expect(regenerated.events.find((event) => event.id === custom.id)).toBeDefined()
    expect(regenerated.events.find((event) => event.generatedKey === sectionKey)?.text).toBe('Edited verse')
    expect(regenerated.events.find((event) => event.generatedKey === disabledKey)?.enabled).toBe(false)
    expect(regenerated.events.find((event) => event.generatedKey === deletedKey)).toBeUndefined()
  })
})
