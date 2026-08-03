/**
 * Which sound card BarBro is playing to.
 *
 * Measured on the real machine: with the XR18 selected Chromium reports
 * `maxChannelCount: 18`; with the built-in speakers selected it reports 2 and
 * throws `IndexSizeError` on any attempt to open four channels. The desk answers
 * OSC perfectly either way — it is on the network, not the USB cable — so every
 * status light in the app stayed green while no audio arrived at all.
 */
import { describe, expect, it } from 'vitest'
import { describeOutputDevice } from './outputDevice'

describe('a rig-capable interface', () => {
  it('is happy at four channels or more', () => {
    const d = describeOutputDevice({ maxChannelCount: 18, label: 'XR18' })
    expect(d.canSeparate).toBe(true)
    expect(d.summary).toMatch(/XR18/)
    expect(d.summary).toMatch(/off the house/)
  })

  it('four is enough — song, click, cue', () => {
    expect(describeOutputDevice({ maxChannelCount: 4 }).canSeparate).toBe(true)
    expect(describeOutputDevice({ maxChannelCount: 3 }).canSeparate).toBe(false)
  })
})

describe('the expensive failure: playing to the laptop', () => {
  it('names the machine speakers and says what to do about it', () => {
    const d = describeOutputDevice({ maxChannelCount: 2, label: 'MacBook Air Speakers' })
    expect(d.looksBuiltIn).toBe(true)
    expect(d.canSeparate).toBe(false)
    // The fix, not the fault.
    expect(d.summary).toMatch(/not the mixer/)
    expect(d.summary).toMatch(/Choose the XR18/)
  })

  it('recognises the usual built-in names', () => {
    for (const name of [
      'MacBook Air Speakers',
      'Built-in Output',
      'MacBook Pro Speakers',
      'Headphones',
      'Speakers (Realtek(R) Audio)',
    ]) {
      expect(describeOutputDevice({ maxChannelCount: 2, label: name }).looksBuiltIn).toBe(true)
    }
  })

  it('does not call a real interface built-in just because it is stereo', () => {
    const d = describeOutputDevice({ maxChannelCount: 2, label: 'Scarlett 2i2 USB' })
    expect(d.looksBuiltIn).toBe(false)
    expect(d.summary).toMatch(/Scarlett 2i2 USB/)
    expect(d.summary).toMatch(/cannot be kept out of the house/)
  })
})

describe('when the browser will not name the device', () => {
  it('still says the useful half — the channel count', () => {
    // The label needs microphone permission, which is an absurd thing to ask a
    // musician for at load-in. The count needs nothing and matters more.
    const d = describeOutputDevice({ maxChannelCount: 2, label: null })
    expect(d.label).toBeNull()
    expect(d.summary).toMatch(/2 channels/)
    expect(d.summary).toMatch(/choose it as the computer's sound output/)
  })

  it('treats an empty label as no label', () => {
    expect(describeOutputDevice({ maxChannelCount: 2, label: '   ' }).label).toBeNull()
  })

  it('survives a nonsense channel count rather than claiming capability', () => {
    for (const n of [Number.NaN, -3, 0]) {
      expect(describeOutputDevice({ maxChannelCount: n }).canSeparate).toBe(false)
    }
  })
})
