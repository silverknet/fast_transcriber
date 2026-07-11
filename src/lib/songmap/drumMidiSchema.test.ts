import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import { toCollabSongMap, collabContentFingerprint, mergeLocalIntoCollab } from './collab'
import { mergeForConflict } from './collabMerge'
import { quantizeTimesToGrid, dedupeDrumEvents } from './quantizeToGrid'
import { fingerprintDrumTrackInputs } from './drumTrackFingerprint'
import { drumClassCounts, hasFreshDrumMidi, DRUM_ANALYZER_VERSION } from './drumMidi'
import type { Bar, Beat, DrumMidi, DrumMidiEvent, SongMap } from './types'

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

function drumMidi(events: DrumMidiEvent[], extra?: Partial<DrumMidi>): DrumMidi {
  return {
    events,
    analyzedAt: '2026-07-11T00:00:00.000Z',
    analyzerVersion: DRUM_ANALYZER_VERSION,
    sourceStem: 'stems/best/drums.wav',
    audioFingerprint: 'song.mp3:123',
    ...extra,
  }
}

describe('drumMidi schema', () => {
  it('survives a parse round-trip; malformed events are dropped, velocity clamps', () => {
    const sm = createEmptySongMap()
    sm.drumMidi = drumMidi([
      { timeSec: 1.234, cls: 'kick', velocity: 0.8 },
      { timeSec: 2.5, cls: 'hihat', velocity: 0.4 },
    ])
    const raw = JSON.parse(JSON.stringify(sm))
    raw.drumMidi.events.push({ timeSec: 'nan', cls: 'kick', velocity: 0.5 }) // dropped
    raw.drumMidi.events.push({ timeSec: 3, cls: 'kazoo', velocity: 0.5 }) // dropped
    raw.drumMidi.events.push({ timeSec: 4, cls: 'snare', velocity: 9 }) // clamped
    raw.drumMidi.quantize = 'nonsense' // ignored
    const parsed = parseSongMap(JSON.stringify(raw))
    expect(parsed.drumMidi?.events).toHaveLength(3)
    expect(parsed.drumMidi?.events[2]).toEqual({ timeSec: 4, cls: 'snare', velocity: 1 })
    expect(parsed.drumMidi?.quantize).toBeUndefined()
    expect(validateSongMap(parsed).errors).toEqual([])
  })

  it('classCounts + freshness', () => {
    const sm = createEmptySongMap()
    sm.audio = {
      fileName: 'song.mp3',
      fileSize: 123,
      source: 'upload',
      trim: { startSec: 0, endSec: 10 },
    } as SongMap['audio']
    sm.drumMidi = drumMidi([
      { timeSec: 1, cls: 'kick', velocity: 1 },
      { timeSec: 2, cls: 'kick', velocity: 1 },
      { timeSec: 3, cls: 'snare', velocity: 1 },
    ])
    expect(drumClassCounts(sm.drumMidi.events)).toMatchObject({ kick: 2, snare: 1, hihat: 0 })
    expect(hasFreshDrumMidi(sm)).toBe(true)
    expect(hasFreshDrumMidi({ ...sm, drumMidi: { ...sm.drumMidi, analyzerVersion: 0 } })).toBe(false)
    expect(
      hasFreshDrumMidi({ ...sm, drumMidi: { ...sm.drumMidi, audioFingerprint: 'other:1' } }),
    ).toBe(false)
  })
})

describe('drumMidi collab rules', () => {
  function withRender(sm: SongMap): SongMap {
    return {
      ...sm,
      drumMidi: drumMidi([{ timeSec: 1, cls: 'kick', velocity: 1 }], {
        renderExport: {
          fingerprint: 'aabbccdd',
          durationSec: 10,
          sampleRate: 44100,
          generatedAt: '2026-07-11T00:00:00.000Z',
          preludeOffsetSec: 0,
          relativePath: 'renders/drum-track.wav',
        },
      }),
    }
  }

  it('strips relativePath on push; fingerprint ignores renderExport entirely', () => {
    const sm = withRender(createEmptySongMap())
    const collab = toCollabSongMap(sm)
    expect(collab.drumMidi?.renderExport?.relativePath).toBeUndefined()
    expect(collab.drumMidi?.renderExport?.fingerprint).toBe('aabbccdd')

    const a = collabContentFingerprint(sm)
    const b = collabContentFingerprint({
      ...sm,
      drumMidi: { ...sm.drumMidi!, renderExport: undefined },
    })
    expect(a).toBe(b) // re-render never changes the sync fingerprint
  })

  it('pull restores the local relativePath', () => {
    const local = withRender(createEmptySongMap())
    const cloud = toCollabSongMap(local)
    const merged = mergeLocalIntoCollab(local, cloud)
    expect(merged.drumMidi?.renderExport?.relativePath).toBe('renders/drum-track.wav')
  })

  it('mergeForConflict ignores render differences but flags event differences', () => {
    const local = withRender(createEmptySongMap())
    const cloudSame = {
      ...toCollabSongMap(local),
      drumMidi: { ...toCollabSongMap(local).drumMidi!, renderExport: undefined },
    }
    expect(
      mergeForConflict(local, cloudSame).conflicts.find((c) => c.path === 'drumMidi'),
    ).toBeUndefined()

    const cloudDiff = {
      ...cloudSame,
      drumMidi: {
        ...cloudSame.drumMidi!,
        events: [{ timeSec: 9, cls: 'snare', velocity: 0.5 }],
      },
    } as SongMap
    const row = mergeForConflict(local, cloudDiff).conflicts.find((c) => c.path === 'drumMidi')
    expect(row).toBeTruthy()
  })
})

describe('quantizeTimesToGrid', () => {
  const sm = withGrid(createEmptySongMap()) // 2 bars, 1s each, beats every 0.25s
  const beatsSorted = [...sm.timeline.beats].sort((a, b) => a.timeSec - b.timeSec)
  const barsById = new Map(sm.timeline.bars.map((b) => [b.id, b]))

  it('snaps to 16ths inside the owning beat span', () => {
    // Beat at 1.0, span 0.25s, 4 slots → slot width 0.0625.
    const [near] = quantizeTimesToGrid([{ timeSec: 1.031 }], beatsSorted, barsById, '1/16')
    expect(near!.timeSec).toBeCloseTo(1.0, 6) // 0.496 slots → rounds to the beat
    const [up] = quantizeTimesToGrid([{ timeSec: 1.04 }], beatsSorted, barsById, '1/16')
    expect(up!.timeSec).toBeCloseTo(1.0625, 6) // 0.64 slots → rounds to slot 1
  })

  it('rounds up across the beat boundary onto the next beat', () => {
    const [e] = quantizeTimesToGrid([{ timeSec: 1.24 }], beatsSorted, barsById, '1/8')
    expect(e!.timeSec).toBeCloseTo(1.25, 6)
  })

  it('triplet slots divide the actual span (works in any meter)', () => {
    const sm68 = withGrid(createEmptySongMap(), 1, 2) // 2 beats of 0.5s each
    const beats68 = [...sm68.timeline.beats].sort((a, b) => a.timeSec - b.timeSec)
    const bars68 = new Map(sm68.timeline.bars.map((b) => [b.id, b]))
    const [e] = quantizeTimesToGrid([{ timeSec: 0.09 }], beats68, bars68, '1/16T')
    expect(e!.timeSec).toBeCloseTo(0.5 / 6, 5) // first triplet slot of a 0.5s beat
  })

  it('passes through before the grid and after the last span', () => {
    const [before] = quantizeTimesToGrid([{ timeSec: -0.5 }], beatsSorted, barsById, '1/16')
    expect(before!.timeSec).toBe(-0.5)
    const [after] = quantizeTimesToGrid([{ timeSec: 9.7 }], beatsSorted, barsById, '1/16')
    expect(after!.timeSec).toBe(9.7)
  })

  it('dedupeDrumEvents merges same-class same-slot hits keeping max velocity', () => {
    const out = dedupeDrumEvents([
      { timeSec: 1.0, cls: 'kick', velocity: 0.4 },
      { timeSec: 1.0005, cls: 'kick', velocity: 0.9 },
      { timeSec: 1.0, cls: 'hihat', velocity: 0.3 },
    ])
    expect(out).toHaveLength(2)
    expect(out.find((e) => e.cls === 'kick')!.velocity).toBe(0.9)
  })
})

describe('drumTrackFingerprint', () => {
  it('stable; sensitive to events/kit/quantize/trim; insensitive to renderExport', () => {
    let sm = withGrid(createEmptySongMap())
    sm = {
      ...sm,
      audio: {
        fileName: 'a.mp3',
        source: 'upload',
        trim: { startSec: 0, endSec: 10 },
      } as SongMap['audio'],
      drumMidi: drumMidi([{ timeSec: 1, cls: 'kick', velocity: 1 }]),
    }
    const base = fingerprintDrumTrackInputs(sm)
    expect(fingerprintDrumTrackInputs(sm)).toBe(base)
    expect(
      fingerprintDrumTrackInputs({
        ...sm,
        drumMidi: { ...sm.drumMidi!, events: [{ timeSec: 2, cls: 'kick', velocity: 1 }] },
      }),
    ).not.toBe(base)
    expect(
      fingerprintDrumTrackInputs({ ...sm, drumMidi: { ...sm.drumMidi!, kit: 'acoustic' } }),
    ).not.toBe(base)
    expect(
      fingerprintDrumTrackInputs({ ...sm, drumMidi: { ...sm.drumMidi!, quantize: '1/16' } }),
    ).not.toBe(base)
    expect(
      fingerprintDrumTrackInputs({
        ...sm,
        drumMidi: {
          ...sm.drumMidi!,
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
