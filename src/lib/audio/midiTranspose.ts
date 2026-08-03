import { clampTransposeSemitones } from '$lib/songmap/transposition'

export function transposeMidiNote(midi: number, semitones: number): number {
  const note = Math.round(midi)
  const n = clampTransposeSemitones(Math.round(semitones))
  return Math.max(0, Math.min(127, note + n))
}
