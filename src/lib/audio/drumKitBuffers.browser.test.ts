/**
 * The Float32Array → AudioBuffer adapter. Needs a real context (createBuffer /
 * copyToChannel), so it lives in the browser project.
 */
import { describe, expect, it } from 'vitest'
import { kitToAudioBuffers, clearKitBufferCache, DRUM_VOICE_CLASSES } from './drumKitBuffers'
import { buildSynthKit, DRUM_KIT_SAMPLE_RATE, type DrumKit } from './drumKits'

function synthKit(): DrumKit {
  return { id: 'synth', label: 'Electronic kit', voices: buildSynthKit() }
}

const ctx = () => new OfflineAudioContext(1, 1024, 48000)

describe('kitToAudioBuffers', () => {
  it('converts every voice to a playable buffer', () => {
    const bufs = kitToAudioBuffers(ctx(), synthKit())
    for (const cls of DRUM_VOICE_CLASSES) {
      expect(bufs[cls], cls).toBeDefined()
      expect(bufs[cls]!.length, cls).toBeGreaterThan(0)
      expect(bufs[cls]!.numberOfChannels, cls).toBe(1)
    }
  })

  it('keeps the KIT sample rate, not the context rate', () => {
    // 44.1k data claimed as 48k would play sharp and short; the source node
    // resamples instead.
    const c = ctx()
    expect(c.sampleRate).toBe(48000)
    const bufs = kitToAudioBuffers(c, synthKit())
    expect(bufs.kick!.sampleRate).toBe(DRUM_KIT_SAMPLE_RATE)
  })

  it('preserves the samples exactly — no gain applied', () => {
    // VOICE_MIX_GAIN is already baked into kit.voices; re-applying it here
    // would quietly halve the hats.
    const kit = synthKit()
    const bufs = kitToAudioBuffers(ctx(), kit)
    const src = kit.voices.kick
    const out = bufs.kick!.getChannelData(0)
    expect(out.length).toBe(src.length)
    for (let i = 0; i < src.length; i += 97) expect(out[i]).toBeCloseTo(src[i]!, 6)
  })

  it('caches per context — the same kit returns the same buffers', () => {
    const c = ctx()
    const kit = synthKit()
    expect(kitToAudioBuffers(c, kit).kick).toBe(kitToAudioBuffers(c, kit).kick)
  })

  it('does not share buffers across contexts', () => {
    // An AudioBuffer belongs to the context that made it.
    const kit = synthKit()
    expect(kitToAudioBuffers(ctx(), kit).kick).not.toBe(kitToAudioBuffers(ctx(), kit).kick)
  })

  it('treats a changed sample set as a different kit', () => {
    const c = ctx()
    const a = synthKit()
    const first = kitToAudioBuffers(c, a).kick
    // Same id ("Your kit" is user files), different content.
    const b: DrumKit = { ...a, voices: { ...a.voices, kick: a.voices.kick.slice(0, 100) } }
    expect(kitToAudioBuffers(c, b).kick).not.toBe(first)
  })

  it('skips empty voices instead of creating zero-length buffers', () => {
    const c = ctx()
    const kit = synthKit()
    const stripped: DrumKit = { ...kit, voices: { ...kit.voices, ride: new Float32Array(0) } }
    const bufs = kitToAudioBuffers(c, stripped)
    expect(bufs.ride).toBeUndefined()
    expect(bufs.kick).toBeDefined()
  })

  it('clearing the cache rebuilds', () => {
    const c = ctx()
    const kit = synthKit()
    const first = kitToAudioBuffers(c, kit).kick
    clearKitBufferCache(c)
    expect(kitToAudioBuffers(c, kit).kick).not.toBe(first)
  })
})
