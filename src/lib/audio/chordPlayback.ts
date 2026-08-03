/**
 * Hear the chords you've placed, in time with playback (chords view only).
 *
 * A dedicated {@link KeysSynth} — SEPARATE from the picker/keybed audition synth
 * so the two never fight over note numbers and each keeps its own volume. The
 * caller (the chords workspace) watches the transport playhead and calls
 * {@link playChordPlayback} whenever the sounding chord changes; this module just
 * turns a set of MIDI notes on/off. Its `AudioContext` is created lazily on the
 * first {@link resumeChordPlayback} (a user gesture), so importing is SSR-safe.
 */
import { KeysSynth, BUILTIN_PRESETS, structuredClonePatch, type SynthPatch } from './keysSynth'

const VELOCITY = 80

/**
 * The default: a neutral, TIGHT patch. Quick attack, short decay, a modest
 * sustain so a held chord is still audible, and — crucially — a SHORT release
 * with almost no reverb/delay, so each chord stops cleanly instead of bleeding
 * into the next. This is what "doesn't leak into other chords" needs.
 */
const CHORD_KEYS_PATCH: SynthPatch = {
  name: 'Chord Keys',
  // A warm ANALOG PAD: two detuned SAWTOOTHS (harmonically rich — sine/triangle
  // were the "plastic" thinness) through a warm low-pass with resonance for
  // character. A gentle attack swell, a slow filter LFO, and per-note drift keep
  // it evolving and organic instead of a dead-static digital note.
  oscA: { type: 'sawtooth', level: 1, detune: -11 },
  oscB: { type: 'sawtooth', level: 0.9, detune: 11 },
  filter: { cutoffHz: 2200, resonance: 1.4, velToCutoff: 0.35 },
  lfo: { rateHz: 0.18, depth: 0.3 }, // slow evolving filter movement
  env: { attack: 0.05, decay: 0.5, sustain: 0.7, release: 0.3 }, // gentle pad swell
  gain: 0.4, // saws are hotter — trim
  fx: {
    chorus: 0.6, // lush ensemble width
    delayMix: 0,
    delayTime: 0.3,
    delayFeedback: 0.25,
    reverbMix: 0.3, // spacious
    reverbSize: 2.8,
    highpassHz: 150, // clear the low mud so it sits above bass/kick
    reverbPredelay: 0.03, // keep each chord's attack clear before the tail
    reverbDamp: 3600, // dark, smooth tail (no fizzy top)
    drive: 0.2, // analog warmth/glue
    shimmer: 0.2, // twinkle on top
    analog: 0.55, // per-note detune drift so it's organic, not plastic
  },
}

/**
 * Instruments offered in the chords inspector picker — the tight default first,
 * then a few builtins (percussive → sustained), ending with the lush pad for
 * anyone who actually wants the long tail.
 */
export const CHORD_PLAYBACK_INSTRUMENTS: SynthPatch[] = [
  CHORD_KEYS_PATCH,
  ...['Electric Piano', 'Organ', 'Pluck', 'Lush Pad']
    .map((n) => BUILTIN_PRESETS.find((p) => p.name === n))
    .filter((p): p is SynthPatch => !!p),
]
export const CHORD_PLAYBACK_INSTRUMENT_NAMES = CHORD_PLAYBACK_INSTRUMENTS.map((p) => p.name)
export const DEFAULT_CHORD_PLAYBACK_INSTRUMENT = CHORD_KEYS_PATCH.name

let synth: KeysSynth | null = null
/** Notes currently sounding, so the next change releases exactly them. */
let sounding: number[] = []
let volume = 0.5
let currentPatch: SynthPatch = CHORD_KEYS_PATCH

function ensureSynth(): KeysSynth {
  if (!synth) {
    synth = new KeysSynth()
    synth.setPatch(currentPatch)
    synth.setVolume(volume)
  }
  return synth
}

/** Warm the audio context so the first chord isn't swallowed. Safe to call repeatedly. */
export async function resumeChordPlayback(): Promise<void> {
  try {
    await ensureSynth().resume()
  } catch {
    /* audio unavailable — hearing chords is optional, never block the editor */
  }
}

export function setChordPlaybackVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v))
  synth?.setVolume(volume)
}

/** A fresh copy of a named preset (falls back to the tight default). */
export function getInstrumentPatch(name: string): SynthPatch {
  return structuredClonePatch(CHORD_PLAYBACK_INSTRUMENTS.find((p) => p.name === name) ?? CHORD_KEYS_PATCH)
}

/** Replace the live chord-playback patch (knob edits + preset loads flow here). */
export function setChordPatch(patch: SynthPatch): void {
  currentPatch = structuredClonePatch(patch)
  synth?.setPatch(currentPatch) // FX apply live; osc/env affect the next chord
}

/**
 * Sound exactly `notes` as a fresh attack, releasing whatever was playing. An
 * empty array = silence (used for N.C. and for "before the first chord"), which
 * still releases the previous chord.
 */
export function playChordPlayback(notes: number[]): void {
  const s = ensureSynth()
  for (const n of sounding) s.noteOff(n)
  sounding = notes
  for (const n of notes) s.noteOn(n, VELOCITY)
}

/** Release whatever is currently sounding. */
export function stopChordPlayback(): void {
  if (!synth || sounding.length === 0) return
  for (const n of sounding) synth.noteOff(n)
  sounding = []
}
