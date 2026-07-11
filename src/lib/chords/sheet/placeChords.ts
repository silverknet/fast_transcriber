/**
 * Chord placement — project a parsed chord sheet onto the song's beat grid
 * using the timed lyrics as anchors.
 *
 * The sheet and the stored lyrics are INDEPENDENT sources: lyrics usually
 * come complete (Genius etc.) while chord sheets are lazy — skipped repeats,
 * "Chorus x2", slightly different spellings. Each sheet lyric line is
 * fuzzy-matched (monotone, in song order) against the stored fitted lyrics:
 *
 *   sheet line  →  best stored line after the previous match (Dice ≥ 0.6)
 *   word-anchored chord  →  matched line's word  →  startSec  →  beat
 *   unmatched lines / instrumental runs  →  spread across the bar downbeats
 *   between the surrounding anchored placements.
 *
 * Pure: returns a plan + honest stats; `applyPlacement.ts` writes it.
 */
import type { SongMap, ChordSymbol, Beat, LyricWord } from '$lib/songmap/types'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { lyricWordsOfLine } from '$lib/lyrics/clean'
import { normalizeWord } from '$lib/lyrics/align'
import {
  CHORD_ANALYZER_VERSION,
  aggregateBarChroma,
  chordChromaFitScore,
} from '$lib/chords/suggestFromChroma'
import type { ParsedChordSheet, SheetChord } from './parseChordSheet'

export type ChordPlacement = {
  beatId: string
  barIndex: number
  chord: ChordSymbol
  /** word = aligned lyric anchor; estimated = interpolated anchor; spread = instrumental fill. */
  origin: 'word' | 'estimated' | 'spread'
  orderIdx: number
  sectionIdx: number
}

export type ChordPlacementStats = {
  placed: number
  /** Placements from interpolated (not ASR-anchored) words or spreads. */
  estimated: number
  /** Chords dropped because their beat was already taken by an earlier one. */
  collisions: number
  /** Chords that could not be mapped to any beat/word. */
  unplaceable: number
  /** Sheet lyric lines that found a stored-lyrics line. */
  matchedLines: number
  /** Sheet lyric lines that carry chord anchors. */
  totalLines: number
}

export type ChordPlacementPlan = { placements: ChordPlacement[]; stats: ChordPlacementStats }

export type PlaceChordsResult = { ok: true; plan: ChordPlacementPlan } | { ok: false; error: string }

export function placeChords(sheet: ParsedChordSheet, map: SongMap): PlaceChordsResult {
  if (sheet.chordCount === 0) return { ok: false, error: 'No chords found in the pasted sheet.' }
  const beatsSorted = sortBeatsByTime(map.timeline.beats)
  if (beatsSorted.length === 0 || map.timeline.bars.length === 0) {
    return { ok: false, error: 'Analyze the song first — chords need the beat grid.' }
  }

  const needsLyrics = sheet.anchoredChords.some((c) => c.wordIdx !== null)
  const words = map.lyrics?.words ?? []
  if (needsLyrics && words.length === 0) {
    return {
      ok: false,
      error: 'Fit the lyrics to the song first — the timed words anchor each chord.',
    }
  }

  const barsById = new Map(map.timeline.bars.map((b) => [b.id, b]))
  const barsByIndex = [...map.timeline.bars].sort((a, b) => a.index - b.index)
  const beatsById = new Map(map.timeline.beats.map((b) => [b.id, b]))

  // Stored words grouped by line, in token order (align.ts emits them in order).
  const wordsByLine = new Map<number, LyricWord[]>()
  for (const w of words) {
    const arr = wordsByLine.get(w.line)
    if (arr) arr.push(w)
    else wordsByLine.set(w.line, [w])
  }

  // Match each sheet lyric line to a stored lyric line — monotone (sheet
  // lines come in song order) and fuzzy (spelling/punctuation drift between
  // sources). Lines the sheet has but the lyrics don't (or vice versa —
  // sheets skip repeats) simply stay unmatched; their chords spread.
  const sheetLines = sheet.lyricsText.split('\n').filter((l) => l.length > 0)
  const storedLineCount = Math.max(-1, ...[...wordsByLine.keys()]) + 1
  const storedTokens: string[][] = []
  for (let li = 0; li < storedLineCount; li++) {
    storedTokens.push((wordsByLine.get(li) ?? []).map((w) => normalizeWord(w.text)).filter(Boolean))
  }
  const anchoredLineIdxs = new Set<number>()
  for (const c of sheet.anchoredChords) {
    if (c.lineIdx !== null) anchoredLineIdxs.add(c.lineIdx)
  }
  const lineMap = matchSheetLinesToStored(sheetLines, storedTokens, anchoredLineIdxs)

  const stats: ChordPlacementStats = {
    placed: 0,
    estimated: 0,
    collisions: 0,
    unplaceable: 0,
    matchedLines: [...anchoredLineIdxs].filter((li) => lineMap.get(li) !== undefined).length,
    totalLines: anchoredLineIdxs.size,
  }

  // Chroma gate — same freshness rules as proposeChordSuggestions.
  const hints = map.chordHints
  const beatIndexById = new Map(beatsSorted.map((b, idx) => [b.id, idx]))
  const chromaUsable =
    !!hints &&
    hints.analyzerVersion === CHORD_ANALYZER_VERSION &&
    Array.isArray(hints.beatChroma) &&
    hints.beatChroma.length === beatsSorted.length

  /** Pearson fit of `chord` against one bar's aggregated chroma (null = no signal). */
  function barFit(chord: ChordSymbol, barIndex: number): number | null {
    if (!chromaUsable) return null
    const bar = barByIndex.get(barIndex)
    if (!bar) return null
    const idxs = bar.beatIds
      .map((id) => beatIndexById.get(id))
      .filter((n): n is number => n !== undefined)
    const agg = aggregateBarChroma(idxs, hints!.beatChroma)
    return agg ? chordChromaFitScore(agg, chord) : null
  }

  const barByIndex = new Map(barsByIndex.map((b) => [b.index, b]))
  const lastBarIndex = barsByIndex[barsByIndex.length - 1]!.index

  /**
   * Monotone slot allocator. Chords live on musically plausible slots only:
   * a bar's downbeat first, its mid-beat second, then the next bar — never
   * whatever raw beat the ASR word time happened to fall on (sung onsets are
   * routinely half a beat off the actual chord change; that scatter was the
   * v1 import's big failure against a hand-placed reference).
   */
  const occupancy = new Map<number, number>()
  let frontierKey = -1 // (barIndex << 4) + beatOffset of the last placed chord
  function allocateSlot(startBarIndex: number): Beat | null {
    let bi = Math.max(0, startBarIndex)
    for (let guard = 0; guard < 512 && bi <= lastBarIndex; guard++) {
      const bar = barByIndex.get(bi)
      if (!bar) {
        bi++
        continue
      }
      const used = occupancy.get(bi) ?? 0
      if (used >= 2) {
        bi++
        continue
      }
      const mid = Math.max(1, Math.floor(bar.beatIds.length / 2))
      const offset = used === 0 ? 0 : mid
      const key = (bi << 4) + offset
      if (key <= frontierKey) {
        // This slot is at/behind the previous chord — try the bar's next
        // position, then following bars.
        if (used === 0) {
          occupancy.set(bi, 1)
          continue
        }
        bi++
        continue
      }
      const beat = beatsById.get(bar.beatIds[offset] ?? '')
      if (!beat) {
        bi++
        continue
      }
      occupancy.set(bi, used + 1)
      frontierKey = key
      return beat
    }
    return null
  }

  /** Last bar whose start is at/before `t` (clamped to the first bar). */
  function barIndexAtTime(t: number): number {
    let lo = 0
    let hi = barsByIndex.length - 1
    if (t <= barsByIndex[0]!.startSec) return barsByIndex[0]!.index
    while (lo < hi) {
      const midIdx = (lo + hi + 1) >> 1
      if (barsByIndex[midIdx]!.startSec <= t) lo = midIdx
      else hi = midIdx - 1
    }
    return barsByIndex[lo]!.index
  }

  // Pass 1 — word-anchored chords: resolve each anchor to a TIME, then pick
  // between "this bar" and "the next bar" by chroma fit (with a small prior
  // on the side of the bar the word time rounds to). The allocator keeps
  // everything monotone and collision-free.
  type Slot = {
    sheetChord: SheetChord
    beat: Beat | null
    origin: ChordPlacement['origin']
    needsSpread: boolean
    anchorSec: number | null
  }
  const slots: Slot[] = sheet.anchoredChords.map((c) => ({
    sheetChord: c,
    beat: null,
    origin: 'word',
    needsSpread: c.wordIdx === null || c.lineIdx === null,
    anchorSec: null,
  }))
  for (const slot of slots) {
    const c = slot.sheetChord
    if (slot.needsSpread) continue
    const storedLine = lineMap.get(c.lineIdx!)
    const lineWords = storedLine !== undefined ? (wordsByLine.get(storedLine) ?? []) : []
    // Word index carries over by position; different sources drift by a word
    // or two, so clamp — bar-level quantization absorbs small offsets.
    const word = lineWords.length > 0 ? lineWords[Math.min(c.wordIdx!, lineWords.length - 1)] : undefined
    if (!word) {
      slot.needsSpread = true // no matching line — let the spread pass place it
      continue
    }
    slot.anchorSec = word.startSec
    slot.origin = word.aligned ? 'word' : 'estimated'
  }

  // ── Joint bar assignment for anchored chords (small DP) ────────────────
  // Each anchored chord considers "the bar its word starts in" and "the bar
  // after"; the DP maximizes chroma fit + a rounding prior while penalizing
  // two chords sharing a bar. Independent per-chord choices compressed
  // sheets badly when the lyric aligner interpolated a line (anchors bunch
  // up); the shared-bar penalty makes the sequence spread the way charts
  // actually read — roughly one chord per bar unless the sheet really stacks
  // them.
  const ROUNDING_PRIOR = 0.1
  const SAME_BAR_PENALTY = 0.2
  /**
   * Chroma is a capped VOTE, not a veto: UG sheets routinely spell chords
   * differently from what's played (GM7 on a bar the band plays Gm), and an
   * uncapped Pearson difference would drag such chords onto the wrong bar.
   */
  const CHROMA_WEIGHT = 0.5
  const CHROMA_CAP = 0.25
  const anchoredSlots = slots.filter((s) => s.anchorSec !== null)
  {
    const chromaVote = (chord: ChordSymbol, bar: number): number => {
      const fit = barFit(chord, bar)
      if (fit === null) return 0
      return Math.max(-CHROMA_CAP, Math.min(CHROMA_CAP, fit * CHROMA_WEIGHT))
    }
    type Opt = { bar: number; base: number }
    const optionsPer: Opt[][] = anchoredSlots.map((s) => {
      const t = s.anchorSec!
      const biFloor = barIndexAtTime(t)
      const bar = barByIndex.get(biFloor)
      const frac =
        bar && bar.endSec > bar.startSec ? (t - bar.startSec) / (bar.endSec - bar.startSec) : 0
      const roundsUp = frac >= 0.5
      const chord = s.sheetChord.chord
      // A word starting ON the downbeat is the strongest anchor we get —
      // double its prior so a same-bar penalty can't push it off.
      const floorPrior = roundsUp ? 0 : frac < 0.1 ? ROUNDING_PRIOR * 2 : ROUNDING_PRIOR
      const opts: Opt[] = [{ bar: biFloor, base: chromaVote(chord, biFloor) + floorPrior }]
      if (biFloor + 1 <= lastBarIndex) {
        opts.push({
          bar: biFloor + 1,
          base: chromaVote(chord, biFloor + 1) + (roundsUp ? ROUNDING_PRIOR : 0),
        })
      }
      // ASR word onsets run LATE relative to the chord change as often as
      // early — allow the previous bar when the word sits in the first third.
      if (biFloor - 1 >= 0 && frac < 0.35) {
        opts.push({ bar: biFloor - 1, base: chromaVote(chord, biFloor - 1) - 0.06 })
      }
      return opts
    })

    // DP states after chord k: effective (bar, countInBar) → best score.
    type State = { bar: number; cnt: number; score: number; prev: State | null; optBar: number }
    let frontier: State[] = [{ bar: -1, cnt: 0, score: 0, prev: null, optBar: -1 }]
    for (const opts of optionsPer) {
      const next = new Map<string, State>()
      for (const st of frontier) {
        for (const o of opts) {
          // A chord can never go BEFORE the previous one; clamp into the
          // previous bar (as a same-bar stack) when its options are behind.
          let bar = o.bar
          let cnt: number
          let penalty = 0
          if (bar > st.bar) {
            cnt = 1
          } else {
            bar = st.bar
            if (st.cnt >= 2) {
              bar = st.bar + 1
              cnt = 1
              penalty = SAME_BAR_PENALTY // forced overflow reads as a cram too
            } else {
              cnt = st.cnt + 1
              penalty = SAME_BAR_PENALTY
            }
          }
          const score = st.score + o.base - penalty
          const key = `${bar}:${cnt}`
          const cur = next.get(key)
          if (!cur || score > cur.score) {
            next.set(key, { bar, cnt, score, prev: st, optBar: o.bar })
          }
        }
      }
      frontier = [...next.values()]
      if (frontier.length === 0) break
    }
    // Backtrack the best chain into per-slot target bars.
    let best: State | null = null
    for (const st of frontier) if (!best || st.score > best.score) best = st
    const targets: number[] = []
    for (let st = best; st && st.prev; st = st.prev) targets.unshift(st.bar)
    for (let k = 0; k < anchoredSlots.length && k < targets.length; k++) {
      ;(anchoredSlots[k] as Slot & { targetBar?: number }).targetBar = targets[k]
    }
  }

  // Interleave anchored placement and spreads IN SHEET ORDER so the
  // allocator's frontier stays monotone across both kinds.
  let i = 0
  while (i < slots.length) {
    const slot = slots[i]! as Slot & { targetBar?: number }
    if (slot.anchorSec !== null) {
      slot.beat = allocateSlot(slot.targetBar ?? barIndexAtTime(slot.anchorSec))
      if (!slot.beat) stats.unplaceable++
      i++
      continue
    }

    // Spread run: consecutive chords with no usable anchor.
    let j = i
    while (j < slots.length && slots[j]!.anchorSec === null) j++
    const run = slots.slice(i, j)

    // Window: after the previous placed chord's bar, up to (excluding) the
    // bar of the next anchor.
    let loBarIndex = 0
    for (let k = i - 1; k >= 0; k--) {
      const b = slots[k]!.beat
      if (b) {
        loBarIndex = (barsById.get(b.barId)?.index ?? -1) + 1
        break
      }
    }
    let hiBarIndex = lastBarIndex + 1
    for (let k = j; k < slots.length; k++) {
      const s = slots[k]!
      if (s.anchorSec !== null) {
        hiBarIndex = barIndexAtTime(s.anchorSec)
        break
      }
    }

    const windowBars = barsByIndex.filter((b) => b.index >= loBarIndex && b.index < hiBarIndex)
    const m = windowBars.length
    if (m === 0) {
      stats.unplaceable += run.length
      i = j
      continue
    }

    // Chords sharing a `|` bar group occupy ONE bar together (walk-ups,
    // turnarounds); groups spread evenly across the window. Without pipes
    // every chord is its own group — the classic one-chord-per-slot vamp.
    const groupsInRun: (typeof run)[] = []
    for (const s of run) {
      const g = s.sheetChord.barGroup
      const last = groupsInRun[groupsInRun.length - 1]
      if (last && g !== null && last[0]!.sheetChord.barGroup === g) last.push(s)
      else groupsInRun.push([s])
    }
    // Assign groups to bars (even spread), then lay out each bar's chords
    // evenly across its beats — two vamp chords sharing a bar sit at 0 and
    // mid; a piped 4-chord walk-up takes all four beats.
    const gCount = groupsInRun.length
    const slotsByBar = new Map<number, typeof run>()
    for (let gi = 0; gi < gCount; gi++) {
      const bar = windowBars[Math.min(m - 1, Math.floor((gi * m) / gCount))]!
      const arr = slotsByBar.get(bar.index)
      if (arr) arr.push(...groupsInRun[gi]!)
      else slotsByBar.set(bar.index, [...groupsInRun[gi]!])
    }
    let lastKey = -1
    for (const [barIndex, barSlots] of slotsByBar) {
      const bar = barByIndex.get(barIndex)!
      for (let mj = 0; mj < barSlots.length; mj++) {
        const beatOffset = Math.min(
          bar.beatIds.length - 1,
          Math.floor((mj * bar.beatIds.length) / barSlots.length),
        )
        const beat = beatsById.get(bar.beatIds[beatOffset] ?? '') ?? null
        barSlots[mj]!.beat = beat
        barSlots[mj]!.origin = 'spread'
        if (!beat) stats.unplaceable++
        else lastKey = Math.max(lastKey, (bar.index << 4) + beatOffset)
      }
    }
    if (lastKey > frontierKey) frontierKey = lastKey
    i = j
  }

  // Collect. The allocator keeps anchored beats unique; grouped spreads
  // write directly, so drop any residual same-beat overlap (first wins).
  const takenBeats = new Set<string>()
  const placements: ChordPlacement[] = []
  for (const slot of slots) {
    if (!slot.beat) continue
    if (takenBeats.has(slot.beat.id)) {
      stats.collisions++
      continue
    }
    takenBeats.add(slot.beat.id)
    placements.push({
      beatId: slot.beat.id,
      barIndex: barsById.get(slot.beat.barId)?.index ?? -1,
      chord: slot.sheetChord.chord,
      origin: slot.origin,
      orderIdx: slot.sheetChord.orderIdx,
      sectionIdx: slot.sheetChord.sectionIdx,
    })
    stats.placed++
    if (slot.origin !== 'word') stats.estimated++
  }

  return { ok: true, plan: { placements, stats } }
}

// ── Sheet-line ↔ stored-line matching ───────────────────────────────────────

/** Dice coefficient over token multisets — robust to small wording drift. */
function diceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const counts = new Map<string, number>()
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1)
  let common = 0
  for (const t of b) {
    const c = counts.get(t) ?? 0
    if (c > 0) {
      common++
      counts.set(t, c - 1)
    }
  }
  return (2 * common) / (a.length + b.length)
}

const LINE_MATCH_MIN_SIMILARITY = 0.6

/**
 * Greedy monotone matching: each sheet line takes the best-scoring stored
 * line AFTER the previous match. Monotonicity is what keeps a repeated
 * chorus honest — the sheet's second chorus can only match a later
 * occurrence than its first. Only lines that actually anchor chords matter.
 */
function matchSheetLinesToStored(
  sheetLines: string[],
  storedTokens: string[][],
  anchoredLineIdxs: Set<number>,
): Map<number, number> {
  const out = new Map<number, number>()
  let cursor = 0
  for (let si = 0; si < sheetLines.length; si++) {
    if (!anchoredLineIdxs.has(si)) continue
    const tokens = lyricWordsOfLine(sheetLines[si]!).map(normalizeWord).filter(Boolean)
    if (tokens.length === 0) continue
    let bestIdx = -1
    let bestScore = 0
    for (let li = cursor; li < storedTokens.length; li++) {
      const score = diceSimilarity(tokens, storedTokens[li]!)
      if (score > bestScore) {
        bestScore = score
        bestIdx = li
        if (score === 1) break // exact — no better match exists
      }
    }
    if (bestIdx >= 0 && bestScore >= LINE_MATCH_MIN_SIMILARITY) {
      out.set(si, bestIdx)
      cursor = bestIdx + 1
    }
  }
  return out
}
