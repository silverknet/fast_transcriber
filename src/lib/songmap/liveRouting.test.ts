import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { serializeSongMap } from './serialize'
import { toCollabSongMap } from './collab'
import { SONGMAP_DRAFTS_FORMAT_VERSION, SONGMAP_FORMAT_VERSION } from './version'

describe('SongMap v7 Live routing migration', () => {
  it('migrates every legacy producer as explicitly excluded', () => {
    const legacy = createEmptySongMap()
    legacy.audio = {
      fileName: 'mix.wav', fileSize: 10, mimeType: 'audio/wav',
      trim: { startSec: 0, endSec: 1 }, source: 'upload',
    }
    legacy.stemRefs = { bass: 'stems/bass.wav' }
    legacy.mixState = {
      tracks: [
        { key: 'stem:bass.wav', volume: 1, liveSlot: 'bass' },
      ],
    }
    legacy.drumMachine = { enabled: true, style: 'rock' }
    legacy.liveRouting = undefined
    const raw = JSON.parse(serializeSongMap(legacy)) as Record<string, unknown>
    expect(Object.values(raw.liveStemRefs as Record<string, string>)).toEqual([
      'stems/bass.wav',
    ])
    raw.formatVersion = SONGMAP_DRAFTS_FORMAT_VERSION
    delete raw.liveRouting

    const migrated = parseSongMap(JSON.stringify(raw))
    const routing = migrated.liveRouting!

    expect(migrated.formatVersion).toBe(SONGMAP_FORMAT_VERSION)
    expect(routing.sources).toHaveLength(3)
    expect(
      routing.sources.every(
        (source) =>
          source.admission === 'excluded' &&
          source.main === false &&
          source.monitorSends.length === 0,
      ),
    ).toBe(true)
    expect(
      routing.mixerChannels.every(
        (channel) => channel.rigSourceLaneId === undefined,
      ),
    ).toBe(true)
    expect(routing.sources.map((source) => source.producer.kind)).toEqual([
      'original-audio',
      'stem-audio',
      'drum-machine-midi',
    ])
    const migratedStem = routing.sources.find(
      (source) => source.producer.kind === 'stem-audio',
    )
    expect(migrated.liveStemRefs).toEqual({
      [(migratedStem?.producer as { stemId: string }).stemId]: 'stems/bass.wav',
    })
  })

  it('round-trips stable source and mixer identities without presentation inference', () => {
    const song = createEmptySongMap()
    song.liveStemRefs = { 'stem-stable-id': 'renamed/on-this-machine.wav' }
    song.liveRouting = {
      version: 1,
      sources: [
        {
          id: 'source-stable-id',
          producer: {
            kind: 'stem-audio',
            stemId: 'stem-stable-id',
          },
          admission: 'included',
          required: true,
          mixerChannelId: 'mixer-stable-id',
          main: true,
          monitorSends: [{ performerId: 'performer-a', gain: 0.65 }],
        },
      ],
      mixerChannels: [
        {
          id: 'mixer-stable-id',
          sourceId: 'source-stable-id',
          processing: { gain: 0.9 },
          rigSourceLaneId: 'rig-lane-stable-id',
        },
      ],
      sumGroups: [],
    }

    const roundTrip = parseSongMap(serializeSongMap(song))

    expect(roundTrip.liveRouting).toEqual(song.liveRouting)
    expect(toCollabSongMap(roundTrip).liveRouting).toEqual(song.liveRouting)
    expect(toCollabSongMap(roundTrip).liveStemRefs).toBeUndefined()
    expect(roundTrip.mixState).toBeUndefined()
  })
})
