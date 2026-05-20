import type { Accidental, ChordSymbol, NoteName } from '$lib/songmap/types'

function formatRoot(root: NoteName, accidental: Accidental | undefined, unicode: boolean): string {
  let s: string = root
  if (accidental === 'sharp') s += unicode ? '♯' : '#'
  else if (accidental === 'flat') s += unicode ? '♭' : 'b'
  else if (accidental === 'natural') s += '♮'
  return s
}

function qualitySuffix(quality?: string, extensions?: string[]): string {
  const q = quality ?? 'major'
  const map: Record<string, string> = {
    major: '',
    minor: 'm',
    dim: 'dim',
    aug: 'aug',
    '7': '7',
    maj7: 'maj7',
    min7: 'm7',
    sus2: 'sus2',
    sus4: 'sus4',
    add9: 'add9',
  }
  let base = map[q] ?? q
  if (q === 'minor' && base === 'm') base = 'm'
  if (extensions?.length) {
    const ext = extensions.filter(Boolean).join('')
    if (q === '7' && ext) return `7(${ext})` // simplified — v1 use plain add
    if (ext && !base.includes(ext)) base += ext
  }
  return base
}

export type FormatOptions = {
  /** Prefer flats in root/bass spelling when ambiguous. */
  preferFlats?: boolean
  /** Emit Unicode `♯` / `♭` accidentals instead of ASCII `#` / `b`. */
  unicode?: boolean
}

/**
 * Format structured chord for display. ASCII by default (`Cm7/Bb`); pass
 * `{ unicode: true }` for typeset accidentals (`Cm7/B♭`) — used by the SVG
 * lead-sheet view where music typography matters and the font supports it.
 */
export function formatChordSymbol(chord: ChordSymbol, opts?: FormatOptions): string {
  const unicode = opts?.unicode ?? false
  let s = formatRoot(chord.root, chord.accidental, unicode)
  s += qualitySuffix(chord.quality, chord.extensions)
  if (chord.bass) {
    s += '/' + formatRoot(chord.bass, chord.bassAccidental, unicode)
  }
  return s
}
