/**
 * Richer voicing for CHORD PLAYBACK (the "Hear chords" feature), distinct from
 * the picker's plain root-position `chordVoicingMidi`. Goals:
 *
 *   - Voice-lead with INVERSIONS: each chord's tones are placed at the octave
 *     nearest a moving centre, so consecutive chords sit in the same register
 *     and share common-tone positions instead of every chord being a root-
 *     position stack that leaps around.
 *   - VARY the note count: triads bloom (root/third doubled up an octave → ~5
 *     notes); sevenths/extensions stay leaner, so density differs chord-to-chord.
 *   - Keep a BASS note (root, or the slash bass) low under the voicing — not
 *     critical to the harmony given the inversions, but it grounds each chord.
 *   - An OCTAVE offset shifts the whole thing up/down.
 *
 * Sequence-based: voice leading needs the previous chord, so it voices the whole
 * ordered progression at once. `null` / N.C. entries voice to `[]` (silence) and
 * carry the centre forward so the chord after a rest still connects.
 */
import type { ChordSymbol } from '$lib/songmap/types'
import { chordIntervalSemitones } from '$lib/chords/chordVoicing'
import { chordRootToPitchClass } from '$lib/chords/pitchClass'

/**
 * FIXED target centres (before the octave offset): the upper voicing sits around
 * G3/A3 and the bass around F2. Fixed — NOT moving — on purpose: a per-chord
 * moving centre drifts upward over a song (rounding bias) and everything ends up
 * far too high. A constant centre keeps every chord in the same comfortable
 * register, and close voicing still gives the inversions + voice leading.
 */
const UPPER_CENTER = 55
const BASS_CENTER = 41
const MIDI_MIN = 28
const MIDI_MAX = 96

/** The octave of pitch-class `pc` whose MIDI note is nearest `target`. */
function nearestOctaveTo(pc: number, target: number): number {
  return pc + 12 * Math.round((target - pc) / 12)
}

/** Intervals from the root that sound "strong" on an outer voice (root/3rd/5th, incl. dim/aug 5). */
const STRONG_INTERVALS = new Set([0, 3, 4, 6, 7, 8])
function isStrongOverRoot(midi: number, rootPc: number): boolean {
  return STRONG_INTERVALS.has((((midi - rootPc) % 12) + 12) % 12)
}
const clampMidi = (n: number): number => Math.max(MIDI_MIN, Math.min(MIDI_MAX, n))

export function voiceChordProgression(
  chords: readonly (ChordSymbol | null)[],
  octaveOffset = 0,
): number[][] {
  const shift = octaveOffset * 12
  const center = UPPER_CENTER + shift
  const bassCenter = BASS_CENTER + shift
  const out: number[][] = []

  for (const chord of chords) {
    if (!chord || chord.noChord) {
      out.push([])
      continue
    }

    const rootPc = chordRootToPitchClass(chord.root, chord.accidental)
    const tonePcs = [...new Set(chordIntervalSemitones(chord).map((iv) => (rootPc + iv) % 12))]
    const bassPc = chord.bass ? chordRootToPitchClass(chord.bass, chord.bassAccidental) : rootPc

    // Close voicing around the fixed centre → inversions + smooth connection,
    // same register every chord.
    const upper = tonePcs.map((pc) => nearestOctaveTo(pc, center)).sort((a, b) => a - b)

    // Doubling: a triad blooms to ~5 notes (its two lowest tones an octave up);
    // sevenths/extensions keep their own (larger) count, so density varies.
    const doubled = [...upper]
    if (tonePcs.length <= 3 && upper.length >= 2) {
      doubled.push(upper[0]! + 12, upper[1]! + 12)
    }
    doubled.sort((a, b) => a - b)

    // Bias a STRONG chord tone (root / 3rd / 5th) onto the top voice: a tension
    // (7th, 9th, …) crowning the chord sounds thin, so drop it an octave and let
    // a stronger tone sit on top. The bottom is already the root/slash bass.
    if (doubled.length > 1 && !isStrongOverRoot(doubled[doubled.length - 1]!, rootPc)) {
      doubled[doubled.length - 1]! -= 12
      doubled.sort((a, b) => a - b)
    }

    // Bass: root/slash pc, low and clearly beneath the voicing.
    let bass = nearestOctaveTo(bassPc, bassCenter)
    while (bass > doubled[0]! - 5) bass -= 12

    out.push([...new Set([bass, ...doubled].map(clampMidi))].sort((a, b) => a - b))
  }

  return out
}
