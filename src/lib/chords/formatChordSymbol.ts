import type { Accidental, ChordSymbol, NoteName } from '$lib/songmap/types'

function formatRoot(root: NoteName, accidental: Accidental | undefined, unicode: boolean): string {
  let s: string = root
  if (accidental === 'sharp') s += unicode ? '♯' : '#'
  else if (accidental === 'flat') s += unicode ? '♭' : 'b'
  else if (accidental === 'natural') s += '♮'
  return s
}

/** Printed suffix for each modeled quality. */
const QUALITY_BASE: Record<string, string> = {
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
  // Dominants with a suspended fourth keep the seventh in the name.
  '7sus4': '7sus4',
  '9sus4': '9sus4',
  // Sixth chords. `minor6` was already emitted by the marking menu but had no
  // entry here, so it fell through to `map[q] ?? q` and printed "Fminor6".
  major6: '6',
  minor6: 'm6',
}

/**
 * Seventh-family stems where an extension REPLACES the seventh rather than
 * being appended: `min7` + `9` is `m9`, not `m79`.
 */
const SEVENTH_STEM: Record<string, string> = { '7': '', maj7: 'maj', min7: 'm' }

/** Highest extension wins — a 13th chord implies the 9th and 11th below it. */
function topExtension(extensions?: string[]): string | undefined {
  const nums = (extensions ?? []).filter(Boolean)
  if (!nums.length) return undefined
  return nums.reduce((a, b) => (Number(b) > Number(a) ? b : a))
}

function qualitySuffix(quality?: string, extensions?: string[], alterations?: string[]): string {
  const q = quality ?? 'major'
  let base = QUALITY_BASE[q] ?? q
  const top = topExtension(extensions)

  if (top !== undefined) {
    const stem = SEVENTH_STEM[q]
    if (stem !== undefined) {
      // 7→9/11/13, maj7→maj9/maj13, min7→m9/m11/m13
      base = `${stem}${top}`
    } else if (!base.includes(top)) {
      // A triad with an added tone: C + 9 reads as "Cadd9", not "C9"
      // (which would imply a dominant seventh).
      base += `add${top}`
    }
  }

  const color = (alterations ?? []).filter(Boolean).join('')
  return base + color
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
  s += qualitySuffix(chord.quality, chord.extensions, chord.alterations)
  if (chord.bass) {
    s += '/' + formatRoot(chord.bass, chord.bassAccidental, unicode)
  }
  return s
}
