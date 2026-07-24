import { describe, it, expect } from 'vitest'
import { upcomingChordRow, type ChordSegmentLike } from './upcomingChords'

function seg(id: string, startSec: number, endSec: number, label = id, hasChord = true): ChordSegmentLike {
  return { id, label, startSec, endSec, hasChord }
}

describe('upcomingChordRow', () => {
  // One chord per bar (2s each): seeing the current + 1 ahead is enough.
  const perBar = [seg('G', 0, 2), seg('D', 2, 4), seg('Em', 4, 6), seg('C', 6, 8)]
  // Four chords crammed into one bar (0.5s each): you need to see several ahead.
  const fastRun = [seg('G', 0, 0.5), seg('D', 0.5, 1), seg('Em', 1, 1.5), seg('C', 1.5, 2)]

  it('returns the current chord + next N (up to count+1 items)', () => {
    const row = upcomingChordRow(perBar, 0.1, 3)
    expect(row.map((r) => r.label)).toEqual(['G', 'D', 'Em', 'C'])
    expect(row[0].isCurrent).toBe(true)
    expect(row.slice(1).every((r) => !r.isCurrent)).toBe(true)
  })

  it('fast run: the whole run is visible from the first chord', () => {
    const row = upcomingChordRow(fastRun, 0.1, 3)
    expect(row.map((r) => r.label)).toEqual(['G', 'D', 'Em', 'C'])
    expect(row[0].isCurrent).toBe(true)
  })

  it('current follows the playhead', () => {
    const row = upcomingChordRow(perBar, 4.5, 3) // inside Em
    expect(row[0].label).toBe('Em')
    expect(row[0].isCurrent).toBe(true)
    expect(row.map((r) => r.label)).toEqual(['Em', 'C'])
  })

  it('current progress reflects elapsed time', () => {
    const row = upcomingChordRow(perBar, 3, 3) // halfway through D (2..4)
    expect(row[0].label).toBe('D')
    expect(row[0].progressPct).toBeCloseTo(50, 0)
    expect(row[1].progressPct).toBe(0) // upcoming chords have no progress
  })

  it('clamps at the last chord (no overrun)', () => {
    const row = upcomingChordRow(perBar, 7, 3) // inside C, the last chord
    expect(row.map((r) => r.label)).toEqual(['C'])
    expect(row[0].isCurrent).toBe(true)
  })

  it('in a rest / before the first chord, the next upcoming becomes the head', () => {
    const withRest = [seg('rest', 0, 1, '—', false), seg('G', 1, 3), seg('D', 3, 5)]
    const row = upcomingChordRow(withRest, 0.5, 3) // in the rest
    expect(row[0].label).toBe('G')
    expect(row[0].isCurrent).toBe(true)
    expect(row[0].progressPct).toBe(0)
  })

  it('no chords → empty row', () => {
    expect(upcomingChordRow([seg('r', 0, 5, '—', false)], 1, 3)).toEqual([])
  })
})
