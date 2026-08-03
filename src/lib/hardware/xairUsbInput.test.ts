/**
 * Pointing the desk at BarBro's multichannel output.
 *
 * Click and cues need their own STRIPS, not their own levels on a strip shared
 * with the song. Sharing means taking the click off the house takes the song
 * with it — which is the bug this whole design exists to remove.
 */
import { describe, expect, it } from 'vitest'
import { liveOutputMap } from '$lib/audio/liveOutputMap'
import {
  USB_LEFT_SOURCE,
  USB_RIGHT_SOURCE,
  barbroPairReady,
  liveUsbPlan,
  readChannelInput,
  usbSourcePath,
  usbSwitchPath,
  usbWritesFor,
} from './xairUsbInput'

// The split layout is opt-in at runtime; these tests are about what it
// produces WHEN enabled, so they ask for it directly.
const usb = liveOutputMap(18, { enabled: true }).channels

describe('the two USB settings, verified on a real XR18V2', () => {
  it('builds the addresses the desk actually answers', () => {
    // `rtnsw` is the socket/USB switch; `rtnsrc` picks WHICH USB channel.
    // `insrc` is a different setting (analog socket selection) and mistaking
    // one for the other produced total silence with everything looking right.
    expect(usbSwitchPath(9)).toBe('/ch/09/preamp/rtnsw')
    expect(usbSourcePath(11)).toBe('/ch/11/config/rtnsrc')
  })

  it('writes the SOURCE before the switch', () => {
    // Flipping the switch first would briefly pass whatever USB channel the
    // strip was previously pointed at — a pop in someone's in-ears.
    const w = usbWritesFor(9, USB_LEFT_SOURCE)
    expect(w[0]!.address).toBe(usbSourcePath(9))
    expect(w[1]!.address).toBe(usbSwitchPath(9))
    expect(w[1]!.value).toBe(1)
  })
})

describe('reading what a channel is listening to', () => {
  const replies = (sw: number, src: number) => ({
    [usbSwitchPath(9)]: [{ type: 'i' as const, value: sw }],
    [usbSourcePath(9)]: [{ type: 'i' as const, value: src }],
  })

  it('reports USB and which channel, one-based for humans', () => {
    const c = readChannelInput(9, replies(1, 0))
    expect(c.fromUsb).toBe(true)
    expect(c.usbChannel).toBe(1)
  })

  it('a silent desk is MISSING, never "on the socket"', () => {
    // Assuming a default here would let the rig report itself ready when the
    // desk had said nothing at all.
    const c = readChannelInput(9, {})
    expect(c.missing).toBe(true)
    expect(c.fromUsb).toBeNull()
  })
})

describe('is the pair actually ready', () => {
  const chan = (channel: number, fromUsb: boolean | null, usbChannel: number | null) => ({
    channel,
    fromUsb,
    usbChannel,
    missing: false,
  })

  it('ready when both are on USB 1 and 2', () => {
    const r = barbroPairReady(chan(9, true, 1), chan(10, true, 2))
    expect(r.ok).toBe(true)
  })

  it('catches the DEFAULT trap: on USB, but the wrong USB channels', () => {
    // The desk ships 1:1, so ch 9 listens to USB 9 — where nothing is playing.
    // Silent, and indistinguishable from "not set up" unless the reason names
    // which USB channel it is actually on.
    const r = barbroPairReady(chan(9, true, 9), chan(10, true, 10))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/USB 9\/10/)
  })

  it('is not ready when either channel is on its socket', () => {
    expect(barbroPairReady(chan(9, true, 1), chan(10, false, 2)).ok).toBe(false)
  })

  it('a missing reply is never ready', () => {
    const missing = { channel: 9, fromUsb: null, usbChannel: null, missing: true }
    expect(barbroPairReady(missing, chan(10, true, 2)).ok).toBe(false)
  })
})

describe('the full live layout', () => {
  it('puts song, click and cue on four consecutive strips', () => {
    expect(liveUsbPlan(9, usb)?.deskChannels).toEqual({ song: [9, 10], click: [11], cue: [12] })
  })

  it('feeds each strip from the USB channel BarBro actually sends it on', () => {
    // Both sides derive from ONE source (`liveOutputMap`), so they cannot drift.
    expect(liveUsbPlan(9, usb)?.writes).toEqual([
      { channel: 9, usbSource: USB_LEFT_SOURCE, lane: 'song' },
      { channel: 10, usbSource: USB_RIGHT_SOURCE, lane: 'song' },
      { channel: 11, usbSource: 2, lane: 'click' },
      { channel: 12, usbSource: 3, lane: 'cue' },
    ])
  })

  it('refuses a layout that runs off the end of the desk', () => {
    // Sixteen strips. Truncating would write to channels the XR18 does not
    // have — ignored in silence, so the cue would simply never arrive.
    expect(liveUsbPlan(14, usb)).toBeNull()
    expect(liveUsbPlan(13, usb)?.deskChannels.cue).toEqual([16])
  })

  it('rejects a nonsense starting channel', () => {
    for (const n of [0, -2, 2.5]) expect(liveUsbPlan(n, usb)).toBeNull()
  })

  it('every strip in the plan gets a distinct USB source', () => {
    const w = liveUsbPlan(9, usb)!.writes
    expect(new Set(w.map((x) => x.usbSource)).size).toBe(w.length)
    expect(new Set(w.map((x) => x.channel)).size).toBe(w.length)
  })
})
