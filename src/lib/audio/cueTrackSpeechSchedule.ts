/**
 * Spoken phrases for the offline cue WAV (mixed after click render).
 * Times are seconds on the **cue file** timeline (0 = start of exported WAV).
 */
import { computeCountIn } from '$lib/audio/computeCountIn'
import type { SectionKind, SongMap } from '$lib/songmap/types'

const NUMBER_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
]

function kindFallbackPhrase(kind: SectionKind): string {
  switch (kind) {
    case 'intro':
      return 'Intro'
    case 'verse':
      return 'Verse'
    case 'preChorus':
      return 'Pre-chorus'
    case 'chorus':
      return 'Chorus'
    case 'bridge':
      return 'Bridge'
    case 'solo':
      return 'Solo'
    case 'outro':
      return 'Outro'
    case 'custom':
      return 'Section'
    default:
      return 'Section'
  }
}

export type CueSpeechEvent = { tSec: number; text: string }

/** Sanitize for TTS: single line, bounded length. */
export function sanitizeCueSpeechText(raw: string, maxLen: number): string {
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1).trimEnd()}…`
}

/**
 * Build ordered speech events: opening (title + count-in numbers), then one line per section start.
 */
export function buildCueSpeechEvents(sm: SongMap): CueSpeechEvent[] {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) return []

  let prependSec = 0
  let countInBeats = 0
  if (sm.cues.mode === 'countIn' && sm.cues.countInBeats > 0) {
    const ci = computeCountIn(sm, sm.cues.countInBeats)
    if (ci) prependSec = ci.prependSec
    countInBeats = sm.cues.countInBeats
  }

  const title = sanitizeCueSpeechText(sm.metadata.title || 'Untitled song', 72)
  const headParts: string[] = [title]
  if (countInBeats > 0) {
    for (let i = 0; i < countInBeats; i++) {
      headParts.push(NUMBER_WORDS[i] ?? String(i + 1))
    }
  }
  const headText = sanitizeCueSpeechText(headParts.join('. ') + '.', 420)

  const events: CueSpeechEvent[] = [{ tSec: 0.02, text: headText }]

  const sorted = [...sm.sections].sort((a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex)
  const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]))
  let verseOrdinal = 0

  const leadSec = 0.48

  for (const sec of sorted) {
    const bar = barByIndex.get(sec.barRange.startBarIndex)
    if (!bar) continue

    const tMaster = bar.startSec
    let tCue = prependSec + (tMaster - trim.startSec) - leadSec
    if (!Number.isFinite(tCue)) continue
    if (tCue < 0.06) tCue = 0.06

    let phrase: string
    const label = sec.label?.trim()
    if (label) {
      phrase = label
    } else if (sec.kind === 'verse') {
      verseOrdinal += 1
      phrase = `Verse ${verseOrdinal}`
    } else {
      phrase = kindFallbackPhrase(sec.kind)
    }
    phrase = sanitizeCueSpeechText(phrase.endsWith('.') ? phrase : `${phrase}.`, 120)
    events.push({ tSec: tCue, text: phrase })
  }

  events.sort((a, b) => a.tSec - b.tSec)
  return events
}
