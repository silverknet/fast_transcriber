/**
 * The two multi-bar grid tools, against the mistakes detection actually makes.
 *
 * Both rewrite a run of bars as a whole, so both can quietly destroy a song's
 * timing if the arithmetic drifts. The promises asserted here are the ones a
 * user would notice on stage: the selection's edges never move, no beat is
 * ever lost, and a chord keeps the moment it sounds.
 */
import { describe, expect, it } from 'vitest'
import { evenOutBars, offsetSelectionDownbeat } from './timelineEdit'
import { validateSongMap } from './validate'
import type { Bar, Beat, SongMap } from './types'
import { SONGMAP_FORMAT_VERSION } from './version'

/** `barSpecs` = [beatCount, durationSec] per bar, laid end to end from 0. */
function song(barSpecs: [number, number][]): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  let t = 0
  barSpecs.forEach(([n, dur], bi) => {
    const barId = `bar${bi}`
    const beatIds: string[] = []
    for (let i = 0; i < n; i++) {
      const id = `b${bi}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: t + (i / n) * dur })
    }
    bars.push({
      id: barId,
      index: bi,
      startSec: t,
      endSec: t + dur,
      meter: { numerator: n, denominator: 4 },
      beatCount: n,
      beatIds,
    })
    t += dur
  })
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: { fileName: 'x.wav', source: 'upload', trim: { startSec: 0, endSec: t } },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cueTracks: [],
  } as unknown as SongMap
}

const beatTimes = (m: SongMap) =>
  [...m.timeline.beats].sort((a, b) => a.timeSec - b.timeSec).map((b) => b.timeSec)
const gaps = (t: number[]) => t.slice(1).map((v, i) => v - t[i]!)

describe('even out — one steady pulse across the selection', () => {
  // Three bars that drift: 4 beats each but 2.0s / 2.4s / 1.6s long.
  const drifting = () => song([[4, 2.0], [4, 2.4], [4, 1.6]])

  it('makes every beat in the selection the same length', () => {
    const r = evenOutBars(drifting(), ['bar0', 'bar1', 'bar2'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const g = gaps(beatTimes(r.map))
    const first = g[0]!
    for (const step of g) expect(step).toBeCloseTo(first, 9)
    expect(first).toBeCloseTo(6.0 / 12, 9) // 6s over 12 beats
  })

  it('does NOT move the selection’s outer edges', () => {
    const before = drifting()
    const r = evenOutBars(before, ['bar0', 'bar1', 'bar2'])
    if (!r.ok) throw new Error(r.error)
    const b0 = r.map.timeline.bars[0]!
    const b2 = r.map.timeline.bars[2]!
    expect(b0.startSec).toBeCloseTo(0, 9)
    expect(b2.endSec).toBeCloseTo(6.0, 9)
  })

  it('leaves bars OUTSIDE the selection exactly where they were', () => {
    const before = song([[4, 2.0], [4, 2.4], [4, 1.6], [4, 3.0]])
    const r = evenOutBars(before, ['bar0', 'bar1'])
    if (!r.ok) throw new Error(r.error)
    const untouched = r.map.timeline.bars.find((b) => b.id === 'bar3')!
    const original = before.timeline.bars.find((b) => b.id === 'bar3')!
    expect(untouched).toEqual(original)
    // …and the boundary between the selection and the rest is intact.
    expect(r.map.timeline.bars.find((b) => b.id === 'bar1')!.endSec).toBeCloseTo(4.4, 9)
  })

  it('keeps every beat and every bar — nothing is lost', () => {
    const before = drifting()
    const r = evenOutBars(before, ['bar0', 'bar1', 'bar2'])
    if (!r.ok) throw new Error(r.error)
    expect(r.map.timeline.beats).toHaveLength(before.timeline.beats.length)
    expect(r.map.timeline.bars).toHaveLength(before.timeline.bars.length)
    expect(validateSongMap(r.map).errors).toEqual([])
  })

  it('a chord follows its beat to the beat’s new time', () => {
    const base = drifting()
    const beat = base.timeline.beats.find((b) => b.id === 'b1_2')!
    const withChord: SongMap = {
      ...base,
      harmony: [
        {
          id: 'h1',
          barId: 'bar1',
          beatId: 'b1_2',
          startSec: beat.timeSec,
          endSec: beat.timeSec + 0.5,
          chord: { root: 'C', quality: 'major', displayRaw: 'C' },
          beatAnchor: { indexInBar: 2 },
        },
      ],
    } as SongMap
    const r = evenOutBars(withChord, ['bar0', 'bar1', 'bar2'])
    if (!r.ok) throw new Error(r.error)
    const movedBeat = r.map.timeline.beats.find((b) => b.id === 'b1_2')!
    expect(r.map.harmony[0]!.startSec).toBeCloseTo(movedBeat.timeSec, 9)
    expect(r.map.harmony[0]!.barId).toBe(movedBeat.barId)
  })

  it('refuses a selection that is not a contiguous run', () => {
    const r = evenOutBars(song([[4, 2], [4, 2], [4, 2]]), ['bar0', 'bar2'])
    expect(r.ok).toBe(false)
  })
})

describe('offset the downbeat — move the bar lines, keep the beats', () => {
  // Four 4/4 bars, 2s each: the classic "detection barred it one beat late".
  const fourBars = () => song([[4, 2], [4, 2], [4, 2], [4, 2]])
  const ids = ['bar0', 'bar1', 'bar2', 'bar3']

  it('does not move a single beat in time', () => {
    const before = fourBars()
    const r = offsetSelectionDownbeat(before, ids, 1, () => 'newbar')
    if (!r.ok) throw new Error(r.error)
    expect(beatTimes(r.map)).toEqual(beatTimes(before))
  })

  it('never loses a beat — the displaced ones become a pickup bar', () => {
    const before = fourBars()
    const r = offsetSelectionDownbeat(before, ids, 1, () => 'newbar')
    if (!r.ok) throw new Error(r.error)
    expect(r.map.timeline.beats).toHaveLength(before.timeline.beats.length)
    const first = r.map.timeline.bars[0]!
    expect(first.beatCount, 'a 1-beat pickup bar').toBe(1)
    // …and the bars after it are the original length again, now correctly barred.
    expect(r.map.timeline.bars[1]!.beatCount).toBe(4)
    expect(r.map.timeline.bars[2]!.beatCount).toBe(4)
  })

  it('the new bar line lands exactly on the beat the user pointed at', () => {
    const before = fourBars()
    const secondBeatTime = before.timeline.beats.find((b) => b.id === 'b0_1')!.timeSec
    const r = offsetSelectionDownbeat(before, ids, 1, () => 'newbar')
    if (!r.ok) throw new Error(r.error)
    expect(r.map.timeline.bars[1]!.startSec).toBeCloseTo(secondBeatTime, 9)
  })

  it('offsets of 2 and 3 work the same way', () => {
    for (const d of [2, 3]) {
      const r = offsetSelectionDownbeat(fourBars(), ids, d, () => 'newbar')
      if (!r.ok) throw new Error(r.error)
      expect(r.map.timeline.bars[0]!.beatCount).toBe(d)
      expect(r.map.timeline.beats).toHaveLength(16)
      expect(validateSongMap(r.map).errors).toEqual([])
    }
  })

  it('keeps the selection’s outer edges and renumbers the bars after it', () => {
    const before = song([[4, 2], [4, 2], [4, 2], [4, 2], [4, 2]])
    const r = offsetSelectionDownbeat(before, ['bar0', 'bar1', 'bar2'], 1, () => 'newbar')
    if (!r.ok) throw new Error(r.error)
    expect(r.map.timeline.bars[0]!.startSec).toBeCloseTo(0, 9)
    const indices = r.map.timeline.bars.map((b) => b.index)
    expect(indices, 'bar indices stay 0..n with no gaps').toEqual(
      indices.map((_, i) => i),
    )
    expect(validateSongMap(r.map).errors).toEqual([])
  })

  it('a chord moves to the bar its beat now belongs to', () => {
    const base = fourBars()
    const beat = base.timeline.beats.find((b) => b.id === 'b0_1')!
    const withChord: SongMap = {
      ...base,
      harmony: [
        {
          id: 'h1',
          barId: 'bar0',
          beatId: 'b0_1',
          startSec: beat.timeSec,
          endSec: beat.timeSec + 0.5,
          chord: { root: 'G', quality: 'major', displayRaw: 'G' },
          beatAnchor: { indexInBar: 1 },
        },
      ],
    } as SongMap
    const r = offsetSelectionDownbeat(withChord, ids, 1, () => 'newbar')
    if (!r.ok) throw new Error(r.error)
    const movedBeat = r.map.timeline.beats.find((b) => b.id === 'b0_1')!
    expect(r.map.harmony[0]!.barId).toBe(movedBeat.barId)
    expect(r.map.harmony[0]!.beatAnchor!.indexInBar).toBe(movedBeat.indexInBar)
    // The chord still SOUNDS at the same moment.
    expect(r.map.harmony[0]!.startSec).toBeCloseTo(beat.timeSec, 9)
  })

  it('refuses a nonsense offset instead of mangling the grid', () => {
    expect(offsetSelectionDownbeat(fourBars(), ids, 0, () => 'x').ok).toBe(false)
    expect(offsetSelectionDownbeat(fourBars(), ids, 99, () => 'x').ok).toBe(false)
    expect(offsetSelectionDownbeat(fourBars(), ['bar0', 'bar2'], 1, () => 'x').ok).toBe(false)
  })
})
