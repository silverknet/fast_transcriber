/**
 * Lyrics-to-audio alignment — fit imported lyric words to the timestamps of
 * words recognized in the vocal track.
 *
 * Why this works better than raw speech-to-text: the lyrics are KNOWN text.
 * We only need the recognizer to be right often enough to provide anchors;
 * a Needleman–Wunsch alignment (semi-global / overlap variant) matches the
 * two word sequences in order, transfers timestamps at matches, and
 * interpolates the words the recognizer missed. Recognition errors therefore
 * cost coverage, never correctness of the text (the imported lyrics are
 * always what's displayed).
 *
 * Time base: recognized-word times come from the vocals stem / original file,
 * i.e. ORIGINAL audio time — the same base as `Beat.timeSec` and the schema's
 * `LyricWord.startSec` (see docs/smap-format.md §3.1.2). No conversion here.
 *
 * Pure module — no I/O; heavily unit-tested with synthetic fixtures.
 */
import type { LyricWord } from '$lib/songmap/types'
import { lyricLinesFromSource, lyricWordsOfLine } from './clean'

/** A word from the speech recognizer, in original audio time. */
export type AsrWord = {
  text: string
  startSec: number
  endSec: number
  /** Recognizer confidence 0..1 (unused for anchoring; kept for debugging). */
  conf?: number
}

/** A lyric token before timing: display text + its 0-based line index. */
export type LyricToken = { text: string; line: number }

export type AlignmentResult = {
  words: LyricWord[]
  /** Fraction of lyric words anchored to a recognized word (0..1). */
  matchedRatio: number
}

/** Tokenize cleaned lyrics source text into `LyricToken`s (line-aware). */
export function tokenizeLyrics(sourceText: string): LyricToken[] {
  const out: LyricToken[] = []
  const lines = lyricLinesFromSource(sourceText)
  for (let li = 0; li < lines.length; li++) {
    for (const w of lyricWordsOfLine(lines[li]!)) out.push({ text: w, line: li })
  }
  return out
}

/** Normalize for matching: lowercase, strip everything but letters/digits. */
export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Levenshtein distance with an early-exit cap. */
function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let rowMin = cur[0]!
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      if (cur[j]! < rowMin) rowMin = cur[j]!
    }
    if (rowMin > cap) return cap + 1
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]!
}

// ── Scoring ────────────────────────────────────────────────────────────────
const SCORE_EXACT = 3
const SCORE_FUZZY = 1.5
const SCORE_MISMATCH = -1
const SCORE_GAP = -0.7

/**
 * Pairwise word score. Fuzzy matches are deliberately conservative — short
 * words ("a", "in") must match exactly, otherwise they'd anchor everywhere.
 */
function wordScore(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return SCORE_MISMATCH
  if (a === b) return SCORE_EXACT
  const minLen = Math.min(a.length, b.length)
  if (minLen >= 3 && levenshtein(a, b, 1) <= 1) return SCORE_FUZZY
  if (minLen >= 6 && levenshtein(a, b, 2) <= 2) return SCORE_FUZZY
  return SCORE_MISMATCH
}

/** Move codes for the traceback matrix. */
const MOVE_NONE = 0
const MOVE_DIAG = 1 // lyric i-1 aligned with asr j-1 (match or mismatch)
const MOVE_UP = 2 // gap in ASR (lyric word unmatched)
const MOVE_LEFT = 3 // gap in lyrics (extra ASR word skipped)

/**
 * Align lyric tokens against recognized words and produce fully-timed
 * `LyricWord`s. Every lyric token gets a time: anchors take the matched
 * recognized word's start/end; the rest interpolate between anchors.
 */
export function alignLyricsToTranscription(
  tokens: LyricToken[],
  asr: AsrWord[],
): AlignmentResult {
  if (tokens.length === 0) return { words: [], matchedRatio: 0 }

  const lyr = tokens.map((t) => normalizeWord(t.text))
  const rec = asr.map((w) => normalizeWord(w.text))
  const n = lyr.length
  const m = rec.length

  // With no usable recognition, spread words evenly over nothing → all
  // interpolated from 0 with nominal durations (caller should treat a
  // matchedRatio of 0 as "alignment failed").
  const anchors = new Map<number, AsrWord>() // lyric index → matched ASR word

  if (m > 0) {
    // Semi-global (overlap) NW: leading/trailing gaps in EITHER sequence are
    // free, interior gaps penalized. dp[i][j] = best score of aligning
    // lyr[0..i) with rec[0..j).
    const width = m + 1
    const dp = new Float64Array((n + 1) * width)
    const move = new Uint8Array((n + 1) * width)
    // Free leading gaps: dp row 0 and column 0 stay 0 with MOVE_NONE.

    for (let i = 1; i <= n; i++) {
      const li = lyr[i - 1]!
      for (let j = 1; j <= m; j++) {
        const diag = dp[(i - 1) * width + (j - 1)]! + wordScore(li, rec[j - 1]!)
        const up = dp[(i - 1) * width + j]! + SCORE_GAP
        const left = dp[i * width + (j - 1)]! + SCORE_GAP
        let best = diag
        let mv = MOVE_DIAG
        if (up > best) {
          best = up
          mv = MOVE_UP
        }
        if (left > best) {
          best = left
          mv = MOVE_LEFT
        }
        // Semi-global: never force a negative prefix — restarting free here
        // beats dragging a bad prefix along (local-ish start).
        if (best < 0) {
          best = 0
          mv = MOVE_NONE
        }
        dp[i * width + j] = best
        move[i * width + j] = mv
      }
    }

    // Traceback from the best cell anywhere in the last row or last column
    // (free trailing gaps on both sides).
    let bi = n
    let bj = m
    let bestScore = -Infinity
    for (let j = 0; j <= m; j++) {
      const s = dp[n * width + j]!
      if (s > bestScore) {
        bestScore = s
        bi = n
        bj = j
      }
    }
    for (let i = 0; i <= n; i++) {
      const s = dp[i * width + m]!
      if (s > bestScore) {
        bestScore = s
        bi = i
        bj = m
      }
    }

    let i = bi
    let j = bj
    while (i > 0 && j > 0) {
      const mv = move[i * width + j]!
      if (mv === MOVE_DIAG) {
        // Anchor only on positive-scoring diagonals (real matches, not
        // mismatch substitutions).
        if (wordScore(lyr[i - 1]!, rec[j - 1]!) > 0) {
          anchors.set(i - 1, asr[j - 1]!)
        }
        i--
        j--
      } else if (mv === MOVE_UP) {
        i--
      } else if (mv === MOVE_LEFT) {
        j--
      } else {
        break // MOVE_NONE — free-start boundary reached
      }
    }
  }

  const words = interpolateTimes(tokens, anchors)
  return { words, matchedRatio: anchors.size / n }
}

/** Nominal spoken duration of a word (seconds) when we must guess. */
function nominalDurationSec(text: string): number {
  return Math.min(0.9, Math.max(0.18, 0.07 * Math.max(2, normalizeWord(text).length)))
}

/**
 * Give every token a time. Anchored tokens take their ASR times; unanchored
 * runs are distributed inside the gap between surrounding anchors,
 * proportionally to word length. Output is monotone (non-decreasing starts)
 * with strictly positive durations.
 */
function interpolateTimes(tokens: LyricToken[], anchors: Map<number, AsrWord>): LyricWord[] {
  const n = tokens.length
  const out: LyricWord[] = new Array(n)
  const anchorIdxs = [...anchors.keys()].sort((a, b) => a - b)

  // Degenerate: nothing matched — nominal cadence from t=0 so output is
  // still schema-valid (caller decides whether to keep it).
  if (anchorIdxs.length === 0) {
    let t = 0
    for (let k = 0; k < n; k++) {
      const d = nominalDurationSec(tokens[k]!.text)
      out[k] = { text: tokens[k]!.text, startSec: t, endSec: t + d, line: tokens[k]!.line }
      t += d + 0.06
    }
    return out
  }

  // Anchored words first.
  for (const k of anchorIdxs) {
    const a = anchors.get(k)!
    const startSec = Math.max(0, a.startSec)
    const endSec = Math.max(startSec + 0.01, a.endSec)
    out[k] = { text: tokens[k]!.text, startSec, endSec, line: tokens[k]!.line, aligned: true }
  }

  // Leading run (before the first anchor): back-fill ending at the anchor.
  const first = anchorIdxs[0]!
  if (first > 0) {
    const end = out[first]!.startSec
    let cursor = end
    for (let k = first - 1; k >= 0; k--) {
      const d = nominalDurationSec(tokens[k]!.text)
      const startSec = Math.max(0, cursor - d - 0.05)
      out[k] = {
        text: tokens[k]!.text,
        startSec,
        endSec: Math.max(startSec + 0.01, cursor - 0.05 > startSec ? cursor - 0.05 : startSec + d),
        line: tokens[k]!.line,
      }
      cursor = out[k]!.startSec
    }
    // Clamp monotonicity for the pathological all-at-zero case.
    for (let k = 1; k < first; k++) {
      if (out[k]!.startSec < out[k - 1]!.endSec) {
        out[k]!.startSec = out[k - 1]!.endSec
        out[k]!.endSec = Math.max(out[k]!.endSec, out[k]!.startSec + 0.01)
      }
    }
  }

  // Interior runs between consecutive anchors.
  for (let ai = 0; ai < anchorIdxs.length - 1; ai++) {
    const a = anchorIdxs[ai]!
    const b = anchorIdxs[ai + 1]!
    if (b - a <= 1) continue
    const gapStart = out[a]!.endSec
    const gapEnd = out[b]!.startSec
    const count = b - a - 1
    const weights: number[] = []
    let totalW = 0
    for (let k = a + 1; k < b; k++) {
      const w = Math.max(1, normalizeWord(tokens[k]!.text).length)
      weights.push(w)
      totalW += w
    }
    const span = gapEnd - gapStart
    if (span > 0.02 * count) {
      // Distribute proportionally, singing ~60% of the gap (leave breaths).
      const sing = Math.min(span, Math.max(span * 0.6, Math.min(span, 0.2 * count)))
      const lead = (span - sing) / 2
      let t = gapStart + lead
      for (let x = 0; x < count; x++) {
        const d = (sing * weights[x]!) / totalW
        const k = a + 1 + x
        out[k] = {
          text: tokens[k]!.text,
          startSec: t,
          endSec: Math.max(t + 0.01, t + d),
          line: tokens[k]!.line,
        }
        t += d
      }
    } else {
      // No real gap (ASR words adjacent) — stack with epsilon durations.
      let t = gapStart
      for (let x = 0; x < count; x++) {
        const k = a + 1 + x
        out[k] = {
          text: tokens[k]!.text,
          startSec: t,
          endSec: t + 0.01,
          line: tokens[k]!.line,
        }
        t += 0.01
      }
    }
  }

  // Trailing run (after the last anchor): forward-fill at nominal cadence.
  const last = anchorIdxs[anchorIdxs.length - 1]!
  if (last < n - 1) {
    let t = out[last]!.endSec + 0.05
    for (let k = last + 1; k < n; k++) {
      const d = nominalDurationSec(tokens[k]!.text)
      out[k] = { text: tokens[k]!.text, startSec: t, endSec: t + d, line: tokens[k]!.line }
      t += d + 0.06
    }
  }

  // Final monotonicity sweep (belt & suspenders — schema demands end > start).
  for (let k = 1; k < n; k++) {
    if (out[k]!.startSec < out[k - 1]!.startSec) out[k]!.startSec = out[k - 1]!.startSec
    if (out[k]!.endSec <= out[k]!.startSec) out[k]!.endSec = out[k]!.startSec + 0.01
  }
  return out
}
