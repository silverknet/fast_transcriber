/**
 * The band's real patch, and the rule that keeps it safe: nothing this module
 * produces may ever reach unity on an in-ear send.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_SEND,
  MAX_MONITOR_SEND,
  buildStageInputSends,
  busSendPath,
  monitorBuses,
  stageInputRows,
  stageSendVerifyPlan,
} from './stageInputSends'
import type { Performer } from '$lib/project/types'

/** Exactly what Martin plugged in: 3 mics, stereo keys, stereo guitar. */
const band: Performer[] = [
  {
    id: 'martin',
    name: 'Martin',
    monitorBus: 1,
    inputs: [
      { id: 'i1', label: 'Mic', channels: [1] },
      { id: 'i2', label: 'Keys', channels: [5, 6] },
    ],
  },
  {
    id: 'thor',
    name: 'Thor',
    monitorBus: 2,
    inputs: [
      { id: 'i3', label: 'Mic', channels: [2] },
      { id: 'i4', label: 'Guitar', channels: [7, 8] },
    ],
  },
  { id: 'emma', name: 'Emma', monitorBus: 3, inputs: [{ id: 'i5', label: 'Mic', channels: [3] }] },
]

describe('reading the patch off the roster', () => {
  it('lists every input with who owns it', () => {
    const rows = stageInputRows(band)
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.channels)).toEqual([[1], [5, 6], [2], [7, 8], [3]])
    expect(rows[1]!.ownerName).toBe('Martin')
  })

  it('finds the mixes in use, in order', () => {
    expect(monitorBuses(band)).toEqual([1, 2, 3])
  })

  it('a performer with no bus yet contributes no mix', () => {
    expect(monitorBuses([{ id: 'x', name: 'Guest' }])).toEqual([])
  })
})

describe('wiring every input into every mix', () => {
  const writes = buildStageInputSends(band)

  it('covers all 7 channels × all 3 mixes', () => {
    expect(writes).toHaveLength(7 * 3)
    const channels = [...new Set(writes.map((w) => w.channel))].sort((a, b) => a - b)
    expect(channels).toEqual([1, 2, 3, 5, 6, 7, 8])
    for (const ch of channels) {
      expect(writes.filter((w) => w.channel === ch).map((w) => w.bus).sort()).toEqual([1, 2, 3])
    }
  })

  it('never writes the same send twice, even if a channel is listed twice', () => {
    const doubled: Performer[] = [
      {
        id: 'a',
        name: 'A',
        monitorBus: 1,
        inputs: [
          { id: 'x', label: 'Mic', channels: [1] },
          { id: 'y', label: 'Also mic', channels: [1] },
        ],
      },
    ]
    expect(buildStageInputSends(doubled)).toHaveLength(1)
  })

  it('SAFETY: no send can reach unity, however hard it is asked', () => {
    for (const w of buildStageInputSends(band, 5)) {
      expect(w.value).toBeLessThanOrEqual(MAX_MONITOR_SEND)
      expect(w.value).toBeLessThan(0.75) // X-Air unity — full line level into someone's ears
    }
    expect(DEFAULT_STAGE_SEND).toBeLessThan(MAX_MONITOR_SEND)
  })

  it('a negative level is floored at silence, not wrapped', () => {
    for (const w of buildStageInputSends(band, -3)) expect(w.value).toBe(0)
  })

  it('every write says whose instrument it is', () => {
    const w = buildStageInputSends(band).find((x) => x.channel === 7)!
    expect(w.why).toContain('Thor')
    expect(w.why).toContain('Guitar')
  })

  it('no roster, no writes — never guesses channels', () => {
    expect(buildStageInputSends([])).toEqual([])
    expect(buildStageInputSends([{ id: 'a', name: 'A', monitorBus: 1 }])).toEqual([])
  })
})

describe('addresses and read-back', () => {
  it('zero-pads both channel and bus — the desk ignores unpadded addresses', () => {
    expect(busSendPath(1, 2)).toBe('/ch/01/mix/02/level')
    expect(busSendPath(11, 6)).toBe('/ch/11/mix/06/level')
  })

  it('the verify plan matches the writes one for one', () => {
    const writes = buildStageInputSends(band)
    const plan = stageSendVerifyPlan(writes)
    expect(plan).toHaveLength(writes.length)
    expect(plan[0]!.address).toBe(busSendPath(writes[0]!.channel, writes[0]!.bus))
    expect(plan[0]!.expect).toBe(writes[0]!.value)
  })
})
