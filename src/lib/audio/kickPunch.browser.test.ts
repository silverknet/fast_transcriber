import { describe, expect, it } from 'vitest'
import type { ProjectMastering } from '$lib/project/types'
import { renderBufferThroughStemChain } from './mastering'

/**
 * Kick punch works on the SEPARATED DRUMS STEM, so test it against something
 * shaped like one: kicks on the beat (a fast low sweep, the way a real kick
 * decays) plus continuous hi-hat noise on top. That mix is what makes the
 * claims falsifiable —
 *
 *   - the kick's ATTACK rises relative to its own BODY  → it punches
 *   - the hat band comes out unchanged                  → it is kick-specific,
 *     not "the drums got louder"
 *
 * Real Chromium, real BiquadFilter/DynamicsCompressor curves. A mocked
 * AudioContext can see none of this.
 */

const SR = 44100
const SECONDS = 2
const BEAT_SEC = 0.5
const KICK_TIMES = [0, 0.5, 1, 1.5]

/** A drums-stem-alike: four kicks + steady hats. */
function drumStemBuffer(): AudioBuffer {
  const len = SR * SECONDS
  const ctx = new OfflineAudioContext(1, len, SR)
  const buf = ctx.createBuffer(1, len, SR)
  const d = buf.getChannelData(0)

  // Hats: quiet, continuous high-frequency noise (deterministic).
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < len; i++) {
    // Crude high-pass on the noise so it lives well above the kick band.
    d[i] = (rand() * 2 - 1) * 0.06
  }
  for (let i = len - 1; i > 0; i--) d[i] = d[i]! - d[i - 1]!

  // Kicks: 120 Hz → 45 Hz sweep, 180 ms exponential decay.
  for (const at of KICK_TIMES) {
    const start = Math.floor(at * SR)
    let phase = 0
    for (let k = 0; k < Math.floor(0.25 * SR) && start + k < len; k++) {
      const t = k / SR
      const f = 45 + (120 - 45) * Math.exp(-t / 0.03)
      phase += (2 * Math.PI * f) / SR
      d[start + k]! += Math.sin(phase) * 0.55 * Math.exp(-t / 0.18)
    }
  }
  return buf
}

function cfg(kickPunch: number): ProjectMastering {
  // Everything else off, so only the kick stage can move the result.
  return {
    enabled: true,
    matchLoudness: false,
    masterGlue: false,
    stems: { drums: { intensity: 'off' } },
    ...(kickPunch > 0 ? { kickPunch } : {}),
  }
}

function energy(d: Float32Array, fromSec: number, toSec: number): number {
  let sum = 0
  const a = Math.max(0, Math.floor(fromSec * SR))
  const b = Math.min(d.length, Math.floor(toSec * SR))
  for (let i = a; i < b; i++) sum += d[i]! * d[i]!
  return sum
}

/** Attack energy vs body energy, averaged over the four kicks. */
function attackToBody(d: Float32Array): number {
  let attack = 0
  let body = 0
  for (const at of KICK_TIMES) {
    attack += energy(d, at, at + 0.025)
    body += energy(d, at + 0.05, at + BEAT_SEC)
  }
  return attack / body
}

/** Energy in the hat band, measured between kicks via a first-difference HP. */
function hatEnergy(d: Float32Array): number {
  let sum = 0
  for (const at of KICK_TIMES) {
    const a = Math.floor((at + 0.35) * SR)
    const b = Math.floor((at + 0.48) * SR)
    for (let i = a + 1; i < b && i < d.length; i++) {
      const hp = d[i]! - d[i - 1]!
      sum += hp * hp
    }
  }
  return sum
}

async function render(kickPunch: number): Promise<Float32Array> {
  const out = await renderBufferThroughStemChain(drumStemBuffer(), 'drums', cfg(kickPunch))
  return out.getChannelData(0)
}

describe('kick punch on the drums stem (real browser)', () => {
  it('lifts the kick attack relative to its own body', async () => {
    const dry = await render(0)
    const punched = await render(0.8)
    expect(attackToBody(punched)).toBeGreaterThan(attackToBody(dry) * 1.05)
  }, 20_000)

  it('leaves the hats alone — it is a kick stage, not a level boost', async () => {
    const dry = await render(0)
    const punched = await render(0.8)
    const ratio = hatEnergy(punched) / hatEnergy(dry)
    expect(ratio).toBeGreaterThan(0.97)
    expect(ratio).toBeLessThan(1.03)
  }, 20_000)

  it('adds weight where the kick is', async () => {
    const dry = await render(0)
    const punched = await render(0.8)
    const kickWindow = (d: Float32Array) => KICK_TIMES.reduce((n, at) => n + energy(d, at, at + 0.2), 0)
    expect(kickWindow(punched)).toBeGreaterThan(kickWindow(dry))
  }, 20_000)

  it('scales with the amount', async () => {
    const dry = await render(0)
    const little = await render(0.3)
    const lots = await render(1)
    const kickWindow = (d: Float32Array) => KICK_TIMES.reduce((n, at) => n + energy(d, at, at + 0.2), 0)
    expect(kickWindow(little)).toBeGreaterThan(kickWindow(dry))
    expect(kickWindow(lots)).toBeGreaterThan(kickWindow(little))
  }, 20_000)

  it('is a no-op at 0 — the drums lane is bit-for-bit untouched', async () => {
    const src = drumStemBuffer()
    const out = await renderBufferThroughStemChain(src, 'drums', cfg(0))
    // Nothing else in the config does anything, so the chain must not be built.
    expect(out).toBe(src)
  })

  /** Magnitude of one frequency in the kick windows (naive Goertzel-style probe). */
  function magAt(d: Float32Array, hz: number): number {
    let re = 0
    let im = 0
    let n = 0
    for (const at of KICK_TIMES) {
      const a = Math.floor(at * SR)
      const b = Math.floor((at + 0.15) * SR)
      for (let i = a; i < b && i < d.length; i++) {
        const w = (2 * Math.PI * hz * (i - a)) / SR
        re += d[i]! * Math.cos(w)
        im += d[i]! * Math.sin(w)
        n++
      }
    }
    return n === 0 ? 0 : Math.sqrt(re * re + im * im) / n
  }

  it('adds harmonics above the fundamental, so it carries on small speakers', async () => {
    // The point of the saturation stage: a 45–120 Hz kick is inaudible on a
    // laptop, so the punch has to show up as HARMONICS the speaker can render.
    const dry = await render(0)
    const punched = await render(0.8)
    for (const hz of [150, 200, 250]) {
      const gain = magAt(punched, hz) / Math.max(magAt(dry, hz), 1e-9)
      expect(gain).toBeGreaterThan(1.1)
    }
  }, 20_000)

  it('never applies to a non-drums stem', async () => {
    const src = drumStemBuffer()
    for (const kind of ['bass', 'vocals', 'other'] as const) {
      const out = await renderBufferThroughStemChain(src, kind, cfg(0.9))
      expect(out).toBe(src) // no chain built → same buffer back
    }
  }, 20_000)
})
