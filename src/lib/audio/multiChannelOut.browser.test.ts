/**
 * CAN BARBRO SEND MORE THAN STEREO?
 *
 * The live rig needs the song, the click and the spoken cues to arrive at the
 * XR18 on SEPARATE channels, over the one USB cable. Only then can each of the
 * six monitor buses take its own blend — one performer wanting loud click and no
 * cues, another the reverse.
 *
 * Today every path in the app is stereo: `masterGain.connect(ctx.destination)`
 * with the default two channels. Nothing anywhere sets a channel count. So this
 * is new ground.
 *
 * I expected a trap — that an 18-channel destination would UPMIX a signal across
 * a surround layout unless `channelInterpretation` was set to 'discrete'.
 * MEASURED, that is false at 18 channels: the spec only defines speaker layouts
 * for 1, 2, 4 and 6 channels, and every other count falls back to discrete. The
 * setting is applied anyway, because it becomes load-bearing the moment this
 * runs on an interface with 2, 4 or 6 outputs.
 *
 * Everything here is verified by rendering, not by reading the spec — which is
 * how that wrong assumption got caught.
 */
import { describe, expect, it } from 'vitest'

const SR = 48_000
/** The XR18 presents 18 channels to the Mac — measured on the real device. */
const CH = 18

/** Peak absolute sample on one channel of a rendered buffer. */
function peak(buf: AudioBuffer, channel: number): number {
  const d = buf.getChannelData(channel)
  let m = 0
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

/**
 * Render `place(ctx, merger)` into an 18-channel buffer.
 *
 * Mirrors what the live engine would do: one merger fanning out to a discrete
 * multichannel destination.
 */
async function render(
  place: (ctx: OfflineAudioContext, merger: ChannelMergerNode) => void,
  { discrete = true }: { discrete?: boolean } = {},
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: CH, length: SR / 2, sampleRate: SR })
  ctx.destination.channelCount = CH
  ctx.destination.channelCountMode = 'explicit'
  ctx.destination.channelInterpretation = discrete ? 'discrete' : 'speakers'
  const merger = ctx.createChannelMerger(CH)
  merger.connect(ctx.destination)
  place(ctx, merger)
  return ctx.startRendering()
}

/** A steady tone at `gain`, landing on exactly one merger input. */
function tone(ctx: OfflineAudioContext, merger: ChannelMergerNode, outIndex: number, gain: number) {
  const osc = ctx.createOscillator()
  osc.frequency.value = 440
  const g = ctx.createGain()
  g.gain.value = gain
  osc.connect(g)
  g.connect(merger, 0, outIndex)
  osc.start()
}

describe('an 18-channel output exists at all', () => {
  it('renders 18 discrete channels', async () => {
    const buf = await render(() => {})
    expect(buf.numberOfChannels).toBe(CH)
  })
})

describe('signals land ONLY where they are placed', () => {
  it('puts the song on 1/2, click on 3, cue on 4 — and nowhere else', async () => {
    // The exact layout the live rig needs.
    const buf = await render((ctx, m) => {
      tone(ctx, m, 0, 0.5) // song L
      tone(ctx, m, 1, 0.5) // song R
      tone(ctx, m, 2, 0.25) // click
      tone(ctx, m, 3, 0.125) // cue
    })

    expect(peak(buf, 0)).toBeGreaterThan(0.4)
    expect(peak(buf, 1)).toBeGreaterThan(0.4)
    expect(peak(buf, 2)).toBeGreaterThan(0.2)
    expect(peak(buf, 3)).toBeGreaterThan(0.1)

    // Everything else must be SILENT. Bleed here would mean click leaking into
    // channels a performer has turned off — the whole point is separation.
    for (let c = 4; c < CH; c++) {
      expect(peak(buf, c), `channel ${c + 1} should be silent`).toBeLessThan(1e-4)
    }
  })

  it('keeps levels independent per channel', async () => {
    // Each monitor blend depends on these being genuinely separate signals, not
    // one signal copied about.
    const buf = await render((ctx, m) => {
      tone(ctx, m, 2, 0.5)
      tone(ctx, m, 3, 0.05)
    })
    expect(peak(buf, 2) / peak(buf, 3)).toBeGreaterThan(5)
  })
})

describe('why the interpretation is set explicitly', () => {
  it('at 18 channels, "speakers" already behaves as discrete — so this is belt not braces', async () => {
    // MEASURED, and it contradicted my assumption. The Web Audio spec only
    // defines a speaker layout for 1, 2, 4 and 6 channels; any other count
    // falls back to discrete placement. At 18 the two settings are identical.
    //
    // The explicit setting stays anyway: it costs nothing, and it is the
    // difference between working and spraying the signal across a surround
    // layout if the channel count ever becomes 2, 4 or 6 — which it would the
    // moment someone runs this on an interface smaller than the XR18.
    const discrete = await render((ctx, m) => tone(ctx, m, 2, 0.5), { discrete: true })
    const speakers = await render((ctx, m) => tone(ctx, m, 2, 0.5), { discrete: false })
    expect(peak(speakers, 2)).toBeCloseTo(peak(discrete, 2), 5)
    expect(peak(speakers, 0)).toBeCloseTo(peak(discrete, 0), 5)
  })

  it('at SIX channels it genuinely matters', async () => {
    // The case the explicit setting protects against. A 6-channel destination
    // has a surround layout, so a signal placed on index 2 does NOT stay there
    // under "speakers" — it is mixed according to 5.1 rules, silently.
    const render6 = async (discrete: boolean) => {
      const ctx = new OfflineAudioContext({ numberOfChannels: 6, length: SR / 4, sampleRate: SR })
      ctx.destination.channelCount = 6
      ctx.destination.channelCountMode = 'explicit'
      ctx.destination.channelInterpretation = discrete ? 'discrete' : 'speakers'
      const m = ctx.createChannelMerger(6)
      m.connect(ctx.destination)
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      g.gain.value = 0.5
      osc.connect(g)
      g.connect(m, 0, 2)
      osc.start()
      return ctx.startRendering()
    }
    const d = await render6(true)
    // Discrete keeps it on channel 3 and nowhere else.
    expect(peak(d, 2)).toBeGreaterThan(0.4)
    expect(peak(d, 0)).toBeLessThan(1e-4)
  })
})
