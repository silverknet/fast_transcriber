import { describe, expect, it } from 'vitest'
import {
  TIMER_SECONDS,
  handAngleDeg,
  isFinished,
  progress,
  remainingSec,
  tickIntensity,
  tickTimes,
} from './timerModel'

describe('the 45-second timer', () => {
  it('is exactly 45 seconds', () => {
    expect(TIMER_SECONDS).toBe(45)
  })
})

describe('handAngleDeg — quarter past, all the way round to 00', () => {
  it('starts at quarter past (90° from 12)', () => {
    expect(handAngleDeg(0)).toBe(90)
  })

  it('lands exactly on 00 at the end', () => {
    // 90° + 270° of sweep = 360°, i.e. back at the top.
    expect(handAngleDeg(TIMER_SECONDS)).toBe(360)
  })

  it('sweeps three quarters of the dial in total', () => {
    expect(handAngleDeg(TIMER_SECONDS) - handAngleDeg(0)).toBe(270)
  })

  it('only ever moves forward — a hand that snaps back reads as broken', () => {
    let prev = -Infinity
    for (let t = 0; t <= TIMER_SECONDS; t += 0.25) {
      const a = handAngleDeg(t)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })

  it('passes through half past and quarter to on the way', () => {
    expect(handAngleDeg(15)).toBe(180) // half past
    expect(handAngleDeg(30)).toBe(270) // quarter to
  })

  it('clamps outside the run rather than spinning on', () => {
    expect(handAngleDeg(-5)).toBe(90)
    expect(handAngleDeg(999)).toBe(360)
  })
})

describe('remainingSec', () => {
  it('starts at 45 and ends at 0', () => {
    expect(remainingSec(0)).toBe(45)
    expect(remainingSec(TIMER_SECONDS)).toBe(0)
  })

  it('never shows a negative number after the bell', () => {
    expect(remainingSec(TIMER_SECONDS + 10)).toBe(0)
  })

  it('shows the second you are still inside — 44.2s elapsed is "1" left', () => {
    expect(remainingSec(44.2)).toBe(1)
    expect(remainingSec(0.1)).toBe(45)
  })
})

describe('progress / isFinished', () => {
  it('runs 0 → 1 and clamps', () => {
    expect(progress(0)).toBe(0)
    expect(progress(TIMER_SECONDS / 2)).toBeCloseTo(0.5, 6)
    expect(progress(TIMER_SECONDS)).toBe(1)
    expect(progress(999)).toBe(1)
  })

  it('is only finished at the end', () => {
    expect(isFinished(44.9)).toBe(false)
    expect(isFinished(TIMER_SECONDS)).toBe(true)
  })
})

describe('tickTimes — the ticking closes in', () => {
  const times = tickTimes()

  it('starts on the first second and stays inside the run', () => {
    expect(times[0]).toBe(0)
    expect(Math.max(...times)).toBeLessThan(TIMER_SECONDS)
  })

  it('is strictly increasing with no duplicate ticks', () => {
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!)
    expect(new Set(times).size).toBe(times.length)
  })

  it('speeds up: one per second, then two, then four', () => {
    const inWindow = (from: number, to: number) => times.filter((t) => t >= from && t < to).length
    expect(inWindow(0, 30)).toBe(30) // 1/s
    expect(inWindow(30, 40)).toBe(20) // 2/s
    expect(inWindow(40, 45)).toBe(20) // 4/s
  })

  it('gaps never grow — it can only get more urgent, never less', () => {
    for (let i = 2; i < times.length; i++) {
      const gap = times[i]! - times[i - 1]!
      const prevGap = times[i - 1]! - times[i - 2]!
      expect(gap).toBeLessThanOrEqual(prevGap + 1e-6)
    }
  })
})

describe('tickIntensity', () => {
  it('rises from the start to the end', () => {
    expect(tickIntensity(TIMER_SECONDS)).toBeGreaterThan(tickIntensity(0))
  })

  it('is audible from the very first tick — never starts at silence', () => {
    expect(tickIntensity(0)).toBeGreaterThan(0.2)
  })

  it('never leaves 0…1, even off the ends', () => {
    for (const t of [-10, 0, 22.5, TIMER_SECONDS, 999]) {
      expect(tickIntensity(t)).toBeGreaterThanOrEqual(0)
      expect(tickIntensity(t)).toBeLessThanOrEqual(1)
    }
  })

  it('builds late rather than fading in evenly', () => {
    // The second half should add more than the first, or it reads as a fade-in.
    const firstHalf = tickIntensity(22.5) - tickIntensity(0)
    const secondHalf = tickIntensity(45) - tickIntensity(22.5)
    expect(secondHalf).toBeGreaterThan(firstHalf)
  })
})
