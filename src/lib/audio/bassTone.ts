/**
 * The bass machine's VOICE — parameters only.
 *
 * These mirror `SynthPatch` (chordBass.ts's `BASS_PATCH`) field for field, and
 * `renderBassVoice.ts` feeds them to the SAME Web Audio nodes `KeysSynth`
 * builds — so the programmed bass and the one you play in the chords view are
 * the same instrument, not a lookalike.
 */
import type { OscType } from './keysSynth'

export type BassTone = {
  /** Main oscillator — harmonic definition. */
  waveA: OscType
  /** Second oscillator — weight at the fundamental. */
  waveB: OscType
  /** 0..1 level, like `SynthPatch.oscA.level`. */
  levelA: number
  levelB: number
  /** Cents. */
  detuneA: number
  detuneB: number
  /** Lowpass cutoff in Hz. */
  cutoffHz: number
  /** 0..1 filter resonance. */
  resonance: number
  /** 0..1 — how much velocity opens the filter. */
  velToCutoff: number
  /** ADSR, seconds (sustain is a 0..1 level). */
  attack: number
  decay: number
  sustain: number
  release: number
  /** 0..1 soft saturation — grit so the line cuts through a mix. */
  drive: number
}

/** `BASS_PATCH` from the chords view, as offline-renderable parameters. */
export const DEFAULT_BASS_TONE: BassTone = {
  waveA: 'sawtooth',
  waveB: 'sine',
  // BOTH near full, exactly as BASS_PATCH has them — the pair sums hot into
  // the filter and drive, which is a large part of that sound's weight.
  levelA: 0.9,
  levelB: 0.9,
  detuneA: 0,
  detuneB: 0,
  cutoffHz: 650,
  resonance: 0.9,
  velToCutoff: 0.5,
  attack: 0.004,
  decay: 0.22,
  sustain: 0.72,
  release: 0.14,
  drive: 0.28,
}

/** Presets, so you don't have to dial every knob to change character. */
export const BASS_TONE_PRESETS: { id: string; label: string; tone: BassTone }[] = [
  { id: 'finger', label: 'Finger', tone: DEFAULT_BASS_TONE },
  {
    id: 'round',
    label: 'Round',
    tone: {
      ...DEFAULT_BASS_TONE,
      waveA: 'triangle',
      levelB: 1,
      cutoffHz: 420,
      resonance: 0.4,
      drive: 0.12,
    },
  },
  {
    id: 'pick',
    label: 'Pick',
    tone: {
      ...DEFAULT_BASS_TONE,
      cutoffHz: 1400,
      resonance: 1.3,
      attack: 0.002,
      decay: 0.12,
      sustain: 0.5,
      drive: 0.42,
    },
  },
  {
    id: 'sub',
    label: 'Sub',
    tone: {
      ...DEFAULT_BASS_TONE,
      waveA: 'sine',
      waveB: 'sine',
      levelB: 1,
      cutoffHz: 260,
      resonance: 0.2,
      drive: 0.05,
    },
  },
  {
    id: 'synthGrowl',
    label: 'Growl',
    tone: {
      ...DEFAULT_BASS_TONE,
      waveA: 'sawtooth',
      waveB: 'square',
      levelB: 0.6,
      cutoffHz: 900,
      resonance: 2.2,
      velToCutoff: 0.8,
      drive: 0.55,
    },
  },
]

const OSC_TYPES: OscType[] = ['sine', 'triangle', 'sawtooth', 'square']

export function isOscType(v: unknown): v is OscType {
  return typeof v === 'string' && (OSC_TYPES as string[]).includes(v)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Fill in anything missing/out of range — a partial tone still renders. */
export function normalizeBassTone(t: Partial<BassTone> | undefined): BassTone {
  const d = DEFAULT_BASS_TONE
  return {
    waveA: isOscType(t?.waveA) ? t.waveA : d.waveA,
    waveB: isOscType(t?.waveB) ? t.waveB : d.waveB,
    levelA: clamp(t?.levelA ?? d.levelA, 0, 1),
    levelB: clamp(t?.levelB ?? d.levelB, 0, 1),
    detuneA: clamp(t?.detuneA ?? d.detuneA, -50, 50),
    detuneB: clamp(t?.detuneB ?? d.detuneB, -50, 50),
    cutoffHz: clamp(t?.cutoffHz ?? d.cutoffHz, 40, 8000),
    resonance: clamp(t?.resonance ?? d.resonance, 0, 4),
    velToCutoff: clamp(t?.velToCutoff ?? d.velToCutoff, 0, 1),
    attack: clamp(t?.attack ?? d.attack, 0.0005, 1),
    decay: clamp(t?.decay ?? d.decay, 0.005, 2),
    sustain: clamp(t?.sustain ?? d.sustain, 0, 1),
    release: clamp(t?.release ?? d.release, 0.005, 2),
    drive: clamp(t?.drive ?? d.drive, 0, 1),
  }
}
