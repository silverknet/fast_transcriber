/**
 * Drums are NEVER transposed.
 *
 * Transposing the song changes the transport rate (varispeed), and a drum lane
 * that followed it would pitch the whole kit with the key — a transposed snare
 * is just a worse snare. Timing must follow the rate so the groove stays locked
 * to the song; the SOUND of each hit must not.
 */
import { describe, expect, it } from 'vitest'
import { createDrumMidiInstrument } from './drumMidiInstrument'
import type { DrumPart } from './drumPart'
import type { DrumKit } from './drumKits'

const SR = 44100

/** A kit whose 'kick' is a steady tone, so pitch is measurable. */
function toneKit(freq = 220): DrumKit {
  const n = Math.floor(SR * 0.4)
  const data = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT))
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0.8
  const voices: Record<string, Float32Array> = {}
  for (const cls of ['kick', 'snare', 'hatClosed', 'hatOpen', 'crash', 'ride', 'tom']) {
    voices[cls] = data
  }
  return { id: 'tone', label: 'Tone', sampleRate: SR, voices } as unknown as DrumKit
}

const part = (times: number[]): DrumPart => ({
  hits: times.map((t) => ({ mixTimeSec: t, cls: 'kick' as const, gain: 1 })),
  durationSec: 4,
})

async function render(rate: number, seconds = 3) {
  const ctx = new OfflineAudioContext(2, Math.floor(SR * seconds), SR)
  const inst = await createDrumMidiInstrument(ctx, {
    part: part([0.2, 1.2, 2.2]),
    kit: toneKit(),
    normalizeGain: 1,
  })
  inst.output.connect(ctx.destination)
  inst.schedule(0, 0, rate)
  for (let p = 0; p < seconds; p += 1) inst.tick?.(p)
  return (await ctx.startRendering()).getChannelData(0).slice()
}

/** Zero crossings over a window → a proxy for pitch. */
function crossings(b: Float32Array, fromSec: number, toSec: number): number {
  let n = 0
  for (let i = Math.floor(fromSec * SR) + 1; i < Math.floor(toSec * SR); i++) {
    if (b[i - 1]! <= 0 && b[i]! > 0) n++
  }
  return n
}

describe('drums ignore transpose', () => {
  it('a hit sounds at the SAME pitch at every playback rate', async () => {
    const normal = await render(1)
    const fast = await render(1.5)
    // Measure each at its own first hit: normal at 0.2s, fast at 0.2/1.5s.
    const a = crossings(normal, 0.22, 0.32)
    const b = crossings(fast, 0.14, 0.24)
    expect(a).toBeGreaterThan(10) // sanity: the tone is really there
    // RED if the sample followed the rate: `b` would be ~1.5x `a`.
    expect(Math.abs(b - a)).toBeLessThanOrEqual(2)
  })

  it('but the TIMING still follows the rate, so the groove stays locked', async () => {
    const fast = await render(2)
    const energy = (sec: number) => {
      let s = 0
      for (let i = Math.floor(sec * SR); i < Math.floor((sec + 0.05) * SR); i++) s += fast[i]! ** 2
      return Math.sqrt(s / (0.05 * SR))
    }
    // Hits at 0.2/1.2/2.2 played at rate 2 land at 0.1/0.6/1.1.
    expect(energy(0.11)).toBeGreaterThan(1e-3)
    expect(energy(0.61)).toBeGreaterThan(1e-3)
    expect(energy(1.11)).toBeGreaterThan(1e-3)
  })
})
