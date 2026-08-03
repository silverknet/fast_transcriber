import { describe, expect, it } from 'vitest'
import {
  timeToPx,
  timeToPxInView,
  clientXToContentX,
  clientXToTime,
  clientXToTimeInView,
  clampTime,
} from './timeGeometry'

/**
 * Pure time↔pixel geometry for the waveform. Every click-to-seek and every
 * drawn marker routes through here, so an off-by-one or a missing clamp is a
 * cursor that lands on the wrong beat. Node-pure: the two client-space helpers
 * take a minimal stub for the scroll element's rect + scrollLeft.
 */
function scrollEl(left: number, scrollLeft: number): HTMLElement {
  return { getBoundingClientRect: () => ({ left }) as DOMRect, scrollLeft } as unknown as HTMLElement
}

describe('timeToPx', () => {
  it('maps [0,duration] linearly across the width', () => {
    expect(timeToPx(0, 10, 100)).toBe(0)
    expect(timeToPx(5, 10, 100)).toBe(50)
    expect(timeToPx(10, 10, 100)).toBe(100)
  })
  it('clamps out-of-range times into the wave', () => {
    expect(timeToPx(-3, 10, 100)).toBe(0)
    expect(timeToPx(999, 10, 100)).toBe(100)
  })
  it('guards degenerate inputs by returning 0', () => {
    expect(timeToPx(5, 0, 100)).toBe(0)
    expect(timeToPx(5, 10, 0)).toBe(0)
    expect(timeToPx(NaN, 10, 100)).toBe(0)
  })
})

describe('timeToPxInView', () => {
  it('maps a windowed [viewStart,viewEnd] across the width', () => {
    expect(timeToPxInView(20, 20, 30, 200)).toBe(0)
    expect(timeToPxInView(25, 20, 30, 200)).toBe(100)
    expect(timeToPxInView(30, 20, 30, 200)).toBe(200)
  })
  it('clamps times outside the view to the edges', () => {
    expect(timeToPxInView(10, 20, 30, 200)).toBe(0)
    expect(timeToPxInView(50, 20, 30, 200)).toBe(200)
  })
  it('returns 0 for an empty or inverted span', () => {
    expect(timeToPxInView(25, 30, 30, 200)).toBe(0)
    expect(timeToPxInView(25, 30, 20, 200)).toBe(0)
  })
})

describe('clientXToContentX', () => {
  it('subtracts the element left and adds the scroll offset', () => {
    // Pointer at clientX 150, element starts at 100, scrolled 40 → content 90.
    expect(clientXToContentX(150, scrollEl(100, 40))).toBe(90)
  })
})

describe('clientXToTime', () => {
  it('is the inverse of timeToPx for an unscrolled element', () => {
    const el = scrollEl(0, 0)
    expect(clientXToTime(50, el, 100, 10)).toBe(5)
    expect(clientXToTime(0, el, 100, 10)).toBe(0)
    expect(clientXToTime(100, el, 100, 10)).toBe(10)
  })
  it('clamps the fraction to [0,1] so a drag past the ends stays in bounds', () => {
    const el = scrollEl(0, 0)
    expect(clientXToTime(-20, el, 100, 10)).toBe(0)
    expect(clientXToTime(200, el, 100, 10)).toBe(10)
  })
  it('accounts for element offset + scroll', () => {
    // clientX 160, left 100, scroll 40 → contentX 100 → frac 1 → duration.
    expect(clientXToTime(160, scrollEl(100, 40), 100, 10)).toBe(10)
  })
  it('guards degenerate width/duration', () => {
    expect(clientXToTime(50, scrollEl(0, 0), 0, 10)).toBe(0)
    expect(clientXToTime(50, scrollEl(0, 0), 100, 0)).toBe(0)
  })
})

describe('clientXToTimeInView', () => {
  it('maps within the view window', () => {
    const el = scrollEl(0, 0)
    expect(clientXToTimeInView(0, el, 200, 20, 30)).toBe(20)
    expect(clientXToTimeInView(100, el, 200, 20, 30)).toBe(25)
    expect(clientXToTimeInView(200, el, 200, 20, 30)).toBe(30)
  })
  it('falls back to viewStart on a degenerate span or width', () => {
    expect(clientXToTimeInView(100, scrollEl(0, 0), 200, 30, 30)).toBe(30)
    expect(clientXToTimeInView(100, scrollEl(0, 0), 0, 20, 30)).toBe(20)
  })
})

describe('clampTime', () => {
  it('clamps to [0,max] and maps NaN to 0', () => {
    expect(clampTime(-5, 10)).toBe(0)
    expect(clampTime(4, 10)).toBe(4)
    expect(clampTime(99, 10)).toBe(10)
    expect(clampTime(NaN, 10)).toBe(0)
  })
})
