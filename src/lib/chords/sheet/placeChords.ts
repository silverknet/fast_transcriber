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
import { snapChordTimeToBeat } from '$lib/songmap/beatAtTime'
import { lyricWordsOfLine } from '$lib/lyrics/clean'
import { normalizeWord } from '$lib/lyrics/align'
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

  // Pass 1 — word-anchored chords.
  type Slot = {
    sheetChord: SheetChord
    beat: Beat | null
    origin: ChordPlacement['origin']
    /** True for chords the spread pass must handle (instrumental / lost anchor). */
    needsSpread: boolean
  }
  const slots: Slot[] = sheet.anchoredChords.map((c) => ({
    sheetChord: c,
    beat: null,
    origin: 'word',
    needsSpread: c.wordIdx === null || c.lineIdx === null,
  }))
  for (const slot of slots) {
    const c = slot.sheetChord
    if (slot.needsSpread) continue
    const storedLine = lineMap.get(c.lineIdx!)
    const lineWords = storedLine !== undefined ? (wordsByLine.get(storedLine) ?? []) : []
    // Word index carries over by position; different sources drift by a word
    // or two, so clamp — the beat snap absorbs small offsets.
    const word = lineWords.length > 0 ? lineWords[Math.min(c.wordIdx!, lineWords.length - 1)] : undefined
    if (!word) {
      slot.needsSpread = true // no matching line — let the spread pass place it
      continue
    }
    slot.beat = snapChordTimeToBeat(beatsSorted, barsById, word.startSec)
    slot.origin = word.aligned ? 'word' : 'estimated'
  }

  // Pass 2 — spread runs of unanchored chords across the bars between their
  // neighboring anchored placements.
  let i = 0
  while (i < slots.length) {
    if (!(slots[i]!.needsSpread && slots[i]!.beat === null)) {
      i++
      continue
    }
    let j = i
    while (j < slots.length && slots[j]!.beat === null) j++
    const run = slots.slice(i, j)

    // Window: after the previous placed chord's bar, up to (excluding) the
    // next placed chord's bar.
    let loBarIndex = 0
    for (let k = i - 1; k >= 0; k--) {
      const b = slots[k]!.beat
      if (b) {
        loBarIndex = (barsById.get(b.barId)?.index ?? -1) + 1
        break
      }
    }
    let hiBarIndex = barsByIndex[barsByIndex.length - 1]!.index + 1
    for (let k = j; k < slots.length; k++) {
      const b = slots[k]!.beat
      if (b) {
        hiBarIndex = barsById.get(b.barId)?.index ?? hiBarIndex
        break
      }
    }

    const windowBars = barsByIndex.filter((b) => b.index >= loBarIndex && b.index < hiBarIndex)
    const m = windowBars.length
    const k = run.length
    if (m === 0) {
      stats.unplaceable += k
      i = j
      continue
    }
    const perBarCount = new Map<number, number>()
    for (let r = 0; r < k; r++) {
      const bar = windowBars[Math.min(m - 1, Math.floor((r * m) / k))]!
      const used = perBarCount.get(bar.index) ?? 0
      // 1st chord in a bar → downbeat; 2nd → middle beat; further → next beats.
      const beatOffset = used === 0 ? 0 : used === 1 ? Math.floor(bar.beatIds.length / 2) : Math.min(bar.beatIds.length - 1, Math.floor(bar.beatIds.length / 2) + used - 1)
      const beat = beatsById.get(bar.beatIds[beatOffset] ?? '') ?? null
      perBarCount.set(bar.index, used + 1)
      run[r]!.beat = beat
      run[r]!.origin = 'spread'
      if (!beat) stats.unplaceable++
    }
    i = j
  }

  // Collect, dropping same-beat collisions (first in sheet order wins).
  const taken = new Set<string>()
  const placements: ChordPlacement[] = []
  for (const slot of slots) {
    if (!slot.beat) continue
    if (taken.has(slot.beat.id)) {
      stats.collisions++
      continue
    }
    taken.add(slot.beat.id)
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
