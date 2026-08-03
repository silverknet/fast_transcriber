import type { ChordSymbol } from '$lib/songmap/types'
import { chordRootToPitchClass } from './pitchClass'

/**
 * A simple, recognizable voicing of a chord as MIDI note numbers — enough to
 * AUDITION the chord through the synth, not a production keyboard voicing.
 *
 * Notes are placed around middle C (root ≈ MIDI 60) so any chord in the picker
 * sits in a comfortable, comparable octave. A slash bass is voiced an octave
 * below the chord root. N.C. ("no chord") has no pitch, so it voices to nothing.
 */

/** Semitone offsets from the root for each modeled quality (mirrors the formatter's vocabulary). */
const QUALITY_INTERVALS: Record<string, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  '7sus4': [0, 5, 7, 10],
  '9sus4': [0, 5, 7, 10, 14],
  major6: [0, 4, 7, 9],
  minor6: [0, 3, 7, 9],
}

/** Upper-structure extensions add a tone above the base triad/seventh. */
const EXTENSION_INTERVAL: Record<string, number> = { '9': 14, '11': 17, '13': 21 }

/** Root octave for auditioning — middle-C region keeps every chord comparable. */
const ROOT_MIDI = 60

/**
 * Semitone offsets from the root for a chord's tones (unique, ascending) — the
 * quality triad/seventh plus any 9/11/13 extensions and b5/#5 alterations. No
 * bass, no octave placement. Shared by the picker voicing and the richer
 * playback voicer. Unknown qualities fall back to a major triad.
 */
export function chordIntervalSemitones(chord: ChordSymbol): number[] {
  const base = QUALITY_INTERVALS[chord.quality ?? 'major'] ?? QUALITY_INTERVALS.major
  const intervals = new Set<number>(base)

  // Extensions (9 / 11 / 13) add the corresponding upper tone.
  for (const ext of chord.extensions ?? []) {
    const iv = EXTENSION_INTERVAL[ext]
    if (iv != null) intervals.add(iv)
  }

  // Colour alterations that move the fifth (others don't change recognizability).
  const alt = chord.alterations ?? []
  if (alt.includes('b5')) {
    intervals.delete(7)
    intervals.add(6)
  }
  if (alt.includes('#5')) {
    intervals.delete(7)
    intervals.add(8)
  }

  return [...intervals].sort((a, b) => a - b)
}

/**
 * MIDI notes for a chord, for audition. Root-position around middle C. Unknown
 * qualities fall back to a major triad so the picker never goes silent on an
 * exotic symbol. Returns `[]` for N.C. (no chord).
 */
export function chordVoicingMidi(chord: ChordSymbol): number[] {
  if (chord.noChord) return []

  const rootPc = chordRootToPitchClass(chord.root, chord.accidental)
  const notes = chordIntervalSemitones(chord).map((iv) => ROOT_MIDI + rootPc + iv)

  // Slash bass, voiced an octave below the chord root.
  if (chord.bass) {
    const bassPc = chordRootToPitchClass(chord.bass, chord.bassAccidental)
    notes.unshift(ROOT_MIDI - 12 + bassPc)
  }

  return notes
}
