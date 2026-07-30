/**
 * `KeysSynth` rendering OFFLINE.
 *
 * This is the foundation for putting the chords-tab instruments into the mixer:
 * the mixer renders to a WAV, the chords tab plays live, and both must be the
 * SAME instrument. Reimplementing the voice is what went wrong with the bass
 * twice, so instead the synth itself accepts an `OfflineAudioContext` and the
 * voice/FX code is shared verbatim.
 *
 * Needs a real audio context, so it lives in the browser project.
 */
import { describe, expect, it } from 'vitest'
import { KeysSynth, BUILTIN_PRESETS, DEFAULT_PATCH } from './keysSynth'
import { BASS_PATCH } from './chordBass'

const SR = 44100

const rms = (b: Float32Array, from = 0, to = b.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
/** Cheap content hash — comparing 88k samples element-wise is glacial. */
function hash(b: Float32Array): number {
  let h = 5381
  for (let i = 0; i < b.length; i += 13) h = (h * 33) ^ Math.round(b[i]! * 1e6)
  return h | 0
}

async function render(
  notes: { midi: number; at: number; dur: number; vel?: number }[],
  patch = DEFAULT_PATCH,
  seconds = 2,
  seed = 1,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, Math.floor(SR * seconds), SR)
  const synth = new KeysSynth()
  synth.attachOfflineContext(ctx, seed)
  synth.setPatch(patch)
  synth.setVolume(0.8)
  for (const n of notes) synth.scheduleNote(n.midi, n.vel ?? 100, n.at, n.dur)
  const buf = await ctx.startRendering()
  return buf.getChannelData(0).slice()
}

describe('KeysSynth offline', () => {
  it('renders audible, finite audio', async () => {
    const out = await render([{ midi: 60, at: 0.1, dur: 0.5 }])
    expect(peak(out)).toBeGreaterThan(0.001)
    for (const v of out) expect(Number.isFinite(v)).toBe(true)
  })

  it('starts when told and stops after its release', async () => {
    const out = await render([{ midi: 60, at: 0.5, dur: 0.3 }])
    expect(rms(out, 0, Math.floor(0.45 * SR))).toBeLessThan(1e-4)
    expect(rms(out, Math.floor(0.55 * SR), Math.floor(0.75 * SR))).toBeGreaterThan(1e-4)
  })

  it('plays a CHORD — several notes at once, which is the point', async () => {
    const one = await render([{ midi: 60, at: 0.1, dur: 0.6 }])
    const triad = await render([
      { midi: 60, at: 0.1, dur: 0.6 },
      { midi: 64, at: 0.1, dur: 0.6 },
      { midi: 67, at: 0.1, dur: 0.6 },
    ])
    expect(rms(triad)).toBeGreaterThan(rms(one))
  })

  it('is deterministic — the analog detune is seeded offline', async () => {
    const a = await render([{ midi: 60, at: 0.1, dur: 0.3 }], DEFAULT_PATCH, 1, 7)
    const b = await render([{ midi: 60, at: 0.1, dur: 0.3 }], DEFAULT_PATCH, 1, 7)
    expect(hash(a)).toBe(hash(b))
  })

  it('a different seed really does change the voice', async () => {
    // Proves the humanization is live, not silently bypassed offline.
    const a = await render([{ midi: 60, at: 0.1, dur: 0.3 }], DEFAULT_PATCH, 1, 1)
    const b = await render([{ midi: 60, at: 0.1, dur: 0.3 }], DEFAULT_PATCH, 1, 999)
    expect(hash(a)).not.toBe(hash(b))
  })

  it('the patch actually changes the sound', async () => {
    const dark = await render(
      [{ midi: 60, at: 0.1, dur: 0.5 }],
      { ...DEFAULT_PATCH, filter: { ...DEFAULT_PATCH.filter, cutoffHz: 200, resonance: 0.5 } },
    )
    const bright = await render(
      [{ midi: 60, at: 0.1, dur: 0.5 }],
      { ...DEFAULT_PATCH, filter: { ...DEFAULT_PATCH.filter, cutoffHz: 12000, resonance: 0.5 } },
    )
    const brightness = (b: Float32Array) => {
      let s = 0
      const from = Math.floor(0.15 * SR)
      const to = Math.floor(0.5 * SR)
      for (let i = from + 1; i < to; i++) s += Math.abs(b[i]! - b[i - 1]!)
      return s / (to - from)
    }
    expect(brightness(bright)).toBeGreaterThan(brightness(dark))
  })

  it('renders every built-in preset without blowing up', async () => {
    for (const preset of BUILTIN_PRESETS) {
      const out = await render([{ midi: 60, at: 0.05, dur: 0.2 }], preset, 0.8)
      expect(peak(out), preset.name).toBeGreaterThan(0)
      expect(peak(out), preset.name).toBeLessThan(8)
      for (const v of out) expect(Number.isFinite(v), preset.name).toBe(true)
    }
  })

  it('renders the chords-tab BASS patch too — same instrument, same knobs', async () => {
    const out = await render([{ midi: 40, at: 0.1, dur: 0.5 }], BASS_PATCH)
    expect(peak(out)).toBeGreaterThan(0.001)
  })

  it('a short note does not run past its own length', async () => {
    // DRY patch on purpose: with FX the reverb tail rings on long after the
    // note, which is correct behaviour and would mask what's being tested.
    const patch = {
      ...DEFAULT_PATCH,
      env: { attack: 0.3, decay: 0.4, sustain: 0.7, release: 0.05 },
      fx: { ...DEFAULT_PATCH.fx, reverbMix: 0, delayMix: 0, chorus: 0 },
    }
    const out = await render([{ midi: 60, at: 0.1, dur: 0.1 }], patch, 1)
    // note + release ends ~0.25 s; nothing should still be ringing at 0.5 s.
    expect(rms(out, Math.floor(0.5 * SR), SR)).toBeLessThan(1e-4)
  })

  it('ignores zero-length notes instead of throwing', async () => {
    const out = await render([
      { midi: 60, at: 0.1, dur: 0 },
      { midi: 64, at: 0.3, dur: 0.3 },
    ])
    expect(peak(out)).toBeGreaterThan(0.001)
  })
})
