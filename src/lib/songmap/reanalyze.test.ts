import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { reanalyzeShape, reanalyzeWithHarmony } from './reanalyze'
import { validateSongMap } from './validate'
import type { Bar, Beat, HarmonyEvent, Section, SongMap } from './types'

function map4x4(opts: { harmony?: HarmonyEvent[]; sections?: Section[] } = {}): SongMap {
  const beats: Beat[] = []
  const bars: Bar[] = []
  for (let bar = 0; bar < 2; bar++) {
    const barId = `bar${bar}`
    const beatIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: bar * 2 + i * 0.5 })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: bar * 2,
      endSec: bar * 2 + 2,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds,
    })
  }
  return {
    ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }),
    timeline: { bars, beats },
    harmony: opts.harmony ?? [],
    sections: opts.sections ?? [],
  }
}

function freshBeatsMatching(): { bars: Bar[]; beats: Beat[] } {
  // Same shape (2 bars × 4 beats) but fresh ids — what a re-analysis with
  // unchanged beat structure would produce.
  const beats: Beat[] = []
  const bars: Bar[] = []
  for (let bar = 0; bar < 2; bar++) {
    const barId = `new_bar${bar}`
    const beatIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = `new_b${bar}_${i}`
      beatIds.push(id)
      // Times perturbed slightly from the old (a real re-analysis won't
      // produce identical floats).
      beats.push({ id, barId, indexInBar: i, timeSec: bar * 2 + i * 0.5 + 0.01 })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: bar * 2 + 0.005,
      endSec: bar * 2 + 2 + 0.005,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds,
    })
  }
  return { bars, beats }
}

describe('reanalyzeShape', () => {
  it('match when both beat and bar counts equal', () => {
    const cur = map4x4()
    const { bars, beats } = freshBeatsMatching()
    expect(reanalyzeShape(cur, bars, beats)).toBe('match')
  })

  it('mismatch when beat count differs', () => {
    const cur = map4x4()
    const { bars, beats } = freshBeatsMatching()
    expect(reanalyzeShape(cur, bars, beats.slice(0, -1))).toBe('mismatch')
  })

  it('mismatch when bar count differs', () => {
    const cur = map4x4()
    const { bars, beats } = freshBeatsMatching()
    expect(reanalyzeShape(cur, bars.slice(0, -1), beats)).toBe('mismatch')
  })
})

describe('reanalyzeWithHarmony — shape MATCH path', () => {
  it('re-anchors chord beatIds to the new beat at the same sorted-time index', () => {
    const harmony: HarmonyEvent[] = [
      { beatId: 'b0_0', chord: { root: 'C', quality: 'maj' } },
      { beatId: 'b0_2', chord: { root: 'F', quality: 'maj' } },
      { beatId: 'b1_3', chord: { root: 'G', quality: 'maj' } },
    ] as HarmonyEvent[]
    const cur = map4x4({ harmony })
    const { bars, beats } = freshBeatsMatching()
    const r = reanalyzeWithHarmony(cur, bars, beats)
    expect(r.shape).toBe('match')
    expect(r.chordsKept).toBe(3)
    expect(r.chordsDropped).toBe(0)
    // b0_0 → position 0 → new_b0_0; b0_2 → position 2 → new_b0_2;
    // b1_3 → position 7 → new_b1_3
    expect(r.map.harmony.map((h) => h.beatId)).toEqual([
      'new_b0_0',
      'new_b0_2',
      'new_b1_3',
    ])
  })

  it('preserves sections unchanged on shape match', () => {
    const sections: Section[] = [
      { id: 's1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 1 } },
    ] as Section[]
    const cur = map4x4({ sections })
    const { bars, beats } = freshBeatsMatching()
    const r = reanalyzeWithHarmony(cur, bars, beats)
    expect(r.sectionsKept).toBe(1)
    expect(r.sectionsDropped).toBe(0)
    expect(r.map.sections).toEqual(sections)
  })

  it('captures new bars+beats as the timeline snapshot for Reset to analyzed', () => {
    const cur = map4x4()
    const { bars, beats } = freshBeatsMatching()
    const r = reanalyzeWithHarmony(cur, bars, beats)
    expect(r.map.timeline.original).toBeDefined()
    expect(r.map.timeline.original!.bars.map((b) => b.id)).toEqual(
      bars.map((b) => b.id),
    )
    expect(r.map.timeline.original!.beats.map((b) => b.id)).toEqual(
      beats.map((b) => b.id),
    )
  })
})

describe('reanalyzeWithHarmony — shape MISMATCH path', () => {
  it('drops all chords and sections by default (dropOnMismatch=true)', () => {
    const harmony: HarmonyEvent[] = [
      { beatId: 'b0_0', chord: { root: 'C', quality: 'maj' } },
    ] as HarmonyEvent[]
    const sections: Section[] = [
      { id: 's1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 1 } },
    ] as Section[]
    const cur = map4x4({ harmony, sections })
    const { bars, beats } = freshBeatsMatching()
    const r = reanalyzeWithHarmony(cur, bars, beats.slice(0, -1))
    expect(r.shape).toBe('mismatch')
    expect(r.chordsDropped).toBe(1)
    expect(r.sectionsDropped).toBe(1)
    expect(r.map.harmony).toEqual([])
    expect(r.map.sections).toEqual([])
  })

  it('snapshot still captures even on mismatch — Reset to analyzed becomes usable post-reanalyze', () => {
    const cur = map4x4({
      harmony: [{ beatId: 'b0_0', chord: { root: 'C', quality: 'maj' } } as HarmonyEvent],
    })
    const { bars, beats } = freshBeatsMatching()
    const r = reanalyzeWithHarmony(cur, bars, beats.slice(0, -1))
    expect(r.map.timeline.original).toBeDefined()
    expect(r.map.timeline.original!.beats.length).toBe(beats.length - 1)
  })
})

describe('re-analysis re-anchors chords to the NEW bars (regression)', () => {
  /**
   * A `HarmonyEvent` stores `barId` AND `beatId`, and the beat already knows its
   * bar — so the two can disagree, and they did. Re-analysis updated `beatId`
   * and let the old `barId` through untouched, naming a bar from the previous
   * analysis that no longer existed.
   *
   * Every chord then failed validation with "barId does not match beat's bar",
   * and the editor showed a wall of errors instead of a grid. Re-analysis is
   * precisely when bar ids change, so this fired on every re-analysis of every
   * song that had chords — reported on a real song with 87 of them.
   *
   * The existing tests could not catch it: they asserted the new `beatId` and
   * never looked at `barId`, even though the fixture already gave the new bars
   * different ids.
   */
  const chordAt = (beatId: string, barId: string, startSec: number): HarmonyEvent => ({
    id: `h_${beatId}`,
    barId,
    beatId,
    startSec,
    endSec: startSec + 0.5,
    chord: { root: 'C', quality: 'maj', displayRaw: 'C' } as HarmonyEvent['chord'],
    beatAnchor: { indexInBar: 0 },
  })

  it('gives every kept chord the bar its NEW beat belongs to', () => {
    const current = map4x4({
      harmony: [chordAt('b0_0', 'bar0', 0), chordAt('b1_0', 'bar1', 2)],
    })
    const fresh = freshBeatsMatching()
    const r = reanalyzeWithHarmony(current, fresh.bars, fresh.beats)

    const beatById = new Map(r.map.timeline.beats.map((b) => [b.id, b]))
    expect(r.map.harmony).toHaveLength(2)
    for (const h of r.map.harmony) {
      const beat = beatById.get(h.beatId!)
      expect(beat, 'chord points at a beat that does not exist').toBeDefined()
      expect(h.barId, 'chord kept a bar id from the OLD analysis').toBe(beat!.barId)
    }
  })

  it('the re-analysed map VALIDATES — the check the user actually hit', () => {
    // The end-to-end assertion. Ids matching is the mechanism; validating is
    // the promise, and it is the promise that broke.
    const current = map4x4({
      harmony: [chordAt('b0_0', 'bar0', 0), chordAt('b0_2', 'bar0', 1), chordAt('b1_1', 'bar1', 2.5)],
    })
    const fresh = freshBeatsMatching()
    const r = reanalyzeWithHarmony(current, fresh.bars, fresh.beats)
    const { errors } = validateSongMap(r.map)
    expect(errors.filter((e) => /barId does not match/.test(e))).toEqual([])
    expect(errors).toEqual([])
  })

  it('moves the cached position-in-bar with the beat', () => {
    // Otherwise every chord warns instead of erroring — quieter, same cause.
    const current = map4x4({ harmony: [chordAt('b0_2', 'bar0', 1)] })
    const fresh = freshBeatsMatching()
    const r = reanalyzeWithHarmony(current, fresh.bars, fresh.beats)
    const beat = r.map.timeline.beats.find((b) => b.id === r.map.harmony[0]!.beatId)!
    expect(r.map.harmony[0]!.beatAnchor?.indexInBar).toBe(beat.indexInBar)
  })

  it('leaves a chord with no beatAnchor without inventing one', () => {
    const current = map4x4({
      harmony: [{ ...chordAt('b0_0', 'bar0', 0), beatAnchor: undefined }],
    })
    const fresh = freshBeatsMatching()
    const r = reanalyzeWithHarmony(current, fresh.bars, fresh.beats)
    expect(r.map.harmony[0]!.beatAnchor).toBeUndefined()
  })
})
