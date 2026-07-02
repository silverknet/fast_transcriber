import { describe, expect, it } from 'vitest'
import { parseSongMap } from './parse'
import { serializeSongMap } from './serialize'

/**
 * The v1→v2 format bump touches the parse/serialize boundary for the WHOLE
 * SongMap, not just cue fields. `cueMigration.test.ts` proves the cue-side
 * migration; this proves the format bump does NOT lose any of the *non-cue*
 * data a real project carries — bars, beats, sections, chords, count-in,
 * song-start anchor, audio identity — and that a v2 file round-trips through
 * save/load unchanged.
 */

// A realistic legacy (v1) .smap: 2 bars of 4/4, a section, two chords, a
// count-in, a moved song-start anchor, and full audio identity.
const legacyV1 = {
  formatVersion: 1,
  app: { name: 'BarBro', appVersion: '0.0.9' },
  metadata: {
    title: 'Valerie (live)',
    artist: 'Amy Winehouse',
    key: 'Eb',
    keyDetail: { root: 'E', accidental: 'flat', mode: 'major' },
    bpm: 120,
    analyzed: true,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-06-01T00:00:00.000Z',
  },
  audio: {
    fileName: 'valerie.mp3',
    mimeType: 'audio/mpeg',
    durationSec: 210.5,
    sampleRate: 44100,
    channels: 2,
    fileSize: 3_400_000,
    trim: { startSec: 1.25, endSec: 200.0 },
    sha256: 'deadbeef',
    originalPath: 'audio/valerie.mp3',
    source: 'upload',
  },
  timeline: {
    bars: [
      {
        id: 'bar-1',
        index: 0,
        startSec: 0,
        endSec: 2,
        meter: { numerator: 4, denominator: 4 },
        beatCount: 4,
        beatIds: ['b1', 'b2', 'b3', 'b4'],
      },
      {
        id: 'bar-2',
        index: 1,
        startSec: 2,
        endSec: 4,
        meter: { numerator: 4, denominator: 4 },
        beatCount: 4,
        beatIds: ['b5', 'b6', 'b7', 'b8'],
      },
    ],
    beats: [
      { id: 'b1', barId: 'bar-1', indexInBar: 0, timeSec: 0, source: 'detected' },
      { id: 'b2', barId: 'bar-1', indexInBar: 1, timeSec: 0.5, source: 'detected' },
      { id: 'b3', barId: 'bar-1', indexInBar: 2, timeSec: 1.0, source: 'detected' },
      { id: 'b4', barId: 'bar-1', indexInBar: 3, timeSec: 1.5, source: 'detected' },
      { id: 'b5', barId: 'bar-2', indexInBar: 0, timeSec: 2.0, source: 'detected' },
      { id: 'b6', barId: 'bar-2', indexInBar: 1, timeSec: 2.5, source: 'detected' },
      { id: 'b7', barId: 'bar-2', indexInBar: 2, timeSec: 3.0, source: 'detected' },
      { id: 'b8', barId: 'bar-2', indexInBar: 3, timeSec: 3.5, source: 'manual' },
    ],
  },
  sections: [
    {
      id: 'sec-1',
      kind: 'verse',
      label: 'Verse 1',
      barRange: { startBarIndex: 0, endBarIndex: 1 },
      color: '#334455',
    },
  ],
  harmony: [
    {
      id: 'ch-1',
      barId: 'bar-1',
      beatId: 'b1',
      startSec: 0,
      endSec: 2,
      chord: { root: 'E', accidental: 'flat', quality: 'maj', displayRaw: 'Ebmaj' },
    },
    {
      id: 'ch-2',
      barId: 'bar-2',
      beatId: 'b5',
      startSec: 2,
      endSec: 4,
      chord: { root: 'C', quality: 'min', displayRaw: 'Cm' },
    },
  ],
  startBeatId: 'b1',
  // A count-in that must survive as top-level countInBeats.
  cues: { mode: 'countIn', countInBeats: 4, useSectionLabels: true },
}

describe('SongMap v1→v2 full round-trip (no non-cue data loss)', () => {
  const sm = parseSongMap(JSON.stringify(legacyV1))

  it('bumps to v2 and migrates the count-in to a top-level field', () => {
    expect(sm.formatVersion).toBe(2)
    expect(sm.countInBeats).toBe(4)
  })

  it('preserves metadata verbatim', () => {
    expect(sm.metadata).toMatchObject(legacyV1.metadata)
  })

  it('preserves audio identity + trim verbatim', () => {
    expect(sm.audio).toMatchObject(legacyV1.audio)
  })

  it('preserves the full bar/beat grid', () => {
    expect(sm.timeline.bars).toEqual(legacyV1.timeline.bars)
    expect(sm.timeline.beats).toEqual(legacyV1.timeline.beats)
  })

  it('preserves sections and the song-start anchor', () => {
    expect(sm.sections).toEqual(legacyV1.sections)
    expect(sm.startBeatId).toBe('b1')
  })

  it('preserves harmony (chords) verbatim', () => {
    expect(sm.harmony).toEqual(legacyV1.harmony)
  })

  it('is idempotent through serialize → parse (a v2 save reloads unchanged)', () => {
    const reparsed = parseSongMap(serializeSongMap(sm))
    expect(reparsed).toEqual(sm)
  })

  it('gives a friendly "update BarBro" error for a file from a newer build', () => {
    const fromFuture = JSON.stringify({ ...legacyV1, formatVersion: 999 })
    expect(() => parseSongMap(fromFuture)).toThrow(/newer version of BarBro/i)
  })
})
