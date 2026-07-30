import { describe, expect, it } from 'vitest'
import {
  buildXAirBusSends,
  buildXAirLaneWrites,
  defaultXAirChannelsForLane,
  diffXAirBusWrites,
  diffXAirLaneWrites,
  ensureXAirRoutesForLanes,
  isMonitorOnlyLane,
  parseXAirChannelList,
  verifyFohSafe,
  xairDbToFader,
  xairFaderFromLinearGain,
  xairFaderToDb,
  xairFohSafetyPlan,
  xairLaneAudible,
  xairWriteSignature,
  type XAirLiveLane,
  type XAirLaneRoute,
  type XAirMonitorMix,
} from './xairRouting'

const lane = (patch: Partial<XAirLiveLane> & Pick<XAirLiveLane, 'key'>): XAirLiveLane => ({
  label: patch.key,
  volume: 1,
  muted: false,
  soloed: false,
  ...patch,
})

describe('parseXAirChannelList', () => {
  it('parses comma and whitespace separated XR18 channels', () => {
    expect(parseXAirChannelList('17, 18')).toEqual([17, 18])
    expect(parseXAirChannelList('1 2 2,3')).toEqual([1, 2, 3])
    expect(parseXAirChannelList('')).toEqual([])
  })

  it('rejects invalid XR18 channel text', () => {
    expect(() => parseXAirChannelList('0')).toThrow(/1..18/)
    expect(() => parseXAirChannelList('19')).toThrow(/1..18/)
    expect(() => parseXAirChannelList('1-2')).toThrow(/1..18/)
    expect(() => parseXAirChannelList('kick')).toThrow(/1..18/)
  })
})

describe('ensureXAirRoutesForLanes', () => {
  it('adds safe default routes for known live lanes', () => {
    const routes = ensureXAirRoutesForLanes(
      [],
      [lane({ key: 'original' }), lane({ key: 'cue' }), lane({ key: 'stem:vocals.wav' })],
    )
    expect(routes.map((r) => [r.laneKey, r.channels])).toEqual([
      ['original', [9, 10]],
      ['cue', [18]],
      ['stem:vocals.wav', [13, 14]],
    ])
    expect(defaultXAirChannelsForLane('click')).toEqual([17]) // click → its own channel, off FOH
  })

  it('preserves existing routes, including lanes that are temporarily absent', () => {
    const routes: XAirLaneRoute[] = [
      { laneKey: 'original', channels: [9, 10], followVolume: false, followMute: true },
      { laneKey: 'old', channels: [1], followVolume: true, followMute: true },
    ]
    expect(ensureXAirRoutesForLanes(routes, [lane({ key: 'original' })])).toEqual([
      { laneKey: 'original', channels: [9, 10], followVolume: false, followMute: true },
      { laneKey: 'old', channels: [1], followVolume: true, followMute: true },
    ])
  })
})

describe('X Air fader law', () => {
  it('maps BarBro unity gain to 0 dB (fader 0.75), NOT full fader (+10 dB)', () => {
    expect(xairFaderFromLinearGain(1.0)).toBeCloseTo(0.75, 5)
  })

  it('round-trips dB ↔ fader across all four curve segments', () => {
    for (const db of [10, 0, -10, -20, -30, -45, -60, -75]) {
      expect(xairFaderToDb(xairDbToFader(db))).toBeCloseTo(db, 4)
    }
  })

  it('silence maps to fader 0 and gains clamp sanely', () => {
    expect(xairFaderFromLinearGain(0)).toBe(0)
    expect(xairFaderFromLinearGain(Number.NaN)).toBe(0)
    // +3.5 dB (gain 1.5) stays well below the +10 dB ceiling.
    const f = xairFaderFromLinearGain(1.5)
    expect(f).toBeGreaterThan(0.75)
    expect(f).toBeLessThan(0.85)
  })
})

describe('buildXAirLaneWrites', () => {
  it('mirrors lane volume (through the fader law) and mute to every mapped channel', () => {
    const writes = buildXAirLaneWrites(
      [lane({ key: 'original', volume: 0.6 })],
      [{ laneKey: 'original', channels: [17, 18], followVolume: true, followMute: true }],
    )
    const expectedFader = xairFaderFromLinearGain(0.6)
    expect(writes).toEqual([
      { kind: 'channel-fader', channel: 17, value: expectedFader },
      { kind: 'channel-on', channel: 17, on: true },
      { kind: 'channel-fader', channel: 18, value: expectedFader },
      { kind: 'channel-on', channel: 18, on: true },
    ])
    // gain 0.6 ≈ −4.4 dB ≈ fader 0.64 — NOT the raw 0.6 linear value.
    expect(expectedFader).toBeGreaterThan(0.6)
    expect(expectedFader).toBeLessThan(0.7)
  })

  it('diffXAirLaneWrites sends only what changed since the last send', () => {
    const writes = buildXAirLaneWrites(
      [lane({ key: 'original', volume: 1.0 }), lane({ key: 'click', volume: 1.0 })],
      [
        { laneKey: 'original', channels: [17], followVolume: true, followMute: true },
        { laneKey: 'click', channels: [15], followVolume: true, followMute: true },
      ],
    )
    const first = diffXAirLaneWrites(writes, new Map())
    expect(first.changed).toHaveLength(4)

    // Same state again → nothing to send.
    const second = diffXAirLaneWrites(writes, first.nextState)
    expect(second.changed).toHaveLength(0)

    // One lane's volume moves → only that lane's fader is re-sent.
    const moved = buildXAirLaneWrites(
      [lane({ key: 'original', volume: 0.5 }), lane({ key: 'click', volume: 1.0 })],
      [
        { laneKey: 'original', channels: [17], followVolume: true, followMute: true },
        { laneKey: 'click', channels: [15], followVolume: true, followMute: true },
      ],
    )
    const third = diffXAirLaneWrites(moved, second.nextState)
    expect(third.changed).toEqual([
      { kind: 'channel-fader', channel: 17, value: xairFaderFromLinearGain(0.5) },
    ])
  })

  it('uses BarBro solo state when deciding XR18 channel on/off', () => {
    const lanes = [
      lane({ key: 'original', soloed: true }),
      lane({ key: 'click', muted: false }),
    ]
    expect(xairLaneAudible(lanes[0], lanes)).toBe(true)
    expect(xairLaneAudible(lanes[1], lanes)).toBe(false)

    const writes = buildXAirLaneWrites(lanes, [
      { laneKey: 'original', channels: [17], followVolume: false, followMute: true },
      { laneKey: 'click', channels: [15], followVolume: false, followMute: true },
    ])
    expect(writes).toEqual([
      { kind: 'channel-on', channel: 17, on: true },
      { kind: 'channel-on', channel: 15, on: false },
    ])
  })

  it('omits unmapped lanes and produces a stable signature', () => {
    const writes = buildXAirLaneWrites(
      [lane({ key: 'stem:bass.wav', volume: 2 })],
      [{ laneKey: 'stem:bass.wav', channels: [], followVolume: true, followMute: true }],
    )
    expect(writes).toEqual([])
    expect(
      xairWriteSignature([
        { kind: 'channel-fader', channel: 1, value: 0.5 },
        { kind: 'channel-on', channel: 1, on: true },
      ]),
    ).toBe('f:1:0.5000|o:1:1')
  })
})

// ── FOH safety (the show-stopping invariant: click/cue NEVER to the house) ────

const route = (laneKey: string, channels: number[]): XAirLaneRoute => ({
  laneKey,
  channels,
  followVolume: true,
  followMute: true,
})

describe('isMonitorOnlyLane', () => {
  it('flags click + cue as monitor-only, music as FOH-ok', () => {
    expect(isMonitorOnlyLane('click')).toBe(true)
    expect(isMonitorOnlyLane('cue')).toBe(true)
    expect(isMonitorOnlyLane('original')).toBe(false)
    expect(isMonitorOnlyLane('stem:vocals.wav')).toBe(false)
  })
})

describe('xairFohSafetyPlan', () => {
  it('takes click/cue channels OFF the main bus and assigns music ON', () => {
    const plan = xairFohSafetyPlan([
      route('click', [17]),
      route('cue', [18]),
      route('stem:vocals.wav', [13, 14]),
      route('original', [9, 10]),
    ])
    expect(plan).toEqual([
      { kind: 'channel-main-assign', channel: 9, on: true },
      { kind: 'channel-main-assign', channel: 10, on: true },
      { kind: 'channel-main-assign', channel: 13, on: true },
      { kind: 'channel-main-assign', channel: 14, on: true },
      { kind: 'channel-main-assign', channel: 17, on: false }, // click OFF house
      { kind: 'channel-main-assign', channel: 18, on: false }, // cue OFF house
    ])
  })

  it('monitor-only WINS if a channel is shared (safety over convenience)', () => {
    const plan = xairFohSafetyPlan([route('original', [17]), route('click', [17])])
    expect(plan).toEqual([{ kind: 'channel-main-assign', channel: 17, on: false }])
  })
})

describe('verifyFohSafe', () => {
  const routes = [route('click', [17]), route('cue', [18]), route('original', [9, 10])]

  it('is SAFE only when every click/cue channel reads back OFF the main bus', () => {
    const readback = new Map<number, boolean>([
      [17, false],
      [18, false],
      [9, true],
      [10, true],
    ])
    expect(verifyFohSafe(routes, readback)).toEqual({ safe: true, unsafeChannels: [] })
  })

  it('is UNSAFE if a click/cue channel is still on the main bus', () => {
    const readback = new Map<number, boolean>([
      [17, true], // click still going to the house!
      [18, false],
    ])
    expect(verifyFohSafe(routes, readback)).toEqual({ safe: false, unsafeChannels: [17] })
  })

  it('treats an UNREAD channel as UNSAFE — never claims safe without proof', () => {
    expect(verifyFohSafe(routes, new Map())).toEqual({ safe: false, unsafeChannels: [17, 18] })
  })
})

// ── Per-performer monitor mixes (aux-bus sends) ───────────────────────────────

describe('buildXAirBusSends', () => {
  const routes = [route('stem:vocals.wav', [13, 14]), route('click', [17])]

  it('sends each lane level (via the fader law) to its channels on the performer bus', () => {
    const mixes: XAirMonitorMix[] = [
      { performerId: 'p1', bus: 3, sends: { 'stem:vocals.wav': 1.0, click: 0.5 }, master: 1.0 },
    ]
    const writes = buildXAirBusSends(routes, mixes)
    expect(writes).toEqual([
      { kind: 'bus-send', channel: 13, bus: 3, value: xairFaderFromLinearGain(1.0) },
      { kind: 'bus-send', channel: 14, bus: 3, value: xairFaderFromLinearGain(1.0) },
      { kind: 'bus-send', channel: 17, bus: 3, value: xairFaderFromLinearGain(0.5) },
      { kind: 'bus-fader', bus: 3, value: xairFaderFromLinearGain(1.0) },
    ])
  })

  it('ignores out-of-range buses and unmapped lanes', () => {
    expect(buildXAirBusSends(routes, [{ performerId: 'x', bus: 7, sends: { click: 1 } }])).toEqual([])
    expect(
      buildXAirBusSends(routes, [{ performerId: 'x', bus: 2, sends: { 'stem:guitar.wav': 1 } }]),
    ).toEqual([])
  })

  it('diffXAirBusWrites re-sends only what changed', () => {
    const mixes: XAirMonitorMix[] = [{ performerId: 'p1', bus: 1, sends: { click: 1.0 } }]
    const first = diffXAirBusWrites(buildXAirBusSends(routes, mixes), new Map())
    expect(first.changed).toHaveLength(1)
    const second = diffXAirBusWrites(buildXAirBusSends(routes, mixes), first.nextState)
    expect(second.changed).toHaveLength(0)
  })
})
