/**
 * Cross-component sync invariants — the single most important contract in the
 * codebase: **Ableton playback must be sample-aligned with what BarBro plays.**
 *
 * The Ableton setlist export and the BarBro mixer / Grid-tab metronome all
 * derive from one source of truth (`songTimings` + the click WAV's
 * `preludeOffsetSec`). These tests assert that for any SongMap the derived
 * play ranges produce the SAME wall-clock-to-musical-time mapping in both
 * contexts.
 *
 * Conventions used below:
 *   - "scene-time": seconds since the Ableton scene fired (= mix-time 0 in
 *     the in-app mixer for the equivalent moment).
 *   - "original-time": seconds in the user's uploaded audio file (= the time
 *     each stem WAV exposes).
 *   - "click-WAV-time": seconds inside the rendered click WAV.
 *
 * Invariants verified:
 *   I1. At scene-time `countInDurationSec`, both stem clip and click clip
 *       reach the song-start anchor (= bar 1 beat 1 by default, or
 *       `startBeatId` if set).
 *   I2. For every beat in the song, the click and stem reach that beat at the
 *       same scene-time.
 *   I3. The renderer's "first downbeat on click WAV" position equals what
 *       `timings.ts` derives from `clickPreludeOffsetSec`.
 *   I4. A `startBeatId` override shifts both stem and click ranges in lockstep.
 *   I5. Irregular beat times don't break the per-beat alignment (the song-
 *       click formula uses each beat's actual `timeSec`).
 *   I6. Count-in is consistent with `effectiveCountInBeats(sm)` across the
 *       fingerprint, timings, and renderer-time helpers.
 *
 * These invariants are the contract a refactor MUST preserve. If a future
 * change breaks them, the click track will drift relative to stems in the
 * Ableton .als — and the user will (rightly) lose their mind.
 */

import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { clickPlayRange, songTimings, stemPlayRange } from './timings'
import { clickWavSongStartSec, songStartBeat } from '$lib/audio/cueTrackSpeechSchedule'
import { computeCountIn } from '$lib/audio/computeCountIn'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import { cueTrackFingerprintPayload } from '$lib/songmap/cueTrackFingerprint'
import type { Bar, Beat, SongMap } from '$lib/songmap/types'

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function makeBar(index: number, startSec: number, lengthSec: number, beatsPerBar = 4): Bar {
  return {
    id: `bar${index}`,
    index,
    startSec,
    endSec: startSec + lengthSec,
    meter: { numerator: beatsPerBar, denominator: 4 },
    beatCount: beatsPerBar,
    beatIds: Array.from({ length: beatsPerBar }, (_, i) => `b${index}_${i}`),
  }
}

function makeBeat(barIndex: number, indexInBar: number, timeSec: number): Beat {
  return {
    id: `b${barIndex}_${indexInBar}`,
    barId: `bar${barIndex}`,
    indexInBar,
    timeSec,
  }
}

/** Build a 2-bar / 4-4 SongMap with uniform beats at `bd` spacing and the
 *  first downbeat anchored at `firstDownbeatSec` in original-time. */
function buildUniformMap(opts: {
  firstDownbeatSec: number
  trimStartSec: number
  trimEndSec: number
  bpm: number
  countInBeats?: number
  startBeatId?: string
}): SongMap {
  const bd = 60 / opts.bpm
  const bar0 = makeBar(0, opts.firstDownbeatSec, 4 * bd)
  const bar1 = makeBar(1, opts.firstDownbeatSec + 4 * bd, 4 * bd)
  const beats: Beat[] = []
  for (let i = 0; i < 4; i++) beats.push(makeBeat(0, i, opts.firstDownbeatSec + i * bd))
  for (let i = 0; i < 4; i++) beats.push(makeBeat(1, i, opts.firstDownbeatSec + (4 + i) * bd))
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 't', createdAt: '', updatedAt: '', bpm: opts.bpm },
    audio: {
      fileName: 'a.wav',
      trim: { startSec: opts.trimStartSec, endSec: opts.trimEndSec },
      source: 'upload',
    },
    timeline: { bars: [bar0, bar1], beats },
    sections: [],
    harmony: [],
    cues: { mode: 'off', countInBeats: 0, useSectionLabels: false },
    countInBeats: opts.countInBeats,
    startBeatId: opts.startBeatId,
  } as unknown as SongMap
}

/** The same shape as the in-renderer math: where `trim.startSec` lands on
 *  the click WAV. = `preludeSec + prependSec`. The Ableton export reads this
 *  from the rendered `clickTrackExport.preludeOffsetSec`; we synthesise it
 *  here from `computeCountIn` so the test doesn't need to render audio. */
function clickPreludeOffsetSec(sm: SongMap, preludeSec: number): number {
  const n = effectiveCountInBeats(sm)
  if (n <= 0) return preludeSec
  const ci = computeCountIn(sm, n)
  return preludeSec + (ci?.prependSec ?? 0)
}

/* ──────────────────────────────────────────────────────────────────────── */
/* I1. Click + stem reach the song-start anchor at the same scene-time      */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — invariants', () => {
  it('I1: stem & click both reach the song-start anchor at scene-time = countInDurationSec', () => {
    // Adequate lead-in: firstDownbeat at 5s, count-in 4 beats at 120bpm = 2s.
    const sm = buildUniformMap({
      firstDownbeatSec: 5,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const t = songTimings(sm)
    expect(t.countInBeats).toBe(4)
    expect(t.countInDurationSec).toBeCloseTo(2, 6)

    // Renderer would emit preludeSec = 0 (no spoken cues in this song),
    // prependSec = max(0, 2 − 5) = 0, so preludeOffset = 0.
    const preludeOffset = clickPreludeOffsetSec(sm, /*preludeSec*/ 0)

    const stem = stemPlayRange(t, /*stemDur*/ 300)
    const click = clickPlayRange(t, /*clickDur*/ 100, preludeOffset)

    // Scene-time at which stem reaches the song-start beat.
    const stemSongStartAt = t.firstDownbeatOriginalSec - stem.playStartSec
    // Scene-time at which click reaches the same anchor.
    const clickWavFirstDownbeat = preludeOffset + (t.firstDownbeatOriginalSec - t.trimStartSec)
    const clickSongStartAt = clickWavFirstDownbeat - click.playStartSec

    expect(stemSongStartAt).toBeCloseTo(t.countInDurationSec, 6)
    expect(clickSongStartAt).toBeCloseTo(t.countInDurationSec, 6)
    expect(stemSongStartAt).toBeCloseTo(clickSongStartAt, 6)
  })

  it('I1: no count-in → both clips reach the song-start at scene-time 0', () => {
    const sm = buildUniformMap({
      firstDownbeatSec: 0,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
    })
    const t = songTimings(sm)
    expect(t.countInDurationSec).toBe(0)

    const preludeOffset = clickPreludeOffsetSec(sm, 0)
    const stem = stemPlayRange(t, 300)
    const click = clickPlayRange(t, 60, preludeOffset)

    const stemSongStartAt = t.firstDownbeatOriginalSec - stem.playStartSec
    const clickWavFirstDownbeat = preludeOffset + (t.firstDownbeatOriginalSec - t.trimStartSec)
    const clickSongStartAt = clickWavFirstDownbeat - click.playStartSec

    expect(stemSongStartAt).toBe(0)
    expect(clickSongStartAt).toBe(0)
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* I2. For every beat in the song, click and stem reach it at the same     */
/*     scene-time.                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — per-beat sync', () => {
  it('I2: every song beat lines up between stem and click clips', () => {
    const sm = buildUniformMap({
      firstDownbeatSec: 5,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const t = songTimings(sm)
    const preludeOffset = clickPreludeOffsetSec(sm, 0)
    const stem = stemPlayRange(t, 300)
    const click = clickPlayRange(t, 100, preludeOffset)

    // For each beat at or after the song-start anchor, the scene-time it
    // hits on the stem clip equals the scene-time it hits on the click clip.
    const start = songStartBeat(sm)!
    for (const b of sm.timeline.beats) {
      if (b.timeSec < start.timeSec - 1e-9) continue

      // Stem reaches b.timeSec (in original-time) at scene-time =
      //   b.timeSec − stem.playStartSec.
      const stemHits = b.timeSec - stem.playStartSec

      // The renderer places this beat on the click WAV at
      //   preludeOffset + (b.timeSec − trim.startSec).
      const clickWavBeatPos = preludeOffset + (b.timeSec - t.trimStartSec)
      const clickHits = clickWavBeatPos - click.playStartSec

      expect(clickHits).toBeCloseTo(stemHits, 6)
    }
  })

  it('I2 with start-beat override: shifted anchor still lines up per beat', () => {
    const sm = buildUniformMap({
      firstDownbeatSec: 0,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    // Move start to beat 5 (bar 2 beat 1 in this uniform map).
    sm.startBeatId = sm.timeline.beats[4]!.id
    const t = songTimings(sm)
    const preludeOffset = clickPreludeOffsetSec(sm, 0)
    const stem = stemPlayRange(t, 300)
    const click = clickPlayRange(t, 100, preludeOffset)

    const start = songStartBeat(sm)!
    expect(start.id).toBe(sm.timeline.beats[4]!.id)

    for (const b of sm.timeline.beats) {
      if (b.timeSec < start.timeSec - 1e-9) continue
      const stemHits = b.timeSec - stem.playStartSec
      const clickWavBeatPos = preludeOffset + (b.timeSec - t.trimStartSec)
      const clickHits = clickWavBeatPos - click.playStartSec
      expect(clickHits).toBeCloseTo(stemHits, 6)
    }
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* I3. Renderer's `clickWavSongStartSec` matches timings' derived value.    */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — derived-value consistency', () => {
  it('I3: clickWavSongStartSec(sm, {…}) equals preludeOffset + (firstDownbeat − trimStart)', () => {
    const cases = [
      { firstDownbeatSec: 0, trimStartSec: 0, countInBeats: 0 },
      { firstDownbeatSec: 5, trimStartSec: 0, countInBeats: 4 },
      { firstDownbeatSec: 1.5, trimStartSec: 0.7, countInBeats: 4 },
      { firstDownbeatSec: 3.2, trimStartSec: 3.2, countInBeats: 8 }, // tight trim
    ]
    for (const c of cases) {
      const sm = buildUniformMap({
        firstDownbeatSec: c.firstDownbeatSec,
        trimStartSec: c.trimStartSec,
        trimEndSec: c.firstDownbeatSec + 30,
        bpm: 120,
        countInBeats: c.countInBeats,
      })
      const t = songTimings(sm)
      const preludeSec = 0
      const prependSec = computeCountIn(sm, effectiveCountInBeats(sm))?.prependSec ?? 0
      const fromRenderer = clickWavSongStartSec(sm, { preludeSec, prependSec })!
      const fromTimings =
        preludeSec + prependSec + (t.firstDownbeatOriginalSec - t.trimStartSec)
      expect(fromRenderer).toBeCloseTo(fromTimings, 6)
    }
  })

  it('I3: clickPlayRange.playStartSec is always ≥ 0 (never clamped) when prependSec is sized correctly', () => {
    // Tight trim and loose trim, both with count-in.
    for (const firstDownbeatSec of [0, 1.5, 3]) {
      const sm = buildUniformMap({
        firstDownbeatSec,
        trimStartSec: 0,
        trimEndSec: 60,
        bpm: 120,
        countInBeats: 8, // 4s count-in
      })
      const t = songTimings(sm)
      const preludeOffset = clickPreludeOffsetSec(sm, 0)
      const click = clickPlayRange(t, /*clickDur*/ 100, preludeOffset)
      // First count-in click on WAV = (preludeSec) here (since preludeSec = 0)
      // for the tight trim and a positive value for loose trim. Either way ≥ 0.
      expect(click.playStartSec).toBeGreaterThanOrEqual(0)
    }
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* I4. Start-beat override shifts both clips by the same amount.            */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — start-beat override propagation', () => {
  it('I4: moving startBeatId shifts stem and click playStart by the same amount', () => {
    const baseline = buildUniformMap({
      firstDownbeatSec: 4, // adequate lead-in for any reasonable count-in
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const moved = buildUniformMap({
      firstDownbeatSec: 4,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    // Move start to beat 5 (bar 2 beat 1; bd = 0.5s) — adds 2s of lead-in audio.
    moved.startBeatId = moved.timeline.beats[4]!.id

    const tA = songTimings(baseline)
    const tB = songTimings(moved)
    const offA = clickPreludeOffsetSec(baseline, 0)
    const offB = clickPreludeOffsetSec(moved, 0)

    const stemA = stemPlayRange(tA, 300)
    const stemB = stemPlayRange(tB, 300)
    const clickA = clickPlayRange(tA, 100, offA)
    const clickB = clickPlayRange(tB, 100, offB)

    // Both anchors moved forward by 2s (one bar at 0.5s/beat × 4 beats).
    const stemDelta = stemB.playStartSec - stemA.playStartSec
    const clickDelta = clickB.playStartSec - clickA.playStartSec
    expect(stemDelta).toBeCloseTo(2, 6)
    expect(clickDelta).toBeCloseTo(2, 6)
    expect(clickDelta).toBeCloseTo(stemDelta, 6)
    // First-downbeat position on the click WAV moves by the same anchor delta.
    const clickWavSongStartA = offA + (tA.firstDownbeatOriginalSec - tA.trimStartSec)
    const clickWavSongStartB = offB + (tB.firstDownbeatOriginalSec - tB.trimStartSec)
    expect(clickWavSongStartB - clickWavSongStartA).toBeCloseTo(2, 6)
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* I5. Irregular beat times don't break per-beat sync.                      */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — irregular beats', () => {
  it('I5: each beat hits at its own real timeSec on both stem and click', () => {
    // Beats deliberately spaced unevenly — simulates manual placement / rubato.
    const sm = buildUniformMap({
      firstDownbeatSec: 0,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
    })
    // Replace the uniform beats with irregular onsets.
    sm.timeline.beats = [
      { ...sm.timeline.beats[0]!, timeSec: 0.0 },
      { ...sm.timeline.beats[1]!, timeSec: 0.47 },
      { ...sm.timeline.beats[2]!, timeSec: 1.06 },
      { ...sm.timeline.beats[3]!, timeSec: 1.49 },
      { ...sm.timeline.beats[4]!, timeSec: 2.03 },
      { ...sm.timeline.beats[5]!, timeSec: 2.5 },
      { ...sm.timeline.beats[6]!, timeSec: 3.05 },
      { ...sm.timeline.beats[7]!, timeSec: 3.48 },
    ]

    const t = songTimings(sm)
    const preludeOffset = clickPreludeOffsetSec(sm, 0)
    const stem = stemPlayRange(t, 300)
    const click = clickPlayRange(t, 100, preludeOffset)

    for (const b of sm.timeline.beats) {
      const stemHits = b.timeSec - stem.playStartSec
      const clickWavPos = preludeOffset + (b.timeSec - t.trimStartSec)
      const clickHits = clickWavPos - click.playStartSec
      // Both should equal b.timeSec exactly (no count-in, no trim head).
      expect(stemHits).toBeCloseTo(b.timeSec, 6)
      expect(clickHits).toBeCloseTo(b.timeSec, 6)
    }
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* I6. Count-in is consistent across helpers (timings + fingerprint + UI).  */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — count-in source-of-truth', () => {
  it('I6: top-level countInBeats drives timings, fingerprint, and effectiveCountInBeats together', () => {
    const sm = buildUniformMap({
      firstDownbeatSec: 5,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const t = songTimings(sm)
    expect(effectiveCountInBeats(sm)).toBe(4)
    expect(t.countInBeats).toBe(4)
    expect(t.countInDurationSec).toBeCloseTo(2, 6)

    const fp = cueTrackFingerprintPayload(sm) as Record<string, unknown>
    expect(fp.countInBeats).toBe(4)
  })

  it('I6: bumping countInBeats invalidates the fingerprint', () => {
    const base = buildUniformMap({
      firstDownbeatSec: 5,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const same = buildUniformMap({
      firstDownbeatSec: 5,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const more = buildUniformMap({
      firstDownbeatSec: 5,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 8,
    })
    const fpBase = JSON.stringify(cueTrackFingerprintPayload(base))
    const fpSame = JSON.stringify(cueTrackFingerprintPayload(same))
    const fpMore = JSON.stringify(cueTrackFingerprintPayload(more))
    expect(fpSame).toBe(fpBase)
    expect(fpMore).not.toBe(fpBase)
  })

  it('I6: a startBeatId change also invalidates the fingerprint', () => {
    const sm = buildUniformMap({
      firstDownbeatSec: 0,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const fpDefault = JSON.stringify(cueTrackFingerprintPayload(sm))
    sm.startBeatId = sm.timeline.beats[4]!.id
    const fpMoved = JSON.stringify(cueTrackFingerprintPayload(sm))
    expect(fpMoved).not.toBe(fpDefault)
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* I-mix. Per-clip volume/mute from `mixState` shows up in the Ableton XML  */
/*     via SampleVolume — the user's headphone mix == the exported mix.    */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — mixer volume propagation', () => {
  // Helper: minimal but complete enough StemClip for the project-setlist exporter.
  function stemClip(opts: { fileName: string; volume?: number; muted?: boolean }) {
    return {
      fileName: opts.fileName,
      relativePath: `stems/${opts.fileName}`,
      durationSec: 30,
      sampleRate: 44100,
      playStartSec: 0,
      playEndSec: 30,
      volume: opts.volume,
      muted: opts.muted,
    }
  }

  async function exportXml(stems: Map<string, ReturnType<typeof stemClip>>, click: ReturnType<typeof stemClip>) {
    const { generateAbletonProjectSetXml } = await import('$lib/export/abletonSet')
    return generateAbletonProjectSetXml({
      projectTitle: 'TestProj',
      songs: [{ title: 'Song', bpm: 120, stems, click }],
    })
  }

  it('non-default volume on a stem shows up as SampleVolume in the .als XML', async () => {
    const stems = new Map([
      ['Drums', stemClip({ fileName: 'drums.wav', volume: 0.42 })],
    ])
    const click = stemClip({ fileName: 'click-track.wav' })
    const xml = await exportXml(stems, click)
    expect(xml).toContain('<SampleVolume Value="0.420000"')
  })

  it('muted stem renders SampleVolume="0.000000" regardless of volume', async () => {
    const stems = new Map([
      ['Drums', stemClip({ fileName: 'drums.wav', volume: 0.8, muted: true })],
    ])
    const click = stemClip({ fileName: 'click-track.wav' })
    const xml = await exportXml(stems, click)
    // The drums clip is muted. Ensure SampleVolume="0.000000" appears for it
    // (and isn't accidentally overwritten by the absent-volume default).
    expect(xml).toContain('<SampleVolume Value="0.000000"')
  })

  it('absent volume → default SampleVolume="1.000000"', async () => {
    const stems = new Map([['Drums', stemClip({ fileName: 'drums.wav' })]])
    const click = stemClip({ fileName: 'click-track.wav' })
    const xml = await exportXml(stems, click)
    expect(xml).toContain('<SampleVolume Value="1.000000"')
  })

  it('negative volume is clamped to 0 (defensive)', async () => {
    const stems = new Map([['Drums', stemClip({ fileName: 'drums.wav', volume: -0.5 })]])
    const click = stemClip({ fileName: 'click-track.wav' })
    const xml = await exportXml(stems, click)
    expect(xml).toContain('<SampleVolume Value="0.000000"')
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* I7. Stem clip's play end is bounded by trim end (Ableton clip stops on   */
/*     song-end, not stem file end).                                        */
/* ──────────────────────────────────────────────────────────────────────── */

describe('Ableton ↔ BarBro alignment — clip end bounds', () => {
  it('I7: stem clip ends at trim.endSec (not at the stem WAV end)', () => {
    const sm = buildUniformMap({
      firstDownbeatSec: 0,
      trimStartSec: 0,
      trimEndSec: 30,
      bpm: 120,
      countInBeats: 4,
    })
    const t = songTimings(sm)
    // Stem WAV is longer than trim — playEnd must clip to trim.
    const stem = stemPlayRange(t, /*stemDur*/ 60)
    expect(stem.playEndSec).toBe(30)
  })

  it('I7: stem clip ends at the WAV end when the WAV is shorter than trim (defensive)', () => {
    const sm = buildUniformMap({
      firstDownbeatSec: 0,
      trimStartSec: 0,
      trimEndSec: 60,
      bpm: 120,
      countInBeats: 4,
    })
    const t = songTimings(sm)
    const stem = stemPlayRange(t, /*stemDur*/ 20)
    expect(stem.playEndSec).toBe(20)
  })
})
