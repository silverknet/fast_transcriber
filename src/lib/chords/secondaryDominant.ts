import type { ChordSymbol } from '$lib/songmap/types'
import { chordRootToPitchClass, pitchClassToRootAcc, transposePitchClass } from './pitchClass'
import { formatChordSymbol } from './formatChordSymbol'

function dom7FromPc(pc: number, preferFlats: boolean): ChordSymbol {
  const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
  const c: ChordSymbol = { root, accidental, quality: '7', displayRaw: '' }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}

/**
 * Secondary dominant: dominant seventh built a perfect fifth above this chord’s root
 * (V⁷ / X when X is the row chord).
 */
export function dominantSeventhOfChordRoot(chord: ChordSymbol, preferFlats: boolean): ChordSymbol {
  const pc = chordRootToPitchClass(chord.root, chord.accidental)
  const domPc = transposePitchClass(pc, 7)
  return dom7FromPc(domPc, preferFlats)
}

/** Tritone substitute of a dominant seventh (same tritone, root moved by 6 semitones). */
export function tritoneSubOfDominantSeventh(dom7: ChordSymbol, preferFlats: boolean): ChordSymbol {
  const pc = chordRootToPitchClass(dom7.root, dom7.accidental)
  return dom7FromPc(transposePitchClass(pc, 6), preferFlats)
}
