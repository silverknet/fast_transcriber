/**
 * Lyrics-to-audio alignment — fit imported lyric words to the timestamps of
 * words recognized in the vocal track.
 *
 * ARCHITECTURE (row-based): song lyrics repeat — the same chorus text appears
 * many times while the recognizer only catches SOME occurrences. Word-level
 * global alignment is ambiguous under repetition (verified on real data: it
 * mapped whisper's blocks onto later twin stanzas and misplaced the whole top
 * of the sheet). The natural unit is the ROW:
 *
 *  1. CANDIDATES — every lyric row is matched against the recognition at each
 *     plausible starting point (a windowed mini-alignment per occurrence).
 *     A row candidate needs a real run of matching words, which makes ad-lib
 *     one-offs ("uh you movin") score below acceptance for real rows.
 *  2. ASSIGNMENT — a monotone DP picks at most one occurrence per row,
 *     maximizing total match quality with time strictly advancing. Repeated
 *     chorus rows land on successive occurrences; rows the recognizer missed
 *     stay unassigned.
 *  3. RESCUE — unassigned rows get a relaxed second look inside the unclaimed
 *     time window between their assigned neighbors.
 *
 * Matched words anchor to the recognized timestamps; everything else
 * interpolates line-aware (words hug their own row's anchors; gaps live
 * BETWEEN rows). Recognition errors cost coverage, never text correctness —
 * the imported lyrics are always what's displayed.
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
  /**
   * Row coverage — the honest display-quality metric: rows with at least one
   * real anchor are PLACED by evidence; anchorless rows interpolate between
   * their neighbors (fine when few, guesswork when most).
   */
  matchedRows: number
  totalRows: number
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
  // Inflected languages (Swedish "sommartider"/"sommartiden") often differ by
  // a 2-char ending — allow it once the words are long enough to be distinctive.
  if (minLen >= 5 && levenshtein(a, b, 2) <= 2) return SCORE_FUZZY
  return SCORE_MISMATCH
}

// ── Row candidates ──────────────────────────────────────────────────────────

/** Nominal within-row word spacing (seconds). */
const PACE_SEC = 0.42
/** Extra window beyond the row's nominal length when matching an occurrence. */
const ROW_WINDOW_SLACK_SEC = 3.5
/** Minimum (exact + 0.6·fuzzy)/rowLen for a candidate to count. */
const ROW_ACCEPT_SCORE = 0.3
/** Relaxed threshold used by the rescue pass inside a bounded window. */
const ROW_RESCUE_SCORE = 0.25

type RowHit = { tokenIdx: number; asrIdx: number; exact: boolean }

/** One candidate occurrence of a lyric row in the recognition. */
type RowCandidate = {
  row: number
  score: number
  hits: RowHit[]
  tFirst: number
  tLast: number
}

/** Token indices grouped by row, in order. */
function rowsOf(tokens: LyricToken[]): number[][] {
  const rows: number[][] = []
  let line = -1
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.line !== line) {
      line = tokens[i]!.line
      rows.push([])
    }
    rows[rows.length - 1]!.push(i)
  }
  return rows
}

/**
 * Mini semi-global alignment of ONE row against an ASR window: free
 * leading/trailing gaps on the ASR side (extra recognized words cost nothing
 * at the edges), penalized gaps for missing lyric words and interior ad-libs.
 * Returns the positive-scoring matches (the row's anchors at this occurrence).
 */
function matchRowWindow(
  rowIdxs: readonly number[],
  lyr: readonly string[],
  rec: readonly string[],
  j0: number,
  jEnd: number,
): RowHit[] {
  const L = rowIdxs.length
  const W = jEnd - j0
  if (L === 0 || W <= 0) return []
  const width = W + 1
  const dp = new Float64Array((L + 1) * width)
  const move = new Uint8Array((L + 1) * width)
  const M_DIAG = 1
  const M_UP = 2
  const M_LEFT = 3
  // Row 0: free leading ASR gaps (dp stays 0). Column 0: missing lyric words
  // cost a gap each (we want occurrences that cover the row).
  for (let i = 1; i <= L; i++) {
    dp[i * width] = dp[(i - 1) * width]! + SCORE_GAP
    move[i * width] = M_UP
  }
  for (let i = 1; i <= L; i++) {
    const li = lyr[rowIdxs[i - 1]!]!
    for (let j = 1; j <= W; j++) {
      const diag = dp[(i - 1) * width + (j - 1)]! + wordScore(li, rec[j0 + j - 1]!)
      const up = dp[(i - 1) * width + j]! + SCORE_GAP
      const left = dp[i * width + (j - 1)]! + SCORE_GAP
      let best = diag
      let mv = M_DIAG
      if (up > best) {
        best = up
        mv = M_UP
      }
      if (left > best) {
        best = left
        mv = M_LEFT
      }
      dp[i * width + j] = best
      move[i * width + j] = mv
    }
  }
  // Traceback from the best cell in the LAST lyric row (free trailing ASR).
  let bj = 0
  let bestScore = -Infinity
  for (let j = 0; j <= W; j++) {
    const s = dp[L * width + j]!
    if (s > bestScore) {
      bestScore = s
      bj = j
    }
  }
  const hits: RowHit[] = []
  let i = L
  let j = bj
  while (i > 0 && j > 0) {
    const mv = move[i * width + j]!
    if (mv === M_DIAG) {
      const s = wordScore(lyr[rowIdxs[i - 1]!]!, rec[j0 + j - 1]!)
      if (s > 0) {
        hits.push({ tokenIdx: rowIdxs[i - 1]!, asrIdx: j0 + j - 1, exact: s === SCORE_EXACT })
      }
      i--
      j--
    } else if (mv === M_UP) {
      i--
    } else {
      j--
    }
  }
  hits.reverse()
  return hits
}

function candidateFromHits(row: number, rowLen: number, hits: RowHit[], asr: readonly AsrWord[]): RowCandidate | null {
  if (hits.length === 0) return null
  const exact = hits.filter((h) => h.exact).length
  const score = (exact + 0.6 * (hits.length - exact)) / rowLen
  return {
    row,
    score,
    hits,
    tFirst: asr[hits[0]!.asrIdx]!.startSec,
    tLast: asr[hits[hits.length - 1]!.asrIdx]!.endSec,
  }
}

function acceptCandidate(
  c: RowCandidate | null,
  lyr: readonly string[],
  minScore: number,
): c is RowCandidate {
  if (!c) return false
  if (c.score < minScore) return false
  if (c.hits.length >= 2) return true
  // A lone hit only counts when it's self-evident: exact + distinctive word.
  const h = c.hits[0]!
  return h.exact && lyr[h.tokenIdx]!.length >= 4
}

/**
 * All acceptable occurrences of one row. Start positions are prefiltered to
 * recognized words matching one of the row's first `startDepth` tokens;
 * duplicates (same first hit) keep the best score.
 */
function rowCandidates(
  row: number,
  rowIdxs: readonly number[],
  lyr: readonly string[],
  rec: readonly string[],
  asr: readonly AsrWord[],
  opts: { jLo?: number; jHi?: number; minScore?: number; startDepth?: number; usable?: (j: number) => boolean } = {},
): RowCandidate[] {
  const jLo = opts.jLo ?? 0
  const jHi = opts.jHi ?? rec.length
  const minScore = opts.minScore ?? ROW_ACCEPT_SCORE
  const startDepth = Math.min(opts.startDepth ?? 3, rowIdxs.length)
  const out: RowCandidate[] = []
  const seenFirstHit = new Map<number, number>() // first asrIdx → index in out

  for (let j0 = jLo; j0 < jHi; j0++) {
    if (opts.usable && !opts.usable(j0)) continue
    let starts = false
    for (let x = 0; x < startDepth; x++) {
      if (wordScore(lyr[rowIdxs[x]!]!, rec[j0]!) > 0) {
        starts = true
        break
      }
    }
    if (!starts) continue
    const windowEnd = asr[j0]!.startSec + rowIdxs.length * PACE_SEC + ROW_WINDOW_SLACK_SEC
    let jEnd = j0
    while (jEnd < jHi && asr[jEnd]!.startSec <= windowEnd) jEnd++
    let hits = matchRowWindow(rowIdxs, lyr, rec, j0, jEnd)
    if (opts.usable) hits = hits.filter((h) => opts.usable!(h.asrIdx))
    const cand = candidateFromHits(row, rowIdxs.length, hits, asr)
    if (!acceptCandidate(cand, lyr, minScore)) continue
    const key = cand.hits[0]!.asrIdx
    const existing = seenFirstHit.get(key)
    if (existing !== undefined) {
      if (out[existing]!.score < cand.score) out[existing] = cand
      continue
    }
    seenFirstHit.set(key, out.length)
    out.push(cand)
  }
  return out
}

// ── Monotone row assignment ─────────────────────────────────────────────────

/** Rows may flow into each other, but never by more than this overlap. */
const ROW_FLOW_OVERLAP_SEC = 1.5
/** A skipped sheet row "costs" at least this much audio time to be plausible. */
const MIN_SKIPPED_ROW_SEC = 1.5
/** Penalty per implausibly-skipped row (see below). */
const ROW_SKIP_PENALTY = 0.2

/**
 * Pick at most one occurrence per row so that chosen occurrences advance
 * strictly in time, maximizing total match quality. Classic weighted-chain
 * DP; ties resolve to the EARLIEST candidates (iteration order + strict `>`),
 * so repeated stanzas fill from the first occurrence forward.
 *
 * MUSICAL PRIOR — skips need time. Lyric sheets repeat stanzas the recording
 * sings once; without a prior, the DP happily jumps 13 rows in 2 seconds to
 * anchor a later twin copy (seen on real data). Skipping K rows across a time
 * gap Δt is penalized for every row beyond what the gap could plausibly have
 * contained (Δt / MIN_SKIPPED_ROW_SEC) — a real instrumental bridge grants
 * its skip for free, a 2-second hop over half the sheet does not.
 */
function assignRowsMonotone(candidatesByRow: RowCandidate[][]): (RowCandidate | null)[] {
  type Node = { cand: RowCandidate; total: number; prev: Node | null }
  const chosen: (RowCandidate | null)[] = candidatesByRow.map(() => null)
  const nodes: Node[] = []
  let best: Node | null = null

  for (let r = 0; r < candidatesByRow.length; r++) {
    const rowCands = [...candidatesByRow[r]!].sort((a, b) => a.tFirst - b.tFirst)
    const newNodes: Node[] = []
    for (const cand of rowCands) {
      const gain = cand.score + 0.02 * cand.hits.length
      let bestPrev: Node | null = null
      let bestPrevTotal = 0
      for (const p of nodes) {
        if (p.cand.row >= cand.row) continue
        if (!(cand.tFirst > p.cand.tFirst + 0.05)) continue
        if (!(cand.tFirst >= p.cand.tLast - ROW_FLOW_OVERLAP_SEC)) continue
        if (!(cand.tLast > p.cand.tLast)) continue
        const skipped = cand.row - p.cand.row - 1
        const gapSec = Math.max(0, cand.tFirst - p.cand.tLast)
        const plausibleSkips = gapSec / MIN_SKIPPED_ROW_SEC
        const penalty = ROW_SKIP_PENALTY * Math.max(0, skipped - plausibleSkips)
        const total = p.total - penalty
        if (!bestPrev || total > bestPrevTotal) {
          bestPrev = p
          bestPrevTotal = total
        }
      }
      const node: Node = { cand, total: gain + (bestPrev ? bestPrevTotal : 0), prev: bestPrev }
      newNodes.push(node)
      if (!best || node.total > best.total) best = node
    }
    nodes.push(...newNodes)
  }

  for (let n = best; n; n = n.prev) chosen[n.cand.row] = n.cand
  return chosen
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Align lyric tokens against recognized words and produce fully-timed
 * `LyricWord`s. Every lyric token gets a time: anchors take the matched
 * recognized word's start/end; the rest interpolate between anchors.
 */
export function alignLyricsToTranscription(
  tokens: LyricToken[],
  asr: AsrWord[],
): AlignmentResult {
  if (tokens.length === 0) return { words: [], matchedRatio: 0, matchedRows: 0, totalRows: 0 }

  const lyr = tokens.map((t) => normalizeWord(t.text))
  const rec = asr.map((w) => normalizeWord(w.text))
  const n = tokens.length
  const rows = rowsOf(tokens)

  // Pass 1+2: per-row occurrence candidates → monotone assignment.
  const candidatesByRow = rows.map((rowIdxs, r) => rowCandidates(r, rowIdxs, lyr, rec, asr))
  const chosen = assignRowsMonotone(candidatesByRow)

  // Pass 3: rescue unassigned rows inside the unclaimed window between their
  // assigned neighbors (relaxed score is safe in a bounded window; recognized
  // words already claimed by neighbors are off-limits).
  const usedAsr = new Set<number>()
  for (const c of chosen) if (c) for (const h of c.hits) usedAsr.add(h.asrIdx)

  for (let r = 0; r < rows.length; r++) {
    if (chosen[r]) continue
    let tLo = 0
    let tHi = Number.POSITIVE_INFINITY
    for (let p = r - 1; p >= 0; p--) {
      if (chosen[p]) {
        tLo = chosen[p]!.tLast - 0.3
        break
      }
    }
    for (let q = r + 1; q < rows.length; q++) {
      if (chosen[q]) {
        tHi = chosen[q]!.tFirst + 0.3
        break
      }
    }
    if (tHi <= tLo) continue
    // Translate the time window to an ASR index range.
    let jLo = 0
    while (jLo < asr.length && asr[jLo]!.startSec < tLo) jLo++
    let jHi = jLo
    while (jHi < asr.length && asr[jHi]!.startSec <= tHi) jHi++
    const rescued = rowCandidates(r, rows[r]!, lyr, rec, asr, {
      jLo,
      jHi,
      minScore: ROW_RESCUE_SCORE,
      startDepth: rows[r]!.length, // any row word can start a rescue match
      usable: (j) => !usedAsr.has(j),
    })
    if (rescued.length === 0) continue
    let bestCand = rescued[0]!
    for (const c of rescued) if (c.score > bestCand.score) bestCand = c
    chosen[r] = bestCand
    for (const h of bestCand.hits) usedAsr.add(h.asrIdx)
  }

  // Collect anchors; a final monotone sweep drops any stragglers that would
  // step backward (rescue windows overlap slightly at their edges).
  const anchors = new Map<number, AsrWord>()
  for (const c of chosen) {
    if (!c) continue
    for (const h of c.hits) anchors.set(h.tokenIdx, asr[h.asrIdx]!)
  }
  const ordered = [...anchors.keys()].sort((a, b) => a - b)
  let prevT = -Infinity
  for (const i of ordered) {
    const t = anchors.get(i)!.startSec
    if (t + 0.05 < prevT) anchors.delete(i)
    else prevT = Math.max(prevT, t)
  }

  const words = interpolateTimes(tokens, anchors)
  const anchoredRows = new Set<number>()
  for (const i of anchors.keys()) anchoredRows.add(tokens[i]!.line)
  return {
    words,
    matchedRatio: anchors.size / n,
    matchedRows: anchoredRows.size,
    totalRows: rows.length,
  }
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

  // Interior runs between consecutive anchors — LINE-AWARE. A row is sung in
  // one breath: unanchored words that share a row with the LEFT anchor chain
  // forward right after it; words sharing the RIGHT anchor's row chain
  // backward right before it; only whole unanchored rows float in the middle
  // of the gap. The silence of a long gap lives BETWEEN rows, never stretched
  // through one.
  for (let ai = 0; ai < anchorIdxs.length - 1; ai++) {
    const a = anchorIdxs[ai]!
    const b = anchorIdxs[ai + 1]!
    if (b - a <= 1) continue
    const gapStart = out[a]!.endSec
    const gapEnd = out[b]!.startSec
    const count = b - a - 1
    const span = gapEnd - gapStart

    if (span <= 0.02 * count) {
      // No real gap (recognized words adjacent) — stack with epsilon durations.
      let t = gapStart
      for (let x = 0; x < count; x++) {
        const k = a + 1 + x
        out[k] = { text: tokens[k]!.text, startSec: t, endSec: t + 0.01, line: tokens[k]!.line }
        t += 0.01
      }
      continue
    }

    const lineA = tokens[a]!.line
    const lineB = tokens[b]!.line
    const head: number[] = []
    const tail: number[] = []
    const middle: number[] = []
    for (let k = a + 1; k < b; k++) {
      if (tokens[k]!.line === lineA) head.push(k)
      else if (tokens[k]!.line === lineB) tail.push(k)
      else middle.push(k)
    }

    // Head: same row as the left anchor → chain forward at singing pace.
    let cursor = gapStart + 0.06
    for (const k of head) {
      const d = nominalDurationSec(tokens[k]!.text)
      const startSec = Math.min(cursor, gapEnd - 0.02)
      const endSec = Math.min(Math.max(startSec + 0.01, startSec + d), gapEnd - 0.01)
      out[k] = { text: tokens[k]!.text, startSec, endSec, line: tokens[k]!.line }
      cursor = endSec + 0.06
    }

    // Tail: same row as the right anchor → chain backward from it.
    let back = gapEnd - 0.06
    for (let x = tail.length - 1; x >= 0; x--) {
      const k = tail[x]!
      const d = nominalDurationSec(tokens[k]!.text)
      const endSec = Math.max(back, gapStart + 0.03)
      const startSec = Math.max(endSec - d, gapStart + 0.02)
      out[k] = { text: tokens[k]!.text, startSec, endSec, line: tokens[k]!.line }
      back = startSec - 0.06
    }

    // Middle: whole unanchored rows — space them as row-blocks across what's
    // left of the gap, each row internally chained at pace.
    if (middle.length > 0) {
      const windowStart = head.length > 0 ? out[head[head.length - 1]!]!.endSec + 0.1 : gapStart + 0.05
      const windowEnd = tail.length > 0 ? out[tail[0]!]!.startSec - 0.1 : gapEnd - 0.05
      const blocks: number[][] = []
      let curLine = -1
      for (const k of middle) {
        if (tokens[k]!.line !== curLine) {
          curLine = tokens[k]!.line
          blocks.push([])
        }
        blocks[blocks.length - 1]!.push(k)
      }
      const W = Math.max(windowEnd - windowStart, 0.02 * middle.length)
      const slot = W / blocks.length
      blocks.forEach((blk, bi) => {
        const blockDur = Math.min(slot, blk.length * PACE_SEC)
        let t = windowStart + slot * bi + Math.max(0, (slot - blockDur) / 2)
        for (const k of blk) {
          const d = Math.min(nominalDurationSec(tokens[k]!.text), Math.max(0.01, blockDur / blk.length - 0.02))
          out[k] = {
            text: tokens[k]!.text,
            startSec: t,
            endSec: Math.max(t + 0.01, t + d),
            line: tokens[k]!.line,
          }
          t = out[k]!.endSec + 0.06
        }
      })
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
