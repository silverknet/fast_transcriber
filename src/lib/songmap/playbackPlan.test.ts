import { describe, expect, it } from 'vitest'
import { defaultCueSettings } from '$lib/songmap/defaults'
import { songPlaybackPlan, type PlaybackPlan } from '$lib/songmap/playbackPlan'
import type { SongMap } from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'

/**
 * Build a song with `barCount` 4/4 bars, beats at 0, 0.5, 1.0, … (= 120 BPM
 * grid), no sections, no harmony. Trim covers the whole timeline so beats
 * are all "inside" the song. Use `mutate` to tweak per-test.
 */
function makeSong(opts: {
  barCount: number
  beatsPerBar?: number
  beatDurationSec?: number
  trimStartSec?: number
  trimEndSec?: number
  countInBeats?: number
  startBeatId?: string
  title?: string
  spokenIntroText?: string
}): SongMap {
  const beatsPerBar = opts.beatsPerBar ?? 4
  const bd = opts.beatDurationSec ?? 0.5
  const barCount = opts.barCount
  const trimStartSec = opts.trimStartSec ?? 0
  const trimEndSec = opts.trimEndSec ?? barCount * beatsPerBar * bd

  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const barStart = bar * beatsPerBar * bd
    const barEnd = barStart + beatsPerBar * bd
    const beatIds: string[] = []
    for (let i = 0; i < beatsPerBar; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({
        id,
        barId,
        indexInBar: i,
        timeSec: barStart + i * bd,
      })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: barStart,
      endSec: barEnd,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }

  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: opts.title ?? 'Test',
      bpm: 60 / bd,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'x.wav',
      trim: { startSec: trimStartSec, endSec: trimEndSec },
      source: 'upload',
    },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cues: {
      ...defaultCueSettings(),
      mode: 'off',
      countInBeats: 0,
      ...(opts.spokenIntroText !== undefined ? { spokenIntroText: opts.spokenIntroText } : {}),
    },
    ...(opts.countInBeats !== undefined ? { countInBeats: opts.countInBeats } : {}),
    ...(opts.startBeatId !== undefined ? { startBeatId: opts.startBeatId } : {}),
  } as SongMap
}

/** Pull just the song-click times out for compact assertions. */
function songClickTimes(plan: PlaybackPlan): number[] {
  return plan.clickPoints.filter((c) => !c.isCountIn).map((c) => c.timeSec)
}
function countInClickTimes(plan: PlaybackPlan): number[] {
  return plan.clickPoints.filter((c) => c.isCountIn).map((c) => c.timeSec)
}

describe('songPlaybackPlan — null cases', () => {
  it('returns null when audio.trim is missing', () => {
    const sm = makeSong({ barCount: 2 })
    sm.audio = undefined as unknown as SongMap['audio']
    expect(songPlaybackPlan(sm)).toBeNull()
  })

  it('returns null when audio.trim has zero/negative duration', () => {
    const sm = makeSong({ barCount: 2, trimStartSec: 1, trimEndSec: 1 })
    expect(songPlaybackPlan(sm)).toBeNull()
  })
})

describe('songPlaybackPlan — anchor + tempo', () => {
  it('derives bpm + beatDurationSec from the first bar by default', () => {
    const sm = makeSong({ barCount: 2 })
    const p = songPlaybackPlan(sm)!
    expect(p.bpm).toBe(120)
    expect(p.beatDurationSec).toBeCloseTo(0.5, 6)
  })

  it('uses songStartBeat (bar 1 beat 1) as firstDownbeatOriginalSec', () => {
    const sm = makeSong({ barCount: 2 })
    const p = songPlaybackPlan(sm)!
    expect(p.firstDownbeatOriginalSec).toBe(0)
  })

  it('honors startBeatId by anchoring later in the song', () => {
    const sm = makeSong({ barCount: 4, startBeatId: 'b1_0' /* bar 2 beat 1 */ })
    const p = songPlaybackPlan(sm)!
    // bar 1 beat 1 is at 0; b1_0 is at 2.0 (after 4 beats × 0.5 s)
    expect(p.firstDownbeatOriginalSec).toBeCloseTo(2.0, 6)
  })
})

describe('songPlaybackPlan — count-in math', () => {
  it('countInBeats=0 → countInDurationSec=0, prependSec=0, no count-in clicks', () => {
    const sm = makeSong({ barCount: 2 })
    const p = songPlaybackPlan(sm)!
    expect(p.countInBeats).toBe(0)
    expect(p.countInDurationSec).toBe(0)
    expect(p.prependSec).toBe(0)
    expect(countInClickTimes(p)).toEqual([])
  })

  it('count-in with no audio lead-in → prependSec = N · beatDuration', () => {
    // trim starts AT the first downbeat (0), 4 beats × 0.5 s = 2.0 s count-in
    const sm = makeSong({ barCount: 2, countInBeats: 4 })
    const p = songPlaybackPlan(sm)!
    expect(p.countInDurationSec).toBeCloseTo(2.0, 6)
    expect(p.prependSec).toBeCloseTo(2.0, 6)
  })

  it('count-in with enough audio lead-in → prependSec = 0', () => {
    // trim starts 3 s before the first downbeat — 4-beat count-in (2 s)
    // fits entirely inside the lead-in.
    const sm = makeSong({
      barCount: 6,
      trimStartSec: -3,
      trimEndSec: 12,
      countInBeats: 4,
    })
    // Manually overwrite the bars' time origin so the first bar still
    // sits at the "musical 0" rather than the modified trim:
    sm.timeline.bars = sm.timeline.bars.map((b) => ({ ...b, startSec: b.startSec, endSec: b.endSec }))
    const p = songPlaybackPlan(sm)!
    expect(p.prependSec).toBe(0)
    expect(p.countInDurationSec).toBeCloseTo(2.0, 6)
  })

  it('emits exactly N count-in click points', () => {
    for (const n of [1, 4, 8, 16]) {
      const sm = makeSong({ barCount: Math.max(2, Math.ceil(n / 4)), countInBeats: n })
      const p = songPlaybackPlan(sm)!
      expect(countInClickTimes(p)).toHaveLength(n)
    }
  })

  it('count-in clicks end one beat before bar 1 (in audio-element time)', () => {
    const sm = makeSong({ barCount: 2, countInBeats: 4 })
    const p = songPlaybackPlan(sm)!
    const ci = countInClickTimes(p)
    // 4 beats × 0.5 s, last click at firstDownbeat - 0.5 (audio-element time 0 = first downbeat here).
    expect(ci[ci.length - 1]).toBeCloseTo(-0.5, 6)
    // First at -2.0 (4 × 0.5 s back).
    expect(ci[0]).toBeCloseTo(-2.0, 6)
    // Evenly spaced.
    for (let i = 1; i < ci.length; i++) {
      expect(ci[i]! - ci[i - 1]!).toBeCloseTo(0.5, 6)
    }
  })

  it('count-in clicks shift forward when prependSec > 0 (audio starts mid-count-in)', () => {
    // Trim only has 0.5 s of pre-roll → 4-beat count-in needs 1.5 s prepend.
    const sm = makeSong({
      barCount: 2,
      trimStartSec: -0.5,
      trimEndSec: 4,
      countInBeats: 4,
    })
    const p = songPlaybackPlan(sm)!
    expect(p.prependSec).toBeCloseTo(1.5, 6)
    const ci = countInClickTimes(p)
    // First downbeat is at audio-element t = 0 - (-0.5) = 0.5.
    // Count-in clicks land at 0.5 - i·0.5 for i = 1..4 → 0, -0.5, -1.0, -1.5.
    expect(ci[0]).toBeCloseTo(-1.5, 6)
    expect(ci[ci.length - 1]).toBeCloseTo(0, 6)
  })
})

describe('songPlaybackPlan — song clicks', () => {
  it('emits one click per beat inside the trim window', () => {
    const sm = makeSong({ barCount: 2 }) // 2 × 4 = 8 beats
    const p = songPlaybackPlan(sm)!
    expect(songClickTimes(p)).toHaveLength(8)
  })

  it('first song click is at audio-element time 0 (no trim offset)', () => {
    const sm = makeSong({ barCount: 2 })
    const p = songPlaybackPlan(sm)!
    expect(songClickTimes(p)[0]).toBeCloseTo(0, 6)
  })

  it('first song click is shifted by trim.startSec when trim is mid-song', () => {
    const sm = makeSong({ barCount: 4, trimStartSec: 1.0, trimEndSec: 8 })
    const p = songPlaybackPlan(sm)!
    // beats at 1.0, 1.5, 2.0, … in original-time → 0, 0.5, 1.0, … in audio-element-time
    expect(songClickTimes(p)[0]).toBeCloseTo(0, 6)
    expect(songClickTimes(p)[1]).toBeCloseTo(0.5, 6)
  })

  it('marks downbeats correctly', () => {
    const sm = makeSong({ barCount: 2 })
    const p = songPlaybackPlan(sm)!
    const songClicks = p.clickPoints.filter((c) => !c.isCountIn)
    expect(songClicks[0]?.downbeat).toBe(true) // bar 1 beat 1
    expect(songClicks[1]?.downbeat).toBe(false) // bar 1 beat 2
    expect(songClicks[4]?.downbeat).toBe(true) // bar 2 beat 1
  })

  it('skips pre-start beats when count-in is active and start anchor moved', () => {
    // 4 bars, anchor at bar 2 (b1_0), 4-beat count-in. The count-in covers
    // the pre-anchor space; we should NOT also emit song clicks for bar 1.
    const sm = makeSong({
      barCount: 4,
      startBeatId: 'b1_0',
      countInBeats: 4,
    })
    const p = songPlaybackPlan(sm)!
    const songClicks = songClickTimes(p)
    // bar 2 beat 1 lands at original-time 2.0, audio-element-time 2.0.
    // No song click should be < 2.0 (those would dupe with the count-in).
    for (const t of songClicks) {
      expect(t).toBeGreaterThanOrEqual(2.0 - 1e-6)
    }
  })

  it('clickPoints are sorted ascending', () => {
    const sm = makeSong({ barCount: 2, countInBeats: 4 })
    const p = songPlaybackPlan(sm)!
    for (let i = 1; i < p.clickPoints.length; i++) {
      expect(p.clickPoints[i]!.timeSec).toBeGreaterThanOrEqual(p.clickPoints[i - 1]!.timeSec)
    }
  })
})

describe('songPlaybackPlan — spoken layer', () => {
  it('titlePreludeSec is 0 when no speech and no count-in', () => {
    const sm = makeSong({ barCount: 2 })
    const p = songPlaybackPlan(sm)!
    expect(p.titlePreludeSec).toBe(0)
  })

  it('titlePreludeSec is positive when count-in is active (even without spoken mode)', () => {
    const sm = makeSong({ barCount: 2, countInBeats: 4 })
    const p = songPlaybackPlan(sm)!
    expect(p.titlePreludeSec).toBeGreaterThan(0)
  })

  it('spokenIntroText defaults to the song title', () => {
    const sm = makeSong({ barCount: 2, title: 'Dum av Dig' })
    const p = songPlaybackPlan(sm)!
    expect(p.spokenIntroText).toBe('Dum av Dig')
  })

  it('spokenIntroText override wins', () => {
    const sm = makeSong({
      barCount: 2,
      title: 'Valerie (Amy Winehouse cover) — live',
      spokenIntroText: 'Valerie',
    })
    const p = songPlaybackPlan(sm)!
    expect(p.spokenIntroText).toBe('Valerie')
  })
})

describe('songPlaybackPlan — reactivity contract', () => {
  it('a mutation to countInBeats produces a different click schedule', () => {
    const sm = makeSong({ barCount: 4, countInBeats: 4 })
    const a = songPlaybackPlan(sm)!
    sm.countInBeats = 8
    const b = songPlaybackPlan(sm)!
    expect(countInClickTimes(a)).toHaveLength(4)
    expect(countInClickTimes(b)).toHaveLength(8)
  })

  it('a mutation to startBeatId shifts firstDownbeatOriginalSec and re-anchors clicks', () => {
    const sm = makeSong({ barCount: 4, countInBeats: 4 })
    const a = songPlaybackPlan(sm)!
    sm.startBeatId = 'b2_0' // bar 3 beat 1, original-time 4.0
    const b = songPlaybackPlan(sm)!
    expect(a.firstDownbeatOriginalSec).toBe(0)
    expect(b.firstDownbeatOriginalSec).toBeCloseTo(4.0, 6)
    // Count-in clicks moved by 4 s in audio-element-time.
    const aLast = countInClickTimes(a).at(-1)!
    const bLast = countInClickTimes(b).at(-1)!
    expect(bLast - aLast).toBeCloseTo(4.0, 6)
  })
})
