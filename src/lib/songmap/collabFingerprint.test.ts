import { describe, it, expect } from 'vitest'
import { parseSongMap } from './parse'
import { collabContentFingerprint } from './collab'
import type { SongMap } from './types'

/**
 * The fingerprint is the linchpin of the phantom-conflict fix: it must be
 * IDENTICAL across devices for the same shared musical content, and blind to
 * per-render / per-machine noise — otherwise the autosave keeps pushing and
 * the conflict dialog keeps firing.
 */
const baseJson = {
  formatVersion: 1,
  metadata: { title: 'Song', bpm: 120, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
  audio: { fileName: 'a.mp3', trim: { startSec: 0, endSec: 10 }, source: 'upload', sha256: 'abc' },
  timeline: {
    bars: [
      { id: 'bar-1', index: 0, startSec: 0, endSec: 2, meter: { numerator: 4, denominator: 4 }, beatCount: 2, beatIds: ['b1', 'b2'] },
    ],
    beats: [
      { id: 'b1', barId: 'bar-1', indexInBar: 0, timeSec: 0, source: 'detected' },
      { id: 'b2', barId: 'bar-1', indexInBar: 1, timeSec: 1, source: 'detected' },
    ],
  },
  sections: [{ id: 'sec-1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 0 } }],
  harmony: [{ id: 'ch-1', barId: 'bar-1', beatId: 'b1', startSec: 0, endSec: 2, chord: { root: 'C', displayRaw: 'C' } }],
}

const sm = (): SongMap => parseSongMap(JSON.stringify(baseJson))

describe('collabContentFingerprint', () => {
  it('is stable for identical content', () => {
    expect(collabContentFingerprint(sm())).toBe(collabContentFingerprint(sm()))
  })

  it('ignores metadata.updatedAt (a save bumps it, not a real edit)', () => {
    const b = sm()
    b.metadata.updatedAt = '2099-12-31T00:00:00.000Z'
    expect(collabContentFingerprint(b)).toBe(collabContentFingerprint(sm()))
  })

  it('ignores render caches (clickExport / cue renderExport)', () => {
    const b = sm()
    b.clickExport = {
      fingerprint: 'zzz',
      durationSec: 3,
      sampleRate: 44100,
      generatedAt: '2099-01-01T00:00:00.000Z',
      preludeOffsetSec: 0,
      relativePath: 'cue/click-track.wav',
    }
    expect(collabContentFingerprint(b)).toBe(collabContentFingerprint(sm()))
  })

  it('ignores expectedAudio (joiner-only reconciliation field)', () => {
    const b = sm()
    b.expectedAudio = { fileName: 'a.mp3', sha256: 'abc' }
    expect(collabContentFingerprint(b)).toBe(collabContentFingerprint(sm()))
  })

  it('changes when a chord changes', () => {
    const b = sm()
    b.harmony[0]!.chord = { root: 'F', quality: 'maj7', displayRaw: 'Fmaj7' }
    expect(collabContentFingerprint(b)).not.toBe(collabContentFingerprint(sm()))
  })

  it('changes when the grid changes', () => {
    const b = sm()
    b.timeline.beats[0]!.timeSec = 99
    expect(collabContentFingerprint(b)).not.toBe(collabContentFingerprint(sm()))
  })

  it('changes when a section label changes', () => {
    const b = sm()
    b.sections[0]!.label = 'Chorus'
    expect(collabContentFingerprint(b)).not.toBe(collabContentFingerprint(sm()))
  })
})
