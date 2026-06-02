import { describe, expect, it } from 'vitest'
import { computeCountIn } from '$lib/audio/computeCountIn'
import {
  buildCueSpeechEvents,
  clickWavSongStartSec,
  countInSpeechOutputTimes,
  songStartBeat,
  titleCuePreludeSec,
} from '$lib/audio/cueTrackSpeechSchedule'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import { defaultCueSettings } from '$lib/songmap/defaults'
import { defaultSectionLabel } from '$lib/songmap/sectionEdit'
import type { SongMap } from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'

function mapWithCountIn(countInBeats: number): SongMap {
  const barId = 'b0'
  const beatIds = ['bb0', 'bb1', 'bb2', 'bb3']
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Test',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'x.wav',
      trim: { startSec: 0, endSec: 10 },
      source: 'upload',
    },
    timeline: {
      bars: [
        {
          id: barId,
          index: 0,
          startSec: 0,
          endSec: 2,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds,
        },
      ],
      beats: beatIds.map((id, i) => ({
        id,
        barId,
        indexInBar: i,
        timeSec: i * 0.5,
      })),
    },
    sections: [],
    harmony: [],
    cues: {
      ...defaultCueSettings(),
      mode: 'countIn',
      countInBeats,
    },
  }
}

describe('countInSpeechOutputTimes', () => {
  it('spaces four counts evenly before the first downbeat on the cue timeline', () => {
    const sm = mapWithCountIn(4)
    const trim = sm.audio!.trim
    const ci = computeCountIn(sm, 4)
    expect(ci).not.toBeNull()
    const prepend = ci!.prependSec
    const times = countInSpeechOutputTimes(sm, trim, prepend, 4)
    expect(times).toHaveLength(4)
    const bd = 0.5
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeCloseTo(bd, 5)
    }
    const firstDownbeatOut = prepend + (0 - trim.startSec)
    expect(times[3]! + bd).toBeCloseTo(firstDownbeatOut, 5)
  })

  it('emits exactly N clicks for N ∈ {1,4,8,16}', () => {
    const trim = { startSec: 0, endSec: 10 }
    for (const N of [1, 4, 8, 16]) {
      const sm = mapWithCountIn(N)
      const ci = computeCountIn(sm, N)!
      const times = countInSpeechOutputTimes(sm, trim, ci.prependSec, N)
      expect(times).toHaveLength(N)
      // Last click is exactly one beat before the first downbeat.
      const firstDownbeatOut = ci.prependSec + (0 - trim.startSec)
      expect(times[N - 1]! + ci.beatDurationSec).toBeCloseTo(firstDownbeatOut, 5)
      // Every click ≥ 0 on the pre-prelude timeline.
      for (const t of times) expect(t).toBeGreaterThanOrEqual(-1e-9)
    }
  })

  it('returns [] when countInBeats is 0', () => {
    const sm = mapWithCountIn(0)
    expect(countInSpeechOutputTimes(sm, sm.audio!.trim, 0, 0)).toEqual([])
  })

  it('loose trim (pre-roll before first downbeat) still emits exactly N clicks', () => {
    // First bar at 1.5s..3.5s, downbeat at 1.5s; trim starts at 0s so the
    // trimmed audio has 1.5s of pre-roll before bar 1, beat 1. Count-in must
    // still land entirely ≥ 0 on the pre-prelude timeline with N clicks.
    const sm = mapWithCountIn(8)
    sm.timeline.bars[0]!.startSec = 1.5
    sm.timeline.bars[0]!.endSec = 3.5
    sm.timeline.beats = sm.timeline.beats.map((b, i) => ({ ...b, timeSec: 1.5 + i * 0.5 }))
    const ci = computeCountIn(sm, 8)!
    const times = countInSpeechOutputTimes(sm, sm.audio!.trim, ci.prependSec, 8)
    expect(times).toHaveLength(8)
    const bd = ci.beatDurationSec
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeCloseTo(bd, 5)
    }
    const firstDownbeatOut = ci.prependSec + (1.5 - sm.audio!.trim.startSec)
    expect(times[7]! + bd).toBeCloseTo(firstDownbeatOut, 5)
    for (const t of times) expect(t).toBeGreaterThanOrEqual(-1e-9)
  })

  it('honors actual beat times before songStart when startBeatId is moved (irregular grid)', () => {
    // 4-beat bar, downbeats at irregular times (not perfectly uniform). Move
    // startBeatId to the 5th beat (= bar 2 beat 1). Count-in clicks for beats
    // 1..4 should land at those beats' ACTUAL timeSec values, not a synthetic
    // uniform grid.
    const sm = mapWithCountIn(4)
    // Extend timeline with a second bar so we have a beat to anchor on.
    const bar1 = sm.timeline.bars[0]!
    sm.timeline.bars.push({
      id: 'b1',
      index: 1,
      startSec: 2,
      endSec: 4,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: ['bb4', 'bb5', 'bb6', 'bb7'],
    })
    // Make the first-bar beats slightly irregular and add bar-2 beats.
    sm.timeline.beats = [
      { id: 'bb0', barId: bar1.id, indexInBar: 0, timeSec: 0.0 },
      { id: 'bb1', barId: bar1.id, indexInBar: 1, timeSec: 0.47 }, // not 0.5
      { id: 'bb2', barId: bar1.id, indexInBar: 2, timeSec: 1.06 }, // not 1.0
      { id: 'bb3', barId: bar1.id, indexInBar: 3, timeSec: 1.49 }, // not 1.5
      { id: 'bb4', barId: 'b1', indexInBar: 0, timeSec: 2.0 },
      { id: 'bb5', barId: 'b1', indexInBar: 1, timeSec: 2.5 },
      { id: 'bb6', barId: 'b1', indexInBar: 2, timeSec: 3.0 },
      { id: 'bb7', barId: 'b1', indexInBar: 3, timeSec: 3.5 },
    ]
    bar1.beatIds = ['bb0', 'bb1', 'bb2', 'bb3']
    sm.startBeatId = 'bb4' // anchor moves to bar 2 beat 1 at 2.0s

    const ci = computeCountIn(sm, 4)!
    const times = countInSpeechOutputTimes(sm, sm.audio!.trim, ci.prependSec, 4)
    expect(times).toHaveLength(4)

    // Click k should land at (songStartNoPrelude − (start.timeSec − preBeat.timeSec)).
    const songStartNoPrelude = ci.prependSec + (2.0 - 0 /* trim.startSec */)
    const expected = [0.0, 0.47, 1.06, 1.49].map(
      (t) => songStartNoPrelude - (2.0 - t),
    )
    for (let i = 0; i < 4; i++) expect(times[i]!).toBeCloseTo(expected[i]!, 5)
    // Sanity: NOT a uniform grid (gaps should differ).
    const gap01 = times[1]! - times[0]!
    const gap12 = times[2]! - times[1]!
    expect(Math.abs(gap01 - gap12)).toBeGreaterThan(0.05)
  })
})

describe('clickWavSongStartSec', () => {
  it('matches the first downbeat position on the final click WAV timeline', () => {
    const sm = mapWithCountIn(8)
    const ci = computeCountIn(sm, 8)!
    const preludeSec = titleCuePreludeSec(sm)
    const start = clickWavSongStartSec(sm, { preludeSec, prependSec: ci.prependSec })
    expect(start).not.toBeNull()
    // tight trim: songStart = preludeSec + prependSec + 0
    expect(start!).toBeCloseTo(preludeSec + ci.prependSec, 5)
    // count-in clicks end one beat before songStart on the final timeline
    const times = countInSpeechOutputTimes(sm, sm.audio!.trim, ci.prependSec, 8)
    expect(preludeSec + times[7]! + ci.beatDurationSec).toBeCloseTo(start!, 5)
  })

  it('returns null when no first-bar downbeat exists', () => {
    const sm = mapWithCountIn(4)
    sm.timeline.bars = []
    expect(clickWavSongStartSec(sm, { preludeSec: 1, prependSec: 0 })).toBeNull()
  })
})

describe('songStartBeat', () => {
  it('falls back to bar 1 beat 1 when no override is set', () => {
    const sm = mapWithCountIn(4)
    sm.startBeatId = undefined
    const beat = songStartBeat(sm)
    expect(beat).toBeDefined()
    expect(beat!.indexInBar).toBe(0)
    // first beat in mapWithCountIn is at timeSec 0
    expect(beat!.timeSec).toBe(0)
  })

  it('honors a startBeatId override that points to a non-downbeat', () => {
    const sm = mapWithCountIn(4)
    // override to beat 3 in bar 1 (indexInBar=2, timeSec=1.0)
    sm.startBeatId = sm.timeline.beats[2]!.id
    const beat = songStartBeat(sm)
    expect(beat).toBeDefined()
    expect(beat!.id).toBe(sm.timeline.beats[2]!.id)
    expect(beat!.indexInBar).toBe(2)
  })

  it('ignores a startBeatId that does not match any beat (soft fallback)', () => {
    const sm = mapWithCountIn(4)
    sm.startBeatId = 'no-such-beat'
    const beat = songStartBeat(sm)
    // Falls back to the first downbeat — no crash.
    expect(beat).toBeDefined()
    expect(beat!.indexInBar).toBe(0)
  })
})

describe('effectiveCountInBeats + cues.mode coexistence', () => {
  it('reads top-level countInBeats independently of cues.mode', () => {
    const sm = mapWithCountIn(0) // sets cues.mode = 'countIn' with 0 beats
    sm.cues.mode = 'spoken'
    sm.cues.countInBeats = 0
    sm.countInBeats = 4
    expect(effectiveCountInBeats(sm)).toBe(4)
  })

  it('returns 0 when both top-level and legacy fields are absent/zero', () => {
    const sm = mapWithCountIn(0)
    sm.cues.mode = 'off'
    sm.cues.countInBeats = 0
    sm.countInBeats = undefined
    expect(effectiveCountInBeats(sm)).toBe(0)
  })

  it('honors legacy cues.countInBeats during the migration window', () => {
    const sm = mapWithCountIn(4) // cues.mode = 'countIn', cues.countInBeats = 4
    sm.countInBeats = undefined
    expect(effectiveCountInBeats(sm)).toBe(4)
  })
})

describe('buildCueSpeechEvents', () => {
  it('emits separate count clips on a steady grid', () => {
    const sm = mapWithCountIn(4)
    const ev = buildCueSpeechEvents(sm)
    const counts = ev.filter((e) => e.kind === 'count')
    expect(counts).toHaveLength(4)
    const pre = titleCuePreludeSec(sm)
    expect(pre).toBeGreaterThan(0)
    for (let i = 1; i < counts.length; i++) {
      const dt = counts[i]!.tSec - counts[i - 1]!.tSec
      expect(dt).toBeCloseTo(0.5, 5)
    }
    expect(counts[0]!.tSec).toBeCloseTo(pre - 0.048, 5)
  })

  it('every generic section: full one…four, label, shortened pickup (two verses)', () => {
    const bar0 = 'b0'
    const bar1 = 'b1'
    const beats0 = ['b00', 'b01', 'b02', 'b03'].map((id, i) => ({
      id,
      barId: bar0,
      indexInBar: i,
      timeSec: 3 + i * 0.5,
    }))
    const beats1 = ['b10', 'b11', 'b12', 'b13'].map((id, i) => ({
      id,
      barId: bar1,
      indexInBar: i,
      timeSec: 5 + i * 0.5,
    }))
    const sm: SongMap = {
      formatVersion: SONGMAP_FORMAT_VERSION,
      metadata: {
        title: 'T',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
      audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 20 }, source: 'upload' },
      timeline: {
        bars: [
          {
            id: bar0,
            index: 0,
            startSec: 3,
            endSec: 5,
            meter: { numerator: 4, denominator: 4 },
            beatCount: 4,
            beatIds: ['b00', 'b01', 'b02', 'b03'],
          },
          {
            id: bar1,
            index: 1,
            startSec: 5,
            endSec: 7,
            meter: { numerator: 4, denominator: 4 },
            beatCount: 4,
            beatIds: ['b10', 'b11', 'b12', 'b13'],
          },
        ],
        beats: [...beats0, ...beats1],
      },
      sections: [
        {
          id: 's1',
          kind: 'verse',
          label: defaultSectionLabel('verse'),
          barRange: { startBarIndex: 0, endBarIndex: 0 },
        },
        {
          id: 's2',
          kind: 'verse',
          label: defaultSectionLabel('verse'),
          barRange: { startBarIndex: 1, endBarIndex: 1 },
        },
      ],
      harmony: [],
      cues: { ...defaultCueSettings(), mode: 'off', countInBeats: 0 },
    }
    const ev = buildCueSpeechEvents(sm)
    const verseLabels = ev.filter((e) => e.kind === 'section' && e.text === 'Verse.')
    expect(verseLabels).toHaveLength(2)
    const countWords = ev.filter((e) => e.kind === 'count').map((e) => e.text)
    // Section 1: one…four + two…four; section 2: one…four + three…four
    expect(countWords).toEqual([
      'one.',
      'two.',
      'three.',
      'four.',
      'two.',
      'three.',
      'four.',
      'one.',
      'two.',
      'three.',
      'four.',
      'three.',
      'four.',
    ])
  })

  it('generic chorus: same count-in pattern twice', () => {
    const bar0 = 'b0'
    const bar1 = 'b1'
    const beats = ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3'].map((id, i) => ({
      id,
      barId: i < 4 ? bar0 : bar1,
      indexInBar: i % 4,
      timeSec: (i < 4 ? 4 : 6) + (i % 4) * 0.5,
    }))
    const sm: SongMap = {
      formatVersion: SONGMAP_FORMAT_VERSION,
      metadata: {
        title: 'T',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
      audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 20 }, source: 'upload' },
      timeline: {
        bars: [
          {
            id: bar0,
            index: 0,
            startSec: 4,
            endSec: 6,
            meter: { numerator: 4, denominator: 4 },
            beatCount: 4,
            beatIds: ['a0', 'a1', 'a2', 'a3'],
          },
          {
            id: bar1,
            index: 1,
            startSec: 6,
            endSec: 8,
            meter: { numerator: 4, denominator: 4 },
            beatCount: 4,
            beatIds: ['b0', 'b1', 'b2', 'b3'],
          },
        ],
        beats,
      },
      sections: [
        {
          id: 'c1',
          kind: 'chorus',
          label: defaultSectionLabel('chorus'),
          barRange: { startBarIndex: 0, endBarIndex: 0 },
        },
        {
          id: 'c2',
          kind: 'chorus',
          label: defaultSectionLabel('chorus'),
          barRange: { startBarIndex: 1, endBarIndex: 1 },
        },
      ],
      harmony: [],
      cues: { ...defaultCueSettings(), mode: 'off', countInBeats: 0 },
    }
    const ev = buildCueSpeechEvents(sm)
    const sections = ev.filter((e) => e.kind === 'section')
    expect(sections.map((e) => e.text)).toEqual(['Chorus.', 'Chorus.'])
    expect(ev.filter((e) => e.kind === 'count')).toHaveLength(13)
  })
})
