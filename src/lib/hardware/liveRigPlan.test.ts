/**
 * The live signal chain.
 *
 * Every test here corresponds to a real defect found in this repository. The
 * chain was described in six places that nothing forced to agree, and they
 * drifted until the desk was taking a silent channel off the house while the
 * actual click went to the PA. These lock the properties that make that
 * unrepresentable rather than merely unlikely.
 */
import { describe, expect, it } from 'vitest'
import {
  MONITOR_BUS_COUNT,
  XAIR_MAX_CHANNEL,
  channelsForProfile,
  clickIsOutOfHouse,
  liveRigLayout,
  outputChannelsForLane,
  resolveRigProfile,
  slotForLane,
  slotsOffHouse,
  slotsOnHouse,
  usbWritePlan,
  type RigProfile,
} from './liveRigPlan'

const ALL: RigProfile[] = ['stereo-passthrough', 'stereo-sum', 'multichannel']
const band = [
  { id: 'a', name: 'Martin', monitorBus: 1 },
  { id: 'b', name: 'Thor', monitorBus: 2 },
  { id: 'c', name: 'Emma', monitorBus: 3 },
]

describe('THE INVARIANT — the two sides of the USB link cannot disagree', () => {
  it('desk channel, USB source and output channel all come from one index', () => {
    // This is the whole cure. `liveOutputMap` said click leaves on output 2
    // while `defaultXAirChannelsForLane` said it arrives on desk 15; both
    // shipped, and neither knew about the other.
    for (const profile of ALL) {
      for (const first of [1, 5, 9, 12]) {
        const layout = liveRigLayout({ profileRequest: profile, deviceChannels: 18, firstDeskChannel: first })
        for (const s of layout.slots) {
          expect(s.deskChannel).toBe(first + s.webAudioChannel)
          expect(s.usbSource).toBe(s.webAudioChannel)
        }
      }
    }
  })

  it('the USB plan is a projection of the slots, not a second opinion', () => {
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18 })
    expect(usbWritePlan(layout)).toEqual(
      layout.slots.map((s) => ({ channel: s.deskChannel, usbSource: s.usbSource })),
    )
  })
})

describe('INJECTIVITY — one channel, one meaning', () => {
  it('no two slots ever share a desk channel', () => {
    // The old default table was not injective: `stem:other` claimed 15 and 16,
    // which were also click and cue. So the FOH rule fired on channels that
    // meant two different things and pulled part of the band off the PA.
    for (const profile of ALL) {
      for (const first of [1, 9, 13]) {
        const layout = liveRigLayout({ profileRequest: profile, deviceChannels: 18, firstDeskChannel: first })
        const desk = layout.slots.map((s) => s.deskChannel)
        const web = layout.slots.map((s) => s.webAudioChannel)
        const usb = layout.slots.map((s) => s.usbSource)
        expect(new Set(desk).size).toBe(desk.length)
        expect(new Set(web).size).toBe(web.length)
        expect(new Set(usb).size).toBe(usb.length)
      }
    }
  })

  it('a channel is either on the house or off it, never both', () => {
    for (const profile of ALL) {
      const layout = liveRigLayout({ profileRequest: profile, deviceChannels: 18 })
      const on = new Set(slotsOnHouse(layout))
      for (const ch of slotsOffHouse(layout)) expect(on.has(ch)).toBe(false)
    }
  })
})

describe('keeping the click out of the room', () => {
  it('multichannel gives click and cues their own channels, off the house', () => {
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18, firstDeskChannel: 9 })
    expect(layout.slots.map((s) => s.deskChannel)).toEqual([9, 10, 11, 12])
    expect(slotsOnHouse(layout)).toEqual([9, 10])
    expect(slotsOffHouse(layout)).toEqual([11, 12])
    expect(clickIsOutOfHouse(layout)).toBe(true)
  })

  it('stereo-sum separates the click on TWO channels, at the cost of a mono song', () => {
    const layout = liveRigLayout({ profileRequest: 'stereo-sum', deviceChannels: 2, firstDeskChannel: 9 })
    expect(layout.profile).toBe('stereo-sum')
    expect(slotsOnHouse(layout)).toEqual([9])
    expect(slotsOffHouse(layout)).toEqual([10])
    expect(clickIsOutOfHouse(layout)).toBe(true)
  })

  it('passthrough admits the click CANNOT be kept out — it does not pretend', () => {
    // The honest failure. Claiming safety here is what made the FOH check
    // protect two channels that carried the click it was meant to exclude.
    const layout = liveRigLayout({ profileRequest: 'stereo-passthrough', deviceChannels: 2 })
    expect(clickIsOutOfHouse(layout)).toBe(false)
    expect(slotsOffHouse(layout)).toEqual([])
  })
})

describe('degrading without lying', () => {
  it('asks for multichannel on a laptop and gets told why not', () => {
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 2 })
    expect(layout.profile).toBe('stereo-passthrough')
    expect(layout.reason).toMatch(/2 channels/)
    expect(layout.reason).toMatch(/sound output/)
  })

  it('honours the request when the device can do it', () => {
    expect(resolveRigProfile('multichannel', 4)).toEqual({ profile: 'multichannel', reason: '' })
    expect(resolveRigProfile('multichannel', 3).profile).toBe('stereo-passthrough')
  })

  it('opens EXACTLY what is needed, never the whole device', () => {
    // `channelCount: max` opened all 18 to use four, and is the prime suspect
    // for the silence that followed.
    expect(liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18 }).requiredOutputChannels).toBe(4)
    expect(liveRigLayout({ profileRequest: 'stereo-sum', deviceChannels: 18 }).requiredOutputChannels).toBe(2)
    expect(channelsForProfile('multichannel')).toBe(4)
  })

  it('defaults to the behaviour that ships today when nothing is asked for', () => {
    const layout = liveRigLayout()
    expect(layout.profile).toBe('stereo-passthrough')
    expect(layout.requiredOutputChannels).toBe(2)
  })
})

describe('refusing what the desk cannot do', () => {
  it('says so rather than truncating past channel 16', () => {
    // X-Air ignores addresses it does not have — silently, no reply, no error.
    // A truncated layout is a cue that simply never arrives.
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18, firstDeskChannel: 14 })
    expect(layout.problems.join(' ')).toMatch(/stops at 16/)
    expect(layout.problems.join(' ')).toMatch(/channel 13 or lower/)
  })

  it('fits exactly at the top of the strip', () => {
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18, firstDeskChannel: 13 })
    expect(layout.slots.map((s) => s.deskChannel)).toEqual([13, 14, 15, 16])
    expect(layout.problems).toEqual([])
    expect(XAIR_MAX_CHANNEL).toBe(16)
  })

  it('falls back to a sane channel when given nonsense', () => {
    for (const bad of [0, -4, 2.5]) {
      const layout = liveRigLayout({ firstDeskChannel: bad })
      expect(layout.slots[0]!.deskChannel).toBe(9)
      expect(layout.problems.join(' ')).toMatch(/not a channel/)
    }
  })
})

describe('monitors', () => {
  it('sorts the band by bus and keeps their names', () => {
    const layout = liveRigLayout({ performers: [band[2]!, band[0]!, band[1]!] })
    expect(layout.monitors.map((m) => m.bus)).toEqual([1, 2, 3])
    expect(layout.monitors.map((m) => m.name)).toEqual(['Martin', 'Thor', 'Emma'])
    expect(layout.problems).toEqual([])
  })

  it('names both people when two share a bus', () => {
    // Turning one down turns the other down, and neither can be fixed without
    // moving someone — so it is a problem, not a preference.
    const layout = liveRigLayout({
      performers: [
        { id: 'a', name: 'Martin', monitorBus: 2 },
        { id: 'b', name: 'Thor', monitorBus: 2 },
      ],
    })
    expect(layout.problems.join(' ')).toMatch(/Martin and Thor/)
    expect(layout.problems.join(' ')).toMatch(/different mixes/)
    expect(layout.monitors).toHaveLength(1)
  })

  it('refuses a bus the desk does not have', () => {
    const layout = liveRigLayout({ performers: [{ id: 'a', name: 'Guest', monitorBus: 7 }] })
    expect(layout.problems.join(' ')).toMatch(/this desk has 6/)
    expect(layout.monitors).toEqual([])
    expect(MONITOR_BUS_COUNT).toBe(6)
  })

  it('says in words that a seventh performer cannot have their own mix', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      monitorBus: i < 6 ? i + 1 : null,
    }))
    const layout = liveRigLayout({ performers: seven })
    expect(layout.problems.join(' ')).toMatch(/7 performers and only 6/)
  })

  it('a performer with no bus is not a problem on their own', () => {
    const layout = liveRigLayout({ performers: [{ id: 'a', name: 'Martin', monitorBus: null }] })
    expect(layout.problems).toEqual([])
    expect(layout.monitors).toEqual([])
  })
})

describe('which slot a lane enters — the per-song projection', () => {
  it('click takes its own channel when there is one', () => {
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18 })
    expect(slotForLane(layout, 'click')!.role).toBe('click')
    expect(outputChannelsForLane(layout, 'click')).toEqual([2])
    expect(outputChannelsForLane(layout, 'cue')).toEqual([3])
    expect(outputChannelsForLane(layout, 'stem:bass.wav')).toEqual([0, 1])
  })

  it('click and cue SHARE the monitor channel under stereo-sum', () => {
    const layout = liveRigLayout({ profileRequest: 'stereo-sum', deviceChannels: 2 })
    expect(outputChannelsForLane(layout, 'click')).toEqual([1])
    expect(outputChannelsForLane(layout, 'cue')).toEqual([1])
    expect(outputChannelsForLane(layout, 'original')).toEqual([0])
  })

  it('falls back to the programme rather than routing to nothing', () => {
    // Audible and mixed in beats silent on a channel that does not exist.
    const layout = liveRigLayout({ profileRequest: 'stereo-passthrough', deviceChannels: 2 })
    expect(outputChannelsForLane(layout, 'click')).toEqual([0, 1])
    expect(slotForLane(layout, 'click')!.role).toBe('program')
  })

  it('the layout does not change when a different song is loaded', () => {
    // The layout is the electrical contract for the SET. Making it a function
    // of the open song would re-write rtnsrc on live channels mid-show.
    const a = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18, performers: band })
    const b = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18, performers: band })
    expect(a.slots).toEqual(b.slots)
  })
})
