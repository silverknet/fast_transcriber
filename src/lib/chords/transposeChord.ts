import type { ChordSymbol } from '$lib/songmap/types'
import { chordRootToPitchClass, pitchClassToRootAcc, transposePitchClass } from './pitchClass'
import { formatChordSymbol } from './formatChordSymbol'

/** Transpose chord by semitones (+ up, − down). Bass moves with chord (typical slash usage). */
export function transposeChord(chord: ChordSymbol, semitones: number, preferFlats?: boolean): ChordSymbol {
  // N.C. ("no chord") has no pitch to move — it never transposes.
  if (chord.noChord) return chord
  const pf = preferFlats ?? false
  const rootPc = chordRootToPitchClass(chord.root, chord.accidental)
  const nr = pitchClassToRootAcc(transposePitchClass(rootPc, semitones), pf)

  let bass: typeof chord.bass
  let bassAcc: typeof chord.bassAccidental
  if (chord.bass) {
    const bpc = chordRootToPitchClass(chord.bass, chord.bassAccidental)
    const nb = pitchClassToRootAcc(transposePitchClass(bpc, semitones), pf)
    bass = nb.root
    bassAcc = nb.accidental
  } else {
    bass = undefined
    bassAcc = undefined
  }

  const next: ChordSymbol = {
    ...chord,
    root: nr.root,
    accidental: nr.accidental,
    bass,
    bassAccidental: bassAcc,
    displayRaw: '',
  }
  next.displayRaw = formatChordSymbol(next, { preferFlats: pf })
  return next
}
