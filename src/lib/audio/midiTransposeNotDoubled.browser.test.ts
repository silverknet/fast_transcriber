/**
 * A MIDI lane transposes by moving the NOTE, never by re-pitching its audio.
 *
 * Transposing the song does two things at once: the mixer transposes each MIDI
 * lane's notes (`transposeMidiNote`), and varispeed changes the transport rate
 * so the recorded stems come out in the new key. A MIDI voice that also pitched
 * itself by that rate would apply the transpose TWICE — +2 semitones of notes
 * played through a +2-semitone rate lands about 4 semitones up, and the bass
 * drifts out of key with the stems.
 *
 * Timing must still follow the rate, or the line stops matching the song.
 */
import { describe, expect, it } from 'vitest'
import { createBassMidiInstrument } from './bassMidiInstrument'
import { DEFAULT_BASS_TONE } from './bassTone'
import type { BassPart } from './bassPart'

const SR = 44100

const part = (): BassPart => ({
  notes: [
    { atSec: 0.2, durationSec: 0.5, midi: 45, velocity: 0.9 },
    { atSec: 1.2, durationSec: 0.5, midi: 45, velocity: 0.9 },
  ],
  durationSec: 3,
})

async function render(rate: number, seconds = 3): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(SR * seconds), SR)
  const inst = await createBassMidiInstrument(ctx, { part: part(), tone: DEFAULT_BASS_TONE })
  inst.output.connect(ctx.destination)
  inst.schedule(0, 0, rate)
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

const energy = (b: Float32Array, sec: number, win = 0.06) => {
  let s = 0
  const from = Math.floor(sec * SR)
  const to = Math.min(b.length, Math.floor((sec + win) * SR))
  for (let i = from; i < to; i++) s += b[i]! ** 2
  return Math.sqrt(s / Math.max(1, to - from))
}

describe('MIDI lanes are not double-transposed', () => {
  it('a note keeps its pitch regardless of the transport rate', async () => {
    const normal = await render(1)
    const fast = await render(1.5)
    // Each measured over its own sustain: 0.3s at rate 1, 0.3/1.5 at rate 1.5.
    const a = crossings(normal, 0.3, 0.4)
    const b = crossings(fast, 0.2, 0.267)
    expect(a).toBeGreaterThan(5) // sanity: a real tone
    // Per 100ms of wall time both should show the same frequency. Scale the
    // fast window (66.7ms) up for comparison.
    const bScaled = b * (0.1 / 0.0667)
    // RED if the voice followed the rate: bScaled would be ~1.5x a.
    expect(Math.abs(bScaled - a) / a).toBeLessThan(0.15)
  })

  it('but the TIMING still follows the rate', async () => {
    const fast = await render(2)
    // Notes at 0.2 and 1.2 played at rate 2 land at 0.1 and 0.6.
    expect(energy(fast, 0.12)).toBeGreaterThan(1e-4)
    expect(energy(fast, 0.62)).toBeGreaterThan(1e-4)
    // ...and NOT where they would be at rate 1.
    expect(energy(fast, 1.25)).toBeLessThan(energy(fast, 0.62))
  })
})
