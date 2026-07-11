/**
 * Strict chord-token parsing for chord-sheet import.
 *
 * `parseChordText` (the chord-entry parser) is deliberately LENIENT: it
 * silently ignores anything it can't consume, so `"Baby"` parses as B major
 * and `"Am9"` as A major. That's fine for a chord input box, fatal for
 * classifying pasted sheet lines. This module owns a full-consumption
 * grammar: a token either matches the whole chord grammar or it is not a
 * chord. Interpretation maps rich symbols (m9, 7sus4, dim7, alterations) to
 * the nearest `ChordSymbol` the app models, while `displayRaw` keeps the
 * original token verbatim so `Am9` / `E7b9` render exactly as imported.
 */
import type { Accidental, ChordSymbol, NoteName } from '$lib/songmap/types'

const NOTE_NAMES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

/** Sheet decorations that may sit on a chord line without being chords. */
const DECORATION = [
  /^\|+$/, // bar separators
  /^%+$/, // repeat-previous-bar marks
  /^\*+$/, // footnote stars
  /^[x×]\s*\d+$/i, // x2
  /^[\[(]\s*[x×]\s*\d+\s*[\])]$/i, // (x2), [x3]
  /^N\.?C\.?$/i, // no chord
  /^-+$/, // dashes used as spacers
]

export function isDecorationToken(token: string): boolean {
  return DECORATION.some((re) => re.test(token))
}

/** `|` / `||` — bar separators. Chords between pipes share one bar. */
export function isBarSeparatorToken(token: string): boolean {
  return /^\|+$/.test(token)
}

/** Repeat tag value: `x2` → 2, `(x3)` → 3, `[X 4]` → 4; null otherwise. */
export function repeatTagCount(token: string): number | null {
  const m = token.match(/^[\[(]?\s*[x×]\s*(\d{1,2})\s*[\])]?$/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n >= 2 && n <= 16 ? n : null
}

function normalizeUnicode(s: string): string {
  return s.replace(/[♯♯]/g, '#').replace(/[♭♭]/g, 'b').replace(/°/g, 'dim')
}

/** Root: UPPERCASE letter only (lowercase roots are English words in sheets). */
function eatStrictRoot(s: string): { root: NoteName; accidental?: Accidental; rest: string } | null {
  const L = s[0]
  if (!L || !NOTE_NAMES.has(L)) return null
  let i = 1
  let delta = 0
  while (i < s.length && (s[i] === '#' || s[i] === 'b')) {
    // A lowercase 'b' is only a flat when NOT followed by a letter that would
    // make it a word ("Bbm" flat, "Baby" not). One accidental max.
    if (s[i] === 'b' && /[a-z]/.test(s[i + 1] ?? '') && !/^b(?:m|maj|min|mi|dim|aug|sus|add)/.test(s.slice(i))) {
      break
    }
    delta += s[i] === '#' ? 1 : -1
    i++
    if (Math.abs(delta) > 1) return null
    break // exactly zero or one accidental in sheet chords
  }
  return {
    root: L as NoteName,
    accidental: delta === 1 ? 'sharp' : delta === -1 ? 'flat' : undefined,
    rest: s.slice(i),
  }
}

/** Alteration tails: b5 #9 b9 #11 b13 (repeatable), with or without parens. */
const ALTERATION = /^(?:[b#](?:5|6|9|11|13))+$/
const PAREN_TENSION = /^\((?:add)?[b#]?(?:2|4|5|6|9|11|13)(?:[,/]\s*[b#]?(?:2|4|5|6|9|11|13))*\)$/

type Interpreted = { quality: string; extensions?: string[] }

/**
 * Match the full post-root tail (before any slash bass). Returns the nearest
 * modeled interpretation, or null when the tail isn't chord grammar.
 */
function interpretTail(tail: string): Interpreted | null {
  // Peel trailing parenthesized tensions and bare alteration runs — they
  // refine color but don't change the modeled quality.
  let core = tail
  for (;;) {
    const paren = core.match(/\((?:[^()]*)\)$/)
    if (paren && PAREN_TENSION.test(paren[0])) {
      core = core.slice(0, -paren[0].length)
      continue
    }
    const alt = core.match(/(?:[b#](?:5|6|9|11|13))+$/)
    if (alt && alt[0] !== core) {
      core = core.slice(0, -alt[0].length)
      continue
    }
    break
  }

  // 6/9 handled by caller (slash split); here core has no '/'.
  switch (core) {
    case '':
      return { quality: 'major' }
    case '5':
      return { quality: 'major' } // power chord ≈ major triad
    case '6':
      return { quality: 'major' }
    case '2':
      return { quality: 'sus2' }
    case '4':
      return { quality: 'sus4' }
    case '7':
      return { quality: '7' }
    case '9':
      return { quality: '7', extensions: ['9'] }
    case '11':
      return { quality: '7', extensions: ['11'] }
    case '13':
      return { quality: '7', extensions: ['13'] }
  }

  // minor family: m, min, mi, - (lowercase only — 'M' means major)
  let m = core.match(/^(?:m|min|mi|-)(?![a-z])(6|7|9|11|13)?$/)
  if (m && /^(?:m|min|mi|-)/.test(core)) {
    const n = m[1]
    if (!n || n === '6') return { quality: 'minor' }
    if (n === '7') return { quality: 'min7' }
    return { quality: 'min7', extensions: [n] }
  }
  // half-diminished: m7b5 already peeled to m7 by alteration strip; ø explicit
  if (core === 'ø' || core === 'ø7') return { quality: 'min7' }

  // major-7 family: maj7 / Maj9 / M7 / M9 / maj (bare)
  m = core.match(/^(?:maj|Maj|MAJ|M)(6|7|9|11|13)?$/)
  if (m) {
    const n = m[1]
    if (!n || n === '6') return { quality: 'major' }
    if (n === '7') return { quality: 'maj7' }
    return { quality: 'maj7', extensions: [n] }
  }

  // diminished: dim, dim7 (° normalized to dim); bare 'o' NOT accepted ("Do", "Go")
  if (core === 'dim' || core === 'dim7' || core === 'o7') return { quality: 'dim' }

  // augmented: aug, aug7, +, +7
  if (core === 'aug' || core === 'aug7' || core === '+' || core === '+7') return { quality: 'aug' }

  // suspensions: sus, sus2, sus4, 7sus4, 7sus2, 9sus4
  m = core.match(/^(7|9)?sus(2|4)?$/)
  if (m) {
    return { quality: m[2] === '2' ? 'sus2' : 'sus4' }
  }

  // added tones: add9, add2, add4, add11, madd9…
  m = core.match(/^(m)?add(2|4|9|11|13)$/)
  if (m) {
    return m[1] ? { quality: 'minor' } : { quality: 'add9' }
  }

  return null
}

export type StrictChordParse = { ok: true; chord: ChordSymbol } | { ok: false }

/**
 * Parse one whitespace-delimited sheet token as a chord — full consumption,
 * uppercase root required. `displayRaw` is the ORIGINAL token, verbatim.
 */
export function parseStrictChordToken(rawToken: string): StrictChordParse {
  const token = rawToken.trim()
  if (!token.length || token.length > 16) return { ok: false }
  const s = normalizeUnicode(token)

  // Split off a slash bass — but "6/9" is a chord color, not a bass note.
  let mainPart = s
  let bassPart = ''
  const slashIdx = s.indexOf('/')
  if (slashIdx >= 0) {
    if (s.endsWith('6/9') && s.indexOf('/') === s.length - 2) {
      mainPart = s.slice(0, -2) // treat as ...6 → major family
    } else {
      mainPart = s.slice(0, slashIdx)
      bassPart = s.slice(slashIdx + 1)
      if (!bassPart.length || bassPart.includes('/')) return { ok: false }
    }
  }

  const rootParsed = eatStrictRoot(mainPart)
  if (!rootParsed) return { ok: false }

  const tail = interpretTail(rootParsed.rest)
  if (!tail) return { ok: false }

  let bass: NoteName | undefined
  let bassAccidental: Accidental | undefined
  if (bassPart.length) {
    const bp = eatStrictRoot(bassPart)
    if (!bp || bp.rest.length > 0) return { ok: false }
    bass = bp.root
    bassAccidental = bp.accidental
  }

  return {
    ok: true,
    chord: {
      root: rootParsed.root,
      accidental: rootParsed.accidental,
      quality: tail.quality,
      extensions: tail.extensions,
      bass,
      bassAccidental,
      displayRaw: token,
    },
  }
}
