import { describe, expect, it } from 'vitest'
import type { CueTrack } from '$lib/songmap/types'
import {
  LIVE_AUDIO_SHADOW_SCHEMA_VERSION,
  snapshotCurrentLiveAudioContext,
  validateAudioConfiguration,
  type LiveAudioShadowInput,
  type LiveSourceCandidate,
  type LiveSourceIntent,
  type RawLiveSourceLane,
} from './audioConfigValidator'
import {
  formatLiveAudioShadowDiagnostic,
  liveAudioShadowDiagnostic,
  logLiveAudioShadowDiagnostic,
} from './liveAudioShadowDiagnostics'

const PERFORMERS = [
  { id: 'p1', name: 'Martin', monitorBus: 1, required: true },
  { id: 'p2', name: 'Thor', monitorBus: 2, required: true },
  { id: 'p3', name: 'Emma', monitorBus: 3, required: true },
] as const

function cueTrack(id: string, performerId: string): CueTrack {
  return {
    id,
    name: `${performerId} cues`,
    performerId,
    enabled: true,
    suppressedGeneratedKeys: [],
    events: [
      {
        id: `${id}-intro`,
        kind: 'intro',
        enabled: true,
        source: 'custom',
        text: 'Song title',
        anchor: { kind: 'time', timeSec: 0 },
      },
      {
        id: `${id}-verse`,
        kind: 'section',
        enabled: true,
        source: 'generated',
        text: 'Verse, two, three, four',
        anchor: { kind: 'time', timeSec: 8 },
      },
    ],
  }
}

function lane(
  id: string,
  role: 'program' | 'click' | 'cue',
  channel: number | readonly [number, number],
  performerId?: string,
): RawLiveSourceLane {
  const channels = typeof channel === 'number' ? [channel] : [...channel]
  return {
    id,
    role,
    performerId,
    webAudioChannels: channels,
    usbReturnChannels: channels,
    xr18InputStrips: channels.map((value) => value + 9),
    mainPolicy: role === 'program' ? 'on' : 'off',
  }
}

function source(
  id: string,
  kind: LiveSourceCandidate['kind'] = 'stem-audio',
): LiveSourceCandidate {
  return {
    id,
    songId: 'song-a',
    generationId: 'generation-a',
    label: id,
    kind,
    scope: 'live-musical',
    admissionStatus: 'included',
    availability: 'available',
  }
}

function intent(
  sourceId: string,
  options: Partial<LiveSourceIntent> = {},
): LiveSourceIntent {
  return {
    sourceId,
    songId: 'song-a',
    generationId: 'generation-a',
    included: true,
    required: true,
    mixerChannelId: `mix:${sourceId}`,
    main: true,
    monitorSends: [
      { performerId: 'p1', gain: 1 },
      { performerId: 'p2', gain: 1 },
      { performerId: 'p3', gain: 1 },
    ],
    ...options,
  }
}

function baseInput(
  overrides: Partial<LiveAudioShadowInput> = {},
): LiveAudioShadowInput {
  const candidates = overrides.candidates ?? [source('original', 'original-audio')]
  const sourceIntents = overrides.sourceIntents ?? [intent('original')]
  const mixerChannels =
    overrides.mixerChannels ??
    sourceIntents.map((sourceIntent) => ({
      id: sourceIntent.mixerChannelId,
      sourceId: sourceIntent.sourceId,
      songId: sourceIntent.songId,
      generationId: sourceIntent.generationId,
      processing: { gain: 1 },
      rigSourceLaneId: 'program',
      ...(sourceIntents.length > 1 ? { sumGroupId: 'program-sum' } : {}),
    }))
  const sourceSumGroups =
    overrides.sourceSumGroups ??
    (mixerChannels.length > 1
      ? [
          {
            id: 'program-sum',
            rigSourceLaneId: 'program',
            mixerChannelIds: mixerChannels.map((channel) => channel.id),
          },
        ]
      : [])
  return {
    schemaVersion: LIVE_AUDIO_SHADOW_SCHEMA_VERSION,
    generationId: 'generation-a',
    project: { id: 'project-a', performers: PERFORMERS },
    song: {
      id: 'song-a',
      cueTracks: [
        cueTrack('cue-p1', 'p1'),
        cueTrack('cue-p2', 'p2'),
        cueTrack('cue-p3', 'p3'),
      ],
    },
    candidates,
    sourceIntents,
    mixerChannels,
    sourceSumGroups,
    supportedMusicalSourceKinds: [
      'original-audio',
      'stem-audio',
      'drum-machine-midi',
      'bass-machine-midi',
      'chord-machine-keys-midi',
      'chord-machine-arp-midi',
    ],
    rigProfile: {
      id: 'xr18-three-performer',
      version: 1,
      mainPhysicalOutputId: 'xr18-main-lr',
      sourceLanes: [
        lane('program', 'program', [0, 1]),
        lane('click', 'click', 2),
        lane('cue:p1', 'cue', 3, 'p1'),
        lane('cue:p2', 'cue', 4, 'p2'),
        lane('cue:p3', 'cue', 5, 'p3'),
      ],
      monitorOutputs: [
        { monitorBus: 1, physicalOutputId: 'xr18-aux-1' },
        { monitorBus: 2, physicalOutputId: 'xr18-aux-2' },
        { monitorBus: 3, physicalOutputId: 'xr18-aux-3' },
      ],
    },
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
    rawProjectRouting: { fixture: true },
    inputFacts: [],
    ...overrides,
  }
}

describe('live audio shadow validation', () => {
  it('routes explicitly assigned stems to Main', () => {
    const plan = validateAudioConfiguration(
      baseInput({
        candidates: [source('stem:bass'), source('stem:drums')],
        sourceIntents: [intent('stem:bass'), intent('stem:drums')],
      }),
    )

    expect(plan.main.sourceIds).toEqual(['stem:bass', 'stem:drums'])
    expect(plan.admittedSources.map((candidate) => candidate.id)).toEqual([
      'stem:bass',
      'stem:drums',
    ])
  })

  it('excludes every unassigned, orphaned, preview-only, and stale source', () => {
    const stale = { ...source('old-song'), songId: 'song-old' }
    const plan = validateAudioConfiguration(
      baseInput({
        candidates: [
          source('assigned'),
          source('unassigned'),
          { ...source('orphan'), scope: 'orphaned' },
          { ...source('preview', 'preview-audio'), scope: 'live-musical' },
          stale,
        ],
        sourceIntents: [intent('assigned')],
      }),
    )

    expect(plan.main.sourceIds).toEqual(['assigned'])
    expect(
      Object.fromEntries(
        plan.excludedSources.map((item) => [item.id, item.reason]),
      ),
    ).toEqual({
      'old-song': 'stale-song-source',
      orphan: 'source-not-live-musical',
      preview: 'source-not-live-musical',
      unassigned: 'unassigned-source',
    })
  })

  it('keeps click, cues, and announcements out of Main by default', () => {
    const plan = validateAudioConfiguration(baseInput())

    expect(plan.main.click).toBe(false)
    expect(plan.main.cueTrackIds).toEqual([])
    expect(plan.main.announcementTrackIds).toEqual([])
    expect(plan.click.destinations).toEqual([
      'performer:p1',
      'performer:p2',
      'performer:p3',
    ])
    expect(
      plan.cueTracks.every((track) => !track.cueDestinations.includes('main')),
    ).toBe(true)
    expect(
      plan.cueTracks.every(
        (track) => !track.announcementDestinations.includes('main'),
      ),
    ).toBe(true)
  })

  it('routes only click and the explicitly selected cue track to Main in Practice', () => {
    const plan = validateAudioConfiguration(
      baseInput({ practice: { enabled: true, selectedCueTrackId: 'cue-p2' } }),
    )

    expect(plan.main.click).toBe(true)
    expect(plan.main.cueTrackIds).toEqual(['cue-p2'])
    expect(plan.main.announcementTrackIds).toEqual(['cue-p2'])
    expect(plan.click.destinations).toContain('main')
    expect(
      plan.cueTracks.find((track) => track.id === 'cue-p1')?.cueDestinations,
    ).not.toContain('main')
    expect(
      plan.cueTracks.find((track) => track.id === 'cue-p2')?.cueDestinations,
    ).toContain('main')
    expect(
      plan.cueTracks.find((track) => track.id === 'cue-p2')
        ?.announcementDestinations,
    ).toContain('main')
    expect(
      plan.cueTracks.find((track) => track.id === 'cue-p3')?.cueDestinations,
    ).not.toContain('main')
  })

  it('isolates one invalid performer route without affecting valid performers or Main', () => {
    const plan = validateAudioConfiguration(
      baseInput({
        project: {
          id: 'project-a',
          performers: [
            PERFORMERS[0],
            { ...PERFORMERS[1], monitorBus: 99 },
            PERFORMERS[2],
          ],
        },
      }),
    )

    expect(plan.configurationDisposition).toBe('degraded')
    expect(plan.main.sourceIds).toEqual(['original'])
    expect(
      plan.performers.find((performer) => performer.performerId === 'p1')
        ?.readiness.state,
    ).toBe('initializing')
    expect(
      plan.performers.find((performer) => performer.performerId === 'p2')
        ?.readiness,
    ).toMatchObject({
      state: 'failed',
      reasonCodes: ['performer-monitor-invalid'],
    })
    expect(
      plan.performers.find((performer) => performer.performerId === 'p3')
        ?.readiness.state,
    ).toBe('initializing')
    expect(plan.click.destinations).not.toContain('performer:p2')
    expect(plan.click.destinations).not.toContain('main')
  })

  it('fails closed when required source channels are missing', () => {
    const plan = validateAudioConfiguration(
      baseInput({ device: { ...baseInput().device, outputChannelCount: 1 } }),
    )

    expect(plan.configurationDisposition).toBe('blocked')
    expect(plan.main.sourceIds).toEqual([])
    expect(plan.main.readiness.reasonCodes).toContain(
      'required-program-source-unavailable',
    )
    expect(
      plan.issues.some((issue) => issue.code === 'channel-out-of-range'),
    ).toBe(true)
    expect(plan.click.destinations).toEqual([])
    expect(
      plan.performers.every((performer) => performer.click === false),
    ).toBe(true)
    expect(
      plan.cueTracks.every(
        (track) =>
          track.cueDestinations.length === 0 &&
          track.announcementDestinations.length === 0,
      ),
    ).toBe(true)
  })

  it('reports Main/private channel collisions and removes all unsafe Main routes', () => {
    const input = baseInput()
    const collidingClick = lane('click', 'click', 1)
    const plan = validateAudioConfiguration({
      ...input,
      rigProfile: {
        ...input.rigProfile,
        sourceLanes: input.rigProfile.sourceLanes.map((item) =>
          item.id === 'click' ? collidingClick : item,
        ),
      },
    })

    expect(
      plan.issues.some(
        (issue) => issue.code === 'main-monitor-channel-collision',
      ),
    ).toBe(true)
    expect(plan.main.sourceIds).toEqual([])
    expect(plan.main.readiness.state).toBe('failed')
    expect(plan.click.destinations).toEqual([])
  })

  it('cannot carry old-song state into a new song plan', () => {
    const oldPlan = validateAudioConfiguration(baseInput())
    const nextCandidate = {
      ...source('next-original', 'original-audio'),
      songId: 'song-b',
      generationId: 'generation-b',
    }
    const nextIntent = {
      ...intent('next-original'),
      songId: 'song-b',
      generationId: 'generation-b',
    }
    const nextPlan = validateAudioConfiguration(
      baseInput({
        generationId: 'generation-b',
        song: { id: 'song-b', cueTracks: [] },
        candidates: [source('original', 'original-audio'), nextCandidate],
        sourceIntents: [intent('original'), nextIntent],
        mixerChannels: [
          {
            id: nextIntent.mixerChannelId,
            sourceId: nextIntent.sourceId,
            songId: 'song-b',
            generationId: 'generation-b',
            processing: { gain: 1 },
            rigSourceLaneId: 'program',
          },
        ],
        sourceSumGroups: [],
      }),
    )

    expect(oldPlan.main.sourceIds).toContain('original')
    expect(nextPlan.main.sourceIds).toEqual(['next-original'])
    expect(nextPlan.excludedSources).toContainEqual(
      expect.objectContaining({ id: 'original', reason: 'stale-song-source' }),
    )
    expect(JSON.stringify(nextPlan)).not.toContain('cue-p1')
  })

  it('represents disabled and missing cue and announcement content without substitutions', () => {
    const disabled = { ...cueTrack('cue-p1', 'p1'), enabled: false }
    const empty = { ...cueTrack('cue-p2', 'p2'), events: [] }
    const disabledIntroOnly = {
      ...cueTrack('cue-p3', 'p3'),
      events: [
        {
          ...cueTrack('cue-p3', 'p3').events[0]!,
          enabled: false,
        },
      ],
    }
    const plan = validateAudioConfiguration(
      baseInput({
        song: { id: 'song-a', cueTracks: [disabled, empty, disabledIntroOnly] },
      }),
    )

    expect(plan.cueTracks.find((track) => track.id === 'cue-p1')).toMatchObject(
      {
        cueContent: 'disabled',
        announcementContent: 'disabled',
        cueDestinations: [],
        announcementDestinations: [],
      },
    )
    expect(plan.cueTracks.find((track) => track.id === 'cue-p2')).toMatchObject(
      {
        cueContent: 'missing',
        announcementContent: 'missing',
        cueDestinations: [],
        announcementDestinations: [],
      },
    )
    expect(plan.cueTracks.find((track) => track.id === 'cue-p3')).toMatchObject(
      {
        cueContent: 'missing',
        announcementContent: 'disabled',
        cueDestinations: [],
        announcementDestinations: [],
      },
    )
  })

  it('does not mistake XR18 control connectivity for a verified audio route', () => {
    const plan = validateAudioConfiguration(
      baseInput({
        device: { ...baseInput().device, xr18ControlConnected: true },
      }),
    )

    expect(plan.xr18ControlConnected).toBe(true)
    expect(plan.xr18AudioRouteVerified).toBe(false)
    expect(plan.main.readiness).toMatchObject({
      state: 'initializing',
      evidence: 'configured',
      runtimeActivationVerified: false,
      physicallyConfirmed: false,
    })
    expect(
      plan.issues.some(
        (issue) => issue.code === 'xr18-control-is-not-audio-evidence',
      ),
    ).toBe(true)
  })

  it('is deterministic for semantically identical input ordering', () => {
    const input = baseInput({
      candidates: [source('stem:drums'), source('stem:bass')],
      sourceIntents: [intent('stem:drums'), intent('stem:bass')],
    })
    const reordered: LiveAudioShadowInput = {
      ...input,
      candidates: [...input.candidates].reverse(),
      sourceIntents: [...input.sourceIntents].reverse(),
      project: {
        ...input.project,
        performers: [...input.project.performers].reverse(),
      },
      song: { ...input.song, cueTracks: [...input.song.cueTracks].reverse() },
      rigProfile: {
        ...input.rigProfile,
        sourceLanes: [...input.rigProfile.sourceLanes].reverse(),
        monitorOutputs: [...input.rigProfile.monitorOutputs].reverse(),
      },
    }

    expect(validateAudioConfiguration(reordered)).toEqual(
      validateAudioConfiguration(input),
    )
  })

  it('exposes an opt-in stable diagnostic without changing the plan', () => {
    const plan = validateAudioConfiguration(baseInput())
    const messages: string[] = []

    const diagnostic = liveAudioShadowDiagnostic(plan)
    logLiveAudioShadowDiagnostic(plan, (message) => messages.push(message))

    expect(diagnostic.songId).toBe('song-a')
    expect(messages).toEqual([
      `[live-audio-shadow]\n${formatLiveAudioShadowDiagnostic(plan)}`,
    ])
    expect(plan.main.readiness.runtimeActivationVerified).toBe(false)
  })

  it('snapshots current project and song data without retaining mutable arrays', () => {
    const tracks = [cueTrack('cue-p1', 'p1')]
    const project = {
      id: 'project-a',
      performers: [{ id: 'p1', name: 'Martin', monitorBus: 1 }],
    }
    const context = snapshotCurrentLiveAudioContext(project, 'song-a', {
      cueTracks: tracks,
    })

    project.performers[0]!.name = 'Changed'
    tracks[0]!.events[0]!.text = 'Changed'

    expect(context.project.performers[0]?.name).toBe('Martin')
    expect(context.song.cueTracks[0]?.events[0]?.text).toBe('Song title')
  })
})
