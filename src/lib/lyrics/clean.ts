/**
 * Lyrics import cleaning — turn pasted lyrics (Genius/AZLyrics/etc. style)
 * into clean, line-preserving text ready for alignment.
 *
 * Removals:
 *  - Section-marker lines: `[Chorus]`, `[Verse 2: Someone]`, `(Bridge)`, etc.
 *  - Trailing repeat tags on a line: `... (x2)`, `... [X3]`.
 *  - Decorative empty-ish lines; runs of blank lines collapse to one
 *    (blank lines = stanza separators and are kept singly).
 *
 * Deliberately NOT removed: parenthesized ad-libs inside a line
 * (`(ooh) baby`) — they're often sung and belong in the alignment.
 */

/** A line that is ONLY a bracketed/parenthesized label, e.g. `[Chorus 2]`. */
const SECTION_MARKER_LINE = /^\s*[\[(][^\])]{0,60}[\])]\s*:?\s*$/

/** Trailing repeat tag: `(x2)`, `[X 3]`, `x2` at end of line. */
const TRAILING_REPEAT = /\s*(?:[\[(]\s*[x×]\s*\d+\s*[\])]|[x×]\s*\d+)\s*$/i

export type CleanedLyrics = {
  /** Cleaned text, lines joined with '\n' (what gets stored as sourceText). */
  text: string
  /** Non-empty lyric lines, in order (blank separator lines excluded). */
  lines: string[]
}

export function cleanLyricsText(raw: string): CleanedLyrics {
  const outLines: string[] = []
  let pendingBlank = false

  for (const rawLine of raw.split(/\r\n|\r|\n/)) {
    let line = rawLine.replace(/ /g, ' ').trim()
    if (line.length === 0) {
      pendingBlank = outLines.length > 0
      continue
    }
    if (SECTION_MARKER_LINE.test(line)) continue
    line = line.replace(TRAILING_REPEAT, '').trim()
    if (line.length === 0) continue
    if (pendingBlank) {
      outLines.push('')
      pendingBlank = false
    }
    outLines.push(line)
  }

  return {
    text: outLines.join('\n'),
    lines: outLines.filter((l) => l.length > 0),
  }
}

/** Split cleaned text back into non-empty lines (inverse of storage). */
export function lyricLinesFromSource(sourceText: string): string[] {
  return sourceText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** Tokenize a lyric line into display words (whitespace-separated). */
export function lyricWordsOfLine(line: string): string[] {
  return line.split(/\s+/).filter((w) => w.length > 0)
}
