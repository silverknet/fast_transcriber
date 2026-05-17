import { describe, expect, it } from 'vitest'
import { defaultCueSettings } from '$lib/songmap/defaults'
import { fingerprintCueTrackInputs, cueTrackFingerprintPayload } from '$lib/songmap/cueTrackFingerprint'
import type { SongMap } from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'

function minimalMap(overrides: Partial<SongMap> = {}): SongMap {
  const barId = 'bar1'
  const beatId = 'b1'
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
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
          beatIds: [beatId, 'b2', 'b3', 'b4'],
        },
      ],
      beats: [
        { id: beatId, barId, indexInBar: 0, timeSec: 0 },
        { id: 'b2', barId, indexInBar: 1, timeSec: 0.5 },
        { id: 'b3', barId, indexInBar: 2, timeSec: 1 },
        { id: 'b4', barId, indexInBar: 3, timeSec: 1.5 },
      ],
    },
    sections: [],
    harmony: [],
    cues: defaultCueSettings(),
    ...overrides,
  }
}

describe('fingerprintCueTrackInputs', () => {
  it('is stable for the same map', () => {
    const m = minimalMap()
    expect(fingerprintCueTrackInputs(m)).toBe(fingerprintCueTrackInputs(m))
  })

  it('changes when trim changes', () => {
    const a = minimalMap()
    const b = minimalMap({
      audio: { fileName: 'x.wav', trim: { startSec: 0.1, endSec: 10 }, source: 'upload' },
    })
    expect(fingerprintCueTrackInputs(a)).not.toBe(fingerprintCueTrackInputs(b))
  })

  it('changes when a beat time changes', () => {
    const a = minimalMap()
    const beats = a.timeline.beats.map((b) => (b.id === 'b2' ? { ...b, timeSec: 0.55 } : b))
    const b = minimalMap({ timeline: { ...a.timeline, beats } })
    expect(fingerprintCueTrackInputs(a)).not.toBe(fingerprintCueTrackInputs(b))
  })

  it('includes cue mode and count-in', () => {
    const a = minimalMap({ cues: { ...defaultCueSettings(), mode: 'off', countInBeats: 0 } })
    const b = minimalMap({
      cues: { ...defaultCueSettings(), mode: 'countIn', countInBeats: 4, prependSec: 1.2 },
    })
    expect(fingerprintCueTrackInputs(a)).not.toBe(fingerprintCueTrackInputs(b))
  })

  it('payload is JSON-stable for bar order', () => {
    const m = minimalMap()
    const p = cueTrackFingerprintPayload(m)
    expect(JSON.stringify(p)).toContain('"v":2')
  })
})
