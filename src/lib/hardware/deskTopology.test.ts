/**
 * Bus link state.
 *
 * Verified against a real XR18V2: `/config/buslink` answers `0,0,0` and the
 * per-pair form `/config/buslink/1-2` answers `0`. Zero means unlinked, which is
 * what the whole monitor model needs.
 */
import { describe, expect, it } from 'vitest'
import { BUS_LINK_PATHS, availableMonitorBuses, readBusTopology } from './deskTopology'

const answers = (a: number, b: number, c: number) => ({
  [BUS_LINK_PATHS[0]!]: [{ type: 'i', value: a }],
  [BUS_LINK_PATHS[1]!]: [{ type: 'i', value: b }],
  [BUS_LINK_PATHS[2]!]: [{ type: 'i', value: c }],
})

describe('what the desk says about its buses', () => {
  it('six mono buses when every pair is unlinked', () => {
    const t = readBusTopology(answers(0, 0, 0))
    expect(t.mono).toBe(true)
    expect(t.linkedPairs).toEqual([])
    expect(t.reason).toBe('')
    expect(availableMonitorBuses(t)).toBe(6)
  })

  it('names the linked pair, and says what it costs', () => {
    const t = readBusTopology(answers(0, 1, 0))
    expect(t.mono).toBe(false)
    expect(t.linkedPairs).toEqual(['3-4'])
    expect(t.reason).toMatch(/3-4/)
    expect(t.reason).toMatch(/share one mix/)
    expect(availableMonitorBuses(t)).toBe(5)
  })

  it('handles every pair linked', () => {
    const t = readBusTopology(answers(1, 1, 1))
    expect(t.linkedPairs).toEqual(['1-2', '3-4', '5-6'])
    expect(availableMonitorBuses(t)).toBe(3)
  })
})

describe('silence is not an answer', () => {
  it('a desk that said nothing is UNKNOWN, never mono', () => {
    // This link genuinely drops UDP. Treating no-reply as "unlinked" would
    // reinstate the very assumption this check exists to test.
    const t = readBusTopology({})
    expect(t.unknown).toBe(true)
    expect(t.mono).toBe(false)
    expect(t.reason).toMatch(/did not say/)
    expect(availableMonitorBuses(t)).toBe(0)
  })

  it('a PARTIAL answer is still unknown', () => {
    const t = readBusTopology({ [BUS_LINK_PATHS[0]!]: [{ type: 'i', value: 0 }] })
    expect(t.unknown).toBe(true)
    expect(t.mono).toBe(false)
  })

  it('ignores a non-numeric reply rather than trusting it', () => {
    const t = readBusTopology({
      ...answers(0, 0, 0),
      [BUS_LINK_PATHS[1]!]: [{ type: 's', value: 'yes' }],
    })
    expect(t.unknown).toBe(true)
  })
})
