import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import { toCollabSongMap, collabContentFingerprint, mergeLocalIntoCollab } from './collab'
import { mergeForConflict } from './collabMerge'
import { fingerprintBassTrackInputs } from './bassTrackFingerprint'
import { hasFreshBassMidi, BASS_ANALYZER_VERSION } from './bassMidi'
import type { Bar, BassMidi, BassMidiEvent, Beat, SongMap } from './types'

function withGrid(sm: SongMap, barCount = 2, beatsPerBar = 4): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < barCount; i++) {
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: i,
      endSec: i + 1,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds: Array.from({ length: beatsPerBar }, (_, j) => `b${i}_${j}`),
    })
    for (let j = 0; j < beatsPerBar; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: i + j / beatsPerBar })
    }
  }
  return { ...sm, timeline: { bars, beats } }
}

function bassMidi(events: BassMidiEvent[], extra?: Partial<BassMidi>): BassMidi {
  return {
    events,
    analyzedAt: '2026-07-11T00:00:00.000Z',
    analyzerVersion: BASS_ANALYZER_VERSION,
    sourceStem: 'stems/best/bass.wav',
    audioFingerprint: 'song.mp3:123',
    ...extra,
  }
}

function note(timeSec: number, midi = 40, durationSec = 0.4, velocity = 0.8): BassMidiEvent {
  return { timeSec, durationSec, midi, velocity }
}

describe('bassMidi schema', () => {
  it('survives a parse round-trip; malformed notes are dropped, velocity clamps', () => {
    const sm = createEmptySongMap()
    sm.bassMidi = bassMidi([note(1.234, 40), note(2.5, 43, 0.25, 0.4)])
    const raw = JSON.parse(JSON.stringify(sm))
    raw.bassMidi.events.push({ timeSec: 'nan', durationSec: 0.5, midi: 40, velocity: 0.5 }) // dropped
    raw.bassMidi.events.push({ timeSec: 3, durationSec: 0, midi: 40, velocity: 0.5 }) // zero duration → dropped
    raw.bassMidi.events.push({ timeSec: 3, durationSec: 0.5, midi: 40.5, velocity: 0.5 }) // fractional midi → dropped
    raw.bassMidi.events.push({ timeSec: 3, durationSec: 0.5, midi: 200, velocity: 0.5 }) // out-of-range midi → dropped
    raw.bassMidi.events.push({ timeSec: 4, durationSec: 0.5, midi: 45, velocity: 9 }) // clamped
    raw.bassMidi.quantize = 'nonsense' // ignored
    const parsed = parseSongMap(JSON.stringify(raw))
    expect(parsed.bassMidi?.events).toHaveLength(3)
    expect(parsed.bassMidi?.events[2]).toEqual({ timeSec: 4, durationSec: 0.5, midi: 45, velocity: 1 })
    expect(parsed.bassMidi?.quantize).toBeUndefined()
    expect(validateSongMap(parsed).errors).toEqual([])
  })

  it('freshness tracks analyzer version and audio identity', () => {
    const sm = createEmptySongMap()
    sm.audio = {
      fileName: 'song.mp3',
      fileSize: 123,
      source: 'upload',
      trim: { startSec: 0, endSec: 10 },
    } as SongMap['audio']
    sm.bassMidi = bassMidi([note(1), note(2)])
    expect(hasFreshBassMidi(sm)).toBe(true)
    expect(hasFreshBassMidi({ ...sm, bassMidi: { ...sm.bassMidi, analyzerVersion: 0 } })).toBe(false)
    expect(
      hasFreshBassMidi({ ...sm, bassMidi: { ...sm.bassMidi, audioFingerprint: 'other:1' } }),
    ).toBe(false)
    expect(hasFreshBassMidi({ ...sm, bassMidi: { ...sm.bassMidi, events: [] } })).toBe(false)
  })
})

describe('bassMidi collab rules', () => {
  function withRender(sm: SongMap): SongMap {
    return {
      ...sm,
      bassMidi: bassMidi([note(1)], {
        renderExport: {
          fingerprint: 'aabbccdd',
          durationSec: 10,
          sampleRate: 44100,
          generatedAt: '2026-07-11T00:00:00.000Z',
          preludeOffsetSec: 0,
          relativePath: 'renders/bass-track.wav',
        },
      }),
    }
  }

  it('strips relativePath on push; fingerprint ignores renderExport entirely', () => {
    const sm = withRender(createEmptySongMap())
    const collab = toCollabSongMap(sm)
    expect(collab.bassMidi?.renderExport?.relativePath).toBeUndefined()
    expect(collab.bassMidi?.renderExport?.fingerprint).toBe('aabbccdd')

    const a = collabContentFingerprint(sm)
    const b = collabContentFingerprint({
      ...sm,
      bassMidi: { ...sm.bassMidi!, renderExport: undefined },
    })
    expect(a).toBe(b) // re-render never changes the sync fingerprint
  })

  it('pull restores the local relativePath', () => {
    const local = withRender(createEmptySongMap())
    const cloud = toCollabSongMap(local)
    const merged = mergeLocalIntoCollab(local, cloud)
    expect(merged.bassMidi?.renderExport?.relativePath).toBe('renders/bass-track.wav')
  })

  it('mergeForConflict ignores render differences but flags note differences', () => {
    const local = withRender(createEmptySongMap())
    const cloudSame = {
      ...toCollabSongMap(local),
      bassMidi: { ...toCollabSongMap(local).bassMidi!, renderExport: undefined },
    }
    expect(
      mergeForConflict(local, cloudSame).conflicts.find((c) => c.path === 'bassMidi'),
    ).toBeUndefined()

    const cloudDiff = {
      ...cloudSame,
      bassMidi: { ...cloudSame.bassMidi!, events: [note(9, 33)] },
    } as SongMap
    const row = mergeForConflict(local, cloudDiff).conflicts.find((c) => c.path === 'bassMidi')
    expect(row).toBeTruthy()
  })
})

describe('bassTrackFingerprint', () => {
  it('stable; sensitive to notes/quantize/trim; insensitive to renderExport', () => {
    let sm = withGrid(createEmptySongMap())
    sm = {
      ...sm,
      audio: {
        fileName: 'a.mp3',
        source: 'upload',
        trim: { startSec: 0, endSec: 10 },
      } as SongMap['audio'],
      bassMidi: bassMidi([note(1)]),
    }
    const base = fingerprintBassTrackInputs(sm)
    expect(fingerprintBassTrackInputs(sm)).toBe(base)
    expect(
      fingerprintBassTrackInputs({
        ...sm,
        bassMidi: { ...sm.bassMidi!, events: [note(2)] },
      }),
    ).not.toBe(base)
    expect(
      fingerprintBassTrackInputs({
        ...sm,
        bassMidi: { ...sm.bassMidi!, events: [note(1, 41)] },
      }),
    ).not.toBe(base)
    expect(
      fingerprintBassTrackInputs({ ...sm, bassMidi: { ...sm.bassMidi!, quantize: '1/16' } }),
    ).not.toBe(base)
    expect(
      fingerprintBassTrackInputs({
        ...sm,
        audio: { ...sm.audio!, trim: { startSec: 1, endSec: 10 } },
      }),
    ).not.toBe(base)
    expect(
      fingerprintBassTrackInputs({
        ...sm,
        bassMidi: {
          ...sm.bassMidi!,
          renderExport: {
            fingerprint: 'x',
            durationSec: 1,
            sampleRate: 44100,
            generatedAt: 'now',
            preludeOffsetSec: 0,
          },
        },
      }),
    ).toBe(base)
  })
})
