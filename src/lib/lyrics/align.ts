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
  // Inflected languages (Swedish "sommartider"/"sommartiden") often differ by
  // a 2-char ending — allow it once the words are long enough to be distinctive.
  if (minLen >= 5 && levenshtein(a, b, 2) <= 2) return SCORE_FUZZY
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
  /** lyric index → matched ASR word (+ whether the text matched exactly). */
  const anchors = new Map<number, { w: AsrWord; exact: boolean; asrIdx: number }>()

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
        const s = wordScore(lyr[i - 1]!, rec[j - 1]!)
        if (s > 0) {
          anchors.set(i - 1, { w: asr[j - 1]!, exact: s === SCORE_EXACT, asrIdx: j - 1 })
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

  // Musical common sense, applied in three passes:
  //  1. Anchors need friends — an isolated fuzzy/short-word anchor is almost
  //     always noise (an ad-lib "uh you movin" exact-matching a common word,
  //     or a near-miss grabbing the wrong occurrence). Real lines match as
  //     RUNS of neighboring words.
  //  2. A row is sung in one breath — anchors that put a word many seconds
  //     from its rowmates matched the wrong occurrence; vote them out
  //     ("hej" held for 10 seconds).
  //  3. Recovery — with trusted anchors in place, unanchored words in a row
  //     get a second, row-local look at the recognized words near their row
  //     (generous matching is safe inside a tight window).
  const supported = pruneUnsupportedAnchors(tokens, anchors)
  const consistent = rejectLineOutlierAnchors(tokens, supported)
  const recovered = recoverRowAnchors(tokens, lyr, rec, asr, consistent)

  const finalAnchors = new Map<number, AsrWord>()
  for (const [i, a] of recovered) finalAnchors.set(i, a.w)
  const words = interpolateTimes(tokens, finalAnchors)
  return { words, matchedRatio: recovered.size / n }
}

type Anchor = { w: AsrWord; exact: boolean; asrIdx: number }

/**
 * Pass 1 — drop anchors without support. An anchor is supported when a
 * nearby token (within 2 positions) is also anchored at a plausible sung
 * distance. Isolated anchors survive only when they're self-evident: an
 * EXACT match of a distinctive word (≥ 4 letters). Everything else —
 * isolated fuzzy hits, isolated "you"/"so"/"uh" exact hits inside ad-lib
 * sections — is noise.
 */
function pruneUnsupportedAnchors(
  tokens: LyricToken[],
  anchors: Map<number, Anchor>,
): Map<number, Anchor> {
  const idxs = [...anchors.keys()].sort((a, b) => a - b)
  const kept = new Map<number, Anchor>()
  for (let k = 0; k < idxs.length; k++) {
    const i = idxs[k]!
    const a = anchors.get(i)!
    let hasSupport = false
    for (const dk of [-4, -3, -2, -1, 1, 2, 3, 4]) {
      // Support = another anchored token within 4 token positions whose time
      // sits within sung distance for that spacing. Radius 4 lets sparse
      // scaffolds ("Where … when … you") support each other while ad-lib
      // one-offs, which have no in-order timed neighbors, stay isolated.
      const j = idxs[k + dk]
      if (j === undefined) continue
      if (Math.abs(j - i) > 4) continue
      const b = anchors.get(j)!
      if (Math.abs(b.w.startSec - a.w.startSec) <= 2.5 + PACE_SEC * Math.abs(j - i)) {
        hasSupport = true
        break
      }
    }
    if (hasSupport || (a.exact && normalizeWord(tokens[i]!.text).length >= 4)) {
      kept.set(i, a)
    }
  }
  return kept
}

/** Nominal spoken duration of a word (seconds) when we must guess. */
function nominalDurationSec(text: string): number {
  return Math.min(0.9, Math.max(0.18, 0.07 * Math.max(2, normalizeWord(text).length)))
}

/** Nominal within-row word spacing used for consensus + chained fills. */
const PACE_SEC = 0.42
/** Max deviation from a row's consensus start before an anchor is rejected. */
const LINE_ORIGIN_TOLERANCE_SEC = 3

/** 0-based position of each token within its row. */
function indexInLine(tokens: LyricToken[]): number[] {
  const out = new Array<number>(tokens.length)
  let line = -1
  let k = 0
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.line !== line) {
      line = tokens[i]!.line
      k = 0
    }
    out[i] = k++
  }
  return out
}

/**
 * Pass 2 — per-row anchor consensus. Each anchor implies a "row start" (its
 * time minus pace × its position in the row); anchors deviating from the
 * row's consensus by more than the tolerance matched a different occurrence.
 * Consensus rules, in order of trust:
 *  - majority (median of exact anchors when any exist — fuzzy hits don't
 *    get to out-vote exact ones),
 *  - on a 2-way disagreement with no majority, the EARLIER cluster wins
 *    (wrong-occurrence grabs are almost always a LATER repetition).
 * A final monotonic sweep drops survivors that step backward in time.
 */
function rejectLineOutlierAnchors(
  tokens: LyricToken[],
  anchors: Map<number, Anchor>,
): Map<number, Anchor> {
  const idxInLine = indexInLine(tokens)

  const byLine = new Map<number, number[]>()
  for (const i of anchors.keys()) {
    const arr = byLine.get(tokens[i]!.line) ?? []
    arr.push(i)
    byLine.set(tokens[i]!.line, arr)
  }

  const kept = new Map<number, Anchor>()
  for (const idxs of byLine.values()) {
    if (idxs.length === 1) {
      const i = idxs[0]!
      kept.set(i, anchors.get(i)!)
      continue
    }
    const origin = (i: number) => anchors.get(i)!.w.startSec - PACE_SEC * idxInLine[i]!
    // Consensus origin: median over EXACT anchors when available, else all.
    const exactIdxs = idxs.filter((i) => anchors.get(i)!.exact)
    const voters = exactIdxs.length > 0 ? exactIdxs : idxs
    const origins = voters.map(origin).sort((a, b) => a - b)
    // Lower median: on an even split, the EARLIER cluster wins.
    const median = origins[Math.max(0, Math.ceil(origins.length / 2) - 1)]!
    for (const i of idxs) {
      if (Math.abs(origin(i) - median) <= LINE_ORIGIN_TOLERANCE_SEC) {
        kept.set(i, anchors.get(i)!)
      }
    }
  }
  return kept
}

/**
 * Pass 3 — row-local recovery. Rows that kept at least one trusted anchor
 * get a second look: each still-unanchored token in the row tries to match
 * a not-yet-claimed recognized word inside the row's expected time window.
 * Generous matching is safe here because the window is tight — this is what
 * lifts songs where the recognizer garbled half the words. Finishes with the
 * global monotonic sweep.
 */
function recoverRowAnchors(
  tokens: LyricToken[],
  lyr: string[],
  rec: string[],
  asr: AsrWord[],
  anchors: Map<number, Anchor>,
): Map<number, Anchor> {
  const idxInLine = indexInLine(tokens)
  const out = new Map<number, Anchor>(anchors)
  const usedAsr = new Set<number>()
  for (const a of anchors.values()) usedAsr.add(a.asrIdx)

  const byLine = new Map<number, number[]>()
  for (let i = 0; i < tokens.length; i++) {
    const arr = byLine.get(tokens[i]!.line) ?? []
    arr.push(i)
    byLine.set(tokens[i]!.line, arr)
  }

  for (const rowIdxs of byLine.values()) {
    const rowAnchors = rowIdxs.filter((i) => out.has(i))
    if (rowAnchors.length === 0) continue
    // Expected row window from the anchors' implied row start.
    const origins = rowAnchors.map((i) => out.get(i)!.w.startSec - PACE_SEC * idxInLine[i]!)
    const rowStart = Math.min(...origins)
    const rowLen = rowIdxs.length
    const winLo = rowStart - 1.5
    const winHi = rowStart + PACE_SEC * rowLen + 2.5

    for (const i of rowIdxs) {
      if (out.has(i)) continue
      const expected = rowStart + PACE_SEC * idxInLine[i]!
      let best: { asrIdx: number; dist: number } | null = null
      for (let j = 0; j < asr.length; j++) {
        if (usedAsr.has(j)) continue
        const t = asr[j]!.startSec
        if (t < winLo || t > winHi) continue
        if (wordScore(lyr[i]!, rec[j]!) <= 0) continue
        const dist = Math.abs(t - expected)
        if (!best || dist < best.dist) best = { asrIdx: j, dist }
      }
      if (best && best.dist <= 3) {
        usedAsr.add(best.asrIdx)
        out.set(i, {
          w: asr[best.asrIdx]!,
          exact: lyr[i] === rec[best.asrIdx],
          asrIdx: best.asrIdx,
        })
      }
    }
  }

  // Rows with NO surviving anchor (a bad global path swallowed their words):
  // rescue inside the unclaimed time window between the neighboring anchored
  // tokens. In-order chained matching; accepted with ≥2 hits, or a single
  // EXACT hit on a distinctive (≥4 letters) word.
  for (const rowIdxs of byLine.values()) {
    if (rowIdxs.some((i) => out.has(i))) continue
    const first = rowIdxs[0]!
    const last = rowIdxs[rowIdxs.length - 1]!
    // Window: after the last anchor before the row, before the first anchor
    // after it (in token order).
    let winLo = 0
    let winHi = Number.POSITIVE_INFINITY
    for (const [k, a] of out) {
      if (k < first) winLo = Math.max(winLo, a.w.endSec)
      if (k > last) winHi = Math.min(winHi, a.w.startSec)
    }
    if (winHi <= winLo) continue

    const hits: Array<{ i: number; asrIdx: number }> = []
    let searchFrom = 0
    for (const i of rowIdxs) {
      let found = -1
      for (let j = searchFrom; j < asr.length; j++) {
        if (usedAsr.has(j)) continue
        const t = asr[j]!.startSec
        if (t < winLo) continue
        if (t > winHi) break
        if (wordScore(lyr[i]!, rec[j]!) > 0) {
          found = j
          break
        }
      }
      if (found >= 0) {
        hits.push({ i, asrIdx: found })
        searchFrom = found + 1
      }
    }
    const acceptable =
      hits.length >= 2 ||
      (hits.length === 1 &&
        lyr[hits[0]!.i] === rec[hits[0]!.asrIdx] &&
        normalizeWord(tokens[hits[0]!.i]!.text).length >= 4)
    if (!acceptable) continue
    // Row-span sanity: accepted hits must themselves sit within one breath.
    const times = hits.map((h) => asr[h.asrIdx]!.startSec)
    if (Math.max(...times) - Math.min(...times) > PACE_SEC * rowIdxs.length + 3) continue
    for (const h of hits) {
      usedAsr.add(h.asrIdx)
      out.set(h.i, {
        w: asr[h.asrIdx]!,
        exact: lyr[h.i] === rec[h.asrIdx],
        asrIdx: h.asrIdx,
      })
    }
  }

  // Global monotonic sweep — recovery must not create time-travel.
  const ordered = [...out.keys()].sort((a, b) => a - b)
  let prevT = -Infinity
  for (const i of ordered) {
    const t = out.get(i)!.w.startSec
    if (t + 0.05 < prevT) out.delete(i)
    else prevT = Math.max(prevT, t)
  }
  return out
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
