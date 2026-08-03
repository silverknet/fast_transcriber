/**
 * Audition (hear) a chord through the synth while adding it in the chord picker.
 *
 * A single lazily-created {@link KeysSynth} is shared across every picker open so
 * we spin up just one low-latency `AudioContext`. The context is created on the
 * first user gesture (`resume()`), which keeps this module import-safe on the
 * server — nothing touches Web Audio until a real press happens in the browser.
 */
import type { ChordSymbol } from '$lib/songmap/types'
import { chordVoicingMidi } from '$lib/chords/chordVoicing'
import { KeysSynth, BUILTIN_PRESETS, DEFAULT_PATCH } from './keysSynth'

const AUDITION_VELOCITY = 96

let synth: KeysSynth | null = null
/** Notes currently sounding, so we can release exactly them on stop. */
let sounding: number[] = []

function ensureSynth(): KeysSynth {
  if (!synth) {
    synth = new KeysSynth()
    // Electric Piano reads as a clear, percussive "here's the chord" — falls
    // back to the init patch if the preset name ever changes.
    synth.setPatch(BUILTIN_PRESETS.find((p) => p.name === 'Electric Piano') ?? DEFAULT_PATCH)
    synth.setVolume(0.5)
  }
  return synth
}

/**
 * The shared audition synth. The chord picker plays it on press, and the APC
 * Key 25 keybed plays it while the chords section is open — one instrument, one
 * low-latency context, so both sound identical. Safe to call during SSR: the
 * `AudioContext` isn't created until the first {@link primeChordAudition}.
 */
export function getChordAuditionSynth(): KeysSynth {
  return ensureSynth()
}

/**
 * Warm up the audio context ahead of the first press so the initial chord isn't
 * swallowed while the context spins up. Safe to call on every picker open.
 */
export async function primeChordAudition(): Promise<void> {
  try {
    await ensureSynth().resume()
  } catch {
    /* audio unavailable — audition is a nice-to-have, never block the UI */
  }
}

/** Start sounding `chord` (replaces any currently-auditioned chord). No-op for N.C. */
export function auditionChord(chord: ChordSymbol): void {
  const notes = chordVoicingMidi(chord)
  if (notes.length === 0) return
  const s = ensureSynth()
  void s.resume() // the press is a user gesture; first note may still be quiet
  stopChordAudition()
  for (const n of notes) s.noteOn(n, AUDITION_VELOCITY)
  sounding = notes
}

/** Release whatever chord is currently sounding. */
export function stopChordAudition(): void {
  if (!synth || sounding.length === 0) return
  for (const n of sounding) synth.noteOff(n)
  sounding = []
}
