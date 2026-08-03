/**
 * THE ENGINE BUILT FROM THE RIG LAYOUT.
 *
 * `liveRigPlan` is the one derivation of the live signal chain. These prove the
 * audio graph is genuinely built from it — that a lane's audio comes out on the
 * channel the layout says, in a real Web Audio render, not just in the plan
 * object.
 *
 * Rendered in an `OfflineAudioContext`, so this answers "is our graph right"
 * and deliberately NOT "will this machine drive the device" — a question no
 * render can answer, and the reason the hardware probe exists separately.
 */
import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'
import { liveRigLayout } from '$lib/hardware/liveRigPlan'

const SR = 48000

/** Peak level on one channel of a rendered buffer. */
function peak(buf: AudioBuffer, channel: number): number {
  if (channel >= buf.numberOfChannels) return 0
  const d = buf.getChannelData(channel)
  let m = 0
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

/** A short buffer of steady tone, for a lane to play. */
function tone(ctx: BaseAudioContext, seconds = 0.25): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(SR * seconds), SR)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5
  return buf
}

async function renderWithLayout(
  layout: ReturnType<typeof liveRigLayout>,
  channels: number,
  register: (engine: MixerEngine, ctx: OfflineAudioContext) => void,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length: SR / 4, sampleRate: SR })
  const engine = new MixerEngine(ctx as unknown as AudioContext, { layout })
  register(engine, ctx)
  engine.play()
  return await ctx.startRendering()
}

describe('multichannel: the layout decides, and the audio obeys', () => {
  it('puts the click on its own channel, clear of the song pair', async () => {
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18 })
    const rendered = await renderWithLayout(layout, 4, (engine, ctx) => {
      engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx), volume: 1, muted: false, soloed: false })
    })
    // Channel 2 is where the layout says the click leaves.
    expect(peak(rendered, 2)).toBeGreaterThan(0.05)
    // And nowhere near the song pair, which is the entire point: the desk
    // cannot take the click off the house while it rides inside the song.
    expect(peak(rendered, 0)).toBeLessThan(0.001)
    expect(peak(rendered, 1)).toBeLessThan(0.001)
  })

  it('keeps an ordinary lane on the song pair, off the click channel', async () => {
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18 })
    const rendered = await renderWithLayout(layout, 4, (engine, ctx) => {
      engine.setTrack({ key: 'original', label: 'Song', buffer: tone(ctx), volume: 1, muted: false, soloed: false })
    })
    expect(peak(rendered, 0)).toBeGreaterThan(0.05)
    expect(peak(rendered, 2)).toBeLessThan(0.001)
  })

  it('opens EXACTLY four channels, not the eighteen the device offers', async () => {
    // The old code set `channelCount: max`. Asking CoreAudio for an
    // eighteen-channel stream to place four is the prime suspect for the
    // silence that followed when separation was switched on.
    const layout = liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 18 })
    expect(layout.requiredOutputChannels).toBe(4)
    const ctx = new OfflineAudioContext({ numberOfChannels: 18, length: 128, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext, { layout })
    expect(engine.outputLayout?.channelCount).toBe(4)
  })
})

describe('stereo-sum: separation on a TWO channel device', () => {
  it('song on the left, click on the right — the old model could not express this', async () => {
    // `liveOutputMap` tied "split" to having four channels, so a two-channel
    // device could never keep the click off the house. The layout separates
    // them by summing the song to mono instead.
    const layout = liveRigLayout({ profileRequest: 'stereo-sum', deviceChannels: 2 })
    const rendered = await renderWithLayout(layout, 2, (engine, ctx) => {
      engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx), volume: 1, muted: false, soloed: false })
    })
    expect(peak(rendered, 1)).toBeGreaterThan(0.05)
    expect(peak(rendered, 0)).toBeLessThan(0.001)
  })
})

describe('passthrough: exactly what ships today', () => {
  it('the click is mixed into the song pair, audible on BOTH channels', async () => {
    // Not silence, and not one ear. An earlier version of `outputChannelsForLane`
    // returned only the first programme channel here, which would have put the
    // click in the left ear alone.
    const layout = liveRigLayout({ profileRequest: 'stereo-passthrough', deviceChannels: 2 })
    const rendered = await renderWithLayout(layout, 2, (engine, ctx) => {
      engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx), volume: 1, muted: false, soloed: false })
    })
    expect(peak(rendered, 0)).toBeGreaterThan(0.05)
    expect(peak(rendered, 1)).toBeGreaterThan(0.05)
  })

  it('offers no separate click output, rather than one that goes nowhere', () => {
    const layout = liveRigLayout({ profileRequest: 'stereo-passthrough', deviceChannels: 2 })
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 128, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext, { layout })
    expect(engine.clickOutput).toBeNull()
  })
})

describe('no layout injected', () => {
  it('behaves exactly as before, so existing callers are untouched', () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 128, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    expect(engine.outputLayout?.split).toBe(false)
    expect(engine.clickOutput).toBeNull()
  })
})
