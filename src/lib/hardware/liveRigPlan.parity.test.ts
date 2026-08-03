/**
 * PARITY — the new plan reproduces the old behaviour, channel for channel.
 *
 * `liveRigPlan` replaces `liveOutputMap`, and the replacement has to be provably
 * behaviour-preserving before anything is deleted. This is the same technique
 * CLAUDE.md invariant 3 uses to keep `songTimings` locked to
 * `songPlaybackPlan`: assert one is a projection of the other, so they cannot
 * drift apart during the migration.
 *
 * There is exactly ONE intentional divergence, asserted below rather than
 * hidden: how many channels the destination is opened with.
 */
import { describe, expect, it } from 'vitest'
import { liveOutputMap } from '$lib/audio/liveOutputMap'
import { liveRigLayout, outputChannelsForLane } from './liveRigPlan'

describe('multichannel: the same lanes on the same channels', () => {
  it('song on 0/1, click on 2, cue on 3 — both modules agree', () => {
    for (const device of [4, 6, 8, 18]) {
      const old = liveOutputMap(device, { enabled: true })
      const next = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: device })
      expect(old.split).toBe(true)
      expect(outputChannelsForLane(next, 'original')).toEqual(old.channels.song)
      expect(outputChannelsForLane(next, 'click')).toEqual(old.channels.click)
      expect(outputChannelsForLane(next, 'cue')).toEqual(old.channels.cue)
    }
  })
})

describe('stereo: everything mixed, exactly as it ships today', () => {
  it('every lane lands on the stereo pair', () => {
    const old = liveOutputMap(18, { enabled: false })
    const next = liveRigLayout({ profileRequest: 'stereo-passthrough', deviceChannels: 18 })
    expect(old.split).toBe(false)
    for (const lane of ['original', 'click', 'cue', 'stem:bass.wav']) {
      expect(outputChannelsForLane(next, lane)).toEqual(old.channels[lane === 'click' ? 'click' : lane === 'cue' ? 'cue' : 'song'])
    }
  })

  it('a two-channel device cannot split, in either module', () => {
    const old = liveOutputMap(2, { enabled: true })
    const next = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 2 })
    expect(old.split).toBe(false)
    expect(next.profile).toBe('stereo-passthrough')
    expect(outputChannelsForLane(next, 'click')).toEqual(old.channels.click)
  })

  it('three channels is not enough for either', () => {
    expect(liveOutputMap(3, { enabled: true }).split).toBe(false)
    expect(liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 3 }).profile).toBe(
      'stereo-passthrough',
    )
  })
})

describe('THE ONE INTENTIONAL DIVERGENCE', () => {
  it('the old module opened EVERY channel; the new one opens exactly four', () => {
    // `channelCount: max` asked CoreAudio for an 18-channel stream to use four
    // of them, and is the prime suspect for the silence that followed when the
    // split was switched on. Opening what is needed is the fix, so parity is
    // deliberately NOT asserted here — the difference is the point.
    const old = liveOutputMap(18, { enabled: true })
    const next = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18 })
    expect(old.channelCount).toBe(18)
    expect(next.requiredOutputChannels).toBe(4)
  })
})
