import type { Bar, Section, SongMap } from '$lib/songmap'
import { formatChordSymbol } from '$lib/chords'
import { beatById, harmonyBeatOffset, harmonyByBarId } from './iterate'

/**
 * Per-bar rendering hint, attached to each bar at chart-generation time.
 * The LeadSheet component consumes this alongside the bar/chord data.
 */
export type BarHint = {
  /** How to render the bar body. */
  display: 'normal' | 'nc' | 'simile' | 'skip'
  /** `|:` at the start of this bar. */
  repeatOpen?: boolean
  /** `:|` at the end of this bar. */
  repeatClose?: boolean
  /** Repeat count shown next to the closing repeat (`x2`, `x3`, …). */
  repeatCount?: number
  /** First bar of a volta bracket; the value becomes the bracket label (`"1."`). */
  voltaStart?: string
  /** Bar is inside an active volta bracket but not its start. */
  voltaContinue?: boolean
  /** Last bar of a volta bracket — close the right end of the bracket. */
  voltaEnd?: boolean
  /** Bar-number badge to render at the top-left of the bar. */
  barNumber?: number
}

export type ChartHints = {
  /** Hint keyed by `Bar.id`. Bars without an entry get `{ display: 'normal' }`. */
  bars: Map<string, BarHint>
}

/**
 * Build a per-bar fingerprint from harmony events: a sorted list of
 * `<beatOffset>:<chord-text>` pairs. Two bars with identical fingerprints
 * sound the same to a reader of the chart.
 */
function barFingerprint(bar: Bar, songMap: SongMap): string {
  const beats = beatById(songMap)
  const events = harmonyByBarId(songMap).get(bar.id) ?? []
  return [...events]
    .map((h) => `${harmonyBeatOffset(h, beats)}:${formatChordSymbol(h.chord)}`)
    .sort()
    .join(',')
}

/** Sort bars in section in song order, returning `Bar[]`. */
function sectionBars(songMap: SongMap, section: Section): Bar[] {
  const all = [...songMap.timeline.bars].sort((a, b) => a.index - b.index)
  return all.filter(
    (b) => b.index >= section.barRange.startBarIndex && b.index <= section.barRange.endBarIndex,
  )
}

/** Section fingerprint = ordered list of per-bar fingerprints. */
function sectionFingerprint(songMap: SongMap, section: Section): string[] {
  return sectionBars(songMap, section).map((b) => barFingerprint(b, songMap))
}

function commonPrefixLength(a: string[], b: string[]): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function ensureHint(map: Map<string, BarHint>, barId: string): BarHint {
  let h = map.get(barId)
  if (!h) {
    h = { display: 'normal' }
    map.set(barId, h)
  }
  return h
}

/**
 * Pass 1 — N.C. vs simile. A bar with no harmony events is either:
 *   - **simile** (carry the previous chord) — the default in pop/rock
 *   - **N.C.** (no chord) — silence/break, used when the last chord was a
 *     while ago. Heuristic: empty bar gets N.C. if no chord has been heard
 *     in the previous `NC_LOOKBACK` bars OR we haven't seen any chord yet.
 */
const NC_LOOKBACK = 4

function annotateEmptyBars(songMap: SongMap, hints: Map<string, BarHint>): void {
  const sorted = [...songMap.timeline.bars].sort((a, b) => a.index - b.index)
  const harm = harmonyByBarId(songMap)
  let barsSinceChord = NC_LOOKBACK + 1 // start as "never seen a chord"
  for (const bar of sorted) {
    const events = harm.get(bar.id) ?? []
    if (events.length === 0) {
      const h = ensureHint(hints, bar.id)
      h.display = barsSinceChord >= NC_LOOKBACK ? 'nc' : 'simile'
      barsSinceChord++
    } else {
      barsSinceChord = 0
    }
  }
}

/**
 * Pass 2 — repeat / volta detection between adjacent same-kind sections.
 *
 * For each adjacent pair `[A, B]` of sections of the same kind:
 *   - If A and B have identical bar fingerprints → mark A with a `:|` and
 *     `x2` repeat count; mark all of B's bars `skip`.
 *   - Else if A and B share a long common prefix (`prefix / len ≥
 *     VOLTA_MIN_PREFIX_RATIO`) → mark the shared part with `|:` … `:|`,
 *     the diverging tail of A as the **1.** ending, the matching shared
 *     bars of B as `skip`, and the diverging tail of B as the **2.** ending.
 *
 * v1 only handles pairs — `x3` / `x4` and chained voltas are out of scope.
 */
const VOLTA_MIN_PREFIX_RATIO = 0.5

function annotateRepeatsAndVoltas(songMap: SongMap, hints: Map<string, BarHint>): void {
  const sections = [...songMap.sections].sort(
    (a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex,
  )
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i]
    const b = sections[i + 1]
    if (a.kind !== b.kind) continue

    const aBars = sectionBars(songMap, a)
    const bBars = sectionBars(songMap, b)
    if (aBars.length === 0 || bBars.length === 0) continue

    const aSig = sectionFingerprint(songMap, a)
    const bSig = sectionFingerprint(songMap, b)

    // Full match → x2 repeat, skip section B entirely.
    if (
      aSig.length === bSig.length &&
      aSig.every((s, idx) => s === bSig[idx])
    ) {
      ensureHint(hints, aBars[0].id).repeatOpen = true
      const last = ensureHint(hints, aBars[aBars.length - 1].id)
      last.repeatClose = true
      last.repeatCount = 2
      for (const bar of bBars) {
        ensureHint(hints, bar.id).display = 'skip'
      }
      // Skip past `b` so we don't pair it again as `a` of the next loop.
      i++
      continue
    }

    // Partial match → volta. Need a substantial common prefix.
    const prefixLen = commonPrefixLength(aSig, bSig)
    const aTail = aSig.length - prefixLen
    const bTail = bSig.length - prefixLen
    if (prefixLen === 0) continue
    if (aTail === 0 || bTail === 0) continue
    if (prefixLen / Math.max(aSig.length, bSig.length) < VOLTA_MIN_PREFIX_RATIO) continue

    // Mark shared part of A with |: at start and :| at end of the volta-1 ending.
    ensureHint(hints, aBars[0].id).repeatOpen = true

    // Volta 1 = last `aTail` bars of A.
    const voltaOneStartIdx = aBars.length - aTail
    for (let k = 0; k < aTail; k++) {
      const bar = aBars[voltaOneStartIdx + k]
      const h = ensureHint(hints, bar.id)
      if (k === 0) h.voltaStart = '1.'
      else h.voltaContinue = true
      if (k === aTail - 1) {
        h.voltaEnd = true
        h.repeatClose = true
      }
    }

    // Shared part of B → skip.
    for (let k = 0; k < prefixLen; k++) {
      ensureHint(hints, bBars[k].id).display = 'skip'
    }

    // Volta 2 = last `bTail` bars of B.
    const voltaTwoStartIdx = bBars.length - bTail
    for (let k = 0; k < bTail; k++) {
      const bar = bBars[voltaTwoStartIdx + k]
      const h = ensureHint(hints, bar.id)
      if (k === 0) h.voltaStart = '2.'
      else h.voltaContinue = true
      if (k === bTail - 1) h.voltaEnd = true
    }

    i++ // consume B so it isn't paired again
  }
}

/** Pass 3 — bar numbers every `BAR_NUMBER_INTERVAL` bars. */
const BAR_NUMBER_INTERVAL = 4

function annotateBarNumbers(songMap: SongMap, hints: Map<string, BarHint>): void {
  const sorted = [...songMap.timeline.bars].sort((a, b) => a.index - b.index)
  for (const bar of sorted) {
    if (bar.index % BAR_NUMBER_INTERVAL === 0) {
      ensureHint(hints, bar.id).barNumber = bar.index + 1 // 1-based label
    }
  }
}

/**
 * Top-level analyzer. Pure: same input → same output. Order of the passes
 * matters because later passes can override earlier display values
 * (`skip` from the repeat pass beats `nc` / `simile` from the empty-bar pass).
 */
export function generateChartHints(songMap: SongMap): ChartHints {
  const hints = new Map<string, BarHint>()
  annotateEmptyBars(songMap, hints)
  annotateRepeatsAndVoltas(songMap, hints)
  annotateBarNumbers(songMap, hints)
  return { bars: hints }
}
