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
 */
function predictKind(sections: Section[]): { kind: SectionKind; reason: string } | null {
  if (sections.length === 0) return null

  const last = sections[sections.length - 1]
  if (last.kind === 'outro' || last.kind === 'custom') return null

  const counts = countByKind(sections)
  const verseCount = counts.verse ?? 0
  const chorusCount = counts.chorus ?? 0
  const hasBridge = (counts.bridge ?? 0) > 0
  const hasPreChorus = (counts.preChorus ?? 0) > 0

  // For riff / break, defer to whatever preceded them (instrumental detour).
  let driver = last
  if (driver.kind === 'riff' || driver.kind === 'break') {
    for (let i = sections.length - 2; i >= 0; i--) {
      const s = sections[i]
      if (s.kind !== 'riff' && s.kind !== 'break') {
        driver = s
        break
      }
    }
    if (driver === last) return null // entire song is riffs/breaks — give up.
  }

  switch (driver.kind) {
    case 'intro':
      return { kind: 'verse', reason: 'Intros usually lead into a verse.' }
    case 'verse':
      if (hasPreChorus) {
        return { kind: 'preChorus', reason: 'You used a pre-chorus earlier — likely the same pattern here.' }
      }
      return { kind: 'chorus', reason: 'Verse → chorus is the common move.' }
    case 'preChorus':
      return { kind: 'chorus', reason: 'Pre-chorus → chorus.' }
    case 'chorus':
      if (chorusCount >= 2 && !hasBridge) {
        return { kind: 'bridge', reason: 'Two choruses in — typically a bridge is up next.' }
      }
      if (verseCount <= chorusCount) {
        return { kind: 'verse', reason: 'Back to a verse before the next chorus.' }
      }
      return { kind: 'chorus', reason: 'Chorus repeats — pop song form.' }
    case 'bridge':
      return { kind: 'chorus', reason: 'Bridge → final chorus.' }
    case 'solo':
      return { kind: 'chorus', reason: 'Solo → chorus.' }
    default:
      return null
  }
}

/**
 * Public entry point. Returns `null` when:
 *   - the song has no sections (cold start),
 *   - the last section is `outro` / `custom`,
 *   - the predicted range would overrun the timeline.
 */
export function predictNextSection(songMap: SongMap): SectionSuggestion | null {
  const sections = sortedSections(songMap)
  const pick = predictKind(sections)
  if (!pick) return null

  const bars = predictBarCount(sections, pick.kind)
  if (bars <= 0) return null

  const last = sections[sections.length - 1]
  const nextStart = last.barRange.endBarIndex + 1
  const nextEnd = nextStart + bars - 1
  if (nextEnd >= songMap.timeline.bars.length) return null

  const lengthHint =
    sections.some((s) => s.kind === pick.kind && sectionBarCount(s) === bars)
      ? ` (${bars} bars to match your other ${defaultSectionLabel(pick.kind).toLowerCase()}s)`
      : ` (${bars} bars)`
  return {
    kind: pick.kind,
    bars,
    reason: pick.reason + lengthHint,
  }
}
