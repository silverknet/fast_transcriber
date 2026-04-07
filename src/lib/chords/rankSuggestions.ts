import type { ChordSymbol, SongKey } from '$lib/songmap/types'
import { parseChordText } from './parseChordText'
import { diatonicChordsInKey, songKeyPreferFlats } from './diatonic'
import { formatChordSymbol } from './formatChordSymbol'

export type RankedChord = { chord: ChordSymbol; label: string; inKey: boolean }

/** Common major triads for quick chromatic browse (subset). */
function chromaticMajorTriads(preferFlats: boolean): ChordSymbol[] {
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
  const out: ChordSymbol[] = []
  for (const r of letters) {
    for (const acc of [undefined, 'sharp' as const, 'flat' as const]) {
      if (r === 'C' && acc === 'sharp') continue
      if (r === 'F' && acc === 'sharp') continue
      const ch: ChordSymbol = { root: r, accidental: acc, quality: 'major', displayRaw: '' }
      ch.displayRaw = formatChordSymbol(ch, { preferFlats })
      out.push(ch)
    }
  }
  return out
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

/**
 * Rank chord suggestions: diatonic matches first (when `key` set), then substring matches on labels.
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
  const diatonicLabels = diatonic.map((c) => formatChordSymbol(c, { preferFlats }))

  const ranked: RankedChord[] = []
  const seen = new Set<string>()

  const push = (chord: ChordSymbol, label: string, inKey: boolean) => {
    const k = label
    if (seen.has(k)) return
    seen.add(k)
    ranked.push({ chord, label, inKey })
  }

  if (q.length > 0) {
    const exact = parseChordText(query.trim())
    if (exact.ok) {
      push(exact.chord, formatChordSymbol(exact.chord, { preferFlats }), false)
    }
  }

  for (let i = 0; i < diatonic.length; i++) {
    const chord = diatonic[i]!
    const label = diatonicLabels[i]!
    if (!q || norm(label).includes(q) || q.length === 0) {
      push(chord, label, true)
    }
  }

  if (opts?.includeAllRoots !== false && q.length > 0) {
    for (const rootChord of chromaticMajorTriads(preferFlats)) {
      const label = formatChordSymbol(rootChord, { preferFlats })
      if (norm(label).startsWith(q) || norm(label).includes(q)) {
        push(rootChord, label, false)
      }
    }
  }

  if (!q.length) {
    return ranked.slice(0, limit)
  }

  return ranked
    .sort((a, b) => {
      if (a.inKey !== b.inKey) return a.inKey ? -1 : 1
      const ap = norm(a.label).startsWith(q) ? 0 : 1
      const bp = norm(b.label).startsWith(q) ? 0 : 1
      if (ap !== bp) return ap - bp
      return a.label.localeCompare(b.label)
    })
    .slice(0, limit)
}
