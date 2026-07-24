import { describe, expect, it } from 'vitest'
import {
  setBarChordDivision,
  setBarFractionChord,
  barChordDivision,
} from '$lib/songmap/harmonyEdit'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { ChordSymbol, HarmonyEvent, SongMap } from '$lib/songmap/types'

const C: ChordSymbol = { root: 'C', displayRaw: 'C' }
const AM: ChordSymbol = { root: 'A', quality: 'min', displayRaw: 'Am' }

/** One 4-beat bar spanning [10, 14) sec, with a pre-existing beat chord. */
function mapOneBar(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 'T', createdAt: '', updatedAt: '' },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 20 }, source: 'upload' },
    timeline: {
      bars: [
        {
          id: 'bar1',
          index: 0,
          startSec: 10,
          endSec: 14,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds: ['b1', 'b2', 'b3', 'b4'],
        },
      ],
      beats: [
        { id: 'b1', barId: 'bar1', indexInBar: 0, timeSec: 10 },
        { id: 'b2', barId: 'bar1', indexInBar: 1, timeSec: 11 },
        { id: 'b3', barId: 'bar1', indexInBar: 2, timeSec: 12 },
        { id: 'b4', barId: 'bar1', indexInBar: 3, timeSec: 13 },
      ],
    },
    sections: [],
    harmony: [
      { id: 'h-old', barId: 'bar1', beatId: 'b1', startSec: 10, endSec: 14, chord: C },
    ],
    cueTracks: [],
  }
}

let counter = 0
const id = () => `frac-${counter++}`

describe('setBarChordDivision (off-grid chords)', () => {
  it('replaces the bar with 3 evenly-spaced fraction chords', () => {
    counter = 0
    const r = setBarChordDivision(mapOneBar(), 'bar1', 3, C, id)
    expect(r.ok).toBe(true)
    const h = (r as { map: SongMap }).map.harmony
    expect(h).toHaveLength(3)
    // beat-anchored chord is gone; all three are fraction chords.
    expect(h.every((e) => e.beatId == null && e.barFraction != null)).toBe(true)
    const fr = h.map((e) => e.barFraction!).sort((a, b) => a - b)
    expect(fr[0]).toBeCloseTo(0, 6)
    expect(fr[1]).toBeCloseTo(1 / 3, 6)
    expect(fr[2]).toBeCloseTo(2 / 3, 6)
  })

  it('places the fraction chords at the right times inside the bar', () => {
    counter = 0
    const r = setBarChordDivision(mapOneBar(), 'bar1', 3, C, id) as { map: SongMap }
    const byFrac = [...r.map.harmony].sort((a, b) => a.barFraction! - b.barFraction!)
    // Bar [10,14): thirds at 10, 11.333, 12.667; last ends at bar end 14.
    expect(byFrac[0]!.startSec).toBeCloseTo(10, 5)
    expect(byFrac[1]!.startSec).toBeCloseTo(10 + 4 / 3, 5)
    expect(byFrac[2]!.startSec).toBeCloseTo(10 + 8 / 3, 5)
    expect(byFrac[0]!.endSec).toBeCloseTo(byFrac[1]!.startSec, 5)
    expect(byFrac[2]!.endSec).toBeCloseTo(14, 5)
  })

  it('n<2 reverts the bar to the beat grid (drops fraction chords)', () => {
    counter = 0
    let map = (setBarChordDivision(mapOneBar(), 'bar1', 3, C, id) as { map: SongMap }).map
    expect(barChordDivision(map, 'bar1')).toBe(3)
    map = (setBarChordDivision(map, 'bar1', 1, C, id) as { map: SongMap }).map
    expect(barChordDivision(map, 'bar1')).toBe(0)
    expect(map.harmony).toHaveLength(0)
  })

  it('only touches the target bar', () => {
    counter = 0
    const base = mapOneBar()
    const other: HarmonyEvent = { id: 'h2', barId: 'bar2', beatId: 'bx', startSec: 20, endSec: 22, chord: AM }
    const map: SongMap = { ...base, harmony: [...base.harmony, other] }
    const r = setBarChordDivision(map, 'bar1', 2, C, id) as { map: SongMap }
    expect(r.map.harmony.find((h) => h.id === 'h2')).toEqual(other)
  })

  it('setBarFractionChord updates one slot by fraction', () => {
    counter = 0
    let map = (setBarChordDivision(mapOneBar(), 'bar1', 3, C, id) as { map: SongMap }).map
    map = setBarFractionChord(map, 'bar1', 1 / 3, AM)
    const mid = map.harmony.find((h) => h.barFraction != null && Math.abs(h.barFraction - 1 / 3) < 1e-6)!
    expect(mid.chord).toEqual(AM)
    // others unchanged
    expect(map.harmony.filter((h) => h.chord === C || h.chord.displayRaw === 'C')).toHaveLength(2)
  })
})
