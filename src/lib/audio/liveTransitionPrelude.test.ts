import { describe, expect, it } from 'vitest'
import type { SongMap } from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { scheduleTransitionPrelude, transitionCountInWindow } from './liveTransitionPrelude'

function songWithCountIn(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Incoming',
      bpm: 120,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    audio: { fileName: 'song.wav', source: 'import', trim: { startSec: 0, endSec: 20 } },
    timeline: {
      bars: [{
        id: 'bar-1',
        index: 0,
        startSec: 4,
        endSec: 6,
        meter: { numerator: 4, denominator: 4 },
        beatCount: 4,
        beatIds: ['beat-1', 'beat-2', 'beat-3', 'beat-4'],
      }],
      beats: [0, 1, 2, 3].map((index) => ({
        id: `beat-${index + 1}`,
        barId: 'bar-1',
        indexInBar: index,
        timeSec: 4 + index * 0.5,
      })),
    },
    sections: [],
    harmony: [],
    cueTracks: [],
    countInBeats: 4,
    startBeatId: 'beat-1',
  }
}

describe('transitionCountInWindow', () => {
  it('reuses the canonical click count-in before the saved incoming anchor', () => {
    expect(transitionCountInWindow(songWithCountIn(), 4, 0)).toEqual({
      anchorMixerSec: 4,
      startMixerSec: 2,
      countInBeats: 4,
      usesCanonicalCountIn: true,
    })
  })

  it('does not invent a count-in for an arbitrary transition anchor', () => {
    expect(transitionCountInWindow(songWithCountIn(), 10, 0)).toEqual({
      anchorMixerSec: 10,
      startMixerSec: 10,
      countInBeats: 0,
      usesCanonicalCountIn: false,
    })
  })
})

describe('scheduleTransitionPrelude', () => {
  it('lands the incoming anchor on time after announcement and count-in', () => {
    expect(scheduleTransitionPrelude({
      nowCtxTime: 2,
      requestedAnchorCtxTime: 10,
      startMixerSec: 2,
      anchorMixerSec: 4,
      playbackRate: 1,
      announcementDurationSec: 1,
    })).toEqual({
      sourceStartCtxTime: 8,
      anchorCtxTime: 10,
      announcementCtxTime: 6.85,
      lateBySec: 0,
    })
  })

  it('moves the complete prelude later instead of dropping count-in beats', () => {
    const result = scheduleTransitionPrelude({
      nowCtxTime: 7,
      requestedAnchorCtxTime: 10,
      startMixerSec: 2,
      anchorMixerSec: 4,
      playbackRate: 1,
      announcementDurationSec: 1,
    })

    expect(result.lateBySec).toBeCloseTo(0.19, 8)
    expect(result.sourceStartCtxTime).toBeCloseTo(8.19, 8)
    expect(result.anchorCtxTime).toBeCloseTo(10.19, 8)
    expect(result.announcementCtxTime).toBeCloseTo(7.04, 8)
  })
})
