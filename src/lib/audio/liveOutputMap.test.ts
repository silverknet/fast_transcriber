/**
 * The output layout.
 *
 * Two ways to get this wrong, and they fail in opposite directions:
 *
 *  - Split when the hardware cannot: the click is placed on a channel that does
 *    not exist and silently vanishes — on a laptop, which is what most people
 *    use most of the time.
 *  - Refuse to split when it can: click stays mixed into the song's channels,
 *    and no amount of desk configuration can keep it out of the house.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_SPLIT_CHANNELS,
  liveOutputMap,
  suggestedDeskChannels,
  usbSourcesForLanes,
} from './liveOutputMap'

describe('stereo hardware keeps working exactly as before', () => {
  it('does not split on two channels', () => {
    const m = liveOutputMap(2, { enabled: true })
    expect(m.split).toBe(false)
    expect(m.channelCount).toBe(2)
    // Every lane on the stereo pair == today's behaviour, unchanged.
    expect(m.channels.song).toEqual([0, 1])
    expect(m.channels.click).toEqual([0, 1])
    expect(m.channels.cue).toEqual([0, 1])
  })

  it('says plainly that the click cannot be kept out of the house', () => {
    // The honest consequence, not a silent limitation.
    expect(liveOutputMap(2, { enabled: true }).summary).toMatch(/cannot be kept out of the front of house/i)
  })

  it('survives a mono or nonsense device without producing an impossible layout', () => {
    for (const n of [1, 0, -3, Number.NaN]) {
      const m = liveOutputMap(n, { enabled: true })
      expect(m.split).toBe(false)
      expect(m.channelCount).toBeGreaterThanOrEqual(1)
      expect(m.channelCount).toBeLessThanOrEqual(2)
    }
  })

  it('three channels is still not enough — the rig needs four', () => {
    // song(2) + click(1) + cue(1). Splitting at 3 would drop the cue.
    expect(liveOutputMap(3, { enabled: true }).split).toBe(false)
    expect(MIN_SPLIT_CHANNELS).toBe(4)
  })
})

describe('capable hardware separates the lanes', () => {
  it('splits at exactly four channels, not only on the XR18', () => {
    const m = liveOutputMap(4, { enabled: true })
    expect(m.split).toBe(true)
    expect(m.channels.song).toEqual([0, 1])
    expect(m.channels.click).toEqual([2])
    expect(m.channels.cue).toEqual([3])
  })

  it('opens every channel an XR18 offers', () => {
    const m = liveOutputMap(18, { enabled: true })
    expect(m.channelCount).toBe(18)
    expect(m.channels.click).toEqual([2])
  })

  it('never puts two lanes on the same channel when split', () => {
    // The whole point. Any overlap and the desk cannot separate them either.
    const m = liveOutputMap(18, { enabled: true })
    const used = [...m.channels.song, ...m.channels.click, ...m.channels.cue]
    expect(new Set(used).size).toBe(used.length)
  })

  it('every assigned channel exists on the device', () => {
    for (const n of [4, 6, 8, 18]) {
      const m = liveOutputMap(n, { enabled: true })
      for (const chans of Object.values(m.channels)) {
        for (const c of chans) expect(c).toBeLessThan(m.channelCount)
      }
    }
  })
})

describe('the desk side mirrors the BarBro side', () => {
  it('follows on from wherever the song pair lands', () => {
    // Song on 9/10 → click 11, cue 12. This is the layout on the real desk.
    expect(suggestedDeskChannels(9, liveOutputMap(18, { enabled: true }))).toEqual({
      song: [9, 10],
      click: [11],
      cue: [12],
    })
  })

  it('refuses a layout that runs off the end of the desk', () => {
    // The XR18 has sixteen strips. Silently truncating would put the cue on a
    // channel that does not exist — writes the desk ignores without complaint.
    expect(suggestedDeskChannels(15, liveOutputMap(18, { enabled: true }))).toBeNull()
    expect(suggestedDeskChannels(13, liveOutputMap(18, { enabled: true }))).toEqual({
      song: [13, 14],
      click: [15],
      cue: [16],
    })
  })

  it('offers nothing when the output cannot split', () => {
    expect(suggestedDeskChannels(9, liveOutputMap(2, { enabled: true }))).toBeNull()
  })

  it('rejects a nonsense starting channel', () => {
    expect(suggestedDeskChannels(0, liveOutputMap(18, { enabled: true }))).toBeNull()
    expect(suggestedDeskChannels(1.5, liveOutputMap(18, { enabled: true }))).toBeNull()
  })
})

describe('the two sides cannot drift', () => {
  it('the USB source a lane is read from IS the channel it was sent on', () => {
    // A mismatch here is silence with every setting apparently correct — which
    // is exactly the failure that cost an afternoon. One source of truth.
    const m = liveOutputMap(18, { enabled: true })
    expect(usbSourcesForLanes(m)).toEqual(m.channels)
  })
})

describe('separation is OPT-IN', () => {
  it('is OFF unless switched on, whatever the hardware can do', () => {
    // The default that matters. Splitting by default silenced real playback:
    // the path had only ever been proven in an offline render, and in front of a
    // real sound card it produced nothing at all. Sound that works beats
    // separation that might.
    const m = liveOutputMap(18, { enabled: false })
    expect(m.split).toBe(false)
    expect(m.channelCount).toBe(2)
    expect(m.channels.click).toEqual([0, 1])
  })

  it('says it is switched off rather than blaming the hardware', () => {
    expect(liveOutputMap(18, { enabled: false }).summary).toMatch(/switched off/i)
  })

  it('still splits when switched on and the hardware allows', () => {
    expect(liveOutputMap(18, { enabled: true }).split).toBe(true)
  })
})
