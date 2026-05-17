/**
 * Spoken phrases for the offline cue WAV (mixed after click render).
 * Times are seconds on the **cue file** timeline (0 = start of exported WAV).
 *
 * Count-in numbers use **grid time** (same spacing as `computeCountIn` / metronome clicks),
 * not one continuous TTS phrase at speech rate.
 */
import { computeCountIn } from '$lib/audio/computeCountIn'
import { defaultSectionLabel } from '$lib/songmap/sectionEdit'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { Bar, Beat, SongMap } from '$lib/songmap/types'

const END_EPS = 0.028

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

/** Speak slightly before the click so the beat lands in the vowel. */
const COUNT_SPEECH_ANTICIPATION_SEC = 0.048
/** Section name clip ends ~this far before the first shortened count syllable. */
const SECTION_NAME_BEFORE_SHORT_PICKUP_SEC = 0.52
const MIN_SPEECH_ON_CUE_TIMELINE_SEC = 0.07

type SpeechAtom = { t: number; kind: 'count' | 'section'; text: string }

/**
 * Every section: **full bar** one…N (the bar before the pickup bar), **section name**, then
 * **shortened** count (first syllable = `sectionOrdinal+1` up to N; wraps to 1…N when past N) into the
 * section’s first downbeat. All times on the cue file timeline; shifted together if they start &lt; 0.
 */
function pushSectionCountInPack(
  events: CueSpeechEvent[],
  opts: {
    preludeSec: number
    prependSec: number
    trimStart: number
    bar: Bar
    sectionOrdinal: number
    middlePhrase: string
  },
): void {
  const { preludeSec, prependSec, trimStart, bar, sectionOrdinal, middlePhrase } = opts
  const N = Math.max(1, bar.beatCount)
  const barDur = bar.endSec - bar.startSec
  const bd = barDur / N
  if (!(bd > 0) || !Number.isFinite(bd)) return

  const T = bar.startSec
  const baseOnCue = preludeSec + prependSec + (T - trimStart)
  const shortFrom = sectionOrdinal + 1 <= N ? sectionOrdinal + 1 : 1

  const atoms: SpeechAtom[] = []

  for (let k = 1; k <= N; k++) {
    const hit = baseOnCue - 2 * N * bd + (k - 1) * bd
    const w = NUMBER_WORDS[k - 1] ?? String(k)
    atoms.push({ t: hit - COUNT_SPEECH_ANTICIPATION_SEC, kind: 'count', text: `${w}.` })
  }

  const firstShortHit = baseOnCue - (N - shortFrom + 1) * bd
  const tSectionSpeak = firstShortHit - COUNT_SPEECH_ANTICIPATION_SEC - SECTION_NAME_BEFORE_SHORT_PICKUP_SEC
  const mid = sanitizeCueSpeechText(middlePhrase.endsWith('.') ? middlePhrase : `${middlePhrase}.`, 120)
  atoms.push({ t: tSectionSpeak, kind: 'section', text: mid })

  for (let k = shortFrom; k <= N; k++) {
    const hit = baseOnCue - (N - k + 1) * bd
    const w = NUMBER_WORDS[k - 1] ?? String(k)
    atoms.push({ t: hit - COUNT_SPEECH_ANTICIPATION_SEC, kind: 'count', text: `${w}.` })
  }

  const minT = Math.min(...atoms.map((a) => a.t))
  const shift = minT < MIN_SPEECH_ON_CUE_TIMELINE_SEC ? MIN_SPEECH_ON_CUE_TIMELINE_SEC - minT : 0
  atoms.sort((a, b) => a.t - b.t)
  for (const a of atoms) {
    events.push({ kind: a.kind, tSec: a.t + shift, text: a.text })
  }
}

/**
 * Seconds of **cue-file** timeline reserved at t=0 before the first count-in click, so the
 * spoken title can finish without overlapping count numbers (desktop TTS).
 * Only used when `cues.mode === 'countIn'` and `countInBeats > 0`.
 */
export function titleCuePreludeSec(sm: SongMap): number {
  if (sm.cues.mode !== 'countIn' || sm.cues.countInBeats <= 0) return 0
  const raw = (sm.metadata.title || 'Untitled song').trim()
  const len = Math.min(72, raw.length)
  // Conservative headroom for Piper (~13–16 chars/s) + small gap before beat 1 of the grid.
  return Math.min(2.85, Math.max(0.82, 0.34 + len * 0.055))
}

export function firstBarDownbeatBeat(sm: SongMap): Beat | undefined {
  const bars = [...sm.timeline.bars].sort((a, b) => a.index - b.index)
  const firstBar = bars[0]
  if (!firstBar) return undefined
  return sortBeatsByTime(sm.timeline.beats).find((b) => b.barId === firstBar.id && b.indexInBar === 0)
}

export type CueSpeechKind = 'title' | 'count' | 'section'

export type CueSpeechEvent = {
  kind: CueSpeechKind
  tSec: number
  text: string
}

/** Sanitize for TTS: single line, bounded length. */
export function sanitizeCueSpeechText(raw: string, maxLen: number): string {
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1).trimEnd()}…`
}

/**
 * Output-file times (seconds) for each count-in beat: same steady spacing as the click track
 * leading up to the first bar-1 downbeat on the cue timeline.
 */
export function countInSpeechOutputTimes(
  sm: SongMap,
  trim: { startSec: number; endSec: number },
  prependSec: number,
  countInBeats: number,
): number[] {
  if (countInBeats <= 0) return []
  const bars = [...sm.timeline.bars].sort((a, b) => a.index - b.index)
  const firstBar = bars[0]
  if (!firstBar) return []
  const sorted = sortBeatsByTime(sm.timeline.beats)
  const fd = sorted.find((b) => b.barId === firstBar.id && b.indexInBar === 0)
  if (!fd) return []
  const ci = computeCountIn(sm, countInBeats)
  if (!ci) return []

  const trimStart = trim.startSec
  const T = prependSec + (fd.timeSec - trimStart)
  const bd = ci.beatDurationSec
  if (!(bd > 0) || !Number.isFinite(T)) return []

  const out: number[] = []
  for (let k = 1; k <= countInBeats; k++) {
    out.push(T - (countInBeats - k + 1) * bd)
  }
  return out.map((t) => (Number.isFinite(t) ? Math.max(0, t) : 0))
}

/**
 * Build speech events: **title** (actual `metadata.title` once), count-in numbers if enabled, then for
 * **each section** (intro, verse, chorus, …): **full bar** one…N → **section name** → **shortened**
 * count into that section’s downbeat (2…N, 3…N, …; then wrap). Matches e.g. title + one two three four
 * + Intro + two three four before the intro downbeat.
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

  const preludeSec = titleCuePreludeSec(sm)

  const title = sanitizeCueSpeechText(sm.metadata.title || 'Untitled song', 72)
  const events: CueSpeechEvent[] = [{ kind: 'title', tSec: 0.02, text: `${title}.` }]

  if (countInBeats > 0) {
    const times = countInSpeechOutputTimes(sm, trim, prependSec, countInBeats)
    for (let i = 0; i < times.length; i++) {
      const w = NUMBER_WORDS[i] ?? String(i + 1)
      const tClick = times[i]!
      /** After prelude: same grid as clicks; anticipation keeps the beat in the syllable. */
      const tSpeak = preludeSec + tClick - COUNT_SPEECH_ANTICIPATION_SEC
      events.push({ kind: 'count', tSec: tSpeak, text: `${w}.` })
    }
  }

  const sorted = [...sm.sections].sort((a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex)
  const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]))

  let sectionOrdinal = 0
  const trimStart = trim.startSec

  for (const sec of sorted) {
    const bar = barByIndex.get(sec.barRange.startBarIndex)
    if (!bar) continue

    const tMaster = bar.startSec
    const tCue = preludeSec + prependSec + (tMaster - trimStart) - 0.48
    if (!Number.isFinite(tCue)) continue

    const defaultLabel = defaultSectionLabel(sec.kind)
    const label = sec.label?.trim() ?? ''
    const isGeneric = label === '' || label === defaultLabel
    const middle = isGeneric ? defaultLabel : label

    sectionOrdinal += 1
    const before = events.length
    pushSectionCountInPack(events, {
      preludeSec,
      prependSec,
      trimStart,
      bar,
      sectionOrdinal,
      middlePhrase: middle,
    })
    if (events.length === before) {
      const phrase = sanitizeCueSpeechText(middle.endsWith('.') ? middle : `${middle}.`, 120)
      events.push({ kind: 'section', tSec: Math.max(0.06, tCue), text: phrase })
    }
  }

  return events
}
