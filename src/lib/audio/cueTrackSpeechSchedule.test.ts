import { describe, expect, it } from 'vitest'
import { computeCountIn } from '$lib/audio/computeCountIn'
import {
  buildCueSpeechEvents,
  countInSpeechOutputTimes,
  titleCuePreludeSec,
} from '$lib/audio/cueTrackSpeechSchedule'
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
