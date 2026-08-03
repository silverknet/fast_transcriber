/**
 * The multichannel verdict.
 *
 * This decides whether the whole live rig design is possible on a given
 * machine, so it must be impossible for it to pass optimistically. Every
 * "arrived" has to be backed by a desk meter that actually rose.
 */
import { describe, expect, it } from 'vitest'
import { PROBE_RISE_DB, PROBE_TONES, probeVerdict } from './multichannelProbe'

const quiet = { 9: -100, 10: -100, 11: -100, 12: -100 }
const loud = { 9: -12, 10: -12, 11: -18, 12: -24 }

describe('when the machine can do it', () => {
  it('is proven only when every channel arrived on its own strip', () => {
    const v = probeVerdict({ firstDeskChannel: 9, resting: quiet, active: loud })
    expect(v.proven).toBe(true)
    expect(v.channels.every((c) => c.arrived)).toBe(true)
    expect(v.reason).toMatch(/out of the house/)
  })

  it('maps each output channel to the right desk strip', () => {
    const v = probeVerdict({ firstDeskChannel: 11, resting: {}, active: {} })
    expect(v.channels.map((c) => c.deskChannel)).toEqual([11, 12, 13, 14])
    expect(v.channels.map((c) => c.label)).toEqual(PROBE_TONES.map((t) => t.label))
  })
})

describe('the failure that matters', () => {
  it('names stereo-only: the song pair arrives, the extra channels do not', () => {
    // The exact shape of "this machine will not send more than two channels",
    // which is the question the probe exists to answer.
    const v = probeVerdict({
      firstDeskChannel: 9,
      resting: quiet,
      active: { 9: -12, 10: -12, 11: -100, 12: -100 },
    })
    expect(v.proven).toBe(false)
    expect(v.channels[0]!.arrived).toBe(true)
    expect(v.channels[2]!.arrived).toBe(false)
    expect(v.reason).toMatch(/not send more than two/)
    expect(v.reason).toMatch(/click \(desk 11\)/)
  })

  it('says nothing arrived when nothing did, rather than blaming the channel count', () => {
    const v = probeVerdict({ firstDeskChannel: 9, resting: quiet, active: quiet })
    expect(v.proven).toBe(false)
    expect(v.reason).toMatch(/Nothing reached the desk/)
    expect(v.reason).toMatch(/switched to USB/)
  })
})

describe('an unknown is never an arrival', () => {
  it('a desk that did not answer is NOT proven', () => {
    // UDP drops on this link. Treating a missing reply as success is exactly
    // how the rig reported itself ready while producing silence.
    const v = probeVerdict({ firstDeskChannel: 9, resting: quiet, active: {} })
    expect(v.proven).toBe(false)
    expect(v.channels.every((c) => !c.arrived)).toBe(true)
  })

  it('a missing RESTING reading is not an arrival either', () => {
    const v = probeVerdict({ firstDeskChannel: 9, resting: {}, active: loud })
    expect(v.proven).toBe(false)
  })

  it('a channel already carrying signal cannot fake an arrival', () => {
    // Someone else's programme on desk 11 would otherwise read as the probe
    // landing there. The rise, not the level, is what counts.
    const v = probeVerdict({
      firstDeskChannel: 9,
      resting: { 9: -100, 10: -100, 11: -20, 12: -100 },
      active: { 9: -12, 10: -12, 11: -19, 12: -24 },
    })
    expect(v.channels[2]!.arrived).toBe(false)
    expect(v.proven).toBe(false)
  })

  it('needs a real rise, not a flicker', () => {
    const justUnder = { 9: -100 + PROBE_RISE_DB - 1, 10: -12, 11: -18, 12: -24 }
    expect(probeVerdict({ firstDeskChannel: 9, resting: quiet, active: justUnder }).proven).toBe(false)
    const justOver = { 9: -100 + PROBE_RISE_DB, 10: -12, 11: -18, 12: -24 }
    expect(probeVerdict({ firstDeskChannel: 9, resting: quiet, active: justOver }).proven).toBe(true)
  })
})
