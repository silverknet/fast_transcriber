/**
 * LIVE MODE FAILS CLOSED: click is silent on the main mix unless Practice is on.
 *
 * On a stereo output everything the engine plays reaches the house, so "the
 * click is for monitors" is only true if the click makes NO sound at all until
 * someone explicitly says otherwise. This locks the enforcement mechanism —
 * engine-level suppression — in a real render, where a UI-only gate cannot
 * fake it.
 *
 * The counterpart (suppression must NOT eat the click outside live mode, and
 * must lift when Practice is enabled) is asserted too: a safety gate that
 * cannot be opened is a broken feature wearing a halo.
 */
import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'

const SR = 48000

function tone(ctx: BaseAudioContext, seconds = 0.25): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(SR * seconds), SR)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5
  return buf
}

function peak(buf: AudioBuffer): number {
  let m = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  }
  return m
}

async function renderClick(configure: (engine: MixerEngine) => void): Promise<number> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR / 4, sampleRate: SR })
  const engine = new MixerEngine(ctx as unknown as AudioContext)
  engine.setTrack({
    key: 'click',
    label: 'Click',
    buffer: tone(ctx),
    volume: 1,
    muted: false,
    soloed: false,
  })
  configure(engine)
  engine.play()
  return peak(await ctx.startRendering())
}

describe('the live click gate, in a real render', () => {
  it('suppressed = truly silent on the output, whatever the mute state says', async () => {
    // What live mode does with Practice OFF. The click track is UNMUTED —
    // suppression must silence it anyway, because mute is the user's mix state
    // and the gate must not depend on it.
    const p = await renderClick((e) => e.setTrackSuppressed('click', true))
    expect(p).toBeLessThan(1e-6)
  })

  it('unsuppressed = audible — the gate can actually be opened', async () => {
    // Practice ON, and the editor always. A gate that cannot open is a broken
    // click feature, not a safety win.
    const p = await renderClick((e) => e.setTrackSuppressed('click', false))
    expect(p).toBeGreaterThan(0.05)
  })

  it('lifting the suppression restores the user’s saved state, not a guess', async () => {
    // Suppress then unsuppress: the track's own mute/volume must be exactly as
    // it was — suppression is a gate in front of the mix state, not a write to it.
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 128, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    engine.setTrack({
      key: 'click',
      label: 'Click',
      buffer: tone(ctx),
      volume: 0.7,
      muted: false,
      soloed: false,
    })
    engine.setTrackSuppressed('click', true)
    engine.setTrackSuppressed('click', false)
    const t = engine.listTracks().find((t) => t.key === 'click')!
    expect(t.muted).toBe(false)
    expect(t.volume).toBe(0.7)
  })

  it('suppressing the click leaves the song alone', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR / 4, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    engine.setTrack({ key: 'original', label: 'Song', buffer: tone(ctx), volume: 1, muted: false, soloed: false })
    engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx), volume: 1, muted: false, soloed: false })
    engine.setTrackSuppressed('click', true)
    engine.play()
    expect(peak(await ctx.startRendering())).toBeGreaterThan(0.05)
  })
})

describe('the Practice gesture, exactly as performed on the stage', () => {
  /**
   * Reported: "no clicks in main even with the toggle red". The gesture is:
   * live mode (click suppressed) → press play → flip Practice ON mid-song.
   * The unsuppress happens against a RUNNING graph — this proves the gain
   * actually opens mid-play, not merely before play like the tests above.
   */
  it('unsuppressing MID-PLAY makes the click audible from that point on', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    engine.setTrack({
      key: 'click',
      label: 'Click',
      buffer: tone(ctx, 1),
      volume: 1,
      muted: false,
      soloed: false,
    })
    engine.setTrackSuppressed('click', true) // live default: fail closed
    engine.play()
    // Flip Practice ON a quarter of the way in.
    ctx.suspend(0.25).then(() => {
      engine.setTrackSuppressed('click', false)
      void ctx.resume()
    })
    const rendered = await ctx.startRendering()
    const d = rendered.getChannelData(0)
    const firstQuarter = d.slice(0, Math.floor(SR * 0.2))
    const after = d.slice(Math.floor(SR * 0.3))
    const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak(firstQuarter), 'click leaked while suppressed').toBeLessThan(1e-6)
    expect(peak(after), 'click stayed silent after Practice ON').toBeGreaterThan(0.05)
  })

  it('a MUTED click stays silent even with Practice on — the pill still owns it', async () => {
    // The other suspect for "no click with the toggle red": the click pill is
    // OFF (saved mute). Practice opens the gate; it does not override the mute.
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR / 2, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    engine.setTrack({ key: 'click', label: 'Click', buffer: tone(ctx), volume: 1, muted: true, soloed: false })
    engine.setTrackSuppressed('click', false)
    engine.play()
    const rendered = await ctx.startRendering()
    const d = rendered.getChannelData(0)
    expect(d.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(1e-6)
  })
})
