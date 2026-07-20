/**
 * Drum kits for the generated drum track.
 *
 * Three kits:
 *  - `synth` ("Electronic kit") — every voice synthesized in code with a
 *    seeded PRNG, so output is bit-identical across machines and builds.
 *  - `acoustic` ("Acoustic kit") — loads CC0 one-shot samples from
 *    `static/drums/acoustic/<voice>.wav` when present; any missing voice
 *    falls back to a warmer, acoustic-leaning synthesized variant so the
 *    kit is always complete. See `static/drums/acoustic/README.md` for the
 *    sample drop-in contract (CC0-only, provenance in LICENSE.md).
 *  - `custom` ("Your kit") — the user's own one-shots from the PROJECT
 *    folder (`kits/drums/<voice>.wav`), loaded via the sidecar by
 *    `$lib/client/projectDrumKit.ts` and assembled with `buildCustomKit`.
 *    Nothing is bundled — the user supplies (and licenses) their own
 *    sounds, e.g. exported from their DAW.
 *
 * All voices are mono Float32Array at 44.1 kHz, peak-normalized then scaled
 * by a per-voice mix gain — consistent levels are the whole point.
 */
import { linearResampleMono } from './renderCueTrack'
import type { DrumClass } from '$lib/songmap/types'

export const DRUM_KIT_SAMPLE_RATE = 44100

export type DrumKitId = 'synth' | 'acoustic' | 'custom'

export type DrumKit = {
  id: DrumKitId
  label: string
  voices: Record<DrumClass, Float32Array>
}

export const DRUM_KITS: { id: DrumKitId; label: string }[] = [
  { id: 'synth', label: 'Electronic kit' },
  { id: 'acoustic', label: 'Acoustic kit' },
  { id: 'custom', label: 'Your kit' },
]

// ── Deterministic noise ──────────────────────────────────────────────────────

/** mulberry32 — tiny seeded PRNG; fixed seeds keep kit renders reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Voice building blocks ────────────────────────────────────────────────────

function seconds(n: number): number {
  return Math.ceil(n * DRUM_KIT_SAMPLE_RATE)
}

function normalizeTo(buf: Float32Array, peak: number): Float32Array {
  let max = 0
  for (const v of buf) max = Math.max(max, Math.abs(v))
  if (max > 0) {
    const g = peak / max
    for (let i = 0; i < buf.length; i++) buf[i]! *= g
  }
  return buf
}

/** One-pole high-pass, applied `passes` times for a steeper knee. */
function highpass(buf: Float32Array, cutoffHz: number, passes = 1): Float32Array {
  const dt = 1 / DRUM_KIT_SAMPLE_RATE
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const a = rc / (rc + dt)
  let out = buf
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(out.length)
    let prevY = 0
    let prevX = 0
    for (let i = 0; i < out.length; i++) {
      const x = out[i]!
      const y = a * (prevY + x - prevX)
      next[i] = y
      prevY = y
      prevX = x
    }
    out = next
  }
  return out
}

/** One-pole low-pass, `passes` times. */
function lowpass(buf: Float32Array, cutoffHz: number, passes = 1): Float32Array {
  const dt = 1 / DRUM_KIT_SAMPLE_RATE
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const a = dt / (rc + dt)
  let out = buf
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(out.length)
    let prevY = 0
    for (let i = 0; i < out.length; i++) {
      prevY = prevY + a * (out[i]! - prevY)
      next[i] = prevY
    }
    out = next
  }
  return out
}

function expEnv(i: number, tauSec: number): number {
  return Math.exp(-(i / DRUM_KIT_SAMPLE_RATE) / tauSec)
}

/** Phase-continuous sine with an exponential pitch sweep. */
function pitchSweep(
  lenSec: number,
  fromHz: number,
  toHz: number,
  sweepTau: number,
  ampTau: number,
): Float32Array {
  const n = seconds(lenSec)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / DRUM_KIT_SAMPLE_RATE
    const f = toHz + (fromHz - toHz) * Math.exp(-t / sweepTau)
    phase += (2 * Math.PI * f) / DRUM_KIT_SAMPLE_RATE
    const attack = Math.min(1, i / (0.002 * DRUM_KIT_SAMPLE_RATE))
    out[i] = Math.sin(phase) * expEnv(i, ampTau) * attack
  }
  return out
}

function noiseBurst(lenSec: number, tau: number, seed: number): Float32Array {
  const n = seconds(lenSec)
  const rand = mulberry32(seed)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const attack = Math.min(1, i / (0.0005 * DRUM_KIT_SAMPLE_RATE))
    out[i] = (rand() * 2 - 1) * expEnv(i, tau) * attack
  }
  return out
}

function mixInto(dst: Float32Array, src: Float32Array, gain: number): void {
  const n = Math.min(dst.length, src.length)
  for (let i = 0; i < n; i++) dst[i]! += src[i]! * gain
}

// ── Synth voices (Electronic kit) ────────────────────────────────────────────

function synthKick(): Float32Array {
  const body = pitchSweep(0.22, 150, 50, 0.03, 0.045)
  const click = highpass(noiseBurst(0.004, 0.002, 101), 3500, 2)
  const out = new Float32Array(body.length)
  mixInto(out, body, 1)
  mixInto(out, click, 0.4)
  return normalizeTo(out, 0.95)
}

function synthSnare(): Float32Array {
  const out = new Float32Array(seconds(0.28))
  // Body: a short pitched thump (drops fast so the crack dominates).
  mixInto(out, pitchSweep(0.1, 210, 165, 0.04, 0.045), 0.55)
  mixInto(out, pitchSweep(0.08, 320, 300, 0.05, 0.035), 0.25)
  // Crack: bright wire noise 1.5–8 kHz — this is what reads as "snare"
  // against a hat-heavy mix; the previous 0.8–5 kHz band buried it.
  const crack = lowpass(highpass(noiseBurst(0.2, 0.055, 202), 1500, 1), 8000, 1)
  mixInto(out, crack, 1.4)
  // Rattle tail: softer, darker noise ringing a touch longer.
  const rattle = lowpass(highpass(noiseBurst(0.28, 0.11, 212), 700, 1), 4000, 1)
  mixInto(out, rattle, 0.4)
  return normalizeTo(out, 0.95)
}

function synthHihat(): Float32Array {
  return normalizeTo(highpass(noiseBurst(0.08, 0.018, 303), 7000, 2), 0.95)
}

function synthTom(): Float32Array {
  const out = new Float32Array(seconds(0.35))
  mixInto(out, pitchSweep(0.35, 200, 120, 0.08, 0.11), 1)
  mixInto(out, lowpass(noiseBurst(0.02, 0.01, 404), 2000, 1), 0.15)
  return normalizeTo(out, 0.95)
}

function synthCymbal(): Float32Array {
  return normalizeTo(highpass(noiseBurst(1.2, 0.3, 505), 4000, 1), 0.95)
}

// ── Acoustic-leaning synthesized fallback voices ─────────────────────────────
// Warmer, rounder variants used for any acoustic-kit voice without a sample
// on disk: lower click, longer decays, band-passed (not razor-HP) metals.

function acousticKickFallback(): Float32Array {
  const body = pitchSweep(0.3, 110, 46, 0.045, 0.09)
  const beater = lowpass(highpass(noiseBurst(0.006, 0.003, 606), 1500, 1), 6000, 1)
  const out = new Float32Array(body.length)
  mixInto(out, body, 1)
  mixInto(out, beater, 0.25)
  return normalizeTo(out, 0.95)
}

function acousticSnareFallback(): Float32Array {
  const out = new Float32Array(seconds(0.32))
  mixInto(out, pitchSweep(0.16, 175, 168, 0.4, 0.09), 0.55)
  mixInto(out, pitchSweep(0.12, 330, 320, 0.4, 0.06), 0.2)
  const wire = lowpass(highpass(noiseBurst(0.32, 0.11, 707), 600, 1), 7500, 1)
  mixInto(out, wire, 0.85)
  return normalizeTo(out, 0.95)
}

function acousticHihatFallback(): Float32Array {
  return normalizeTo(lowpass(highpass(noiseBurst(0.11, 0.03, 808), 5500, 2), 10000, 1), 0.95)
}

function acousticTomFallback(): Float32Array {
  const out = new Float32Array(seconds(0.45))
  mixInto(out, pitchSweep(0.45, 165, 95, 0.11, 0.16), 1)
  mixInto(out, lowpass(noiseBurst(0.03, 0.015, 909), 1500, 1), 0.12)
  return normalizeTo(out, 0.95)
}

function acousticCymbalFallback(): Float32Array {
  return normalizeTo(lowpass(highpass(noiseBurst(1.6, 0.45, 1010), 3000, 1), 9500, 1), 0.95)
}

/** Per-voice level trims applied after peak normalization (kit balance). */
const VOICE_MIX_GAIN: Record<DrumClass, number> = {
  kick: 1.0,
  snare: 1.0,
  hihat: 0.32,
  tom: 0.8,
  cymbal: 0.45,
}

function withMixGains(voices: Record<DrumClass, Float32Array>): Record<DrumClass, Float32Array> {
  const out = {} as Record<DrumClass, Float32Array>
  for (const cls of Object.keys(voices) as DrumClass[]) {
    const src = voices[cls]
    const scaled = new Float32Array(src.length)
    for (let i = 0; i < src.length; i++) scaled[i] = src[i]! * VOICE_MIX_GAIN[cls]
    out[cls] = scaled
  }
  return out
}

export function buildSynthKit(): Record<DrumClass, Float32Array> {
  return withMixGains({
    kick: synthKick(),
    snare: synthSnare(),
    hihat: synthHihat(),
    tom: synthTom(),
    cymbal: synthCymbal(),
  })
}

export function buildAcousticFallbackVoices(): Record<DrumClass, Float32Array> {
  return withMixGains({
    kick: acousticKickFallback(),
    snare: acousticSnareFallback(),
    hihat: acousticHihatFallback(),
    tom: acousticTomFallback(),
    cymbal: acousticCymbalFallback(),
  })
}

// ── Kit loading (browser: fetch samples; everywhere: synth fallback) ────────

const kitCache = new Map<DrumKitId, Promise<DrumKit>>()

/**
 * Decode arbitrary audio bytes into a kit voice: mono, 44.1 kHz,
 * peak-normalized. Browser-only (needs `decodeAudioData`); null on failure.
 */
export async function decodeToKitVoice(bytes: ArrayBuffer): Promise<Float32Array | null> {
  if (typeof AudioContext === 'undefined') return null
  try {
    const ac = new AudioContext({ sampleRate: DRUM_KIT_SAMPLE_RATE })
    try {
      const buf = await ac.decodeAudioData(bytes)
      // Downmix to mono + resample to the kit rate.
      const mono = new Float32Array(buf.length)
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch)
        for (let i = 0; i < d.length; i++) mono[i]! += d[i]! / buf.numberOfChannels
      }
      const destLen = Math.ceil((buf.length * DRUM_KIT_SAMPLE_RATE) / buf.sampleRate)
      const resampled =
        buf.sampleRate === DRUM_KIT_SAMPLE_RATE
          ? mono
          : linearResampleMono(mono, buf.sampleRate, destLen, DRUM_KIT_SAMPLE_RATE)
      return normalizeTo(resampled, 0.95)
    } finally {
      await ac.close().catch(() => {})
    }
  } catch {
    return null
  }
}

/**
 * Assemble the user's kit from whatever one-shots they provided (already
 * decoded via `decodeToKitVoice`). Same level treatment as bundled kits —
 * peak-normalized input, per-voice mix gain — and any missing voice falls
 * back to the warm acoustic synth so the kit always plays complete.
 */
export function buildCustomKit(samples: Partial<Record<DrumClass, Float32Array>>): DrumKit {
  const fallback = buildAcousticFallbackVoices()
  const voices = { ...fallback }
  for (const cls of Object.keys(VOICE_MIX_GAIN) as DrumClass[]) {
    const s = samples[cls]
    if (!s || s.length === 0) continue
    const scaled = new Float32Array(s.length)
    const g = VOICE_MIX_GAIN[cls]
    for (let i = 0; i < s.length; i++) scaled[i] = s[i]! * g
    voices[cls] = scaled
  }
  return { id: 'custom', label: 'Your kit', voices }
}

async function fetchAcousticSample(cls: DrumClass): Promise<Float32Array | null> {
  if (typeof fetch !== 'function') return null
  try {
    const res = await fetch(`/drums/acoustic/${cls}.wav`)
    if (!res.ok) return null
    return await decodeToKitVoice(await res.arrayBuffer())
  } catch {
    return null
  }
}

export function loadDrumKit(id: DrumKitId): Promise<DrumKit> {
  const cached = kitCache.get(id)
  if (cached) return cached
  const p = (async (): Promise<DrumKit> => {
    if (id === 'synth') {
      return { id, label: 'Electronic kit', voices: buildSynthKit() }
    }
    if (id === 'custom') {
      // The custom kit needs project context (`loadProjectDrumKit`); this
      // path is the no-samples fallback so callers always get a playable kit.
      return buildCustomKit({})
    }
    const fallback = buildAcousticFallbackVoices()
    const voices = { ...fallback }
    const classes: DrumClass[] = ['kick', 'snare', 'hihat', 'tom', 'cymbal']
    await Promise.all(
      classes.map(async (cls) => {
        const sample = await fetchAcousticSample(cls)
        if (sample) {
          const scaled = new Float32Array(sample.length)
          const g = VOICE_MIX_GAIN[cls]
          for (let i = 0; i < sample.length; i++) scaled[i] = sample[i]! * g
          voices[cls] = scaled
        }
      }),
    )
    return { id, label: 'Acoustic kit', voices }
  })()
  kitCache.set(id, p)
  return p
}
