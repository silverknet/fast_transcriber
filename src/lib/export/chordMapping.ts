import type { Accidental, SongKey } from '$lib/songmap'

export type MusicXmlChordKind = {
  value: string
  text?: string
}

function normalizedQuality(quality?: string): string {
  return (quality ?? '').trim().toLowerCase()
}

export function chordQualityToMusicXmlKind(quality?: string): MusicXmlChordKind {
  const q = normalizedQuality(quality)
  switch (q) {
    case '':
    case 'maj':
    case 'major':
      return { value: 'major' }
    case 'm':
    case 'min':
    case 'minor':
      return { value: 'minor' }
    case 'dim':
    case 'diminished':
      return { value: 'diminished' }
    case 'aug':
    case 'augmented':
      return { value: 'augmented' }
    case '7':
    case 'dom7':
    case 'dominant':
      return { value: 'dominant' }
    case 'maj7':
    case 'major7':
    case 'major-seventh':
      return { value: 'major-seventh' }
    case 'm7':
    case 'min7':
    case 'minor7':
    case 'minor-seventh':
      return { value: 'minor-seventh' }
    case 'sus2':
    case 'suspended-second':
      return { value: 'suspended-second' }
    case 'sus4':
    case 'sus':
    case 'suspended-fourth':
      return { value: 'suspended-fourth' }
    case 'add9':
      return { value: 'major', text: 'add9' }
    default:
      return { value: 'other', text: quality?.trim() || 'other' }
  }
}

function accidentalToken(accidental?: Accidental): string {
  if (accidental === 'sharp') return '#'
  if (accidental === 'flat') return 'b'
  return ''
}

function keyToken(root: SongKey['root'], accidental?: Accidental): string {
  return `${root}${accidentalToken(accidental)}`
}

const MAJOR_KEY_TO_FIFTHS: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  Gb: -6,
  Db: -5,
  Ab: -4,
  Eb: -3,
  Bb: -2,
  F: -1,
}

const MINOR_KEY_TO_FIFTHS: Record<string, number> = {
  A: 0,
  E: 1,
  B: 2,
  'F#': 3,
  'C#': 4,
  'G#': 5,
  Eb: -6,
  Bb: -5,
  F: -4,
  C: -3,
  G: -2,
  D: -1,
}

export function songKeyToFifths(key: SongKey): number {
  const token = keyToken(key.root, key.accidental)
  if (key.mode === 'minor') {
    return MINOR_KEY_TO_FIFTHS[token] ?? 0
  }
  return MAJOR_KEY_TO_FIFTHS[token] ?? 0
}
