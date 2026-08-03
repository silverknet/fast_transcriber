/**
 * DISCRETE CHANNEL PLACEMENT — the mechanism click-in-monitors stands on.
 *
 * The plan: song leaves on output channels 0/1 (desk 9/10, the house pair),
 * click on channel 2, cues on channel 3 (desk strips off the house, sent to
 * the monitor buses). Before any engine work, this proves the underlying Web
 * Audio behaviour in a real Chromium render:
 *
 *   1. a source fed into merger input N comes out in channel N and NOWHERE else
 *   2. a stereo source on inputs 0/1 stays off the click channel
 *   3. the stereo→mono downmix trap: summing needs `channelInterpretation:
 *      'speakers'` on the SUM node while the destination stays 'discrete' —
 *      they are opposites, both load-bearing, and getting it backwards
 *      silently halves or loses part of the arrangement
 *
 * If these ever fail, no amount of desk routing can make monitors work — which
 * is exactly why they run offline, in CI, without an XR18 attached.
 */
import { describe, expect, it } from 'vitest'

const SR = 48000
const LEN = SR / 4

function tone(ctx: BaseAudioContext, freq: number, amp = 0.5): AudioBuffer {
  const buf = ctx.createBuffer(1, LEN, SR)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * freq * i) / SR) * amp
  return buf
}

function peak(d: Float32Array): number {
  let m = 0
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

function discreteCtx(channels: number): OfflineAudioContext {
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length: LEN, sampleRate: SR })
  ctx.destination.channelInterpretation = 'discrete'
  return ctx
}

function playInto(ctx: OfflineAudioContext, merger: ChannelMergerNode, buf: AudioBuffer, input: number) {
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(merger, 0, input)
  src.start(0)
}

describe('discrete output channels, in a real render', () => {
  it('a click on merger input 2 lands in channel 2 and NOWHERE else', async () => {
    const ctx = discreteCtx(4)
    const merger = ctx.createChannelMerger(4)
    merger.channelInterpretation = 'discrete'
    merger.connect(ctx.destination)
    playInto(ctx, merger, tone(ctx, 1000), 2)
    const out = await ctx.startRendering()
    expect(peak(out.getChannelData(2)), 'the click channel').toBeGreaterThan(0.4)
    expect(peak(out.getChannelData(0)), 'house L must stay silent').toBeLessThan(1e-6)
    expect(peak(out.getChannelData(1)), 'house R must stay silent').toBeLessThan(1e-6)
    expect(peak(out.getChannelData(3)), 'cue channel must stay silent').toBeLessThan(1e-6)
  })

  it('the song on inputs 0/1 never bleeds onto the click channel', async () => {
    const ctx = discreteCtx(4)
    const merger = ctx.createChannelMerger(4)
    merger.channelInterpretation = 'discrete'
    merger.connect(ctx.destination)
    playInto(ctx, merger, tone(ctx, 220), 0)
    playInto(ctx, merger, tone(ctx, 330), 1)
    const out = await ctx.startRendering()
    expect(peak(out.getChannelData(0))).toBeGreaterThan(0.4)
    expect(peak(out.getChannelData(1))).toBeGreaterThan(0.4)
    expect(peak(out.getChannelData(2)), 'click channel with no click').toBeLessThan(1e-6)
    expect(peak(out.getChannelData(3))).toBeLessThan(1e-6)
  })

  it('the downmix trap: a mono sum node gives 0.5·(L+R), not a truncated left channel', async () => {
    const ctx = discreteCtx(2)
    // Stereo buffer with DIFFERENT content per side: L = DC 0.8, R = DC 0.4.
    const buf = ctx.createBuffer(2, LEN, SR)
    buf.getChannelData(0).fill(0.8)
    buf.getChannelData(1).fill(0.4)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const sum = ctx.createGain()
    sum.channelCount = 1
    sum.channelCountMode = 'explicit'
    sum.channelInterpretation = 'speakers' // the load-bearing opposite
    src.connect(sum)
    sum.connect(ctx.destination)
    src.start(0)
    const out = await ctx.startRendering()
    const mid = out.getChannelData(0)[Math.floor(LEN / 2)]!
    // speakers downmix: 0.5·(0.8+0.4) = 0.6. 'discrete' would give 0.8 (R lost).
    expect(mid).toBeGreaterThan(0.55)
    expect(mid).toBeLessThan(0.65)
  })
})
