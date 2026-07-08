import {
  chordRootToPitchClass,
  pitchClassToRootAcc,
  transposeChord,
  transposePitchClass,
  songKeyPreferFlats,
} from '$lib/chords'
import type { ChordSymbol, SongKey, SongMap } from './types'

export const MIN_TRANSPOSE_SEMITONES = -12
export const MAX_TRANSPOSE_SEMITONES = 12

export function clampTransposeSemitones(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0
  return Math.max(
    MIN_TRANSPOSE_SEMITONES,
    Math.min(MAX_TRANSPOSE_SEMITONES, Math.trunc(semitones)),
  )
}

export function formatTransposeLabel(semitones: number): string {
  const n = clampTransposeSemitones(semitones)
  return n > 0 ? `+${n}` : String(n)
}

export function effectiveTransposeSemitones(songMap: SongMap | null | undefined, localOffset = 0): number {
  return clampTransposeSemitones((songMap?.transpose?.baseSemitones ?? 0) + localOffset)
}

export function transposeSongKey(key: SongKey, semitones: number): SongKey {
  const n = clampTransposeSemitones(semitones)
  if (n === 0) return { ...key }
  const preferFlats = songKeyPreferFlats(key)
  const pc = chordRootToPitchClass(key.root, key.accidental)
  const next = pitchClassToRootAcc(transposePitchClass(pc, n), preferFlats)
  return {
    root: next.root,
    ...(next.accidental ? { accidental: next.accidental } : {}),
    mode: key.mode,
  }
}

export function transposeChordForDisplay(
  chord: ChordSymbol,
  semitones: number,
  displayedKey?: SongKey,
): ChordSymbol {
  const n = clampTransposeSemitones(semitones)
  if (n === 0) return chord
  return transposeChord(chord, n, displayedKey ? songKeyPreferFlats(displayedKey) : false)
}

export function transposeChordForStorage(
  displayedChord: ChordSymbol,
  semitones: number,
  sourceKey?: SongKey,
): ChordSymbol {
  const n = clampTransposeSemitones(semitones)
  if (n === 0) return displayedChord
  return transposeChord(displayedChord, -n, sourceKey ? songKeyPreferFlats(sourceKey) : false)
}
