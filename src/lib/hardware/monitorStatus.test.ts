/**
 * Per-performer monitor status, from the desk's own meters.
 *
 * The CHANNEL block (indices 0-15) is proven on a real XR18V2 (40 values in an
 * 84-byte blob). The BUS block's position is IN DOUBT — live evidence 2026-08-03
 * contradicted indices 22-27 — so bus verdicts default to unknown until the
 * /debug/meters capture at rehearsal settles it. See BUS_METER_INDEX_VERIFIED.
 */
import { describe, expect, it } from 'vitest'
import {
  BUS_METER_INDEX_VERIFIED,
  METER_INDEX,
  METER_STALE_MS,
  busLevelDb,
  channelLevelDb,
  duplicateBuses,
  monitorStatuses,
} from './monitorStatus'

/** A frame with everything at the floor except the named points. */
function frame(overrides: Record<number, number> = {}): number[] {
  const f = new Array(40).fill(-128)
  for (const [i, v] of Object.entries(overrides)) f[Number(i)] = v
  return f
}

const band = [
  { id: 'a', name: 'Martin', role: 'Keyboard', monitorBus: 1 },
  { id: 'b', name: 'Thor', role: 'Guitar', monitorBus: 2 },
  { id: 'c', name: 'Emma', role: 'Song', monitorBus: 3 },
]

describe('reading the desk frame', () => {
  it('finds a bus at the index the real desk uses', () => {
    expect(busLevelDb(frame({ [METER_INDEX.firstBus]: -14 }), 1)).toBe(-14)
    expect(busLevelDb(frame({ [METER_INDEX.firstBus + 5]: -20 }), 6)).toBe(-20)
  })

  it('finds a channel at the index the real desk uses', () => {
    // Channel 9 is where BarBro's left output lands.
    expect(channelLevelDb(frame({ 8: -12 }), 9)).toBe(-12)
  })

  it('refuses a bus or channel the desk does not have', () => {
    expect(busLevelDb(frame(), 7)).toBeNull()
    expect(busLevelDb(frame(), 0)).toBeNull()
    expect(channelLevelDb(frame(), 17)).toBeNull()
    expect(busLevelDb(null, 1)).toBeNull()
  })
})

describe('what a performer row says', () => {
  it('reports SENDING when the desk shows signal on their bus', () => {
    const rows = monitorStatuses({
      busIndexVerified: true,
      performers: band,
      levels: frame({ [METER_INDEX.firstBus]: -14 }),
      ageMs: 100,
    })
    expect(rows[0]).toMatchObject({ name: 'Martin', bus: 1, state: 'sending', levelDb: -14 })
    // It stops at "leaving the desk" — it cannot know anyone heard it.
    expect(rows[0]!.detail).toMatch(/hear it/)
  })

  it('reports SILENT only when the SOURCE is hot and the bus is dead — a broken send', () => {
    // Song playing on ch 9 (index 8), Thor's bus at the floor → genuinely broken.
    const rows = monitorStatuses({
      busIndexVerified: true,
      performers: band,
      levels: frame({ 8: -12 }),
      ageMs: 100,
      sourceActive: true,
    })
    expect(rows[1]).toMatchObject({ name: 'Thor', state: 'silent' })
    expect(rows[1]!.detail).toMatch(/sends and the bus master/)
  })

  it('an IDLE desk is idle, not broken — nothing playing means every bus is quiet', () => {
    // The real report behind this state: three red dots and "3 silent" at a
    // desk with nothing playing. Truthful, alarming, and wrong — red at rest
    // trains people to ignore red.
    const rows = monitorStatuses({ performers: band, levels: frame(), ageMs: 100, sourceActive: false, busIndexVerified: true })
    for (const r of rows) {
      expect(r.state, r.name).toBe('idle')
      expect(r.detail).toMatch(/Nothing is playing/)
    }
  })

  it('says UNASSIGNED rather than silent when nobody picked a bus', () => {
    // A different problem with a different fix, and telling someone to check
    // their cable when no bus is assigned wastes soundcheck.
    const rows = monitorStatuses({
      busIndexVerified: true,
      performers: [{ id: 'x', name: 'Guest', monitorBus: null }],
      levels: frame(),
      ageMs: 100,
    })
    expect(rows[0]).toMatchObject({ state: 'unassigned', bus: null })
    expect(rows[0]!.detail).toMatch(/Project settings/)
  })
})

describe('silence is not the same as not knowing', () => {
  it('is UNKNOWN, never silent, when no frame has arrived', () => {
    const rows = monitorStatuses({ performers: band, levels: null, ageMs: null, busIndexVerified: true })
    expect(rows.every((r) => r.state === 'unknown')).toBe(true)
    expect(rows[0]!.detail).toMatch(/not sent any levels/)
  })

  it('is UNKNOWN when the feed has gone stale', () => {
    // The subscription expires after ~10 s. A missed renewal must not paint six
    // working monitors red and send the band hunting for cables.
    const rows = monitorStatuses({
      busIndexVerified: true,
      performers: band,
      levels: frame({ [METER_INDEX.firstBus]: -14 }),
      ageMs: METER_STALE_MS + 1,
    })
    expect(rows.every((r) => r.state === 'unknown')).toBe(true)
    expect(rows[0]!.detail).toMatch(/stopped updating/)
  })

  it('a fresh frame just inside the window is still believed', () => {
    const rows = monitorStatuses({
      busIndexVerified: true,
      performers: band,
      levels: frame({ [METER_INDEX.firstBus]: -14 }),
      ageMs: METER_STALE_MS,
    })
    expect(rows[0]!.state).toBe('sending')
  })
})

describe('two performers on one bus', () => {
  it('is reported, because turning one down turns both down', () => {
    expect(
      duplicateBuses([
        { id: 'a', name: 'A', monitorBus: 1 },
        { id: 'b', name: 'B', monitorBus: 1 },
        { id: 'c', name: 'C', monitorBus: 2 },
      ]),
    ).toEqual([1])
  })

  it('says nothing when every bus is distinct', () => {
    expect(duplicateBuses(band)).toEqual([])
  })

  it('ignores performers with no bus rather than calling them duplicates', () => {
    expect(
      duplicateBuses([
        { id: 'a', name: 'A', monitorBus: null },
        { id: 'b', name: 'B', monitorBus: null },
      ]),
    ).toEqual([])
  })
})

describe('unverified bus-meter layout — the default, until a rehearsal proves it', () => {
  // 2026-08-03: packs audibly carried signal while "bus" indices 22-27 read
  // −128 all night. Until /debug/meters proves the real positions, a
  // bus-derived verdict must be UNKNOWN — a false red trains people to ignore
  // red, and a false green about someone's in-ears is worse.
  const band = [{ id: 'p1', name: 'Martin', monitorBus: 1 }]
  const hot = () => {
    const f = new Array(40).fill(-128)
    f[0] = -6 // a source channel is hot
    f[22] = -6 // and the (suspect) bus slot shows signal
    return f
  }

  it('by DEFAULT a bus verdict is unknown — no red, no green, and it says why', () => {
    const rows = monitorStatuses({ performers: band, levels: hot(), ageMs: 100, sourceActive: true })
    expect(rows[0]!.state).toBe('unknown')
    expect(rows[0]!.levelDb).toBeNull()
    expect(rows[0]!.detail).toMatch(/meter layout/i)
  })

  it('unassigned and stale verdicts are unaffected — they never read bus meters', () => {
    const unassigned = monitorStatuses({
      performers: [{ id: 'p2', name: 'Thor' }],
      levels: hot(),
      ageMs: 100,
    })
    expect(unassigned[0]!.state).toBe('unassigned')
    const stale = monitorStatuses({ performers: band, levels: hot(), ageMs: 99_999 })
    expect(stale[0]!.state).toBe('unknown')
    expect(stale[0]!.detail).toMatch(/stopped updating/)
  })

  it('BUS_METER_INDEX_VERIFIED is still false — flipping it requires measured indices AND updating this suite', () => {
    expect(BUS_METER_INDEX_VERIFIED).toBe(false)
  })
})
