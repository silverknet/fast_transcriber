import type { Accidental, NoteName } from '$lib/songmap/types'

/** C = 0 … B = 11 */
export const LETTER_PC: Record<NoteName, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

export function chordRootToPitchClass(root: NoteName, accidental?: Accidental): number {
  let pc = LETTER_PC[root]
  if (accidental === 'sharp') pc = (pc + 1) % 12
  if (accidental === 'flat') pc = (pc + 11) % 12
  if (accidental === 'natural') {
    /* treat as explicit natural — rarely used */
  }
  return pc % 12
}

/** Pick spelling with preference for sharps vs flats in key of `preferFlats` (e.g. F major → flats). */
export function pitchClassToRootAcc(
  pc: number,
  preferFlats: boolean,
): { root: NoteName; accidental?: Accidental } {
  const p = ((pc % 12) + 12) % 12
  const sharpNames: { root: NoteName; accidental?: Accidental }[] = [
    { root: 'C' },
    { root: 'C', accidental: 'sharp' },
    { root: 'D' },
    { root: 'D', accidental: 'sharp' },
    { root: 'E' },
    { root: 'F' },
    { root: 'F', accidental: 'sharp' },
    { root: 'G' },
    { root: 'G', accidental: 'sharp' },
    { root: 'A' },
    { root: 'A', accidental: 'sharp' },
    { root: 'B' },
  ]
  const flatNames: { root: NoteName; accidental?: Accidental }[] = [
    { root: 'C' },
    { root: 'D', accidental: 'flat' },
    { root: 'D' },
    { root: 'E', accidental: 'flat' },
    { root: 'E' },
    { root: 'F' },
    { root: 'G', accidental: 'flat' },
    { root: 'G' },
    { root: 'A', accidental: 'flat' },
    { root: 'A' },
    { root: 'B', accidental: 'flat' },
    { root: 'B' },
  ]
  return preferFlats ? flatNames[p]! : sharpNames[p]!
}

export function transposePitchClass(pc: number, semitones: number): number {
  return (((pc + semitones) % 12) + 12) % 12
}

