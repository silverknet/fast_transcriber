import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import TimerDial from './TimerDial.svelte'
import { handAngleDeg } from './timerModel'

/**
 * The hand must turn about the CENTRE of the clock.
 *
 * This is a geometry bug that no test on the angle can catch — the number is
 * right, the drawing is wrong — and it has already happened once here: a CSS
 * `transform-origin` sat on top of the centre already named in the SVG
 * `rotate(angle cx cy)` attribute, so every rotation was applied about a doubled
 * offset and the hand orbited a point outside the dial.
 *
 * The check is exact: the hand's pivot end is at (50,50) in view-box units, so
 * whatever the angle, that point must map to the same place on screen.
 */

function pivotScreenPoint(container: HTMLElement): { x: number; y: number } {
  const svg = container.querySelector('svg') as SVGSVGElement
  const hand = container.querySelector('[data-testid="hand"]') as SVGGraphicsElement
  const pt = svg.createSVGPoint()
  pt.x = 50
  pt.y = 50
  const screen = pt.matrixTransform(hand.getScreenCTM()!)
  return { x: screen.x, y: screen.y }
}

/** Where the dial's own centre lands, independent of the hand. */
function dialCentre(container: HTMLElement): { x: number; y: number } {
  const svg = container.querySelector('svg') as SVGSVGElement
  const face = container.querySelector('.face') as SVGGraphicsElement
  const pt = svg.createSVGPoint()
  pt.x = 50
  pt.y = 50
  const screen = pt.matrixTransform(face.getScreenCTM()!)
  return { x: screen.x, y: screen.y }
}

describe('TimerDial — the hand turns about the clock centre', () => {
  it('keeps its pivot on the dial centre at every angle', async () => {
    const screen = render(TimerDial, { angle: 90, startAngle: 90, sweptFraction: 0 })
    const container = screen.container as HTMLElement
    const centre = dialCentre(container)

    for (const angle of [0, 45, 90, 137, 180, 270, 359, 360]) {
      await screen.rerender({ angle, startAngle: 90, sweptFraction: 0 })
      const pivot = pivotScreenPoint(container)
      // Sub-pixel: the pivot IS the centre, not merely near it.
      expect(Math.hypot(pivot.x - centre.x, pivot.y - centre.y)).toBeLessThan(0.5)
    }
  }, 30_000)

  it('holds the anchor across the real sweep, quarter past round to 00', async () => {
    const screen = render(TimerDial, { angle: handAngleDeg(0), startAngle: 90, sweptFraction: 0 })
    const container = screen.container as HTMLElement
    const centre = dialCentre(container)

    for (let t = 0; t <= 45; t += 5) {
      await screen.rerender({ angle: handAngleDeg(t), startAngle: 90, sweptFraction: t / 60 })
      const pivot = pivotScreenPoint(container)
      expect(Math.hypot(pivot.x - centre.x, pivot.y - centre.y)).toBeLessThan(0.5)
    }
  }, 30_000)

  it('actually moves the tip — an anchored hand still has to rotate', async () => {
    const screen = render(TimerDial, { angle: 0, startAngle: 90, sweptFraction: 0 })
    const container = screen.container as HTMLElement
    const svg = container.querySelector('svg') as SVGSVGElement
    const hand = container.querySelector('[data-testid="hand"]') as SVGGraphicsElement

    const tipAt = () => {
      const pt = svg.createSVGPoint()
      pt.x = 50
      pt.y = 13 // the free end
      return pt.matrixTransform(hand.getScreenCTM()!)
    }

    const up = tipAt()
    await screen.rerender({ angle: 180, startAngle: 90, sweptFraction: 0 })
    const down = tipAt()
    // Half a turn puts the tip on the opposite side of the centre.
    expect(Math.hypot(down.x - up.x, down.y - up.y)).toBeGreaterThan(1)
  }, 30_000)
})
