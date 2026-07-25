import { describe, expect, it } from 'vitest'
import { lyricBreakState } from './lyricBreak'

// Three lines: [0-2], a SMALL gap to [3-5], then a BIG gap to [15-17].
const lines = [
  { startSec: 0, endSec: 2 },
  { startSec: 3, endSec: 5 },
  { startSec: 15, endSec: 17 },
]

describe('lyricBreakState', () => {
  it('is inactive while a line is being sung', () => {
    expect(lyricBreakState(lines, 1).active).toBe(false)
    expect(lyricBreakState(lines, 4).active).toBe(false)
  })

  it('ignores a small line-to-line gap', () => {
    // gap 2→3 is 1s, below the 6s default
    expect(lyricBreakState(lines, 2.5).active).toBe(false)
  })

  it('activates inside a big gap and counts down to the next line', () => {
    const s = lyricBreakState(lines, 9) // in the 5→15 gap (10s)
    expect(s.active).toBe(true)
    expect(s.gapSec).toBe(10)
    expect(s.untilSec).toBe(6) // 15 - 9
    expect(s.elapsedSec).toBe(4) // 9 - 5
    expect(s.progress).toBeCloseTo(0.4, 5)
    expect(s.nextLine).toBe(lines[2])
  })

  it('treats a long intro before the first line as a break', () => {
    const late = [{ startSec: 12, endSec: 14 }]
    const s = lyricBreakState(late, 3)
    expect(s.active).toBe(true)
    expect(s.gapSec).toBe(12)
    expect(s.untilSec).toBe(9)
    expect(s.nextLine).toBe(late[0])
  })

  it('is inactive after the last line (nothing to count down to)', () => {
    expect(lyricBreakState(lines, 20).active).toBe(false)
  })

  it('respects a custom minGapSec', () => {
    // the 2→3 (1s) gap now counts if the threshold is small enough
    expect(lyricBreakState(lines, 2.5, { minGapSec: 0.5 }).active).toBe(true)
  })

  it('handles empty lyrics', () => {
    expect(lyricBreakState([], 5).active).toBe(false)
  })
})
