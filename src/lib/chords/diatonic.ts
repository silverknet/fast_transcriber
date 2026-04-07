import type { Accidental, ChordSymbol, NoteName, SongKey } from '$lib/songmap/types'
import { chordRootToPitchClass, pitchClassToRootAcc, transposePitchClass } from './pitchClass'
import { formatChordSymbol } from './formatChordSymbol'

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_NATURAL_STEPS = [0, 2, 3, 5, 7, 8, 10]

/** Major-key diatonic chord qualities per degree (0-based). */
const MAJOR_QUALITIES: string[] = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim']

/** Natural minor diatonic qualities. */
const MINOR_QUALITIES: string[] = ['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major']

function scaleStepsForKey(key: SongKey): number[] {
  const rootPc = chordRootToPitchClass(key.root, key.accidental)
  const base = key.mode === 'major' ? MAJOR_STEPS : MINOR_NATURAL_STEPS
  return base.map((s) => transposePitchClass(s, rootPc))
}

function buildChordAtDegree(
  key: SongKey,
  degreeIndex: number,
  useSeventh: boolean,
  preferFlats: boolean,
): ChordSymbol {
  const steps = scaleStepsForKey(key)
  const pc = steps[degreeIndex]!
  const qualities = key.mode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES
  let q = qualities[degreeIndex]!
  if (useSeventh) {
    if (q === 'dim') q = 'min7'
    else if (q === 'major') q = degreeIndex === 4 ? '7' : 'maj7'
    else if (q === 'minor') q = 'min7'
  }
  const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
  const chord: ChordSymbol = {
    root,
    accidental,
    quality: q,
    displayRaw: '',
  }
  chord.displayRaw = formatChordSymbol(chord, { preferFlats })
  return chord
}

/** Diatonic triads and seventh chords in key (14 entries: 7 triads + 7 sevenths). */
export function diatonicChordsInKey(key: SongKey, preferFlats: boolean): ChordSymbol[] {
  const out: ChordSymbol[] = []
  for (let d = 0; d < 7; d++) {
    out.push(buildChordAtDegree(key, d, false, preferFlats))
  }
  for (let d = 0; d < 7; d++) {
    out.push(buildChordAtDegree(key, d, true, preferFlats))
  }
  return out
}

/** Seven diatonic triads in scale order (I–VII). */
export function diatonicTriadsInKey(key: SongKey, preferFlats: boolean): ChordSymbol[] {
  const out: ChordSymbol[] = []
  for (let d = 0; d < 7; d++) {
    out.push(buildChordAtDegree(key, d, false, preferFlats))
  }
  return out
}

const ROMAN_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] as const
const ROMAN_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'] as const

export function diatonicDegreeRomanLabel(key: SongKey, degreeIndex: number): string {
  const row = key.mode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR
  return row[degreeIndex] ?? ''
}

function withQualityClone(base: ChordSymbol, quality: string, preferFlats: boolean): ChordSymbol {
  const c: ChordSymbol = {
    root: base.root,
    accidental: base.accidental,
    quality,
    extensions: undefined,
    bass: undefined,
    bassAccidental: undefined,
    displayRaw: '',
  }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}

/**
 * Common spellings for one diatonic degree (triad, seventh, sus/add where applicable).
 * Order: triad first, then typical extensions; duplicates removed.
 */
export function diatonicChordVariationsForDegree(
  key: SongKey,
  degreeIndex: number,
  preferFlats: boolean,
): ChordSymbol[] {
  const triad = buildChordAtDegree(key, degreeIndex, false, preferFlats)
  const seventh = buildChordAtDegree(key, degreeIndex, true, preferFlats)
  const q = triad.quality ?? 'major'
  const seen = new Set<string>()
  const out: ChordSymbol[] = []
  const push = (c: ChordSymbol) => {
    const label = formatChordSymbol(c, { preferFlats })
    if (seen.has(label)) return
    seen.add(label)
    out.push(c)
  }

  push(triad)
  push(seventh)

  if (q === 'major') {
    push(withQualityClone(triad, 'sus4', preferFlats))
    push(withQualityClone(triad, 'sus2', preferFlats))
    push(withQualityClone(triad, 'add9', preferFlats))
  } else if (q === 'minor') {
    push(withQualityClone(triad, 'sus4', preferFlats))
    push(withQualityClone(triad, 'add9', preferFlats))
  }
  return out
}

export function songKeyPreferFlats(key: SongKey): boolean {
  const pc = chordRootToPitchClass(key.root, key.accidental)
  const flatMajor = new Set([5, 10, 3, 8, 1, 6, 11])
  const flatMinor = new Set([8, 1, 3, 6, 10, 2, 5])
  return key.mode === 'major' ? flatMajor.has(pc) : flatMinor.has(pc)
}

function formatKeyRoot(root: NoteName, accidental?: Accidental): string {
  let s = root
  if (accidental === 'sharp') s += '#'
  else if (accidental === 'flat') s += 'b'
  else if (accidental === 'natural') s += '♮'
  return s
}

/** Human-readable key for `metadata.key` and UI labels. */
export function formatSongKeyLabel(key: SongKey): string {
  return `${formatKeyRoot(key.root, key.accidental)} ${key.mode === 'major' ? 'major' : 'minor'}`
}
