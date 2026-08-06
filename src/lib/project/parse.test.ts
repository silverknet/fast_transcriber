import { describe, it, expect } from 'vitest'
import { parseProjectJson } from './parse'
import { serializeProject } from './serialize'
import type { ProjectFile } from './types'

function manifest(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    id: 'proj-1',
    name: 'My Set',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    songs: [],
    ...extra,
  })
}

describe('parseProjectJson — autoStems', () => {
  it('is undefined when absent', () => {
    expect(parseProjectJson(manifest()).autoStems).toBeUndefined()
  })

  it('round-trips a well-formed config', () => {
    const p = parseProjectJson(
      manifest({ autoStems: { enabled: true, stems: ['drums', 'bass'], quality: 'best' } }),
    )
    expect(p.autoStems).toEqual({ enabled: true, stems: ['drums', 'bass'], quality: 'best' })
  })

  it('filters unknown stem names and de-duplicates', () => {
    const p = parseProjectJson(
      manifest({
        autoStems: { enabled: true, stems: ['drums', 'drums', 'kazoo', 'bass'], quality: 'balanced' },
      }),
    )
    expect(p.autoStems?.stems).toEqual(['drums', 'bass'])
  })

  it('falls back to balanced for an unknown quality', () => {
    const p = parseProjectJson(
      manifest({ autoStems: { enabled: true, stems: ['vocals'], quality: 'ultra' } }),
    )
    expect(p.autoStems?.quality).toBe('balanced')
  })

  it('coerces enabled to a strict boolean', () => {
    const p = parseProjectJson(
      manifest({ autoStems: { enabled: 'yes', stems: ['drums'], quality: 'preview' } }),
    )
    expect(p.autoStems?.enabled).toBe(false)
  })

  it('does not throw on a malformed block — treats it as not configured', () => {
    expect(parseProjectJson(manifest({ autoStems: 'nope' })).autoStems).toBeUndefined()
    expect(parseProjectJson(manifest({ autoStems: { stems: 'no' } })).autoStems).toEqual({
      enabled: false,
      stems: [],
      quality: 'balanced',
    })
  })

  it('survives a serialize → parse round-trip (persistence is lossless)', () => {
    const project: ProjectFile = {
      formatVersion: 1,
      id: 'proj-1',
      name: 'My Set',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      songs: [],
      autoStems: { enabled: true, stems: ['drums', 'bass', 'other'], quality: 'best' },
    }
    const reparsed = parseProjectJson(serializeProject(project))
    expect(reparsed.autoStems).toEqual(project.autoStems)
  })
})

describe('parseProjectJson — mastering kickPunch', () => {
  const withMastering = (extra: Record<string, unknown>) =>
    parseProjectJson(manifest({ mastering: { enabled: true, ...extra } })).mastering

  it('is undefined when absent (existing projects are untouched)', () => {
    expect(withMastering({})?.kickPunch).toBeUndefined()
  })

  it('keeps a valid amount', () => {
    expect(withMastering({ kickPunch: 0.4 })?.kickPunch).toBe(0.4)
  })

  it('clamps out-of-range amounts to 0…1', () => {
    expect(withMastering({ kickPunch: 7 })?.kickPunch).toBe(1)
    expect(withMastering({ kickPunch: -3 })?.kickPunch).toBe(0)
  })

  it('ignores junk rather than corrupting the config', () => {
    expect(withMastering({ kickPunch: 'loud' })?.kickPunch).toBeUndefined()
    expect(withMastering({ kickPunch: NaN })?.kickPunch).toBeUndefined()
  })

  it('survives a serialize → parse round-trip', () => {
    const project: ProjectFile = {
      formatVersion: 1,
      id: 'proj-1',
      name: 'My Set',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      songs: [],
      mastering: { enabled: true, kickPunch: 0.45, stems: { drums: { intensity: 'light' } } },
    }
    const reparsed = parseProjectJson(serializeProject(project))
    expect(reparsed.mastering?.kickPunch).toBe(0.45)
  })
})

describe('parseProjectJson — canonical Live rig profile', () => {
  it('round-trips explicit Web, USB, XR18, Main, and monitor mappings', () => {
    const routingProfile = {
      id: 'xr18-profile-a',
      version: 1,
      mainPhysicalOutputId: 'xr18-main-lr',
      sourceLanes: [
        {
          id: 'lane:bass',
          role: 'program' as const,
          webAudioChannels: [0],
          usbReturnChannels: [0],
          xr18InputStrips: [1],
          mainPolicy: 'on' as const,
        },
      ],
      monitorOutputs: [
        { monitorBus: 1, physicalOutputId: 'xr18-aux-1' },
      ],
    }
    const project = parseProjectJson(manifest({ liveRig: { routingProfile } }))

    expect(project.liveRig?.routingProfile).toEqual(routingProfile)
    expect(
      parseProjectJson(serializeProject(project)).liveRig?.routingProfile,
    ).toEqual(routingProfile)
  })
})

describe('parseProjectJson — programmed transitions', () => {
  const SONGS = [
    { id: 'song-a', folder: 'songs/song-a' },
    { id: 'song-b', folder: 'songs/song-b' },
  ]
  const RECIPE = {
    schema: 'barbro.transition-recipe',
    version: 1,
    outgoing: {
      songId: 'song-a',
      title: 'Outgoing',
      endAnchor: { mode: 'bar', timeSec: 208.65, barNumber: 130, beatNumber: 4, label: 'End of bar 130' },
    },
    incoming: {
      songId: 'song-b',
      title: 'Incoming',
      startAnchor: { mode: 'bar', timeSec: 4.76, barNumber: 1, beatNumber: 1, label: 'Start of bar 1' },
    },
    transition: {
      type: 'echo',
      echo: {
        throwRule: 'beat-3-or-7',
        throwTimeSec: 207.85,
        delayDivision: 'dotted-eighth',
        captureLengthBeats: 0.75,
        drySongHoldBeats: 1.75,
        sendLevel: 0.62,
        wetLevel: 0.72,
        feedback: 0.96,
        repeatBuild: 0.53,
        toneHz: 5200,
        tailLengthSec: 5.8,
        effectiveTailLengthSec: 5.8,
        blendReverbLevel: 0.72,
        blendReverbLengthSec: 7.6,
      },
      nextSongDelay: {
        measuredFrom: 'echo-stop',
        beats: 0,
        secondsAtOutgoingTempo: 0,
        startOffsetAfterOutgoingEndSec: 5,
      },
    },
  }

  it('round-trips a valid project-level echo recipe', () => {
    const parsed = parseProjectJson(manifest({ songs: SONGS, transitions: [RECIPE] }))
    expect(parsed.transitions).toEqual([RECIPE])
    expect(parseProjectJson(serializeProject(parsed)).transitions).toEqual([RECIPE])
  })

  it('drops malformed, cross-project, and duplicate outgoing recipes fail-closed', () => {
    const invalidLevel = structuredClone(RECIPE)
    invalidLevel.transition.echo.feedback = 1.2
    const crossProject = structuredClone(RECIPE)
    crossProject.incoming.songId = 'not-in-project'
    const replacement = structuredClone(RECIPE)
    replacement.incoming.title = 'Last valid recipe wins'
    const parsed = parseProjectJson(
      manifest({ songs: SONGS, transitions: [invalidLevel, crossProject, RECIPE, replacement] }),
    )
    expect(parsed.transitions).toHaveLength(1)
    expect(parsed.transitions?.[0]?.incoming.title).toBe('Last valid recipe wins')
  })
})

describe('performers round-trip — the field-by-field whitelist is guarded here', () => {
  /**
   * The whitelist class in its natural habitat: `parsePerformers` reads each
   * field BY NAME, so a field added to the type but not the parser is created,
   * saved, and gone on the next load. The sidecar's copy has had this guard
   * since the day it ate the roster; the web copy went without one until the
   * project-health work exposed the gap. `FULL_PERFORMER` must carry EVERY
   * field of `Performer` — the keys-walk fails when the type grows past it.
   */
  const FULL_PERFORMER = {
    id: 'p1',
    name: 'Martin',
    role: 'Keys',
    userId: 'user-123',
    monitorBus: 1,
    inputs: [
      { id: 'i1', label: 'Piano', channels: [1, 2] },
      { id: 'i2', label: 'Moog', channels: [5] },
    ],
  }

  it('every field of a full performer survives parse → serialize → parse', () => {
    const once = parseProjectJson(manifest({ performers: [FULL_PERFORMER] }))
    const twice = parseProjectJson(serializeProject(once))
    expect(twice.performers?.[0]).toEqual(FULL_PERFORMER)
    // The walk that catches the NEXT field: nothing in the fixture may vanish.
    for (const key of Object.keys(FULL_PERFORMER)) {
      expect(
        (twice.performers?.[0] as unknown as Record<string, unknown>)[key],
        `Performer.${key} was eaten by a parser whitelist`,
      ).toEqual((FULL_PERFORMER as Record<string, unknown>)[key])
    }
  })

  it('junk inputs are dropped; valid ones survive alongside', () => {
    const project = parseProjectJson(
      manifest({
        performers: [
          {
            id: 'p1',
            name: 'M',
            inputs: [
              { id: 'ok', label: 'Sång', channels: [3] },
              { id: 'bad', label: 'off desk', channels: [17] },
              { id: 'bad2', label: 'dup', channels: [4, 4] },
              { label: 'no id', channels: [5] },
            ],
          },
        ],
      }),
    )
    expect(project.performers?.[0]?.inputs).toEqual([{ id: 'ok', label: 'Sång', channels: [3] }])
  })
})

describe('project defaults survive a load — the live-stem set', () => {
  /**
   * REPORTED: "I press in just drums and bass, but other is still toggled when
   * I go in… I unchecked other, went in again, it was checked again."
   *
   * `parseDefaults` read `countInBeats` and `preCountInCue` and silently
   * dropped `liveStems`. One missing line made the whole project-wide setting
   * not exist: it saved, the load threw it away, the dialog reseeded from the
   * LEGACY default (drums + bass + other) so "other" reappeared ticked, and
   * live played 'other' on every song because `audibleStemSet(undefined)`
   * falls back to that same legacy set. Both symptoms, one cause.
   */
  const withDefaults = (defaults: unknown) =>
    parseProjectJson(
      JSON.stringify({
        formatVersion: 1,
        id: 'p1',
        name: 'Gig',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        songs: [],
        defaults,
      }),
    )

  it('THE BUG: keeps the chosen live stems instead of dropping them', () => {
    expect(withDefaults({ liveStems: ['drums', 'bass'] }).defaults?.liveStems).toEqual([
      'drums',
      'bass',
    ])
  })

  it('an EMPTY set means "every stem starts muted" and must not become the legacy default', () => {
    expect(withDefaults({ liveStems: [] }).defaults?.liveStems).toEqual([])
  })

  it('normalises to canonical order and drops junk names', () => {
    expect(
      withDefaults({ liveStems: ['other', 'nonsense', 'drums', 'drums'] }).defaults?.liveStems,
    ).toEqual(['drums', 'other'])
  })

  it('an absent key stays absent, so the legacy fallback still applies', () => {
    expect(withDefaults({ countInBeats: 4 }).defaults?.liveStems).toBeUndefined()
  })

  it('a non-array is ignored rather than crashing the whole project load', () => {
    expect(withDefaults({ liveStems: 'drums' }).defaults?.liveStems).toBeUndefined()
  })

  it('still carries the other defaults through', () => {
    const d = withDefaults({
      countInBeats: 8,
      liveStems: ['bass'],
      preCountInCue: { mode: 'auto' },
    }).defaults
    expect(d?.countInBeats).toBe(8)
    expect(d?.preCountInCue?.mode).toBe('auto')
    expect(d?.liveStems).toEqual(['bass'])
  })
})

describe('the live BUTTON start state survives a load', () => {
  const withDefaults = (defaults: unknown) =>
    parseProjectJson(
      JSON.stringify({
        formatVersion: 1,
        id: 'p1',
        name: 'Gig',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        songs: [],
        defaults,
      }),
    )

  it('keeps the chosen buttons, including the Custom ones a stem list could not name', () => {
    expect(
      withDefaults({ liveSlots: ['drums', 'bass', 'click', 'cue', 'custom1'] }).defaults?.liveSlots,
    ).toEqual(['drums', 'bass', 'click', 'cue', 'custom1'])
  })

  it('EMPTY means every button starts off, and is not mistaken for unset', () => {
    expect(withDefaults({ liveSlots: [] }).defaults?.liveSlots).toEqual([])
  })

  it('unset stays unset, so the old stem setting still drives the start state', () => {
    expect(withDefaults({ liveStems: ['drums'] }).defaults?.liveSlots).toBeUndefined()
  })

  it('drops junk names and duplicates, in canonical order', () => {
    expect(
      withDefaults({ liveSlots: ['custom2', 'nope', 'bass', 'bass'] }).defaults?.liveSlots,
    ).toEqual(['bass', 'custom2'])
  })

  it('carries both settings together during the migration window', () => {
    const d = withDefaults({ liveStems: ['drums', 'bass'], liveSlots: ['drums'] }).defaults
    expect(d?.liveStems).toEqual(['drums', 'bass'])
    expect(d?.liveSlots).toEqual(['drums'])
  })
})

describe('the auto-prepare-browser-audio setting survives a load', () => {
  const withDefaults = (defaults: unknown) =>
    parseProjectJson(
      JSON.stringify({
        formatVersion: 1, id: 'p1', name: 'Gig',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        songs: [], defaults,
      }),
    )

  it('keeps the flag both ways', () => {
    expect(withDefaults({ autoCloudAudio: true }).defaults?.autoCloudAudio).toBe(true)
    expect(withDefaults({ autoCloudAudio: false }).defaults?.autoCloudAudio).toBe(false)
  })

  it('unset stays unset — off, but distinguishable from a deliberate off', () => {
    expect(withDefaults({ countInBeats: 4 }).defaults?.autoCloudAudio).toBeUndefined()
  })

  it('ignores junk rather than treating it as on', () => {
    expect(withDefaults({ autoCloudAudio: 'yes' }).defaults?.autoCloudAudio).toBeUndefined()
  })
})
