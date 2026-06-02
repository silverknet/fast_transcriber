/**
 * Half-smart prediction of the next section in a song that's being authored
 * chronologically. Rule-based — no model, no I/O, no learning. Reads
 * `SongMap.sections` (chronological by `barRange.startBarIndex`) and emits
 * a single suggestion the user can accept with one button.
 */

import type { Section, SectionKind, SongMap } from '$lib/songmap'
import { defaultSectionLabel } from '$lib/songmap/sectionEdit'

export type SectionSuggestion = {
  kind: SectionKind
  bars: number
  /** Short human-readable rationale shown next to the Accept button. */
  reason: string
}

/** Default lengths for kinds we've never seen in this song before. */
const DEFAULT_BARS: Record<SectionKind, number> = {
  intro: 4,
  verse: 8,
  preChorus: 4,
  chorus: 8,
  bridge: 8,
  solo: 8,
  riff: 4,
  break: 2,
  outro: 4,
  custom: 4,
}

function sortedSections(songMap: SongMap): Section[] {
  return [...songMap.sections].sort(
    (a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex,
  )
}

function sectionBarCount(s: Section): number {
  return s.barRange.endBarIndex - s.barRange.startBarIndex + 1
}

function countByKind(sections: Section[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of sections) out[s.kind] = (out[s.kind] ?? 0) + 1
  return out
}

/** Most-frequent prior bar count for this kind; falls back to the default. */
function predictBarCount(sections: Section[], kind: SectionKind): number {
  const sameKind = sections.filter((s) => s.kind === kind)
  if (sameKind.length === 0) return DEFAULT_BARS[kind]
  const freq: Record<number, number> = {}
  for (const s of sameKind) {
    const n = sectionBarCount(s)
    freq[n] = (freq[n] ?? 0) + 1
  }
  let bestN = 0
  let bestF = -1
  for (const [n, f] of Object.entries(freq)) {
    if (f > bestF) {
      bestN = Number(n)
      bestF = f
    }
  }
  return bestN
}

/**
 * Predict the kind of the next section given the chronological history.
 * Riff / break are treated as instrumental detours — they don't drive the
 * macro form, so the prediction "looks past" them at what came before.
 *
 * Single-best version, retained for backward compatibility with the
 * `predictNextSection` wrapper. The richer multi-candidate version
 * `kindCandidates` is what drives the new UI.
 */
function predictKind(sections: Section[]): { kind: SectionKind; reason: string } | null {
  const list = kindCandidates(sections)
  if (list.length === 0) return null
  return { kind: list[0].kind, reason: list[0].reason }
}

/** Internal: per-kind candidate with a 0..1 base score and a human reason. */
type KindCandidate = { kind: SectionKind; score: number; reason: string }

/**
 * Return *all* plausible next-section kinds, ranked by base score.
 *
 * Driven by the last placed section (with riff/break being transparent —
 * we look past them at the previous "real" driver). Context modifiers
 * lift / lower scores based on how many of each kind we've already seen.
 *
 * Returns `[]` when no kind makes sense (cold start, after outro/custom,
 * or a song made entirely of riffs).
 */
function kindCandidates(sections: Section[]): KindCandidate[] {
  if (sections.length === 0) return []

  const last = sections[sections.length - 1]
  if (last.kind === 'outro' || last.kind === 'custom') return []

  const counts = countByKind(sections)
  const verseCount = counts.verse ?? 0
  const chorusCount = counts.chorus ?? 0
  const hasBridge = (counts.bridge ?? 0) > 0
  const hasPreChorus = (counts.preChorus ?? 0) > 0

  // Look past riffs/breaks at the previous "structural" section.
  let driver = last
  if (driver.kind === 'riff' || driver.kind === 'break') {
    for (let i = sections.length - 2; i >= 0; i--) {
      const s = sections[i]
      if (s.kind !== 'riff' && s.kind !== 'break') {
        driver = s
        break
      }
    }
    if (driver === last) return [] // entirely riffs/breaks
  }

  const out: KindCandidate[] = []
  switch (driver.kind) {
    case 'intro':
      out.push({ kind: 'verse', score: 0.9, reason: 'Intros usually lead into a verse.' })
      out.push({ kind: 'chorus', score: 0.2, reason: 'Some songs go straight from intro to chorus.' })
      break
    case 'verse':
      out.push({
        kind: 'preChorus',
        score: hasPreChorus ? 0.9 : 0.55,
        reason: hasPreChorus
          ? 'You used a pre-chorus earlier — likely the same pattern here.'
          : 'Verse → pre-chorus is a common pop pattern.',
      })
      out.push({ kind: 'chorus', score: 0.7, reason: 'Verse → chorus is the most common move.' })
      out.push({ kind: 'verse', score: 0.25, reason: 'Two verses back-to-back happens occasionally.' })
      break
    case 'preChorus':
      out.push({ kind: 'chorus', score: 0.95, reason: 'Pre-chorus → chorus.' })
      out.push({ kind: 'verse', score: 0.1, reason: 'Pre-chorus → verse is unusual but possible.' })
      break
    case 'chorus': {
      // When chorusCount ≥ 2 and there's no bridge yet, the bridge is the
      // dominant signal — make sure it can't be beaten by a verse candidate
      // riding a strong prior-length match in the cross-product later.
      const bridgeStrong = chorusCount >= 2 && !hasBridge
      if (bridgeStrong) {
        out.push({
          kind: 'bridge',
          score: 0.95,
          reason: 'Two choruses in — typically a bridge is up next.',
        })
      }
      if (verseCount <= chorusCount) {
        out.push({
          kind: 'verse',
          score: bridgeStrong ? 0.4 : 0.65,
          reason: 'Back to a verse before the next chorus.',
        })
      }
      out.push({ kind: 'chorus', score: 0.4, reason: 'Chorus repeats — pop song form.' })
      out.push({ kind: 'outro', score: 0.3, reason: 'Songs often end on or just after a chorus.' })
      break
    }
    case 'bridge':
      out.push({ kind: 'chorus', score: 0.9, reason: 'Bridge → final chorus.' })
      out.push({ kind: 'outro', score: 0.2, reason: 'Some songs go bridge → outro.' })
      break
    case 'solo':
      out.push({ kind: 'chorus', score: 0.7, reason: 'Solo → chorus.' })
      out.push({ kind: 'verse', score: 0.4, reason: 'Solo → verse is also common.' })
      break
    default:
      return []
  }

  // Sort by score desc so the cross-product later naturally produces a
  // sensibly-ordered top-N when length scores are similar.
  return out.sort((a, b) => b.score - a.score)
}

/**
 * Audio-derived border. Indices align with `SongMap.timeline.bars`: a border
 * at `bar: N` means "a new section likely begins at bar N." Produced by the
 * Python sidecar (`border_suggest.py`), surfaced via `desktopBridge`.
 */
export type AudioBorderHint = { bar: number; confidence: number }

/** Range (in bars) that an audio-border-derived length must fall into to be trusted. */
const AUDIO_BARS_MIN = 2
const AUDIO_BARS_MAX = 16
/** Confidence floor — below this the predictor falls back to the rule-based length. */
const AUDIO_CONFIDENCE_FLOOR = 0.35

/** Hard ceiling on how many candidates the UI can sensibly cycle through. */
const MAX_CANDIDATES = 5

/** Internal: per-length candidate with score + source-of-truth reason. */
type LengthCandidate = { bars: number; score: number; reason: string }

/**
 * Length candidates for a given kind: audio borders (if any in range),
 * the most-frequent prior length for this kind, and the default.
 * Deduped by `bars`, highest-scored reason wins.
 */
function lengthCandidates(
  sections: Section[],
  kind: SectionKind,
  audioBorders: AudioBorderHint[] | undefined,
  nextStart: number,
): LengthCandidate[] {
  const byBars: Map<number, LengthCandidate> = new Map()
  const add = (cand: LengthCandidate): void => {
    const existing = byBars.get(cand.bars)
    if (!existing || cand.score > existing.score) byBars.set(cand.bars, cand)
  }

  // 1) Audio borders in the [AUDIO_BARS_MIN, AUDIO_BARS_MAX] band after nextStart.
  if (audioBorders && audioBorders.length > 0) {
    for (const b of audioBorders) {
      if (b.confidence < AUDIO_CONFIDENCE_FLOOR) continue
      const delta = b.bar - nextStart
      if (delta < AUDIO_BARS_MIN || delta > AUDIO_BARS_MAX) continue
      add({
        bars: delta,
        score: 0.6 + 0.4 * Math.max(0, Math.min(1, b.confidence)),
        reason: `audio detected a change around bar ${b.bar + 1} (${Math.round(b.confidence * 100)}% confidence)`,
      })
    }
  }

  // 2) Most-frequent prior length for this kind.
  const prior = predictBarCount(sections, kind)
  if (prior > 0 && sections.some((s) => s.kind === kind)) {
    add({
      bars: prior,
      score: 0.55,
      reason: `${prior} bars to match your other ${defaultSectionLabel(kind).toLowerCase()}s`,
    })
  }

  // 3) Default for this kind.
  const def = DEFAULT_BARS[kind]
  if (def > 0) {
    add({
      bars: def,
      score: 0.4,
      reason: `${def} bars is a typical ${defaultSectionLabel(kind).toLowerCase()} length`,
    })
  }

  return [...byBars.values()].sort((a, b) => b.score - a.score)
}

/**
 * Top-ranked next-section candidates. Cross-product of kind candidates ×
 * length candidates, scored by `kind.score * length.score`, filtered to
 * candidates that fit the timeline, deduped by `(kind, bars)`, sorted
 * descending, capped at `MAX_CANDIDATES`.
 *
 * Returns `[]` for cold start, after outro / custom, or when no candidate
 * fits in the remaining bars.
 */
export function predictNextSectionCandidates(
  songMap: SongMap,
  opts?: { audioBorders?: AudioBorderHint[] },
): SectionSuggestion[] {
  const sections = sortedSections(songMap)
  const kinds = kindCandidates(sections)
  if (kinds.length === 0) return []

  const last = sections[sections.length - 1]
  const nextStart = last.barRange.endBarIndex + 1
  const totalBars = songMap.timeline.bars.length

  type Combined = { kind: SectionKind; bars: number; score: number; reason: string }
  const combined: Combined[] = []
  for (const k of kinds) {
    const lengths = lengthCandidates(sections, k.kind, opts?.audioBorders, nextStart)
    for (const l of lengths) {
      if (l.bars <= 0) continue
      const nextEnd = nextStart + l.bars - 1
      if (nextEnd >= totalBars) continue
      combined.push({
        kind: k.kind,
        bars: l.bars,
        score: k.score * l.score,
        reason: `${k.reason} (${l.reason})`,
      })
    }
  }

  // Dedupe by (kind, bars), keep the best-scored entry.
  const byKey: Map<string, Combined> = new Map()
  for (const c of combined) {
    const key = `${c.kind}:${c.bars}`
    const existing = byKey.get(key)
    if (!existing || c.score > existing.score) byKey.set(key, c)
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(({ kind, bars, reason }) => ({ kind, bars, reason }))
}

/**
 * Single-best next-section suggestion — thin wrapper around
 * `predictNextSectionCandidates` returning `candidates[0]` or `null`.
 * Retained for backward compatibility with existing callers / tests.
 */
export function predictNextSection(
  songMap: SongMap,
  opts?: { audioBorders?: AudioBorderHint[] },
): SectionSuggestion | null {
  const out = predictNextSectionCandidates(songMap, opts)
  return out[0] ?? null
}
