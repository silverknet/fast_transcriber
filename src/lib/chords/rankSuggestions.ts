import type { ChordSymbol, SongKey } from '$lib/songmap/types'
import { parseChordText } from './parseChordText'
import { parseStrictChordToken } from './sheet/chordToken'
import { diatonicChordsInKey, songKeyPreferFlats } from './diatonic'
import { formatChordSymbol } from './formatChordSymbol'

export type RankedChord = { chord: ChordSymbol; label: string; inKey: boolean }

/**
 * Browsable qualities, in commonness order — the order ties break by, so
 * typing "f#" lists F#, F#m, F#7, F#m7… rather than alphabet soup.
 */
const BROWSE_QUALITIES = ['major', 'minor', '7', 'min7', 'maj7', 'sus4', 'sus2', 'dim'] as const

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

/**
 * Coloured chords worth surfacing WHILE TYPING, beyond the plain triads and
 * sevenths above. Without these, typing `bm7` offered only `Bm7` and gave no
 * hint that `Bm7b5` existed — you had to know the full symbol and type every
 * character before anything appeared.
 *
 * They rank after `BROWSE_QUALITIES` (unknown qualities sort last), so the
 * common chords stay on top.
 */
const BROWSE_COLOURS: Array<Pick<ChordSymbol, 'quality' | 'extensions' | 'alterations'>> = [
  { quality: 'min7', alterations: ['b5'] },
  { quality: 'major6' },
  { quality: 'minor6' },
  { quality: 'dim', alterations: ['7'] },
  { quality: '7', extensions: ['9'] },
  { quality: 'min7', extensions: ['9'] },
  { quality: 'maj7', extensions: ['9'] },
  { quality: '7sus4' },
  { quality: 'add9' },
  { quality: '7', alterations: ['b9'] },
]

/** All browsable chords: 12 roots (spelled per key) × common qualities. */
function browseCandidates(preferFlats: boolean): ChordSymbol[] {
  const roots: Array<{ root: (typeof LETTERS)[number]; accidental?: 'sharp' | 'flat' }> = []
  for (const r of LETTERS) {
    roots.push({ root: r })
    // One accidental spelling per black key, matching the key's preference.
    if (preferFlats) {
      if (r !== 'C' && r !== 'F') roots.push({ root: r, accidental: 'flat' })
    } else {
      if (r !== 'E' && r !== 'B') roots.push({ root: r, accidental: 'sharp' })
    }
  }
  const out: ChordSymbol[] = []
  for (const { root, accidental } of roots) {
    for (const shape of [
      ...BROWSE_QUALITIES.map((quality) => ({ quality })),
      ...BROWSE_COLOURS,
    ]) {
      const c: ChordSymbol = {
        root,
        ...(accidental ? { accidental } : {}),
        ...shape,
        displayRaw: '',
      }
      c.displayRaw = formatChordSymbol(c, { preferFlats })
      out.push(c)
    }
  }
  return out
}

/**
 * Strict parsing for the ENTRY BOX.
 *
 * `parseStrictChordToken` requires an uppercase root because it was written for
 * chord SHEETS, where a lowercase token is usually an English word ("am I
 * wrong" must not parse as Am). That rule is wrong in an input box: people type
 * `bm7b5`, and rejecting it dropped them onto the lenient parser, which cannot
 * model half-diminished and produced nonsense like `Bb5`.
 *
 * So: try the query as typed, then again with the root capitalised.
 */
function parseTypedChord(query: string): ReturnType<typeof parseStrictChordToken> {
  const direct = parseStrictChordToken(query)
  if (direct.ok) return direct
  const capitalised = query.charAt(0).toUpperCase() + query.slice(1)
  return capitalised === query ? direct : parseStrictChordToken(capitalised)
}

function norm(s: string): string {
  // Unicode accidentals fold to ASCII so a typed `E♭m` compares equal to the
  // rendered `Ebm`.
  return s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\u266f\u266d]/g, (m) => (m === '\u266f' ? '#' : 'b'))
}

/**
 * Key for chord identity comparisons.
 *
 * Extensions and alterations are part of the identity: without them every
 * coloured variant inherited its base chord's in-key flag, so `Cmaj9` and
 * `C#7b9` were marked diatonic in C major and ranked above ordinary out-of-key
 * chords like `Cm` and `C7`.
 */
function identity(c: ChordSymbol): string {
  const ext = (c.extensions ?? []).join('.')
  const alt = (c.alterations ?? []).join('.')
  return `${c.root}${c.accidental ?? ''}:${c.quality ?? 'major'}:${ext}:${alt}`
}

/**
 * Rank chord search results.
 *
 * - Empty query: the key's diatonic chords (triads first, then their 7ths) —
 *   the chords you almost always want.
 * - With a query: everything matching, ordered by in-key first, then
 *   prefix matches, then quality commonness. An exact parse of the query is
 *   always included (and correctly flagged in-key), so any chord remains
 *   reachable by typing it fully.
 */
export function rankChordSuggestions(
  query: string,
  key: SongKey | undefined,
  opts?: { includeAllRoots?: boolean; limit?: number },
): RankedChord[] {
  const q = norm(query)
  const limit = opts?.limit ?? 24
  const preferFlats = key ? songKeyPreferFlats(key) : false
  const diatonic = key ? diatonicChordsInKey(key, preferFlats) : []
  const diatonicIds = new Set(diatonic.map(identity))
  const isInKey = (c: ChordSymbol) => diatonicIds.has(identity(c))

  const ranked: RankedChord[] = []
  const seen = new Set<string>()
  const push = (chord: ChordSymbol, inKey: boolean, labelOverride?: string) => {
    // `labelOverride` keeps a strict parse's verbatim symbol: `formatChordSymbol`
    // rebuilds the label from `quality` + `extensions`, which have no slot for
    // alterations, so it would render `Bm7b5` back as `Bm7`.
    const label = labelOverride ?? formatChordSymbol(chord, { preferFlats })
    if (seen.has(label)) return
    seen.add(label)
    ranked.push({ chord, label, inKey })
  }

  // Exact parse of the raw query — the escape hatch that keeps EVERY chord
  // (slash bass, extensions…) reachable.
  //
  // The STRICT sheet-import grammar goes first: it consumes the whole token or
  // fails, so it understands the colored chords the lenient entry parser can't
  // model (`Bm7b5`, `E7b9`, `C6`, `Cm9`, `C7sus4`) and keeps the typed symbol
  // verbatim in `displayRaw`. The lenient parser is the fallback for PARTIAL
  // input — `Dm`, `f#` — which a full-consumption grammar rightly rejects.
  let exactLabel = ''
  if (q.length > 0) {
    const strict = parseTypedChord(query.trim())
    if (strict.ok) {
      exactLabel = strict.chord.displayRaw
      push(strict.chord, isInKey(strict.chord), exactLabel)
    } else {
      const exact = parseChordText(query.trim())
      if (exact.ok) {
        const label = formatChordSymbol(exact.chord, { preferFlats })
        // Only offer a lenient parse that accounts for EVERYTHING typed. It
        // silently ignores what it cannot model, so a half-typed `bm7b` came
        // back as plain `B` — proposing a chord the user never asked for. When
        // it doesn't round-trip, fall through to the browse list instead.
        if (norm(label) === norm(query)) {
          exactLabel = label
          push(exact.chord, isInKey(exact.chord), label)
        }
      }
    }
  }

  // Diatonic chords of the key.
  for (const chord of diatonic) {
    const label = formatChordSymbol(chord, { preferFlats })
    if (!q || norm(label).includes(q)) push(chord, true)
  }

  // Full browse space (all roots × common qualities).
  if (opts?.includeAllRoots !== false && q.length > 0) {
    for (const chord of browseCandidates(preferFlats)) {
      const label = formatChordSymbol(chord, { preferFlats })
      const n = norm(label)
      if (n.startsWith(q) || n.includes(q)) push(chord, isInKey(chord))
    }
  }

  if (!q.length) return ranked.slice(0, limit)

  const qualityRank = (c: ChordSymbol) => {
    const i = (BROWSE_QUALITIES as readonly string[]).indexOf(c.quality ?? 'major')
    return i === -1 ? BROWSE_QUALITIES.length : i
  }

  return ranked
    .sort((a, b) => {
      // The exact-typed chord stays on top — it's what the user asked for.
      const aExact = exactLabel !== '' && a.label === exactLabel
      const bExact = exactLabel !== '' && b.label === exactLabel
      if (aExact !== bExact) return aExact ? -1 : 1
      if (a.inKey !== b.inKey) return a.inKey ? -1 : 1
      const ap = norm(a.label).startsWith(q) ? 0 : 1
      const bp = norm(b.label).startsWith(q) ? 0 : 1
      if (ap !== bp) return ap - bp
      const aq = qualityRank(a.chord)
      const bq = qualityRank(b.chord)
      if (aq !== bq) return aq - bq
      return a.label.localeCompare(b.label)
    })
    .slice(0, limit)
}
