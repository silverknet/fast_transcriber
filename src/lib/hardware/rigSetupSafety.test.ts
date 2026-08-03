/**
 * The rig page must not grow its own idea of "is the house safe".
 *
 * There is exactly one rule for that (`verifyFohSafe`), it treats a channel
 * MISSING from the desk read-back as unsafe, and a click in the house ends a
 * show. A second copy of that judgement on a diagnostics page is precisely the
 * kind of double knowledge that has already cost this codebase a day.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { verifyFohSafe, type XAirLaneRoute } from './xairRouting'

const page = () =>
  readFileSync(new URL('../../routes/rig/+page.svelte', import.meta.url), 'utf8')

const monitorRoutes = (channels: number[]): XAirLaneRoute[] => [
  { laneKey: 'click', channels, followVolume: false, followMute: false },
]

describe('the rig page defers to the shipped safety rule', () => {
  it('calls verifyFohSafe rather than comparing lr values itself', () => {
    const s = page()
    expect(s).toContain('verifyFohSafe')
    expect(s).toContain('xairFohSafetyPlan')
  })

  it('never claims safety without a read-back', () => {
    // "I sent the message" is not evidence over fire-and-forget UDP.
    const s = page()
    expect(s).toContain('refreshXAirState')
    expect(s).toMatch(/UNVERIFIED/)
  })

  it('restores whatever it changed', () => {
    // It is someone's live desk; leaving faders moved is not acceptable.
    expect(page()).toContain('restoreDesk')
  })
})

describe('the rule it defers to', () => {
  it('treats a channel missing from the read-back as UNSAFE', () => {
    // The dangerous default: silence from the desk must never read as "fine".
    const { safe, unsafeChannels } = verifyFohSafe(monitorRoutes([15, 16]), new Map())
    expect(safe).toBe(false)
    expect(unsafeChannels).toEqual([15, 16])
  })

  it('is safe only when every monitor channel reports OFF the house', () => {
    const assigns = new Map([
      [15, false],
      [16, false],
    ])
    expect(verifyFohSafe(monitorRoutes([15, 16]), assigns).safe).toBe(true)
  })

  it('one channel still assigned is enough to be unsafe', () => {
    const assigns = new Map([
      [15, false],
      [16, true],
    ])
    const { safe, unsafeChannels } = verifyFohSafe(monitorRoutes([15, 16]), assigns)
    expect(safe).toBe(false)
    expect(unsafeChannels).toEqual([16])
  })
})
