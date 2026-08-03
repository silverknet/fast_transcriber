import { describe, expect, it } from 'vitest'
import { KeysSynth, structuredClonePatch, type SynthPatch } from './keysSynth'

/**
 * `scheduleNote` (what the live MIDI machine lanes use) must hold a note at its
 * SUSTAIN level for the note's whole length and only then release — exactly like
 * `noteOn`/`noteOff` (what the Chords tab uses).
 *
 * The regression this pins: the release ramp was scheduled without anchoring the
 * sustain first, so Web Audio interpolated it from the END OF THE DECAY, sliding
 * the gain to silence across the entire note. Every held chord came out as a
 * decaying pluck in live mode while sounding correct in the editor.
 */

const SR = 44100

/** A flat, obvious pad: instant attack, no decay, full sustain, no FX. */
function padPatch(): SynthPatch {
  return structuredClonePatch({
    name: 'Test Pad',
    oscA: { type: 'sine', level: 1, detune: 0 },
    oscB: { type: 'sine', level: 0, detune: 0 },
    filter: { cutoffHz: 12000, resonance: 0.5, velToCutoff: 0 },
    lfo: { rateHz: 0.1, depth: 0 },
    env: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.05 },
    gain: 1,
    fx: {
      chorus: 0,
      delayMix: 0,
      delayTime: 0.3,
      delayFeedback: 0,
      reverbMix: 0,
      reverbSize: 1,
      highpassHz: 20,
      reverbPredelay: 0,
      reverbDamp: 14000,
      drive: 0,
      shimmer: 0,
    },
  } as SynthPatch)
}

/** Render one scheduled note and return the mono samples. */
async function renderScheduled(durationSec: number, renderSec: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.floor(SR * renderSec), SR)
  const synth = new KeysSynth()
  synth.setPatch(padPatch())
  synth.setVolume(1)
  synth.attachContext(ctx, { destination: ctx.destination })
  synth.scheduleNote(60, 100, 0, durationSec)
  const buf = await ctx.startRendering()
  return buf.getChannelData(0)
}

/** Peak amplitude in a window, as a proxy for the envelope level there. */
function peakBetween(d: Float32Array, fromSec: number, toSec: number): number {
  let m = 0
  const a = Math.max(0, Math.floor(fromSec * SR))
  const b = Math.min(d.length, Math.floor(toSec * SR))
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

describe('scheduleNote — a held note sustains instead of decaying away', () => {
  it('is still near full level three quarters of the way through a 2 s note', async () => {
    const d = await renderScheduled(2, 2.5)
    const early = peakBetween(d, 0.15, 0.25) // settled at sustain
    const late = peakBetween(d, 1.5, 1.6) // 75% through
    expect(early).toBeGreaterThan(0.05) // it sounds at all
    // Before the fix this ratio was ~0.25 (a linear slide to silence).
    expect(late / early).toBeGreaterThan(0.9)
  }, 30_000)

  it('does not sag across a long note', async () => {
    const d = await renderScheduled(3, 3.5)
    const q1 = peakBetween(d, 0.5, 0.6)
    const q2 = peakBetween(d, 1.5, 1.6)
    const q3 = peakBetween(d, 2.5, 2.6)
    expect(q2 / q1).toBeGreaterThan(0.92)
    expect(q3 / q1).toBeGreaterThan(0.92)
  }, 30_000)

  it('still releases AFTER the note ends, not before', async () => {
    const d = await renderScheduled(1, 2)
    const beforeEnd = peakBetween(d, 0.85, 0.95)
    const afterRelease = peakBetween(d, 1.2, 1.9)
    expect(beforeEnd).toBeGreaterThan(0.05) // full level right up to the end
    expect(afterRelease).toBeLessThan(beforeEnd * 0.05) // then gone
  }, 30_000)

  it('matches noteOn/noteOff, which is the sound the editor already had', async () => {
    // Same patch, same note, held the same length via the live-play path.
    const ctx = new OfflineAudioContext(1, Math.floor(SR * 2.5), SR)
    const synth = new KeysSynth()
    synth.setPatch(padPatch())
    synth.setVolume(1)
    synth.attachContext(ctx, { destination: ctx.destination })
    synth.noteOn(60, 100)
    const held = (await ctx.startRendering()).getChannelData(0)
    const scheduled = await renderScheduled(2, 2.5)
    const ratio = (d: Float32Array) => peakBetween(d, 1.5, 1.6) / peakBetween(d, 0.15, 0.25)
    // Both paths must hold their level the same way through the note.
    expect(Math.abs(ratio(scheduled) - ratio(held))).toBeLessThan(0.1)
  }, 30_000)

  it('a very short note still fits its envelope inside its own length', async () => {
    const d = await renderScheduled(0.03, 0.5)
    expect(peakBetween(d, 0, 0.05)).toBeGreaterThan(0.02) // it sounds
    expect(peakBetween(d, 0.2, 0.5)).toBeLessThan(0.01) // and is gone after
  }, 30_000)
})
