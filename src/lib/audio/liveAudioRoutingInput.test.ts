import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from '$lib/songmap/factory'
import type {
  LiveProducerReference,
  SongLiveRouting,
  SongMap,
} from '$lib/songmap/types'
import {
  auditInstalledLiveSources,
  buildLiveSourceInstallManifest,
  captureRawProjectRoutingDto,
  deriveLiveAudioShadow,
  type LiveRoutingSnapshot,
} from './liveAudioRoutingInput'

function sourceRouting(
  id: string,
  producer: LiveProducerReference,
  laneId = `lane:${id}`,
): SongLiveRouting {
  return {
    version: 1,
    sources: [
      {
        id,
        producer,
        admission: 'included',
        required: true,
        mixerChannelId: `mixer:${id}`,
        main: true,
        monitorSends: [{ performerId: 'p1', gain: 0.75 }],
      },
    ],
    mixerChannels: [
      {
        id: `mixer:${id}`,
        sourceId: id,
        processing: { gain: 0.8 },
        rigSourceLaneId: laneId,
      },
    ],
    sumGroups: [],
  }
}

function rawProject(
  programLanes: Array<{ id: string; channel: number }> = [
    { id: 'lane:original', channel: 0 },
  ],
): ReturnType<typeof captureRawProjectRoutingDto> {
  return captureRawProjectRoutingDto({
    formatVersion: 1,
    id: 'project-a',
    performers: [{ id: 'p1', name: 'Martin', monitorBus: 1 }],
    liveRig: {
      routingProfile: {
        id: 'rig-a',
        version: 1,
        mainPhysicalOutputId: 'xr18-main-lr',
        sourceLanes: [
          ...programLanes.map(({ id, channel }) => ({
            id,
            role: 'program',
            webAudioChannels: [channel],
            usbReturnChannels: [channel],
            xr18InputStrips: [channel + 1],
            mainPolicy: 'on',
          })),
          {
            id: 'lane:click',
            role: 'click',
            webAudioChannels: [14],
            usbReturnChannels: [14],
            xr18InputStrips: [15],
            mainPolicy: 'off',
          },
          {
            id: 'lane:cue:p1',
            role: 'cue',
            performerId: 'p1',
            webAudioChannels: [15],
            usbReturnChannels: [15],
            xr18InputStrips: [16],
            mainPolicy: 'off',
          },
        ],
        monitorOutputs: [
          { monitorBus: 1, physicalOutputId: 'xr18-aux-1' },
        ],
      },
    },
  })
}

function songWithOriginal(id = 'original'): SongMap {
  const song = createEmptySongMap()
  song.audio = {
    fileName: 'full-mix.wav',
    fileSize: 1234,
    mimeType: 'audio/wav',
    trim: { startSec: 0, endSec: 1 },
    source: 'upload',
  }
  song.liveRouting = sourceRouting(id, { kind: 'original-audio' }, `lane:${id}`)
  return song
}

function snapshot(
  songMap: SongMap,
  overrides: Partial<LiveRoutingSnapshot> = {},
): LiveRoutingSnapshot {
  const liveRouting = songMap.liveRouting ?? {
    version: 1 as const,
    sources: [],
    mixerChannels: [],
    sumGroups: [],
  }
  const sourceIds = liveRouting.sources
    .filter(
      (source) =>
        source.producer.kind === 'original-audio' ||
        source.producer.kind === 'stem-audio',
    )
    .map((source) => source.id)
  return {
    generationId: 'generation-a',
    project: { id: 'project-a' },
    rawProjectRouting: rawProject(
      liveRouting.mixerChannels.map((channel, index) => ({
        id: channel.rigSourceLaneId ?? `missing:${index}`,
        channel: index,
      })),
    ),
    songId: 'song-a',
    songMap,
    currentSongAssets: sourceIds.map((sourceId) => ({
      sourceId,
      songId: 'song-a',
      generationId: 'generation-a',
      availability: 'available' as const,
    })),
    device: {
      audioDeviceId: 'xr18-usb',
      audioDeviceAvailable: true,
      outputChannelCount: 18,
      xr18UsbAudioAvailable: true,
      usbReturnChannelCount: 18,
      xr18InputStripCount: 16,
      xr18MonitorBusCount: 6,
      xr18ControlConnected: false,
    },
    practice: { enabled: false },
    ...overrides,
  }
}

describe('canonical Live routing input pipeline', () => {
  it('resolves a mixer channel to its explicit source and stem', () => {
    const song = createEmptySongMap()
    song.liveStemRefs = { 'stem:bass': 'stems/bass.wav' }
    song.liveRouting = sourceRouting(
      'source:bass',
      { kind: 'stem-audio', stemId: 'stem:bass' },
      'lane:bass',
    )

    const result = deriveLiveAudioShadow(snapshot(song))

    expect(result.plan.admittedSources).toEqual([
      expect.objectContaining({
        id: 'source:bass',
        mixerChannelId: 'mixer:source:bass',
        programLaneId: 'lane:bass',
        processing: { gain: 0.8 },
      }),
    ])
    expect(result.plan.performers[0]?.sourceSends).toEqual([
      {
        sourceId: 'source:bass',
        mixerChannelId: 'mixer:source:bass',
        gain: 0.75,
      },
    ])
  })

  it('does not admit sources through labels, order, filenames, or liveSlot', () => {
    const song = createEmptySongMap()
    song.audio = {
      fileName: 'please-admit-me.wav',
      fileSize: 1,
      mimeType: 'audio/wav',
      trim: { startSec: 0, endSec: 1 },
      source: 'upload',
    }
    song.stemRefs = { Drums: 'stems/drums.wav' }
    song.mixState = {
      tracks: [
        { key: 'original', volume: 1, liveSlot: 'drums' },
        { key: 'stem:drums.wav', volume: 1, liveSlot: 'drums' },
      ],
    }

    const result = deriveLiveAudioShadow(snapshot(song))

    expect(result.input.sourceIntents).toEqual([])
    expect(result.plan.main.sourceIds).toEqual([])
    expect(result.plan.excludedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'unassigned-source' }),
      ]),
    )
  })

  it('derives song B identically whether loaded directly or after song A', () => {
    const songA = songWithOriginal('source:a')
    const songB = songWithOriginal('source:b')
    deriveLiveAudioShadow(snapshot(songA, { songId: 'song-a' }))

    const afterA = deriveLiveAudioShadow(
      snapshot(songB, {
        generationId: 'generation-b',
        songId: 'song-b',
        currentSongAssets: [
          {
            sourceId: 'source:b',
            songId: 'song-b',
            generationId: 'generation-b',
            availability: 'available',
          },
        ],
      }),
    )
    const direct = deriveLiveAudioShadow(
      snapshot(songB, {
        generationId: 'generation-b',
        songId: 'song-b',
        currentSongAssets: [
          {
            sourceId: 'source:b',
            songId: 'song-b',
            generationId: 'generation-b',
            availability: 'available',
          },
        ],
      }),
    )

    expect(afterA).toEqual(direct)
  })

  it('marks every previous-song or previous-generation install for teardown', () => {
    const a = deriveLiveAudioShadow(snapshot(songWithOriginal('source:a')))
    const b = deriveLiveAudioShadow(
      snapshot(songWithOriginal('source:b'), {
        generationId: 'generation-b',
        songId: 'song-b',
        currentSongAssets: [
          {
            sourceId: 'source:b',
            songId: 'song-b',
            generationId: 'generation-b',
            availability: 'available',
          },
        ],
      }),
    )
    const installedA = buildLiveSourceInstallManifest(a.plan).entries
    const audit = auditInstalledLiveSources(
      buildLiveSourceInstallManifest(b.plan),
      installedA,
    )

    expect(audit.exact).toBe(false)
    expect(audit.teardownInstanceIds).toEqual([
      'generation-a:song-a:source:a',
    ])
    expect(audit.missingInstanceIds).toEqual([
      'generation-b:song-b:source:b',
    ])
  })

  it('fails closed for duplicate producer claims and ambiguous mixer ownership', () => {
    const song = createEmptySongMap()
    song.liveStemRefs = { 'stem:bass': 'stems/bass.wav' }
    song.liveRouting = {
      version: 1,
      sources: [
        ...sourceRouting('source:bass-a', {
          kind: 'stem-audio',
          stemId: 'stem:bass',
        }).sources,
        ...sourceRouting('source:bass-b', {
          kind: 'stem-audio',
          stemId: 'stem:bass',
        }).sources,
      ],
      mixerChannels: [
        {
          id: 'mixer:shared',
          sourceId: 'source:bass-a',
          processing: { gain: 1 },
          rigSourceLaneId: 'lane:bass-a',
        },
        {
          id: 'mixer:shared',
          sourceId: 'source:bass-b',
          processing: { gain: 1 },
          rigSourceLaneId: 'lane:bass-b',
        },
      ],
      sumGroups: [],
    }
    song.liveRouting.sources[0]!.mixerChannelId = 'mixer:shared'
    song.liveRouting.sources[1]!.mixerChannelId = 'mixer:shared'

    const result = deriveLiveAudioShadow(snapshot(song))

    expect(result.plan.admittedSources).toEqual([])
    expect(result.inputFacts.map((issue) => issue.code)).toContain(
      'source-producer-ambiguous',
    )
    expect(result.plan.issues.map((issue) => issue.code)).toContain(
      'duplicate-mixer-channel-id',
    )
  })

  it('represents a persisted producer with no source intent as unassigned', () => {
    const song = createEmptySongMap()
    song.audio = {
      fileName: 'mix.wav', fileSize: 1, mimeType: 'audio/wav',
      trim: { startSec: 0, endSec: 1 }, source: 'upload',
    }

    const result = deriveLiveAudioShadow(snapshot(song))

    expect(result.plan.excludedSources).toEqual([
      expect.objectContaining({ reason: 'unassigned-source' }),
    ])
    expect(result.plan.main.sourceIds).toEqual([])
  })

  it('excludes preview-only and orphaned producers', () => {
    const song = createEmptySongMap()
    song.audio = {
      fileName: 'mix.wav', fileSize: 1, mimeType: 'audio/wav',
      trim: { startSec: 0, endSec: 1 }, source: 'upload',
    }
    song.liveRouting = sourceRouting('source:preview', { kind: 'preview-audio' })

    const result = deriveLiveAudioShadow(snapshot(song))

    expect(result.plan.admittedSources).toEqual([])
    expect(result.plan.excludedSources.map((source) => source.reason)).toEqual(
      expect.arrayContaining(['source-not-live-musical', 'unassigned-source']),
    )
  })

  it('discovers every supported persisted producer exhaustively', () => {
    const song = createEmptySongMap()
    song.audio = {
      fileName: 'mix.wav', fileSize: 1, mimeType: 'audio/wav',
      trim: { startSec: 0, endSec: 1 }, source: 'upload',
    }
    song.liveStemRefs = {
      'stem:bass': 'stems/bass.wav',
      'stem:drums': 'stems/drums.wav',
    }
    song.drumMidi = {} as SongMap['drumMidi']
    song.drumMachine = { enabled: true, style: 'rock' } as SongMap['drumMachine']
    song.bassMidi = {} as SongMap['bassMidi']
    song.bassMachine = { enabled: true, style: 'roots' }

    const result = deriveLiveAudioShadow(snapshot(song))

    expect(result.input.candidates.map((candidate) => candidate.kind).sort()).toEqual([
      'bass-machine-midi',
      'detected-bass-midi',
      'detected-drum-midi',
      'drum-machine-midi',
      'original-audio',
      'stem-audio',
      'stem-audio',
    ])
  })

  it('permits source summing only through an exact explicit sum group', () => {
    const song = createEmptySongMap()
    song.liveStemRefs = { 'stem:bass': 'bass.wav', 'stem:drums': 'drums.wav' }
    const bass = sourceRouting(
      'source:bass',
      { kind: 'stem-audio', stemId: 'stem:bass' },
      'lane:band',
    )
    const drums = sourceRouting(
      'source:drums',
      { kind: 'stem-audio', stemId: 'stem:drums' },
      'lane:band',
    )
    song.liveRouting = {
      version: 1,
      sources: [...bass.sources, ...drums.sources],
      mixerChannels: [...bass.mixerChannels, ...drums.mixerChannels],
      sumGroups: [],
    }
    const base = snapshot(song, {
      rawProjectRouting: rawProject([{ id: 'lane:band', channel: 0 }]),
    })

    const implicit = deriveLiveAudioShadow(base)
    expect(implicit.plan.admittedSources).toEqual([])
    expect(implicit.plan.issues.map((issue) => issue.code)).toContain(
      'implicit-source-summing',
    )

    for (const channel of song.liveRouting.mixerChannels) {
      channel.sumGroupId = 'sum:band'
    }
    song.liveRouting.sumGroups = [
      {
        id: 'sum:band',
        rigSourceLaneId: 'lane:band',
        mixerChannelIds: ['mixer:source:bass', 'mixer:source:drums'],
      },
    ]
    const explicit = deriveLiveAudioShadow(base)
    expect(explicit.plan.admittedSources.map((source) => source.id)).toEqual([
      'source:bass',
      'source:drums',
    ])
  })

  it('keeps independently controlled stems on distinct rig lanes', () => {
    const song = createEmptySongMap()
    song.liveStemRefs = { 'stem:bass': 'bass.wav', 'stem:drums': 'drums.wav' }
    const bass = sourceRouting(
      'source:bass',
      { kind: 'stem-audio', stemId: 'stem:bass' },
      'lane:bass',
    )
    const drums = sourceRouting(
      'source:drums',
      { kind: 'stem-audio', stemId: 'stem:drums' },
      'lane:drums',
    )
    song.liveRouting = {
      version: 1,
      sources: [...bass.sources, ...drums.sources],
      mixerChannels: [...bass.mixerChannels, ...drums.mixerChannels],
      sumGroups: [],
    }
    const result = deriveLiveAudioShadow(snapshot(song))

    expect(result.plan.admittedSources.map((source) => source.programLaneId)).toEqual([
      'lane:bass',
      'lane:drums',
    ])
  })

  it('preserves malformed raw routing values for the shadow validator', () => {
    const song = songWithOriginal()
    const raw = captureRawProjectRoutingDto({
      id: 'project-a',
      performers: [{ id: 'p1', name: 'Martin', monitorBus: 'one' }],
      liveRig: {
        routingProfile: {
          id: 'broken-rig',
          version: 'v1',
          mainPhysicalOutputId: null,
          sourceLanes: [
            {
              id: 'lane:original',
              role: 'program',
              webAudioChannels: ['zero'],
              usbReturnChannels: [0],
              xr18InputStrips: [1],
              mainPolicy: 'on',
            },
          ],
          monitorOutputs: [{ monitorBus: 'one', physicalOutputId: 7 }],
        },
      },
    })
    const result = deriveLiveAudioShadow(snapshot(song, { rawProjectRouting: raw }))

    expect(result.input.rawProjectRouting).toEqual(raw.raw)
    expect(result.input.rigProfile.version).toBe('v1')
    expect(result.input.rigProfile.sourceLanes[0]?.webAudioChannels).toEqual([
      'zero',
    ])
    expect(result.plan.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'invalid-rig-profile-version',
        'invalid-channel-vector',
        'main-output-missing',
      ]),
    )
  })

  it('returns byte-equivalent input and plan for identical current state', () => {
    const current = snapshot(songWithOriginal())
    const first = deriveLiveAudioShadow(current)
    const second = deriveLiveAudioShadow(current)

    expect(JSON.stringify(first.input)).toBe(JSON.stringify(second.input))
    expect(JSON.stringify(first.plan)).toBe(JSON.stringify(second.plan))
  })
})
