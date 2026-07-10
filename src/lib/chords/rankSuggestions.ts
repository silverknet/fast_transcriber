import type { ChordSymbol, SongKey } from '$lib/songmap/types'
import { parseChordText } from './parseChordText'
import { diatonicChordsInKey, songKeyPreferFlats } from './diatonic'
import { formatChordSymbol } from './formatChordSymbol'

export type RankedChord = { chord: ChordSymbol; label: string; inKey: boolean }

/**
 * Browsable qualities, in commonness order — the order ties break by, so
 * typing "f#" lists F#, F#m, F#7, F#m7… rather than alphabet soup.
 */
const BROWSE_QUALITIES = ['major', 'minor', '7', 'min7', 'maj7', 'sus4', 'sus2', 'dim'] as const

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

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
    for (const quality of BROWSE_QUALITIES) {
      const c: ChordSymbol = {
        root,
        ...(accidental ? { accidental } : {}),
        quality,
        displayRaw: '',
      }
      c.displayRaw = formatChordSymbol(c, { preferFlats })
      out.push(c)
    }
  }
  return out
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

/** Key for chord identity comparisons (root + accidental + quality). */
function identity(c: ChordSymbol): string {
  return `${c.root}${c.accidental ?? ''}:${c.quality ?? 'major'}`
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
  const push = (chord: ChordSymbol, inKey: boolean) => {
    const label = formatChordSymbol(chord, { preferFlats })
    if (seen.has(label)) return
    seen.add(label)
    ranked.push({ chord, label, inKey })
  }

  // Exact parse of the raw query — the escape hatch that keeps EVERY chord
  // (slash bass, extensions…) reachable.
  let exactLabel = ''
  if (q.length > 0) {
    const exact = parseChordText(query.trim())
    if (exact.ok) {
      exactLabel = formatChordSymbol(exact.chord, { preferFlats })
      push(exact.chord, isInKey(exact.chord))
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
