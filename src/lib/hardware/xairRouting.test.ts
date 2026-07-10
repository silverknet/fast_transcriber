import { describe, expect, it } from 'vitest'
import {
  buildXAirLaneWrites,
  defaultXAirChannelsForLane,
  diffXAirLaneWrites,
  ensureXAirRoutesForLanes,
  parseXAirChannelList,
  xairDbToFader,
  xairFaderFromLinearGain,
  xairFaderToDb,
  xairLaneAudible,
  xairWriteSignature,
  type XAirLiveLane,
  type XAirLaneRoute,
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
      ['original', [17, 18]],
      ['cue', [16]],
      ['stem:vocals.wav', []],
    ])
    expect(defaultXAirChannelsForLane('click')).toEqual([15])
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
