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

type Interpreted = { quality: string; extensions?: string[]; alterations?: string[] }

/**
 * Match the full post-root tail (before any slash bass). Returns the nearest
 * modeled interpretation, or null when the tail isn't chord grammar.
 */
function interpretTail(tail: string): Interpreted | null {
  // Peel trailing parenthesized tensions and bare alteration runs — they
  // refine color but don't change the modeled quality. The peeled text is
  // KEPT (v6, `ChordSymbol.alterations`) so the lead sheet, the mixer rail and
  // transpose can all reproduce it; before v6 it was discarded here and an
  // imported `Bm7b5` rendered as `Bm7`.
  let core = tail
  const peeled: string[] = []
  for (;;) {
    const paren = core.match(/\((?:[^()]*)\)$/)
    if (paren && PAREN_TENSION.test(paren[0])) {
      peeled.unshift(paren[0])
      core = core.slice(0, -paren[0].length)
      continue
    }
    const alt = core.match(/(?:[b#](?:5|6|9|11|13))+$/)
    if (alt && alt[0] !== core) {
      // Split a run like `#9b13` into individual colour tones.
      peeled.unshift(...(alt[0].match(/[b#](?:5|6|9|11|13)/g) ?? [alt[0]]))
      core = core.slice(0, -alt[0].length)
      continue
    }
    break
  }
  const withColor = (i: Interpreted): Interpreted =>
    peeled.length ? { ...i, alterations: [...peeled, ...(i.alterations ?? [])] } : i

  // 6/9 handled by caller (slash split); here core has no '/'.
  switch (core) {
    case '':
      return withColor({ quality: 'major' })
    // Power chord: a bare fifth. Modeled as a major triad (no third is
    // asserted) but keeps the `5` so it doesn't print as a plain `C`.
    case '5':
      return withColor({ quality: 'major', alterations: ['5'] })
    case '6':
      return withColor({ quality: 'major6' })
    case '2':
      return withColor({ quality: 'sus2' })
    case '4':
      return withColor({ quality: 'sus4' })
    case '7':
      return withColor({ quality: '7' })
    case '9':
      return withColor({ quality: '7', extensions: ['9'] })
    case '11':
      return withColor({ quality: '7', extensions: ['11'] })
    case '13':
      return withColor({ quality: '7', extensions: ['13'] })
  }

  // minor family: m, min, mi, - (lowercase only — 'M' means major)
  let m = core.match(/^(?:m|min|mi|-)(?![a-z])(6|7|9|11|13)?$/)
  if (m && /^(?:m|min|mi|-)/.test(core)) {
    const n = m[1]
    if (!n) return withColor({ quality: 'minor' })
    if (n === '6') return withColor({ quality: 'minor6' })
    if (n === '7') return withColor({ quality: 'min7' })
    return withColor({ quality: 'min7', extensions: [n] })
  }
  // half-diminished: `m7b5` reaches here as `m7` with `b5` already peeled; the
  // `ø` shorthand carries no peelable text, so name the flat five explicitly.
  if (core === 'ø' || core === 'ø7') {
    return withColor({ quality: 'min7', alterations: ['b5'] })
  }

  // major-7 family: maj7 / Maj9 / M7 / M9 / maj (bare)
  m = core.match(/^(?:maj|Maj|MAJ|M)(6|7|9|11|13)?$/)
  if (m) {
    const n = m[1]
    if (!n) return withColor({ quality: 'major' })
    if (n === '6') return withColor({ quality: 'major6' })
    if (n === '7') return withColor({ quality: 'maj7' })
    return withColor({ quality: 'maj7', extensions: [n] })
  }

  // diminished: dim, dim7 (° normalized to dim); bare 'o' NOT accepted ("Do", "Go")
  if (core === 'dim') return withColor({ quality: 'dim' })
  // A diminished SEVENTH keeps its 7 in the name — `Bdim7`, not `Bdim`.
  if (core === 'dim7' || core === 'o7') return withColor({ quality: 'dim', alterations: ['7'] })

  // augmented: aug, aug7, +, +7
  if (core === 'aug' || core === 'aug7' || core === '+' || core === '+7') {
    return withColor({ quality: 'aug' })
  }

  // suspensions: sus, sus2, sus4, 7sus4, 7sus2, 9sus4. A dominant with a
  // suspended fourth keeps the seventh in its name (`C7sus4`).
  m = core.match(/^(7|9)?sus(2|4)?$/)
  if (m) {
    const seventh = m[1]
    const which = m[2] === '2' ? 'sus2' : 'sus4'
    if (seventh && which === 'sus4') return withColor({ quality: `${seventh}sus4` })
    return withColor({ quality: which })
  }

  // added tones: add9, add2, add4, add11, madd9… The added degree is kept, so
  // `Cadd11` no longer collapses onto the `add9` quality and print as `Cadd9`.
  m = core.match(/^(m)?add(2|4|9|11|13)$/)
  if (m) {
    const [, minorFlag, degree] = m
    if (!minorFlag && degree === '9') return withColor({ quality: 'add9' })
    return withColor({
      quality: minorFlag ? 'minor' : 'major',
      alterations: [`add${degree}`],
    })
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
  let sixNine = false
  const slashIdx = s.indexOf('/')
  if (slashIdx >= 0) {
    if (s.endsWith('6/9') && s.indexOf('/') === s.length - 2) {
      mainPart = s.slice(0, -2) // treat as ...6 → major family
      sixNine = true // keep the "/9" so the chord prints as `C6/9`
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
      alterations: sixNine ? [...(tail.alterations ?? []), '/9'] : tail.alterations,
      bass,
      bassAccidental,
      displayRaw: token,
    },
  }
}
