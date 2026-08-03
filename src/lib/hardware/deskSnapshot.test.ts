/**
 * Restoring the desk.
 *
 * These are written against a defect that was found on real hardware, not a
 * hypothetical: after pressing "Test aux 2", channels 9 and 10 fed aux 2 at
 * 0.669 and every other aux was at zero. Two of the three performers had
 * completely silent in-ears and there was no record of what their levels had
 * been, because bus sends were written but never read.
 */
import { describe, expect, it } from 'vitest'
import {
  busSendPath,
  busSendQueryPaths,
  canRestoreSends,
  restoreAllWrites,
  restoreWrites,
  withBusSends,
  withUsbInput,
} from './deskSnapshot'

const reply = (v: number) => [{ type: 'f', value: v }]

describe('the addresses the desk actually answers', () => {
  it('zero-pads the bus on a channel send', () => {
    // `/ch/09/mix/1/level` gets no reply at all — X-Air ignores addresses it
    // does not have, silently, so this failed as total silence.
    expect(busSendPath(9, 1)).toBe('/ch/09/mix/01/level')
    expect(busSendPath(12, 6)).toBe('/ch/12/mix/06/level')
  })

  it('asks about all six buses', () => {
    expect(busSendQueryPaths(9)).toHaveLength(6)
    expect(busSendQueryPaths(9)[5]).toBe('/ch/09/mix/06/level')
  })
})

describe('capturing what is about to be overwritten', () => {
  it('keeps every send the desk reported', () => {
    const snap = withBusSends({ fader: 0.75 }, 9, {
      [busSendPath(9, 1)]: reply(0.6),
      [busSendPath(9, 2)]: reply(0.669),
      [busSendPath(9, 3)]: reply(0),
      [busSendPath(9, 4)]: reply(0.4),
      [busSendPath(9, 5)]: reply(0.2),
      [busSendPath(9, 6)]: reply(0.1),
    })
    expect(snap.sends).toEqual({ 1: 0.6, 2: 0.669, 3: 0, 4: 0.4, 5: 0.2, 6: 0.1 })
    expect(snap.fader).toBe(0.75) // untouched
  })

  it('a bus that did not answer is LEFT OUT, never recorded as silence', () => {
    // This link genuinely drops UDP. Defaulting a missing reply to 0 would
    // "restore" a performer to silence and look like it worked.
    const snap = withBusSends({}, 9, { [busSendPath(9, 1)]: reply(0.6) })
    expect(snap.sends).toEqual({ 1: 0.6 })
    expect(snap.sends?.[2]).toBeUndefined()
  })

  it('never re-captures once taken', () => {
    // Asking again after the page has written would capture the page's OWN
    // values and restore the desk to the state it is being rescued from.
    const first = withBusSends({}, 9, { [busSendPath(9, 1)]: reply(0.6) })
    const second = withBusSends(first, 9, { [busSendPath(9, 1)]: reply(0) })
    expect(second.sends).toEqual({ 1: 0.6 })
  })

  it('captures the USB switch and source together, once', () => {
    const snap = withUsbInput({}, 0, 4)
    expect(snap).toMatchObject({ usbSwitch: 0, usbSource: 4 })
    expect(withUsbInput(snap, 1, 0)).toMatchObject({ usbSwitch: 0, usbSource: 4 })
  })
})

describe('putting it back', () => {
  it('restores the sends that the old code silently dropped', () => {
    // The regression. Before the fix this produced fader/on/lr only, and the
    // in-ear mixes stayed at zero forever.
    const writes = restoreWrites(9, {
      fader: 0.75,
      on: 1,
      lr: 1,
      sends: { 1: 0.6, 2: 0.669, 3: 0.5 },
    })
    const sends = writes.filter((w) => w.kind === 'bus-send')
    expect(sends).toHaveLength(3)
    expect(sends).toContainEqual({ kind: 'bus-send', channel: 9, bus: 1, value: 0.6 })
  })

  it('writes the USB source BEFORE the switch', () => {
    // Flipping the switch first briefly passes whichever USB channel the strip
    // was previously pointed at — a pop in six pairs of ears.
    const w = restoreWrites(9, { usbSwitch: 0, usbSource: 4 })
    const src = w.findIndex((x) => x.kind === 'usb-source')
    const sw = w.findIndex((x) => x.kind === 'usb-switch')
    expect(src).toBeGreaterThanOrEqual(0)
    expect(src).toBeLessThan(sw)
  })

  it('restores sends before raising the fader', () => {
    // Otherwise a restored send is briefly audible at the test level.
    const w = restoreWrites(9, { fader: 0.75, sends: { 1: 0.6 } })
    const send = w.findIndex((x) => x.kind === 'bus-send')
    const fader = w.findIndex((x) => x.kind === 'fader')
    // Both must EXIST. Comparing indexes alone passes vacuously when the send
    // is missing entirely (-1 < 0), which is the very bug being guarded.
    expect(send).toBeGreaterThanOrEqual(0)
    expect(fader).toBeGreaterThanOrEqual(0)
    expect(send).toBeLessThan(fader)
  })

  it('restores nothing for a field that was never read', () => {
    // A guess looks like a restore and is not.
    expect(restoreWrites(9, { fader: 0.75 })).toEqual([
      { kind: 'fader', channel: 9, value: 0.75 },
    ])
    expect(restoreWrites(9, undefined)).toEqual([])
    expect(restoreWrites(9, {})).toEqual([])
  })

  it('converts the desk numeric booleans back correctly', () => {
    expect(restoreWrites(9, { on: 1, lr: 0 })).toEqual([
      { kind: 'on', channel: 9, on: true },
      { kind: 'lr', channel: 9, on: false },
    ])
  })

  it('covers every touched channel', () => {
    const w = restoreAllWrites({ 9: { sends: { 1: 0.6 } }, 10: { sends: { 1: 0.6 } } })
    expect(new Set(w.map((x) => x.channel))).toEqual(new Set([9, 10]))
  })
})

describe('refusing to break what cannot be put back', () => {
  it('is only restorable when all six buses were read', () => {
    expect(canRestoreSends({ sends: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } })).toBe(true)
    expect(canRestoreSends({ sends: { 1: 0, 2: 0 } })).toBe(false)
    expect(canRestoreSends({ fader: 0.75 })).toBe(false)
    expect(canRestoreSends(undefined)).toBe(false)
  })
})
