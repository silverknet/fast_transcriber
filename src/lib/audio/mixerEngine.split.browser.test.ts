/**
 * DOES THE ENGINE ACTUALLY SEPARATE THE LANES?
 *
 * The promise the whole live rig rests on: click reaches the performers' ears
 * and never the house. That is only possible if the click leaves BarBro on its
 * own output channel — otherwise it rides inside the song's stereo pair, and
 * taking it off the main bus takes the song with it.
 *
 * Compiling is not evidence. These render the real `MixerEngine` output stage
 * into a real multichannel context and measure which channels carry what.
 */
import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'
import { liveOutputMap } from './liveOutputMap'

const SR = 48_000

function peak(buf: AudioBuffer, channel: number): number {
  if (channel >= buf.numberOfChannels) return 0
  const d = buf.getChannelData(channel)
  let m = 0
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

/**
 * A short tone into `node`, so we can see where it comes out.
 *
 * `stereo` matters and caught a bad test: a MONO oscillator into `masterGain`
 * fills only channel 0, so asserting the right-hand song channel failed while
 * the graph was perfectly correct. The song is genuinely stereo, so it is fed
 * as stereo; click and cues are genuinely mono.
 */
function feed(ctx: BaseAudioContext, node: AudioNode, gain = 0.5, stereo = false): void {
  const osc = ctx.createOscillator()
  osc.frequency.value = 440
  const g = ctx.createGain()
  g.gain.value = gain
  osc.connect(g)
  if (stereo) {
    const m = ctx.createChannelMerger(2)
    g.connect(m, 0, 0)
    g.connect(m, 0, 1)
    m.connect(node)
  } else {
    g.connect(node)
  }
  osc.start()
}

async function withEngine(
  channels: number,
  use: (engine: MixerEngine, ctx: OfflineAudioContext) => void,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: channels,
    length: SR / 4,
    sampleRate: SR,
  })
  localStorage.setItem('barbro::rig::multichannel', channels >= 4 ? '1' : '0')
  const engine = new MixerEngine(ctx as unknown as AudioContext)
  use(engine, ctx)
  const buf = await ctx.startRendering()
  await engine.dispose()
  return buf
}

describe('on a multichannel device', () => {
  it('gives the click and the cues their own outputs', async () => {
    const buf = await withEngine(18, (engine, ctx) => {
      expect(engine.outputLayout?.split).toBe(true)
      feed(ctx, engine.clickOutput!, 0.5)
      feed(ctx, engine.cueOutput!, 0.25)
    })

    // Click on channel 3, cue on channel 4 — zero-based 2 and 3.
    expect(peak(buf, 2)).toBeGreaterThan(0.4)
    expect(peak(buf, 3)).toBeGreaterThan(0.2)
    // And crucially NOT in the song pair, which is what goes to the house.
    expect(peak(buf, 0)).toBeLessThan(1e-4)
    expect(peak(buf, 1)).toBeLessThan(1e-4)
  })

  it('keeps the song on its own pair, clear of the click channel', async () => {
    const buf = await withEngine(18, (engine, ctx) => {
      feed(ctx, engine.masterGain, 0.5, true) // the song is stereo
    })
    expect(peak(buf, 0)).toBeGreaterThan(0.4)
    expect(peak(buf, 1)).toBeGreaterThan(0.4)
    // If the song leaked here, the desk could not tell song from click and the
    // FOH safety plan would be meaningless.
    expect(peak(buf, 2)).toBeLessThan(1e-4)
    expect(peak(buf, 3)).toBeLessThan(1e-4)
  })

  it('song, click and cue are simultaneously separable', async () => {
    // All three at once — the actual live condition.
    const buf = await withEngine(18, (engine, ctx) => {
      feed(ctx, engine.masterGain, 0.5, true)
      feed(ctx, engine.clickOutput!, 0.3)
      feed(ctx, engine.cueOutput!, 0.15)
    })
    expect(peak(buf, 0)).toBeGreaterThan(0.4)
    expect(peak(buf, 2)).toBeGreaterThan(0.2)
    expect(peak(buf, 3)).toBeGreaterThan(0.1)
    // Levels stay distinct — they are genuinely separate signals.
    expect(peak(buf, 2)).toBeGreaterThan(peak(buf, 3) * 1.5)
    for (let c = 4; c < 18; c++) expect(peak(buf, c), `ch ${c + 1}`).toBeLessThan(1e-4)
  })
})

describe('on ordinary stereo hardware', () => {
  it('does NOT split, and offers no separate click output', async () => {
    // The laptop case. Handing back a click node here would place it on a
    // channel that does not exist — silence, no error, for most users.
    await withEngine(2, (engine) => {
      expect(engine.outputLayout?.split).toBe(false)
      expect(engine.clickOutput).toBeNull()
      expect(engine.cueOutput).toBeNull()
    })
  })

  it('still plays the song in stereo, exactly as before', async () => {
    const buf = await withEngine(2, (engine, ctx) => {
      feed(ctx, engine.masterGain, 0.5, true)
    })
    expect(buf.numberOfChannels).toBe(2)
    expect(peak(buf, 0)).toBeGreaterThan(0.4)
    expect(peak(buf, 1)).toBeGreaterThan(0.4)
  })

  it('names the consequence rather than hiding it', () => {
    // Two different reasons for one stereo pair, and the wording must say WHICH:
    // the hardware cannot, versus the feature is switched off.
    expect(liveOutputMap(2, { enabled: true }).summary).toMatch(/cannot be kept out of the front of house/i)
    expect(liveOutputMap(18, { enabled: false }).summary).toMatch(/switched off/i)
  })
})

describe('the CLICK TRACK itself lands on the click channel', () => {
  /** A one-second buffer of steady tone, as a click track would be. */
  function toneBuffer(ctx: BaseAudioContext, gain = 0.5): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.floor(SR / 8), SR)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = gain * Math.sin((2 * Math.PI * 1000 * i) / SR)
    return buf
  }

  it('a track keyed "click" leaves on its own channel, not the song pair', async () => {
    // THE GAP THIS CATCHES: the split outputs existed, but nothing routed the
    // click TRACK into them — so it still travelled inside the song's stereo
    // pair and channels 11/12 on the desk received silence. Everything looked
    // correct and the whole separation was theatre.
    localStorage.setItem('barbro::rig::multichannel', '1')
    const ctx = new OfflineAudioContext({ numberOfChannels: 18, length: SR / 4, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    engine.setTrack({ key: 'click', label: 'Click', buffer: toneBuffer(ctx), volume: 1, muted: false, soloed: false } as never)
    engine.play()
    const buf = await ctx.startRendering()
    await engine.dispose()

    expect(peak(buf, 2)).toBeGreaterThan(0.1) // click channel carries it
    expect(peak(buf, 0)).toBeLessThan(1e-4) // and the song pair does NOT
    expect(peak(buf, 1)).toBeLessThan(1e-4)
  })

  it('an ordinary track still goes to the song pair', async () => {
    localStorage.setItem('barbro::rig::multichannel', '1')
    const ctx = new OfflineAudioContext({ numberOfChannels: 18, length: SR / 4, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    engine.setTrack({ key: 'original', label: 'Song', buffer: toneBuffer(ctx), volume: 1, muted: false, soloed: false } as never)
    engine.play()
    const buf = await ctx.startRendering()
    await engine.dispose()

    expect(peak(buf, 0)).toBeGreaterThan(0.1)
    expect(peak(buf, 2)).toBeLessThan(1e-4) // must not bleed into the click channel
  })

  it('on stereo hardware the click still plays, mixed in as before', async () => {
    // The laptop case. Silently dropping the click here would be far worse than
    // not separating it.
    localStorage.setItem('barbro::rig::multichannel', '0')
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR / 4, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    engine.setTrack({ key: 'click', label: 'Click', buffer: toneBuffer(ctx), volume: 1, muted: false, soloed: false } as never)
    engine.play()
    const buf = await ctx.startRendering()
    await engine.dispose()
    expect(peak(buf, 0)).toBeGreaterThan(0.1)
  })
})
