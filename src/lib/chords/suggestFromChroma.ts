/**
 * Per-bar chord suggestions from cached chroma.
 *
 * Given a SongMap with `chordHints.beatChroma` (12-d vector per beat,
 * stable order = `sortBeatsByTime(songMap.timeline.beats)`), produce a
 * map of `beatId → ChordSuggestion` keyed by each bar's downbeat. The
 * suggestion is the best Pearson-correlation match between the bar's
 * averaged chroma and 24 triad templates (12 major + 12 minor rotations).
 *
 * Diatonic chords in the detected key get a small multiplicative bonus
 * before ranking so borderline calls resolve to in-key chords without
 * blocking borrowed chords on strong evidence.
 *
 * Pure function — no caching. Recompute on `$derived` whenever the
 * SongMap changes (sections, key, beats, chroma).
 */

import type { ChordSymbol, SongMap, SongKey } from '$lib/songmap/types'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { chordRootToPitchClass, pitchClassToRootAcc } from './pitchClass'
import { songKeyPreferFlats } from './diatonic'
import { formatChordSymbol } from './formatChordSymbol'
import { sameKindChordAtMatchingBeat } from './autoFill'

/** Pitch-class offsets from the root for a major triad. */
export const MAJOR_TRIAD = [0, 4, 7] as const
/** Pitch-class offsets from the root for a minor triad. */
export const MINOR_TRIAD = [0, 3, 7] as const

/** Multiplicative score bonus for chords whose root is in the song key's diatonic scale. */
const DIATONIC_BIAS = 1.15

/**
 * Multiplicative score bonus when the matching beat in an EARLIER
 * same-kind section has a user-placed chord that matches the candidate.
 * Strong enough to flip most chroma noise (especially when the harmonic
 * stem is muddy) but small enough that a clearly-different chroma
 * (e.g. user modulated the bridge) still wins.
 */
const SECTION_BIAS = 1.4

/**
 * Minimum confidence (top-vs-runner-up Pearson margin) at which we'll
 * surface a suggestion at all. Below this the chroma is too ambiguous
 * to recommend anything.
 */
export const MIN_SUGGESTION_CONFIDENCE = 0.02

/** Number of total candidates (primary + alternates) surfaced per bar. */
export const SUGGESTION_TOP_N = 5

export type ChordSuggestion = {
  /** The bar's downbeat (where the suggested chord would be placed). */
  beatId: string
  /** Bar index this suggestion is for. */
  barIndex: number
  /** Best-fit triad. */
  chord: ChordSymbol
  /** Pearson margin (top - secondBest). 0…~0.3 in practice. */
  confidence: number
  /** Next-best candidates, ranked. Up to SUGGESTION_TOP_N - 1 entries. */
  alternatives: ChordSymbol[]
}

/**
 * Toggles for the three biases that shape suggestions. Used by the
 * debug A/B harness to measure each one's contribution; default
 * production behavior has all three on.
 */
export type SuggestOptions = {
  /** Use the song-key diatonic 1.15× bonus. Default true. */
  useDiatonicBias?: boolean
  /** Use the same-kind-section 1.40× bonus. Default true. */
  useSectionBias?: boolean
}

/** Major-key diatonic scale degrees (semitone offsets from tonic). */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
/** Natural-minor diatonic scale degrees. */
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

/** Pitch classes in the diatonic scale of `key`. */
function diatonicPitchClasses(key: SongKey | undefined): Set<number> | null {
  if (!key) return null
  const rootPc = chordRootToPitchClass(key.root, key.accidental)
  const base = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE
  return new Set(base.map((s) => (s + rootPc) % 12))
}

/** Build the 12-d template vector for a triad rooted at pitch class `pc`. */
function buildTemplate(pc: number, intervals: readonly number[]): number[] {
  const v = new Array<number>(12).fill(0)
  for (const ivl of intervals) {
    v[(pc + ivl) % 12] = 1
  }
  return v
}

/** Pearson correlation between two equal-length vectors. */
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length
  if (n === 0 || n !== b.length) return 0
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= n
  meanB /= n
  let num = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return 0
  return num / Math.sqrt(varA * varB)
}

/** Build a `ChordSymbol` for the given pitch class + quality, spelled per `preferFlats`. */
function buildChord(pc: number, quality: 'major' | 'minor', preferFlats: boolean): ChordSymbol {
  const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
  const c: ChordSymbol = {
    root,
    ...(accidental ? { accidental } : {}),
    quality,
    displayRaw: '',
  }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}

type ScoredCandidate = {
  pc: number
  quality: 'major' | 'minor'
  score: number
}

/**
 * Match a chroma vector against the 24 triad templates and rank by
 * `Pearson × optional diatonic bonus × optional same-kind-section bonus`.
 * Returns descending list of all 24 with scores.
 *
 * `sameKindMatch`: when set, candidates matching its `(pc, quality)`
 * get the SECTION_BIAS multiplier — the strongest of the three biases.
 * Reflects the convention that in pop songs Verse 2 reuses Verse 1's
 * chord pattern.
 */
export function rankTriadFitsForChroma(
  chroma: readonly number[],
  songKey: SongKey | undefined,
  opts: {
    useDiatonicBias?: boolean
    useSectionBias?: boolean
    sameKindMatch?: { pc: number; quality: 'major' | 'minor' } | null
  } = {},
): ScoredCandidate[] {
  const useDiatonicBias = opts.useDiatonicBias !== false
  const useSectionBias = opts.useSectionBias !== false
  const inKey = useDiatonicBias ? diatonicPitchClasses(songKey) : null
  const section = useSectionBias ? opts.sameKindMatch ?? null : null
  const scored: ScoredCandidate[] = []
  for (let pc = 0; pc < 12; pc++) {
    for (const quality of ['major', 'minor'] as const) {
      const intervals = quality === 'major' ? MAJOR_TRIAD : MINOR_TRIAD
      const template = buildTemplate(pc, intervals)
      let score = pearson(chroma, template)
      if (inKey && inKey.has(pc)) score *= DIATONIC_BIAS
      if (section && section.pc === pc && section.quality === quality) {
        score *= SECTION_BIAS
      }
      scored.push({ pc, quality, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

/** Convert a ChordSymbol to the `(pc, quality)` shape used by the matcher. */
function chordSymbolToTriadKey(c: ChordSymbol): { pc: number; quality: 'major' | 'minor' } | null {
  const pc = chordRootToPitchClass(c.root, c.accidental)
  // We only consider major/minor for the section bias since the matcher
  // only ranks those two qualities. 7ths / sus / etc. of a major triad
  // still map to the major-triad slot (root + 3rd dominates the chroma
  // for triad fitting).
  const q = c.quality ?? 'major'
  const quality: 'major' | 'minor' | null =
    q === 'minor' || q === 'min7' || q === 'm7' || q === 'm' || q === 'min'
      ? 'minor'
      : q === 'dim' || q === 'm7b5' || q === 'min7b5'
        ? null // diminished doesn't map cleanly to major/minor; skip the bias
        : 'major'
  if (quality === null) return null
  return { pc, quality }
}

/**
 * Aggregate per-beat chroma for one bar by averaging then L1-normalizing.
 * Returns null if the bar has no beats or all chroma frames are empty.
 */
export function aggregateBarChroma(
  barBeatIndices: number[],
  beatChroma: readonly (readonly number[])[],
): number[] | null {
  if (barBeatIndices.length === 0) return null
  const acc = new Array<number>(12).fill(0)
  let used = 0
  for (const idx of barBeatIndices) {
    const vec = beatChroma[idx]
    if (!vec || vec.length !== 12) continue
    for (let i = 0; i < 12; i++) acc[i] += vec[i]
    used++
  }
  if (used === 0) return null
  let sum = 0
  for (const v of acc) sum += v
  if (sum <= 0) return null
  for (let i = 0; i < 12; i++) acc[i] /= sum
  return acc
}

/**
 * Build a map of `downbeatId → ChordSuggestion` for every bar that has
 * usable chroma. Bars without chroma, or whose top fit is below
 * `MIN_SUGGESTION_CONFIDENCE`, are omitted from the result.
 *
 * Production callers pass no `opts` and get all three biases on (chroma
 * + diatonic + same-kind section). The debug A/B harness disables one
 * at a time to measure each one's contribution.
 */
export function proposeChordSuggestions(
  songMap: SongMap | null,
  opts: SuggestOptions = {},
): Map<string, ChordSuggestion> {
  const out = new Map<string, ChordSuggestion>()
  if (!songMap) return out
  const hints = songMap.chordHints
  if (!hints || hints.beatChroma.length === 0) return out
  if (hints.beatChroma.length !== songMap.timeline.beats.length) return out

  // beatChroma is in `sortBeatsByTime(beats)` order — build a lookup
  // beatId → chroma index that matches.
  const sortedBeats = sortBeatsByTime(songMap.timeline.beats)
  const beatIndex = new Map<string, number>()
  for (let i = 0; i < sortedBeats.length; i++) {
    beatIndex.set(sortedBeats[i].id, i)
  }

  const songKey: SongKey | undefined = songMap.metadata.keyDetail
  const preferFlats = songKey ? songKeyPreferFlats(songKey) : false

  for (const bar of songMap.timeline.bars) {
    if (bar.beatIds.length === 0) continue
    const indices: number[] = []
    for (const bid of bar.beatIds) {
      const idx = beatIndex.get(bid)
      if (idx !== undefined) indices.push(idx)
    }
    if (indices.length === 0) continue
    const barChroma = aggregateBarChroma(indices, hints.beatChroma)
    if (!barChroma) continue

    const downbeatId = bar.beatIds[0]

    // Section-bias hint: look up the chord the user placed at the
    // matching beat of an earlier same-kind section, if any.
    const sameKindChord = sameKindChordAtMatchingBeat(songMap, downbeatId)
    const sameKindMatch = sameKindChord ? chordSymbolToTriadKey(sameKindChord) : null

    const ranked = rankTriadFitsForChroma(barChroma, songKey, {
      useDiatonicBias: opts.useDiatonicBias,
      useSectionBias: opts.useSectionBias,
      sameKindMatch,
    })
    if (ranked.length < 2) continue
    const top = ranked[0]
    const second = ranked[1]
    const confidence = top.score - second.score
    if (confidence < MIN_SUGGESTION_CONFIDENCE) continue

    out.set(downbeatId, {
      beatId: downbeatId,
      barIndex: bar.index,
      chord: buildChord(top.pc, top.quality, preferFlats),
      confidence,
      // Top-5 total → 4 alternates. Wider safety net for the radial.
      alternatives: ranked
        .slice(1, SUGGESTION_TOP_N)
        .map((c) => buildChord(c.pc, c.quality, preferFlats)),
    })
  }
  return out
}
