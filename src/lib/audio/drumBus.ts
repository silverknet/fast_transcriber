/**
 * The drum mix bus — what makes the generated kit BLEND instead of sitting
 * dry on top of the song. Fully deterministic DSP (no randomness, no
 * AudioContext), applied in this order:
 *
 *   1. per-voice constant-power PAN (kick/snare center, hats/toms off-center)
 *   2. room REVERB send (Schroeder: 4 combs + 2 allpasses per channel,
 *      decorrelated L/R delays, damped feedback, 15 ms pre-delay)
 *   3. gentle bus COMPRESSION (stereo-linked, slow-ish release = glue)
 *   4. soft SATURATION (tanh) for warmth/harmonics
 *
 * The renderer's RMS normalization runs after all of this.
 */
import type { DrumClass } from '$lib/songmap/types'

/** Constant-power pan per voice: -1 left … +1 right. */
const VOICE_PAN: Record<DrumClass, number> = {
  kick: 0,
  snare: 0.04,
  hihat: 0.28,
  tom: -0.3,
  cymbal: -0.18,
}

export function voicePanGains(cls: DrumClass): { l: number; r: number } {
  const p = VOICE_PAN[cls] ?? 0
  const angle = ((p + 1) / 2) * (Math.PI / 2)
  return { l: Math.cos(angle), r: Math.sin(angle) }
}

// ── Reverb ──────────────────────────────────────────────────────────────────

const REVERB_PRE_DELAY_SEC = 0.015
const REVERB_RT60_SEC = 0.9
const REVERB_DAMP_HZ = 4200
/** Wet level of the send (dry stays at 1.0). */
export const REVERB_WET = 0.16
/** Comb delays in ms; the right channel runs slightly longer for width. */
const COMB_DELAYS_MS = [29.7, 37.1, 41.1, 43.7]
const ALLPASS_DELAYS_MS = [5.0, 1.7]
const R_CHANNEL_SKEW_MS = 0.9

function combFilter(
  src: Float32Array,
  delaySamples: number,
  feedback: number,
  dampCoef: number,
): Float32Array {
  const out = new Float32Array(src.length)
  const buf = new Float32Array(delaySamples)
  let idx = 0
  let dampState = 0
  for (let i = 0; i < src.length; i++) {
    const delayed = buf[idx]!
    out[i] = delayed
    // One-pole lowpass in the feedback loop — high end dies first, like a room.
    dampState = delayed + (dampState - delayed) * dampCoef
    buf[idx] = src[i]! + dampState * feedback
    idx = (idx + 1) % delaySamples
  }
  return out
}

function allpassFilter(src: Float32Array, delaySamples: number, g = 0.7): Float32Array {
  const out = new Float32Array(src.length)
  const buf = new Float32Array(delaySamples)
  let idx = 0
  for (let i = 0; i < src.length; i++) {
    const delayed = buf[idx]!
    const y = -g * src[i]! + delayed
    buf[idx] = src[i]! + g * y
    out[i] = y
    idx = (idx + 1) % delaySamples
  }
  return out
}

/** Render the wet reverb signal for one channel. */
export function reverbWet(src: Float32Array, sampleRate: number, channelSkewMs = 0): Float32Array {
  const pre = Math.round(REVERB_PRE_DELAY_SEC * sampleRate)
  const preDelayed = new Float32Array(src.length)
  for (let i = pre; i < src.length; i++) preDelayed[i] = src[i - pre]!
  const dampCoef = Math.exp((-2 * Math.PI * REVERB_DAMP_HZ) / sampleRate)
  let sum: Float32Array | null = null
  for (const ms of COMB_DELAYS_MS) {
    const d = Math.max(1, Math.round(((ms + channelSkewMs) / 1000) * sampleRate))
    const fb = Math.pow(10, (-3 * (d / sampleRate)) / REVERB_RT60_SEC)
    const c = combFilter(preDelayed, d, fb, dampCoef)
    if (!sum) sum = c
    else for (let i = 0; i < c.length; i++) sum[i]! += c[i]!
  }
  let wet = sum ?? new Float32Array(src.length)
  for (let i = 0; i < wet.length; i++) wet[i]! /= COMB_DELAYS_MS.length
  for (const ms of ALLPASS_DELAYS_MS) {
    const d = Math.max(1, Math.round(((ms + channelSkewMs) / 1000) * sampleRate))
    wet = allpassFilter(wet, d)
  }
  return wet
}

/** Add the reverb send in place on both channels (R decorrelated). */
export function applyReverb(l: Float32Array, r: Float32Array, sampleRate: number): void {
  const wetL = reverbWet(l, sampleRate, 0)
  const wetR = reverbWet(r, sampleRate, R_CHANNEL_SKEW_MS)
  for (let i = 0; i < l.length; i++) {
    l[i]! += wetL[i]! * REVERB_WET
    r[i]! += wetR[i]! * REVERB_WET
  }
}

// ── Bus compression ─────────────────────────────────────────────────────────

const COMP_THRESHOLD = 0.35 // linear (~ -9 dBFS on the pre-normalize bus)
const COMP_RATIO = 3
const COMP_ATTACK_SEC = 0.005
const COMP_RELEASE_SEC = 0.12

/** Gentle stereo-linked compressor — the "glue". In place. */
export function applyBusCompression(l: Float32Array, r: Float32Array, sampleRate: number): void {
  const attack = Math.exp(-1 / (COMP_ATTACK_SEC * sampleRate))
  const release = Math.exp(-1 / (COMP_RELEASE_SEC * sampleRate))
  let env = 0
  for (let i = 0; i < l.length; i++) {
    const x = Math.max(Math.abs(l[i]!), Math.abs(r[i]!))
    env = x > env ? attack * env + (1 - attack) * x : release * env + (1 - release) * x
    if (env > COMP_THRESHOLD) {
      const over = env / COMP_THRESHOLD
      const gain = Math.pow(over, 1 / COMP_RATIO - 1)
      l[i]! *= gain
      r[i]! *= gain
    }
  }
}

// ── Saturation ──────────────────────────────────────────────────────────────

const SATURATION_DRIVE = 1.4

/** Soft tanh saturation — adds low-order harmonics that help the kit sit.
 * `drive` is overridable: sustained near-full-scale material (bass) distorts
 * far more per unit drive than percussive one-shots, so it runs lighter. */
export function applySaturation(data: Float32Array, drive = SATURATION_DRIVE): void {
  const norm = Math.tanh(drive)
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.tanh(data[i]! * drive) / norm
  }
}
