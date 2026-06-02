import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { clickPlayRange, songTimings, stemPlayRange, DEFAULT_BPM } from './timings'
import type { Bar, Beat, SongMap } from '$lib/songmap/types'

function bar(index: number, beatsPerBar = 4): Bar {
  return {
    id: `bar${index}`,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: beatsPerBar, denominator: 4 },
    beatCount: beatsPerBar,
    beatIds: Array.from({ length: beatsPerBar }, (_, i) => `b${index}_${i}`),
  }
}

function beat(barIndex: number, indexInBar: number, beatsPerBar = 4): Beat {
  return {
    id: `b${barIndex}_${indexInBar}`,
    barId: `bar${barIndex}`,
    indexInBar,
    timeSec: barIndex + indexInBar / beatsPerBar,
  }
}

function buildMap(opts: {
  trimStart: number
  trimEnd: number
  bpm?: number
  firstBeatTimeSec?: number
  cuesMode?: 'off' | 'countIn'
  countInBeats?: number
}): SongMap {
  const bars: Bar[] = [bar(0), bar(1)]
  const beats: Beat[] = [
    { ...beat(0, 0), timeSec: opts.firstBeatTimeSec ?? opts.trimStart },
    beat(0, 1),
    beat(0, 2),
    beat(0, 3),
    beat(1, 0),
  ]
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 't',
      createdAt: '',
      updatedAt: '',
      bpm: opts.bpm,
    },
    audio: {
      fileName: 'a.wav',
      trim: { startSec: opts.trimStart, endSec: opts.trimEnd },
      source: 'upload',
    },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cues: {
      mode: opts.cuesMode ?? 'off',
      countInBeats: opts.countInBeats ?? 0,
      useSectionLabels: false,
    },
  } as unknown as SongMap
}

describe('songTimings', () => {
  it('computes basic timings for a trimStart=0 song', () => {
    const map = buildMap({ trimStart: 0, trimEnd: 60, bpm: 120, firstBeatTimeSec: 0 })
    const t = songTimings(map)
    expect(t.bpm).toBe(120)
    expect(t.trimStartSec).toBe(0)
    expect(t.trimEndSec).toBe(60)
    expect(t.songDurationSec).toBe(60)
    expect(t.firstBeatSongTimeSec).toBe(0)
    expect(t.firstDownbeatOriginalSec).toBe(0)
    expect(t.countInBeats).toBe(0)
    expect(t.countInDurationSec).toBe(0)
  })

  it('shifts first-beat reference into song-time when trim has a head', () => {
    const map = buildMap({ trimStart: 1.5, trimEnd: 60, bpm: 100, firstBeatTimeSec: 2.3 })
    const t = songTimings(map)
    expect(t.trimStartSec).toBe(1.5)
    expect(t.songDurationSec).toBeCloseTo(58.5, 6)
    expect(t.firstBeatSongTimeSec).toBeCloseTo(0.8, 6) // 2.3 - 1.5
    expect(t.firstDownbeatOriginalSec).toBeCloseTo(2.3, 6)
  })

  it('falls back to DEFAULT_BPM when metadata has no bpm', () => {
    const map = buildMap({ trimStart: 0, trimEnd: 60 })
    expect(songTimings(map).bpm).toBe(DEFAULT_BPM)
  })

  it('throws on missing audio.trim', () => {
    const map = buildMap({ trimStart: 0, trimEnd: 60 })
    delete (map as { audio?: unknown }).audio
    expect(() => songTimings(map)).toThrow(/no valid audio\.trim/)
  })

  it('throws when trim has zero length', () => {
    const map = buildMap({ trimStart: 1, trimEnd: 1 })
    expect(() => songTimings(map)).toThrow(/no valid audio\.trim/)
  })

  it('clamps firstBeatSongTimeSec to 0 if a beat is before trim.startSec', () => {
    const map = buildMap({ trimStart: 5, trimEnd: 60, firstBeatTimeSec: 3 })
    const t = songTimings(map)
    expect(t.firstBeatSongTimeSec).toBe(0)
  })

  it('surfaces count-in beats and duration from cues', () => {
    const map = buildMap({
      trimStart: 0,
      trimEnd: 60,
      bpm: 120,
      firstBeatTimeSec: 0,
      cuesMode: 'countIn',
      countInBeats: 8,
    })
    const t = songTimings(map)
    expect(t.countInBeats).toBe(8)
    // First bar in buildMap is 1s long with 4 beats → beat duration 0.25s.
    expect(t.beatDurationSec).toBeCloseTo(0.25, 6)
    expect(t.countInDurationSec).toBeCloseTo(2.0, 6) // 8 * 0.25
  })

  it('keeps countInBeats=0 when cues.mode is "off"', () => {
    const map = buildMap({ trimStart: 0, trimEnd: 60, cuesMode: 'off', countInBeats: 8 })
    expect(songTimings(map).countInBeats).toBe(0)
    expect(songTimings(map).countInDurationSec).toBe(0)
  })
})

describe('stemPlayRange', () => {
  it('starts at first downbeat when there is no count-in', () => {
    const t = songTimings(buildMap({ trimStart: 1.2, trimEnd: 60, bpm: 120, firstBeatTimeSec: 1.2 }))
    const r = stemPlayRange(t, 75) // stem is 75s long
    expect(r.playStartSec).toBeCloseTo(1.2, 6)
    expect(r.playEndSec).toBe(60)
  })

  it('rewinds by countInDurationSec so lead-in plays under the count-in', () => {
    // 8 count-in beats * 0.25s = 2s lead-in; first downbeat at 5s.
    const t = songTimings(
      buildMap({
        trimStart: 0,
        trimEnd: 60,
        bpm: 120,
        firstBeatTimeSec: 5,
        cuesMode: 'countIn',
        countInBeats: 8,
      }),
    )
    const r = stemPlayRange(t, 75)
    expect(r.playStartSec).toBeCloseTo(3.0, 6) // 5 - 2
    expect(r.playEndSec).toBe(60)
  })

  it('clamps to 0 when count-in exceeds the lead-in available', () => {
    // First downbeat at 0.5s, count-in wants 2s → would land at -1.5s, clamped to 0.
    const t = songTimings(
      buildMap({
        trimStart: 0,
        trimEnd: 60,
        bpm: 120,
        firstBeatTimeSec: 0.5,
        cuesMode: 'countIn',
        countInBeats: 8,
      }),
    )
    const r = stemPlayRange(t, 75)
    expect(r.playStartSec).toBe(0)
    expect(r.playEndSec).toBe(60)
  })

  it('clamps end to stem duration when stem is shorter than trim', () => {
    const t = songTimings(buildMap({ trimStart: 1.2, trimEnd: 60, bpm: 120, firstBeatTimeSec: 1.2 }))
    const r = stemPlayRange(t, 30)
    expect(r.playEndSec).toBe(30)
  })
})

describe('clickPlayRange', () => {
  it('plays from the song-start point inside the WAV when there is no count-in', () => {
    // Trim tight to first downbeat; preludeOffset = preludeSec + prependSec.
    // No count-in → click starts at clickWavSongStart = preludeOffset on the WAV.
    const t = songTimings(buildMap({ trimStart: 0, trimEnd: 60, bpm: 120, firstBeatTimeSec: 0 }))
    const r = clickPlayRange(t, /*clickDur*/ 62, /*preludeOffset*/ 2)
    expect(r.playStartSec).toBeCloseTo(2, 6)
    expect(r.playEndSec).toBeCloseTo(62, 6)
  })

  it('rewinds by countInDurationSec so the click starts on the first count-in click', () => {
    const t = songTimings(
      buildMap({
        trimStart: 0,
        trimEnd: 60,
        bpm: 120,
        firstBeatTimeSec: 0,
        cuesMode: 'countIn',
        countInBeats: 8,
      }),
    )
    // 8 * 0.25 = 2s count-in. preludeOffset 2 (preludeSec=0, prependSec=2).
    // clickWavFirstDownbeat = 2 + (0 - 0) = 2. playStart = 2 - 2 = 0.
    const r = clickPlayRange(t, 62, 2)
    expect(r.playStartSec).toBe(0)
    expect(r.playEndSec).toBeCloseTo(62, 6)
  })

  it('accounts for loose trim (lead-in inside the trimmed audio)', () => {
    // First downbeat 1.5s into the trimmed audio (loose trim).
    const t = songTimings(
      buildMap({
        trimStart: 0,
        trimEnd: 60,
        bpm: 120,
        firstBeatTimeSec: 1.5,
        cuesMode: 'countIn',
        countInBeats: 8,
      }),
    )
    // countInDuration = 2s. preludeOffset = preludeSec + prependSec; with eff=1.5 < countIn=2,
    // prependSec = 0.5 → preludeOffset = (preludeSec=1) + 0.5 = 1.5 say. firstDownbeat on WAV
    // = 1.5 + (1.5 - 0) = 3. playStart = 3 - 2 = 1.
    const r = clickPlayRange(t, 62, 1.5)
    expect(r.playStartSec).toBeCloseTo(1, 6)
  })
})
