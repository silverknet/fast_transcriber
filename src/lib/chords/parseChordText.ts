import type { Accidental, ChordSymbol, NoteName } from '$lib/songmap/types'
import { formatChordSymbol } from './formatChordSymbol'

export type ParseChordResult = { ok: true; chord: ChordSymbol } | { ok: false; error: string }

const NOTE_NAMES = new Set<string>(['C', 'D', 'E', 'F', 'G', 'A', 'B'])

function normalizeUnicode(s: string): string {
  return s
    .trim()
    .replace(/\u266F/g, '#')
    .replace(/\u266D/g, 'b')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
}

/** Parse leading note letter + accidentals; returns remainder after root. */
function eatRoot(s: string): { root: import('$lib/songmap/types').NoteName; accidental?: Accidental; rest: string } | null {
  if (s.length < 1) return null
  const L = s[0]!.toUpperCase()
  if (!NOTE_NAMES.has(L)) return null
  const root = L as import('$lib/songmap/types').NoteName
  let i = 1
  let delta = 0
  while (i < s.length) {
    const c = s[i]!
    if (c === '#' || c === '\u266f') {
      delta += 1
      i++
      continue
    }
    if (c === 'b' || c === '\u266d') {
      delta -= 1
      i++
      continue
    }
    break
  }
  if (delta < -1 || delta > 1) return null
  const accidental: Accidental | undefined =
    delta === 1 ? 'sharp' : delta === -1 ? 'flat' : undefined
  return { root, accidental, rest: s.slice(i) }
}

type QualityParse = { quality?: string; extensions?: string[]; restConsumed: string }

function parseQuality(rest: string): QualityParse {
  const r = rest
  if (!r.length) return { quality: 'major', extensions: undefined, restConsumed: '' }

  const tryPatterns: { pattern: RegExp; quality: string; ext?: string[] }[] = [
    { pattern: /^maj7/i, quality: 'maj7' },
    { pattern: /^ma7/i, quality: 'maj7' },
    { pattern: /^M7(?![a-z])/i, quality: 'maj7' },
    { pattern: /^m7(?![a-z0-9])/i, quality: 'min7' },
    { pattern: /^min7/i, quality: 'min7' },
    { pattern: /^mi7/i, quality: 'min7' },
    { pattern: /^\-7/i, quality: 'min7' },
    { pattern: /^maj(?!or)/i, quality: 'major' },
    { pattern: /^major/i, quality: 'major' },
    { pattern: /^min(?![or])/i, quality: 'minor' },
    { pattern: /^mi(?![nor])/i, quality: 'minor' },
    { pattern: /^dim/i, quality: 'dim' },
    { pattern: /^°/, quality: 'dim' },
    { pattern: /^o(?![0-9])/i, quality: 'dim' },
    { pattern: /^aug/i, quality: 'aug' },
    { pattern: /^\+(?![0-9])/, quality: 'aug' },
    { pattern: /^sus4/i, quality: 'sus4' },
    { pattern: /^sus2/i, quality: 'sus2' },
    { pattern: /^sus/i, quality: 'sus4' },
    { pattern: /^add9/i, quality: 'add9' },
    { pattern: /^m(?![aj0-9])/i, quality: 'minor' },
    { pattern: /^\-(?![0-9])/, quality: 'minor' },
    { pattern: /^7(?![0-9])/i, quality: '7' },
    { pattern: /^9\b/i, quality: '7', ext: ['9'] },
    { pattern: /^11\b/i, quality: '7', ext: ['11'] },
    { pattern: /^13\b/i, quality: '7', ext: ['13'] },
  ]

  for (const { pattern, quality, ext } of tryPatterns) {
    const m = r.match(pattern)
    if (m) {
      const consumed = m[0]!.length
      return {
        quality,
        extensions: ext,
        restConsumed: r.slice(consumed),
      }
    }
  }

  return { quality: 'major', restConsumed: r }
}

/**
 * Parse free-text chord (e.g. `Em`, `ebm`, `F#m7`, `C/E`) into `ChordSymbol`.
 */
export function parseChordText(raw: string): ParseChordResult {
  const s0 = normalizeUnicode(raw)
  if (!s0.length) return { ok: false, error: 'Empty chord' }

  const slashIdx = s0.indexOf('/')
  const mainPart = slashIdx >= 0 ? s0.slice(0, slashIdx) : s0
  const bassPart = slashIdx >= 0 ? s0.slice(slashIdx + 1) : ''

  const rootParsed = eatRoot(mainPart)
  if (!rootParsed) return { ok: false, error: 'Invalid root' }

  let { root, accidental, rest } = rootParsed
  const q = parseQuality(rest)
  let quality = q.quality
  let extensions = q.extensions
  const afterQ = q.restConsumed

  if (afterQ.trim().length > 0 && !extensions) {
    const extM = afterQ.match(/^([0-9]+)/)
    if (extM && ['9', '11', '13'].includes(extM[1]!)) {
      extensions = [extM[1]!]
    }
  }

  let bass: NoteName | undefined
  let bassAccidental: Accidental | undefined
  if (bassPart.length) {
    const bp = eatRoot(bassPart)
    if (!bp || bp.rest.trim().length > 0) return { ok: false, error: 'Invalid bass note' }
    bass = bp.root
    bassAccidental = bp.accidental
  }

  const chord: ChordSymbol = {
    root,
    accidental,
    quality,
    extensions,
    bass,
    bassAccidental,
    displayRaw: '',
  }

  const preferFlats = accidental === 'flat' || bassAccidental === 'flat'
  chord.displayRaw = formatChordSymbol(chord, preferFlats ? { preferFlats: true } : undefined)

  return { ok: true, chord }
}

/** Rebuild `displayRaw` from structured fields (e.g. after transpose). */
export function refreshDisplayRaw(chord: ChordSymbol, preferFlats?: boolean): ChordSymbol {
  return {
    ...chord,
    displayRaw: formatChordSymbol(chord, { preferFlats: preferFlats ?? false }),
  }
}
