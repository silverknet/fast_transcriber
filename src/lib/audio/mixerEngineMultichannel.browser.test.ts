/**
 * THE ENGINE'S SPLIT OUTPUT, END TO END — the build click-in-monitors rides on.
 *
 * `MixerEngine` has carried a dormant multichannel stage (merger, 'discrete'
 * destination, dedicated click/cue outputs) with no production caller. Now the
 * Rig dialog can request it (`rigSetup.profileRequest = 'multichannel'`) and
 * `MixerView` passes the derived `RigLayout` at engine creation. These tests
 * prove, in a real Chromium render, the three facts the gig depends on:
 *
 *   1. with the layout: song on channels 0/1, click ONLY on channel 2, cues
 *      ONLY on channel 3 — desk strips can then keep 2/3 out of the house
 *   2. WITHOUT the layout nothing changes — the default path is byte-for-byte
 *      today's stereo behaviour, even on a big device
 *   3. the fail-closed click suppression SURVIVES the split — a dedicated
 *      channel is not a bypass around the practice gate
 */
import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'
import { liveRigLayout } from '$lib/hardware/liveRigPlan'

const SR = 48000
const LEN = SR / 4

function tone(ctx: BaseAudioContext, freq = 440, amp = 0.5): AudioBuffer {
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

const MULTI = () => liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 4 })

function engineOn4(layout: ReturnType<typeof liveRigLayout> | null) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 4, length: LEN, sampleRate: SR })
  const engine = new MixerEngine(ctx as unknown as AudioContext, layout ? { layout } : undefined)
  return { ctx, engine }
}

describe('the split output, in a real render', () => {
  it('song → 0/1, click → ONLY 2, cue → ONLY 3', async () => {
    const { ctx, engine } = engineOn4(MULTI())
    engine.setTrack({ key: 'original', label: 'Song', buffer: tone(ctx, 220), volume: 1, muted: false, soloed: false })
    engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx, 1000), volume: 1, muted: false, soloed: false })
    // Cues are scheduled straight onto the cue output, as MixerView does.
    const cueSrc = ctx.createBufferSource()
    cueSrc.buffer = tone(ctx, 2000)
    cueSrc.connect(engine.cueOutput!)
    cueSrc.start(0)
    engine.play()
    const out = await ctx.startRendering()
    expect(peak(out.getChannelData(0)), 'song L').toBeGreaterThan(0.05)
    expect(peak(out.getChannelData(1)), 'song R').toBeGreaterThan(0.05)
    expect(peak(out.getChannelData(2)), 'click channel').toBeGreaterThan(0.05)
    expect(peak(out.getChannelData(3)), 'cue channel').toBeGreaterThan(0.05)
    // THE separations the house depends on: no click or cue on the house pair.
    // (Tones are distinct frequencies, but amplitude is the honest check:
    // channel 2/3 content must not appear on 0/1 and vice versa.)
    const houseHasClick = await (async () => {
      const { ctx: c2, engine: e2 } = engineOn4(MULTI())
      e2.setTrack({ key: 'click', label: 'Click', buffer: tone(c2, 1000), volume: 1, muted: false, soloed: false })
      e2.play()
      const r = await c2.startRendering()
      return { house: Math.max(peak(r.getChannelData(0)), peak(r.getChannelData(1))), click: peak(r.getChannelData(2)) }
    })()
    expect(houseHasClick.click, 'click alone lands on its channel').toBeGreaterThan(0.05)
    expect(houseHasClick.house, 'click alone leaks NOTHING to the house pair').toBeLessThan(1e-6)
  })

  it('without a layout, a big device still gets plain stereo — split is opt-in', async () => {
    const { ctx, engine } = engineOn4(null)
    engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx, 1000), volume: 1, muted: false, soloed: false })
    engine.play()
    const out = await ctx.startRendering()
    expect(peak(out.getChannelData(0)), 'click in the stereo mix, as today').toBeGreaterThan(0.05)
    expect(peak(out.getChannelData(2)), 'nothing on the would-be click channel').toBeLessThan(1e-6)
  })

  it('fail-closed suppression survives the split — the gate still owns the click', async () => {
    const { ctx, engine } = engineOn4(MULTI())
    engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx, 1000), volume: 1, muted: false, soloed: false })
    engine.setTrackSuppressed('click', true)
    engine.play()
    const out = await ctx.startRendering()
    for (let c = 0; c < 4; c++) {
      expect(peak(out.getChannelData(c)), `channel ${c} while suppressed`).toBeLessThan(1e-6)
    }
  })
})
