/**
 * The split's desk writes, pinned. Wrong rtnsrc numbering (it is ZERO-based),
 * a missing zero-pad, or a stray fader write are all mistakes that reach a
 * live PA — cheaper to catch here.
 */
import { describe, expect, it } from 'vitest'
import { liveRigLayout } from './liveRigPlan'
import {
  buildSplitBusSends,
  buildSplitStripWrites,
  SPLIT_SEND_START,
  seedableSplitSends,
  splitSendPath,
  splitSendReadPlan,
  splitStrips,
  splitVerifyPlan,
} from './splitRouting'

const MULTI = liveRigLayout({
  profileRequest: 'multichannel',
  deviceChannels: 18,
  firstDeskChannel: 9,
})

describe('which strips the split claims', () => {
  it('multichannel at first-channel 9: click on strip 11 (USB 3), cue on strip 12 (USB 4)', () => {
    expect(splitStrips(MULTI)).toEqual([
      { channel: 11, usbSource: 2, role: 'click' },
      { channel: 12, usbSource: 3, role: 'cue' },
    ])
  })

  it('stereo passthrough claims NOTHING — no strips, no writes, no verify', () => {
    const stereo = liveRigLayout({ profileRequest: 'stereo-passthrough', deviceChannels: 2 })
    expect(splitStrips(stereo)).toEqual([])
    expect(buildSplitStripWrites(stereo)).toEqual([])
    expect(splitVerifyPlan(stereo)).toEqual([])
  })
})

describe('the strip writes', () => {
  const writes = buildSplitStripWrites(MULTI)

  it('per strip: USB switch on, ZERO-based return source, off house, strip on', () => {
    const clickWrites = writes.filter((w) => w.address.startsWith('/ch/11/'))
    expect(clickWrites.map((w) => [w.address, w.value])).toEqual([
      ['/ch/11/preamp/rtnsw', 1],
      ['/ch/11/config/rtnsrc', 2], // web-audio channel 2 = USB 3, zero-based on the desk
      ['/ch/11/mix/lr', 0],
      ['/ch/11/mix/on', 1],
    ])
  })

  it('zero-pads single-digit strips (the desk silently ignores unpadded addresses)', () => {
    const low = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18, firstDeskChannel: 1 })
    const addrs = buildSplitStripWrites(low).map((w) => w.address)
    expect(addrs.some((a) => a.startsWith('/ch/03/'))).toBe(true)
    expect(addrs.some((a) => a.includes('/ch/3/'))).toBe(false)
  })

  it('SAFETY: configuration only — no write can raise a level', () => {
    for (const w of writes) {
      expect(w.address, 'no fader writes').not.toMatch(/fader/)
      expect(w.address, 'no bus masters').not.toMatch(/^\/bus\//)
    }
  })

  it('every write says why, in stage language', () => {
    for (const w of writes) expect(w.why.length).toBeGreaterThan(10)
  })
})

describe('the starting monitor sends', () => {
  it('each strip feeds each ASSIGNED performer bus, at the modest start level', () => {
    const sends = buildSplitBusSends(MULTI, [
      { name: 'Martin', monitorBus: 1 },
      { name: 'Thor', monitorBus: 2 },
      { name: 'Emma', monitorBus: null }, // no bus assigned yet → no send
    ])
    expect(sends).toHaveLength(4) // 2 strips × 2 assigned performers
    for (const s of sends) expect(s.value).toBe(SPLIT_SEND_START)
    expect(SPLIT_SEND_START).toBeLessThan(0.75) // below unity into ears, always
  })
})

describe('the proof read-back', () => {
  it('verifies switch, source and house-off for every claimed strip', () => {
    expect(splitVerifyPlan(MULTI)).toEqual([
      { address: '/ch/11/preamp/rtnsw', expect: 1 },
      { address: '/ch/11/config/rtnsrc', expect: 2 },
      { address: '/ch/11/mix/lr', expect: 0 },
      { address: '/ch/12/preamp/rtnsw', expect: 1 },
      { address: '/ch/12/config/rtnsrc', expect: 3 },
      { address: '/ch/12/mix/lr', expect: 0 },
    ])
  })
})

describe('seed once, then never again — the band owns their click level', () => {
  const BAND = [
    { name: 'Martin', monitorBus: 1 },
    { name: 'Thor', monitorBus: 2 },
  ]
  const sends = buildSplitBusSends(MULTI, BAND)
  const at = (level: number) => [{ type: 'f', value: level }]

  it('addresses the desk with a ZERO-PADDED bus, like the desk expects', () => {
    expect(splitSendPath(11, 1)).toBe('/ch/11/mix/01/level')
    expect(splitSendReadPlan(sends)).toEqual([
      '/ch/11/mix/01/level',
      '/ch/11/mix/02/level',
      '/ch/12/mix/01/level',
      '/ch/12/mix/02/level',
    ])
  })

  it('seeds a bus the desk says has NOTHING there — silence reads as broken', () => {
    const desk = Object.fromEntries(splitSendReadPlan(sends).map((a) => [a, at(0)]))
    expect(seedableSplitSends(sends, desk)).toHaveLength(4)
  })

  it('THE BUG: leaves alone every send the band has already set', () => {
    // Martin turned his click down to 30% between songs. BarBro reconnecting
    // used to shove it back to 65% — on stage, silently, mid-set.
    const desk = Object.fromEntries(splitSendReadPlan(sends).map((a) => [a, at(0.3)]))
    expect(seedableSplitSends(sends, desk)).toEqual([])
  })

  it('seeds only the person who is new, not the whole band', () => {
    const desk: Record<string, { type: string; value: number }[]> = {
      '/ch/11/mix/01/level': at(0.42), // Martin has a click level
      '/ch/12/mix/01/level': at(0.55), // …and a cue level
      '/ch/11/mix/02/level': at(0), // Thor just got a bus — nothing there
      '/ch/12/mix/02/level': at(0),
    }
    const seeded = seedableSplitSends(sends, desk)
    expect(seeded.map((s) => `${s.channel}->${s.bus}`)).toEqual(['11->2', '12->2'])
    for (const s of seeded) expect(s.value).toBe(SPLIT_SEND_START)
  })

  it('an unanswered address counts as ALREADY SET — never write on a guess', () => {
    // Silence from the desk is not evidence that a send is missing, and
    // guessing wrong here writes over a person's monitor mix.
    expect(seedableSplitSends(sends, {})).toEqual([])
    expect(seedableSplitSends(sends, { '/ch/11/mix/01/level': at(0) })).toHaveLength(1)
  })

  it('treats a send pulled fully down as unseeded, not as a preference', () => {
    // A performer who wants NO click mutes or pulls to zero; that is
    // indistinguishable from never-set, and seeding an audible level is the
    // safer of the two errors — silent ears at a gig is the worse one.
    const desk = Object.fromEntries(splitSendReadPlan(sends).map((a) => [a, at(0.005)]))
    expect(seedableSplitSends(sends, desk)).toHaveLength(4)
  })
})
