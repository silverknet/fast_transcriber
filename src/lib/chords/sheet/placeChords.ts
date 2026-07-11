/**
 * Chord placement — project a parsed chord sheet onto the song's beat grid
 * using the timed lyrics as anchors.
 *
 *   word-anchored chord  →  word.startSec  →  snapChordTimeToBeat  →  beatId
 *   unanchored runs (instrumental blocks)  →  spread across the bar downbeats
 *   between the surrounding anchored placements.
 *
 * Pure: returns a plan + honest stats; `applyPlacement.ts` writes it. Refuses
 * outright when the stored lyrics don't come from this sheet — misplacement
 * is worse than a refusal.
 */
import type { SongMap, ChordSymbol, Beat } from '$lib/songmap/types'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { snapChordTimeToBeat } from '$lib/songmap/beatAtTime'
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
  if (needsLyrics) {
    if (map.lyrics?.sourceText !== sheet.lyricsText || words.length === 0) {
      return { ok: false, error: 'Save and fit the lyrics from this sheet first.' }
    }
  }

  const barsById = new Map(map.timeline.bars.map((b) => [b.id, b]))
  const barsByIndex = [...map.timeline.bars].sort((a, b) => a.index - b.index)
  const beatsById = new Map(map.timeline.beats.map((b) => [b.id, b]))

  // Words grouped by line, in token order (align.ts emits them in order).
  const wordsByLine = new Map<number, typeof words>()
  for (const w of words) {
    const arr = wordsByLine.get(w.line)
    if (arr) arr.push(w)
    else wordsByLine.set(w.line, [w])
  }

  const stats: ChordPlacementStats = { placed: 0, estimated: 0, collisions: 0, unplaceable: 0 }

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
    const word = wordsByLine.get(c.lineIdx!)?.[c.wordIdx!]
    if (!word) {
      slot.needsSpread = true // anchor lost — let the spread pass place it
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
