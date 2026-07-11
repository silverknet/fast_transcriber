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

/**
 * Version of the chroma analyzer whose output the matcher trusts. Keep in
 * sync with `ANALYZER_VERSION` in `desktop/native/python/sections/
 * chord_chroma.py`. Hints from older versions were computed with the broken
 * bass-weighted chroma and are WORSE than nothing — consumers must refuse
 * them and re-analyze (the editor's chords tab and the project background
 * backfill both do).
 */
export const CHORD_ANALYZER_VERSION = 4

/** Pitch-class offsets from the root for a major triad. */
export const MAJOR_TRIAD = [0, 4, 7] as const
/** Pitch-class offsets from the root for a minor triad. */
export const MINOR_TRIAD = [0, 3, 7] as const

/** Qualities the chroma matcher can detect. */
export type MatchQuality = 'major' | 'minor' | '7' | 'min7' | 'maj7'

/** Template intervals per matchable quality. */
const QUALITY_INTERVALS: Record<MatchQuality, readonly number[]> = {
  major: MAJOR_TRIAD,
  minor: MINOR_TRIAD,
  '7': [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
}

const MATCH_QUALITIES: readonly MatchQuality[] = ['major', 'minor', '7', 'min7', 'maj7']

/** Triad family of a matchable quality (used for section bias + dedupe). */
export function triadClassOf(q: MatchQuality): 'major' | 'minor' {
  return q === 'minor' || q === 'min7' ? 'minor' : 'major'
}

/**
 * Bias for a candidate whose FULL chord (root + quality) is diatonic in the
 * song key — e.g. E major in A major, Am7 in C major. This is what separates
 * E from Em when the chroma is ambiguous; the old root-only bias boosted both
 * equally and never helped pick the right quality.
 */
const CHORD_IN_KEY_BIAS = 1.22
/** Weaker bias when only the ROOT is in the scale (quality non-diatonic). */
const ROOT_IN_KEY_BIAS = 1.05

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
  /** Use the song-key diatonic bonus (chord-in-key 1.22× / root-in-key 1.05×). Default true. */
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

/**
 * Diatonic CHORDS of a key (degree → allowed matcher qualities), as a map of
 * `pc → Set<MatchQuality>`. Major keys: I ii iii IV V vi with their standard
 * 7ths (V gets the dom7). Minor keys: natural-minor harmony plus the harmonic
 * V/V7, which pop/rock uses constantly. Degree VII° is skipped — the matcher
 * has no diminished template.
 */
function diatonicChordMap(key: SongKey | undefined): Map<number, Set<MatchQuality>> | null {
  if (!key) return null
  const rootPc = chordRootToPitchClass(key.root, key.accidental)
  const out = new Map<number, Set<MatchQuality>>()
  const add = (offset: number, ...qualities: MatchQuality[]) => {
    const pc = (rootPc + offset) % 12
    const set = out.get(pc) ?? new Set<MatchQuality>()
    for (const q of qualities) set.add(q)
    out.set(pc, set)
  }
  if (key.mode === 'major') {
    add(0, 'major', 'maj7') // I
    add(2, 'minor', 'min7') // ii
    add(4, 'minor', 'min7') // iii
    add(5, 'major', 'maj7') // IV
    add(7, 'major', '7') // V
    add(9, 'minor', 'min7') // vi
  } else {
    add(0, 'minor', 'min7') // i
    add(3, 'major', 'maj7') // III
    add(5, 'minor', 'min7') // iv
    add(7, 'minor', 'min7') // v (natural)
    add(7, 'major', '7') // V (harmonic — everywhere in practice)
    add(8, 'major', 'maj7') // VI
    add(10, 'major', '7') // VII
  }
  return out
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
function buildChord(pc: number, quality: MatchQuality, preferFlats: boolean): ChordSymbol {
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
  quality: MatchQuality
  score: number
}

/**
 * Match a chroma vector against the 60 chord templates (12 roots × major /
 * minor / dom7 / min7 / maj7) and rank by `Pearson × optional key bonus ×
 * optional same-kind-section bonus`. Returns the descending list.
 *
 * The 7th templates are what tells Am7 (A-C-E-G) apart from C major (C-E-G)
 * — with triads only those two were a coin flip, the single most common
 * mis-suggestion.
 *
 * Key bonus is CHORD-aware: a candidate whose root+quality is diatonic gets
 * 1.22×; root-in-scale-with-wrong-quality only 1.05×. `sameKindMatch`
 * candidates (same root + triad family as the chord the user placed in an
 * earlier same-kind section) get the SECTION_BIAS multiplier.
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
  const chordMap = useDiatonicBias ? diatonicChordMap(songKey) : null
  const section = useSectionBias ? opts.sameKindMatch ?? null : null
  const scored: ScoredCandidate[] = []
  for (let pc = 0; pc < 12; pc++) {
    for (const quality of MATCH_QUALITIES) {
      const template = buildTemplate(pc, QUALITY_INTERVALS[quality])
      let score = pearson(chroma, template)
      if (chordMap?.get(pc)?.has(quality)) score *= CHORD_IN_KEY_BIAS
      else if (inKey?.has(pc)) score *= ROOT_IN_KEY_BIAS
      if (section && section.pc === pc && section.quality === triadClassOf(quality)) {
        score *= SECTION_BIAS
      }
      scored.push({ pc, quality, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

/**
 * Pearson fit of ONE specific chord against a 12-d chroma vector — used by
 * the chord-sheet importer to arbitrate WHICH bar an imported chord starts
 * on. Maps the chord to its closest matchable template (7ths keep their
 * quality; dim → minor template on the same root as the nearest stand-in).
 * Returns null when the chord has no usable mapping or the chroma is empty.
 */
export function chordChromaFitScore(
  chroma: readonly number[] | null | undefined,
  chord: ChordSymbol,
): number | null {
  if (!chroma || chroma.length !== 12) return null
  const pc = chordRootToPitchClass(chord.root, chord.accidental)
  const q = chord.quality ?? 'major'
  const mq: MatchQuality =
    q === 'maj7' ? 'maj7'
    : q === 'min7' ? 'min7'
    : q === '7' ? '7'
    : q === 'minor' || q === 'm' || q === 'min' ? 'minor'
    : q === 'dim' || q === 'm7b5' || q === 'min7b5' ? 'minor'
    : 'major'
  const template = buildTemplate(pc, QUALITY_INTERVALS[mq])
  return pearson(chroma as number[], template)
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
  // Refuse stale chroma outright — hints from an older analyzer (bass-weighted
  // chroma bug) produce confidently WRONG suggestions. No suggestions is
  // better; the chords tab / background backfill re-analyze automatically.
  if (hints.analyzerVersion !== CHORD_ANALYZER_VERSION) return out

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
    // Confidence = margin against the best DIFFERENT chord (different root or
    // triad family). A triad and its own 7th (Am vs Am7) score near-identically
    // by construction — that's agreement about the chord, not ambiguity, and
    // must not suppress the suggestion.
    const rival = ranked.find(
      (c) => c.pc !== top.pc || triadClassOf(c.quality) !== triadClassOf(top.quality),
    )
    const confidence = top.score - (rival?.score ?? 0)
    if (confidence < MIN_SUGGESTION_CONFIDENCE) continue

    // Alternates: next candidates with UNIQUE root+family (the radial's 7th
    // variants row already covers same-root variants of the primary).
    const alternatives: ChordSymbol[] = []
    const seenFamily = new Set([`${top.pc}:${triadClassOf(top.quality)}`])
    for (const c of ranked.slice(1)) {
      if (alternatives.length >= SUGGESTION_TOP_N - 1) break
      const fam = `${c.pc}:${triadClassOf(c.quality)}`
      if (seenFamily.has(fam)) continue
      seenFamily.add(fam)
      alternatives.push(buildChord(c.pc, c.quality, preferFlats))
    }

    out.set(downbeatId, {
      beatId: downbeatId,
      barIndex: bar.index,
      chord: buildChord(top.pc, top.quality, preferFlats),
      confidence,
      alternatives,
    })
  }
  return out
}
