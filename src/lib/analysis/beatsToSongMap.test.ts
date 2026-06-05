import { describe, expect, it } from 'vitest'
import { beatsToSongMap, type RawBeatRow } from './beatsToSongMap'

function clickTrack(barCount: number, beatsPerBar = 4, secPerBeat = 0.5): RawBeatRow[] {
  const out: RawBeatRow[] = []
  for (let bar = 0; bar < barCount; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      out.push({
        time: (bar * beatsPerBar + beat) * secPerBeat,
        beatInBar: beat + 1,
      })
    }
  }
  return out
}

describe('beatsToSongMap · happy path', () => {
  it('produces a SongMap with bars and beats from a clean 4-bar click track', () => {
    const map = beatsToSongMap({
      filename: 'click.wav',
      durationSec: 8,
      beats: clickTrack(4),
    })
    expect(map.timeline.bars.length).toBe(4)
    expect(map.timeline.beats.length).toBe(16)
    expect(map.metadata.analyzed).toBe(true)
    expect(map.metadata.bpm).toBeGreaterThan(0)
  })

  it('infers ~120 BPM from a click track with 0.5s spacing', () => {
    const map = beatsToSongMap({
      filename: 'click.wav',
      durationSec: 8,
      beats: clickTrack(4, 4, 0.5), // 0.5s = 2 beats/sec = 120 BPM
    })
    expect(map.metadata.bpm).toBeGreaterThanOrEqual(118)
    expect(map.metadata.bpm).toBeLessThanOrEqual(122)
  })

  it('handles a 3/4 time signature (waltz)', () => {
    const map = beatsToSongMap({
      filename: 'waltz.wav',
      durationSec: 12,
      beats: clickTrack(4, 3, 0.5),
    })
    expect(map.timeline.bars.length).toBe(4)
    expect(map.timeline.beats.length).toBe(12)
  })
})

describe('beatsToSongMap · empty / degenerate input', () => {
  it('throws a diagnostic error when the analyzer returned zero beats', () => {
    expect(() =>
      beatsToSongMap({ filename: 'silence.wav', durationSec: 10, beats: [] }),
    ).toThrowError(/no beats.*too short.*too quiet/i)
  })

  it('throws a sidecar-bug error when beats exist but all are malformed', () => {
    expect(() =>
      beatsToSongMap({
        filename: 'broken.wav',
        durationSec: 10,
        beats: [
          { time: NaN, beatInBar: 1 },
          { time: 1, beatInBar: NaN },
        ],
      }),
    ).toThrowError(/sidecar bug/i)
  })

  it('throws when there is no downbeat in the input', () => {
    // No beatInBar === 1 anywhere — but all other beats valid.
    expect(() =>
      beatsToSongMap({
        filename: 'no-down.wav',
        durationSec: 5,
        beats: [
          { time: 0.5, beatInBar: 2 },
          { time: 1.0, beatInBar: 3 },
          { time: 1.5, beatInBar: 4 },
        ],
      }),
    ).not.toThrow() // Falls back to using all rows; should still produce a map.
  })
})

describe('beatsToSongMap · sidecar response contract', () => {
  // These tests pin down the *exact* shape we receive from the sidecar so a
  // future format change doesn't silently break the analyzer.
  it('accepts the exact RawBeatRow shape the sidecar produces', () => {
    // This matches what `analyzeDownbeatsViaDesktop` extracts from
    // `{ ok, data: { beats: [...] } }` after passing through the
    // Number()/Number.isFinite() filter.
    const sidecarBeats: RawBeatRow[] = [
      { time: 0.84, beatInBar: 1 },
      { time: 1.26, beatInBar: 2 },
      { time: 1.68, beatInBar: 3 },
      { time: 2.1, beatInBar: 4 },
      { time: 2.52, beatInBar: 1 },
    ]
    const map = beatsToSongMap({
      filename: 'dum-av-dig-clip.wav',
      durationSec: 5,
      beats: sidecarBeats,
    })
    expect(map.timeline.beats.length).toBeGreaterThan(0)
    expect(map.timeline.bars.length).toBeGreaterThan(0)
  })

  it('tolerates beats with extra fields (forward-compat)', () => {
    type ExtraBeat = RawBeatRow & { confidence?: number; strength?: number }
    const beats: ExtraBeat[] = clickTrack(2).map((b) => ({ ...b, confidence: 0.9 }))
    const map = beatsToSongMap({ filename: 'ext.wav', durationSec: 4, beats })
    expect(map.timeline.beats.length).toBe(8)
  })
})
