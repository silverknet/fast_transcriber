/**
 * The bass voice through real Web Audio nodes. Needs a real
 * `OfflineAudioContext`, so it lives in the browser project.
 */
import { describe, expect, it } from 'vitest'
import { renderBassVoice, BASS_BUS_HIGHPASS_HZ } from './renderBassVoice'
import { DEFAULT_BASS_TONE, normalizeBassTone } from './bassTone'

const SR = 44100
const FRAMES = SR // 1 second

const rms = (b: Float32Array, from = 0, to = b.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

/**
 * High-frequency energy proxy: mean |first difference|. A saw's RMS is
 * dominated by its fundamental, so closing a lowpass barely moves total level
 * — but it strips the harmonics, which this sees immediately.
 */
function brightness(b: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from + 1; i < to; i++) s += Math.abs(b[i]! - b[i - 1]!)
  return s / Math.max(1, to - from)
}
const WIN: [number, number] = [Math.floor(0.15 * SR), Math.floor(0.5 * SR)]

const note = (over = {}) => ({ atSec: 0.1, durationSec: 0.5, midi: 40, velocity: 0.8, ...over })

describe('renderBassVoice', () => {
  it('renders audible, finite audio at the requested length', async () => {
    const out = await renderBassVoice([note()], DEFAULT_BASS_TONE, FRAMES, SR)
    expect(out.length).toBe(FRAMES)
    expect(peak(out)).toBeGreaterThan(0.01)
    for (const v of out) expect(Number.isFinite(v)).toBe(true)
  })

  it('starts where it is told', async () => {
    const out = await renderBassVoice([note({ atSec: 0.3 })], DEFAULT_BASS_TONE, FRAMES, SR)
    // Silent well before the onset (the bus highpass settles fast).
    expect(rms(out, 0, Math.floor(0.25 * SR))).toBeLessThan(1e-3)
    expect(rms(out, Math.floor(0.32 * SR), Math.floor(0.5 * SR))).toBeGreaterThan(1e-3)
  })

  it('plays the pitch it is asked for', async () => {
    const low = await renderBassVoice([note({ midi: 28 })], DEFAULT_BASS_TONE, FRAMES, SR)
    const high = await renderBassVoice([note({ midi: 52 })], DEFAULT_BASS_TONE, FRAMES, SR)
    const crossings = (b: Float32Array) => {
      let n = 0
      for (let i = Math.floor(0.15 * SR); i < Math.floor(0.5 * SR); i++) {
        if (b[i - 1]! <= 0 && b[i]! > 0) n++
      }
      return n
    }
    expect(crossings(high)).toBeGreaterThan(crossings(low))
  })

  it('opens the filter with velocity', async () => {
    const tone = normalizeBassTone({ velToCutoff: 1, resonance: 0.0001, drive: 0 })
    const soft = await renderBassVoice([note({ velocity: 0.15 })], tone, FRAMES, SR)
    const hard = await renderBassVoice([note({ velocity: 1 })], tone, FRAMES, SR)
    expect(brightness(hard, ...WIN)).toBeGreaterThan(brightness(soft, ...WIN))
  })

  it('the cutoff actually filters', async () => {
    // Resonance OFF for this one: at the default 0.9 a low cutoff *boosts*
    // around itself, so total RMS can legitimately RISE as you close the
    // filter. Comparing overall level only isolates the lowpass with Q flat.
    // Drive OFF too: the waveshaper compresses the brighter signal harder,
    // which masks the difference in overall level.
    const flat = { velToCutoff: 0, resonance: 0.0001, drive: 0 }
    const open = await renderBassVoice(
      [note()],
      normalizeBassTone({ ...flat, cutoffHz: 5000 }),
      FRAMES,
      SR,
    )
    const closed = await renderBassVoice(
      [note()],
      normalizeBassTone({ ...flat, cutoffHz: 120 }),
      FRAMES,
      SR,
    )
    expect(brightness(closed, ...WIN)).toBeLessThan(brightness(open, ...WIN))
  })

  it('resonance boosts around the cutoff — the Q is really wired up', () => {
    // Guards the behaviour that made the test above misleading, so nobody
    // "fixes" the filter to match a wrong intuition later.
    return (async () => {
      const flat = await renderBassVoice(
        [note()],
        normalizeBassTone({ velToCutoff: 0, resonance: 0.0001, cutoffHz: 160, drive: 0 }),
        FRAMES,
        SR,
      )
      const resonant = await renderBassVoice(
        [note()],
        normalizeBassTone({ velToCutoff: 0, resonance: 3, cutoffHz: 160, drive: 0 }),
        FRAMES,
        SR,
      )
      expect(rms(resonant)).toBeGreaterThan(rms(flat))
    })()
  })

  it('the bus highpass clears the sub the kick needs', async () => {
    // A low note's fundamental sits under the cutoff; its harmonics carry it.
    const out = await renderBassVoice([note({ midi: 24 })], DEFAULT_BASS_TONE, FRAMES, SR)
    expect(BASS_BUS_HIGHPASS_HZ).toBeGreaterThan(40)
    // Still audible — high-passing must not silence the bass, only unclutter it.
    expect(peak(out)).toBeGreaterThan(0.005)
  })

  it('a short note does not run past its own length', async () => {
    const tone = normalizeBassTone({ release: 0.05 })
    const out = await renderBassVoice([note({ durationSec: 0.08 })], tone, FRAMES, SR)
    // Silent well after note + release (0.1 + 0.08 + 0.05 = 0.23 s).
    expect(rms(out, Math.floor(0.35 * SR), FRAMES)).toBeLessThan(1e-3)
  })

  it('renders a whole line, not just the first note', async () => {
    const notes = [0.1, 0.4, 0.7].map((t) => note({ atSec: t, durationSec: 0.2 }))
    const out = await renderBassVoice(notes, DEFAULT_BASS_TONE, FRAMES, SR)
    for (const t of [0.15, 0.45, 0.75]) {
      expect(rms(out, Math.floor(t * SR), Math.floor((t + 0.05) * SR)), `note at ${t}`).toBeGreaterThan(
        1e-3,
      )
    }
  })

  it('skips zero-length notes instead of throwing', async () => {
    const out = await renderBassVoice(
      [note({ durationSec: 0 }), note({ atSec: 0.4 })],
      DEFAULT_BASS_TONE,
      FRAMES,
      SR,
    )
    expect(peak(out)).toBeGreaterThan(0.01)
  })

  it('drive adds harmonics rather than just level', async () => {
    const clean = await renderBassVoice([note()], normalizeBassTone({ drive: 0 }), FRAMES, SR)
    const dirty = await renderBassVoice([note()], normalizeBassTone({ drive: 0.9 }), FRAMES, SR)
    // Same notes, different timbre — the waveshaper is in circuit.
    expect(rms(dirty)).not.toBeCloseTo(rms(clean), 3)
  })
})
