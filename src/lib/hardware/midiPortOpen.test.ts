/**
 * "The APC lights up but the buttons do nothing" — pinned.
 *
 * Reported after almost every rehearsal, never at home. Outputs were opened
 * explicitly (LEDs perfect); inputs were only `addEventListener`'d, which does
 * NOT open a Web MIDI port. A connected-but-closed port delivers nothing, in
 * silence, while every status indicator says the controller is there.
 */
import { describe, expect, it } from 'vitest'
import { isPortLive, portsNeedingOpen } from './midiPortOpen'

const port = (state: string, connection: string) => ({ state, connection })

describe('a connected port is not a working port', () => {
  it('THE BUG: a plugged-in but unopened input needs opening', () => {
    const closed = port('connected', 'closed')
    expect(portsNeedingOpen([closed])).toEqual([closed])
    expect(isPortLive(closed)).toBe(false)
  })

  it('leaves an already-open port alone', () => {
    expect(portsNeedingOpen([port('connected', 'open')])).toEqual([])
    expect(isPortLive(port('connected', 'open'))).toBe(true)
  })

  it('never tries to open a port whose hardware is gone', () => {
    // Opening a disconnected port throws in some browsers; unplugged is not a
    // fault to fix, it is a cable to plug in.
    expect(portsNeedingOpen([port('disconnected', 'closed')])).toEqual([])
    expect(isPortLive(port('disconnected', 'open'))).toBe(false)
  })

  it('treats "pending" as not open — the state between the two', () => {
    expect(portsNeedingOpen([port('connected', 'pending')])).toHaveLength(1)
    expect(isPortLive(port('connected', 'pending'))).toBe(false)
  })

  it('THE REPLUG CASE: the same port object comes back closed and must reopen', () => {
    // Ports are cached so a listener is not bound twice. But unplug/replug
    // returns the SAME object with `connection` reset — so opening must be
    // decided per refresh, never once at bind time, or the buttons stay dead
    // until a page reload.
    const p = port('connected', 'open')
    expect(portsNeedingOpen([p])).toEqual([])
    p.connection = 'closed' // the replug
    expect(portsNeedingOpen([p])).toEqual([p])
  })

  it('picks only the dead ones out of a mixed rig', () => {
    const dead = port('connected', 'closed')
    const alive = port('connected', 'open')
    const gone = port('disconnected', 'closed')
    expect(portsNeedingOpen([alive, dead, gone])).toEqual([dead])
  })

  it('is safe on nothing at all', () => {
    expect(portsNeedingOpen([])).toEqual([])
    expect(isPortLive(null)).toBe(false)
    expect(isPortLive(undefined)).toBe(false)
  })
})
