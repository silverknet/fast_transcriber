/**
 * "EVERY ANALYSED SONG HAS A CLICK TRACK, AND CLICKS = BEATS IN THE GRID."
 *
 * The user-facing guarantee, stated as a property of the ONE timing derivation
 * (`songPlaybackPlan`) rather than of any renderer: every beat inside the trim
 * is a click, at that beat's own time, plus exactly the configured count-in
 * ahead of the song start. Renderers (the live buffer, the WAV, Ableton) are
 * already parity-locked to the plan, so proving the plan proves them all.
 */
import { describe, expect, it } from 'vitest'
import { songPlaybackPlan } from './playbackPlan'
import { createEmptySongMap } from './factory'
import type { SongMap } from './types'

function analysedSong(opts: { bars?: number; countInBeats?: number; trimStartSec?: number } = {}): SongMap {
  const bd = 0.5
  const barCount = opts.bars ?? 6
  const bars: SongMap['timeline']['bars'] = []
  const beats: SongMap['timeline']['beats'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const start = bar * 4 * bd
    const beatIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: start + i * bd })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: start,
      endSec: start + 4 * bd,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds,
    })
  }
  const sm = createEmptySongMap()
  return {
    ...sm,
    audio: {
      ...sm.audio!,
      fileName: 'x.wav',
      trim: { startSec: opts.trimStartSec ?? 0, endSec: barCount * 4 * bd },
    },
    timeline: { ...sm.timeline, bars, beats },
    ...(opts.countInBeats ? { countInBeats: opts.countInBeats } : {}),
  } as SongMap
}

describe('clicks = beats in the grid', () => {
  it('every beat inside the trim is a click, at its own time', () => {
    const sm = analysedSong()
    const plan = songPlaybackPlan(sm)!
    const songClicks = plan.clickPoints.filter((p) => !p.isCountIn)
    const trim = sm.audio!.trim
    const beatsInTrim = sm.timeline.beats.filter(
      (b) => b.timeSec >= trim.startSec && b.timeSec <= trim.endSec,
    )
    expect(songClicks).toHaveLength(beatsInTrim.length)
    // Time for time — trim-shifted, per the plan's own time base.
    const clickTimes = songClicks.map((p) => p.timeSec).sort((a, b) => a - b)
    const beatTimes = beatsInTrim.map((b) => b.timeSec - trim.startSec).sort((a, b) => a - b)
    for (let i = 0; i < beatTimes.length; i++) {
      expect(clickTimes[i]!).toBeCloseTo(beatTimes[i]!, 6)
    }
  })

  it('the guarantee survives a trimmed lead-in', () => {
    const sm = analysedSong({ trimStartSec: 2 })
    const plan = songPlaybackPlan(sm)!
    const songClicks = plan.clickPoints.filter((p) => !p.isCountIn)
    const trim = sm.audio!.trim
    const beatsInTrim = sm.timeline.beats.filter(
      (b) => b.timeSec >= trim.startSec && b.timeSec <= trim.endSec,
    )
    expect(songClicks).toHaveLength(beatsInTrim.length)
  })

  it('plus exactly the configured count-in, never more, never fewer', () => {
    for (const n of [0, 4, 8]) {
      const plan = songPlaybackPlan(analysedSong({ countInBeats: n || undefined }))!
      expect(plan.clickPoints.filter((p) => p.isCountIn)).toHaveLength(n)
    }
  })

  it('an unanalysed song has NO plan — a click cannot be invented', () => {
    const sm = createEmptySongMap()
    expect(songPlaybackPlan(sm)).toBeNull()
  })
})
