/**
 * Ultimate-Guitar-style chord sheet parser.
 *
 * Input: pasted plain text where chord lines sit ABOVE lyric lines and a
 * chord's character column marks the word it lands on:
 *
 *     [Verse 1]
 *     Am9  C/D              GM7
 *     Baby, love never felt so good
 *
 * Output: the chords with their anchors (section, lyric line, word), plus
 * `lyricsText` — the sheet minus chord lines and markers, cleaned with the
 * SAME per-line rules as `cleanLyricsText`, so it is byte-identical to what
 * the lyrics importer would store. `SheetChord.lineIdx`/`wordIdx` live in the
 * same index space as `LyricWord.line` and `lyricWordsOfLine` (non-empty
 * cleaned lines, whitespace-split words).
 *
 * Pure module — no runtime imports beyond types and the shared cleaners.
 */
import type { ChordSymbol } from '$lib/songmap/types'
import { cleanLyricLine, lyricWordsOfLine } from '$lib/lyrics/clean'
import { isDecorationToken, parseStrictChordToken } from './chordToken'

export type SheetSection = {
  /** Marker text without brackets, e.g. `Verse 1`, `Pre-Chorus`. '' = implicit head. */
  label: string
}

export type SheetChord = {
  chord: ChordSymbol
  /** The token exactly as pasted (also kept in chord.displayRaw). */
  rawToken: string
  sectionIdx: number
  /** Index into non-empty cleaned lyric lines (== LyricWord.line), or null. */
  lineIdx: number | null
  /** Whitespace-token index within that cleaned line, or null (instrumental). */
  wordIdx: number | null
  /** Position in sheet reading order — placement must stay monotone in this. */
  orderIdx: number
}

export type ParsedChordSheet = {
  sections: SheetSection[]
  anchoredChords: SheetChord[]
  /** Cleaned lyric text (chord lines + markers stripped) — what saveLyrics stores. */
  lyricsText: string
  chordCount: number
}

/** UG section markers use square brackets: `[Verse 1]`, `[Pre-Chorus]:`. */
const SHEET_SECTION_MARKER = /^\s*\[([^\]]{1,60})\]\s*:?\s*$/

type LineKind = 'blank' | 'marker' | 'chord' | 'lyric' | 'ambiguous'

type Line = {
  raw: string
  kind: LineKind
  /** Chord tokens with their starting column (chord/ambiguous lines only). */
  tokens?: { token: string; col: number; chord: ChordSymbol }[]
}

/** Tokenize a line, keeping each token's starting column. */
function tokenizeWithColumns(raw: string): { token: string; col: number }[] {
  const out: { token: string; col: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out.push({ token: m[0], col: m.index })
  return out
}

/** Single bare token that is as likely English as a chord: `A`, `Am`. */
const AMBIGUOUS_BARE = /^[A-G]m?$/

function classifyLine(raw: string): Line {
  if (raw.trim().length === 0) return { raw, kind: 'blank' }
  if (SHEET_SECTION_MARKER.test(raw)) return { raw, kind: 'marker' }

  const tokens = tokenizeWithColumns(raw)
  const chordTokens: { token: string; col: number; chord: ChordSymbol }[] = []
  for (const t of tokens) {
    if (isDecorationToken(t.token)) continue
    const p = parseStrictChordToken(t.token)
    if (!p.ok) return { raw, kind: 'lyric' }
    chordTokens.push({ ...t, chord: p.chord })
  }
  if (chordTokens.length === 0) return { raw, kind: 'lyric' } // decorations only

  // A lone `A` / `Am` flush against the left margin reads as a lyric ("Am I
  // wrong…" wraps, one-word lines happen). Indentation = column positioning =
  // chord. Otherwise defer to neighbor context (resolved in a second pass).
  if (chordTokens.length === 1 && tokens.length === 1 && AMBIGUOUS_BARE.test(tokens[0]!.token)) {
    const indented = /^\s/.test(raw)
    if (!indented) return { raw, kind: 'ambiguous', tokens: chordTokens }
  }
  return { raw, kind: 'chord', tokens: chordTokens }
}

/** Word index of the lyric-line word anchored at chord column `col`. */
function wordIndexAtColumn(lyricRaw: string, col: number): number | null {
  const words = tokenizeWithColumns(lyricRaw)
  if (words.length === 0) return null
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (col < w.col) return i // chord over whitespace → the next word
    if (col < w.col + w.token.length) return i // chord over the word itself
  }
  return words.length - 1 // past end of line → last word
}

export function parseChordSheet(raw: string): ParsedChordSheet {
  const lines: Line[] = raw.split(/\r\n|\r|\n/).map(classifyLine)

  // Resolve ambiguous single-token lines by neighbor context: an adjacent
  // (previous/next non-blank) chord line — or a section marker directly
  // above, where chord sheets always put chords — means the sheet is in
  // "chords over lyrics" mode around here. Surrounded by plain lyric lines,
  // a lone flush-left `A` stays a lyric.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.kind !== 'ambiguous') continue
    let prev: Line | undefined
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j]!.kind === 'blank') continue
      prev = lines[j]
      break
    }
    let next: Line | undefined
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.kind === 'blank') continue
      next = lines[j]
      break
    }
    const chordContext =
      prev?.kind === 'chord' || prev?.kind === 'marker' || next?.kind === 'chord'
    lines[i]!.kind = chordContext ? 'chord' : 'lyric'
    if (lines[i]!.kind === 'lyric') lines[i]!.tokens = undefined
  }

  // Build lyricsText with cleanLyricsText's exact semantics over the
  // non-chord lines, recording each lyric line's cleaned non-empty index.
  const outLines: string[] = []
  const cleanedIdxByLine = new Map<number, number>() // line array idx → lineIdx
  let nonEmptyCount = 0
  let pendingBlank = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (l.kind === 'chord') continue // chord lines vanish without a trace
    if (l.kind === 'blank') {
      pendingBlank = outLines.length > 0
      continue
    }
    const cleaned = cleanLyricLine(l.raw)
    if (cleaned === null) continue // markers, repeat-tag-only lines
    if (pendingBlank) {
      outLines.push('')
      pendingBlank = false
    }
    outLines.push(cleaned)
    if (l.kind === 'lyric') cleanedIdxByLine.set(i, nonEmptyCount)
    nonEmptyCount++
  }

  // Sections + chord anchoring.
  const sections: SheetSection[] = []
  const anchoredChords: SheetChord[] = []
  let currentSection = -1
  let orderIdx = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (l.kind === 'marker') {
      const label = l.raw.match(SHEET_SECTION_MARKER)?.[1]?.trim() ?? ''
      sections.push({ label })
      currentSection = sections.length - 1
      continue
    }
    if (l.kind !== 'chord' || !l.tokens) continue
    if (currentSection === -1) {
      sections.push({ label: '' }) // implicit head section
      currentSection = 0
    }

    // Pair with the immediately-following lyric line, if any.
    const next = lines[i + 1]
    const lyricLine = next?.kind === 'lyric' ? next : undefined
    const lineIdx = lyricLine ? (cleanedIdxByLine.get(i + 1) ?? null) : null
    const cleanedWordCount =
      lyricLine && lineIdx !== null
        ? lyricWordsOfLine(cleanLyricLine(lyricLine.raw) ?? '').length
        : 0

    for (const t of l.tokens) {
      let wordIdx: number | null = null
      if (lyricLine && lineIdx !== null && cleanedWordCount > 0) {
        const rawIdx = wordIndexAtColumn(lyricLine.raw, t.col)
        // Cleaning only trims edges / drops a trailing repeat tag, so raw and
        // cleaned word indices agree — clamp covers the dropped-tail case.
        wordIdx = rawIdx === null ? null : Math.min(rawIdx, cleanedWordCount - 1)
      }
      anchoredChords.push({
        chord: t.chord,
        rawToken: t.token,
        sectionIdx: currentSection,
        lineIdx: wordIdx === null ? null : lineIdx,
        wordIdx,
        orderIdx: orderIdx++,
      })
    }
  }

  return {
    sections,
    anchoredChords,
    lyricsText: outLines.join('\n'),
    chordCount: anchoredChords.length,
  }
}
