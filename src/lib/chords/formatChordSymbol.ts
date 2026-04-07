import type { Accidental, ChordSymbol, NoteName } from '$lib/songmap/types'

function formatRoot(root: NoteName, accidental?: Accidental): string {
  let s = root
  if (accidental === 'sharp') s += '#'
  else if (accidental === 'flat') s += 'b'
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
}

/**
 * Format structured chord for display (ASCII `#` `b`).
 */
export function formatChordSymbol(chord: ChordSymbol, _opts?: FormatOptions): string {
  let s = formatRoot(chord.root, chord.accidental)
  s += qualitySuffix(chord.quality, chord.extensions)
  if (chord.bass) {
    s += '/' + formatRoot(chord.bass, chord.bassAccidental)
  }
  return s
}
