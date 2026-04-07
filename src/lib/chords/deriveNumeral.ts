import type { ChordSymbol, SongKey } from '$lib/songmap/types'
import { chordRootToPitchClass } from './pitchClass'

const MAJOR_NUM = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
const MINOR_NUM = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']

/**
 * Roman numeral when chord root is diatonic in key; full quality-aware extensions later.
 */
export function deriveNumeral(chord: ChordSymbol, key: SongKey): string | null {
  return deriveNumeralBasic(chord, key)
}

/** @internal For future use: degree index 0–6 or -1 */
export function chordRootDegreeInKey(chord: ChordSymbol, key: SongKey): number {
  const keyPc = chordRootToPitchClass(key.root, key.accidental)
  const chordPc = chordRootToPitchClass(chord.root, chord.accidental)
  const steps =
    key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]
  const cp = ((chordPc % 12) + 12) % 12
  for (let i = 0; i < steps.length; i++) {
    const p = (keyPc + steps[i]! + 120) % 12
    if (p === cp) return i
  }
  return -1
}

export function deriveNumeralBasic(chord: ChordSymbol, key: SongKey): string | null {
  const d = chordRootDegreeInKey(chord, key)
  if (d < 0) return null
  const table = key.mode === 'major' ? MAJOR_NUM : MINOR_NUM
  return table[d] ?? null
}
