/**
 * Spoken phrases for the offline cue WAV (mixed after click render).
 * Times are seconds on the **cue file** timeline (0 = start of exported WAV).
 *
 * Count-in numbers use **grid time** (same spacing as `computeCountIn` / metronome clicks),
 * not one continuous TTS phrase at speech rate.
 */
import { computeCountIn } from '$lib/audio/computeCountIn'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
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
 *
 * Needed whenever there's speech to fit at the head of the cue WAV — that is,
 * when the cue mode is `'spoken'` OR a count-in is active (both create content
 * the title would otherwise step on).
 */
export function titleCuePreludeSec(sm: SongMap): number {
  const hasSpeech = sm.cues.mode === 'spoken'
  const hasCountIn = effectiveCountInBeats(sm) > 0
  if (!hasSpeech && !hasCountIn) return 0
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

/**
 * The song-start anchor. Single source of truth for "where does the song
 * actually begin." Used by every renderer that needs to place count-in
 * clicks, align stems, or compute the first downbeat on the click WAV.
 *
 * - Honors `sm.startBeatId` when set and the referenced beat exists.
 * - Falls back to `firstBarDownbeatBeat(sm)` (bar 1, beat 1).
 * - Returns `undefined` only when the timeline has no first-bar downbeat,
 *   in which case downstream code already handles "no start" gracefully.
 */
export function songStartBeat(sm: SongMap): Beat | undefined {
  if (sm.startBeatId) {
    const found = sm.timeline.beats.find((b) => b.id === sm.startBeatId)
    if (found) return found
  }
  return firstBarDownbeatBeat(sm)
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
 * Position on the click/cue WAV timeline (seconds from sample 0) where the
 * song's first musical downbeat — bar 1, beat 1 — lands. This is the
 * single, unambiguous "song start" anchor that the renderer uses for both
 * count-in clicks and song-aligned clicks.
 *
 * Click WAV layout:
 *
 *   [0,                    preludeSec)           — title-cue silence
 *   [preludeSec,           preludeSec + prependSec) — count-in silence
 *   [preludeSec + prependSec, songStart)         — pre-roll inside the trimmed
 *                                                  audio (= 0 if trim is tight
 *                                                  to the first downbeat)
 *    songStart                                   — bar 1, beat 1
 *   [songStart, …)                               — song clicks (downbeat first)
 *
 * Invariants downstream depend on this:
 *   - Count-in (N beats) → exactly N clicks at `[songStart − N·bd, songStart − bd]`,
 *     each spaced one beat apart, ending one beat before the downbeat lands.
 *   - The first downbeat-tone song click is mixed AT `songStart`.
 *
 * Returns null when timeline data is insufficient (no first-bar downbeat,
 * no usable beat duration, no trim).
 */
export function clickWavSongStartSec(
  sm: SongMap,
  opts: { preludeSec: number; prependSec: number },
): number | null {
  const start = songStartBeat(sm)
  if (!start) return null
  const trim = sm.audio?.trim
  if (!trim) return null
  const t = opts.preludeSec + opts.prependSec + (start.timeSec - trim.startSec)
  return Number.isFinite(t) ? t : null
}

/**
 * Output-file times (seconds, on the click-WAV timeline BEFORE the title
 * prelude — caller adds `titleCuePreludeSec(sm)`) for each count-in click.
 *
 * Returns **exactly `countInBeats`** times when timeline data is sufficient,
 * ending one beat before the song-start anchor.
 *
 * Placement strategy:
 *  - When the timeline has real beats BEFORE the song-start anchor (typically
 *    because `startBeatId` was moved later in the song), the count-in clicks
 *    land at those actual `beat.timeSec` values — preserving any per-beat
 *    timing irregularity. Each beat has a specific moment; we honor it.
 *  - For the earlier portion that extends before the timeline's earliest
 *    available beat (or when the anchor is bar 1 beat 1 with no pre-start
 *    beats at all), we synthesize uniform-bd spacing extending backward.
 */
export function countInSpeechOutputTimes(
  sm: SongMap,
  trim: { startSec: number; endSec: number },
  prependSec: number,
  countInBeats: number,
): number[] {
  if (countInBeats <= 0) return []
  const start = songStartBeat(sm)
  if (!start) return []
  const ci = computeCountIn(sm, countInBeats)
  if (!ci) return []
  const bd = ci.beatDurationSec
  if (!(bd > 0)) return []

  // Song start on the pre-prelude timeline. Adding `preludeSec` later maps
  // this onto the final click WAV.
  const songStartNoPrelude = prependSec + (start.timeSec - trim.startSec)
  if (!Number.isFinite(songStartNoPrelude)) return []

  // Real beats before the anchor, in time order. The last `countInBeats` of
  // them (if that many exist) become the count-in clicks; earlier slots are
  // synthesized below.
  const sorted = sortBeatsByTime(sm.timeline.beats)
  const startIdx = sorted.findIndex((b) => b.id === start.id)
  const preStartBeats: Beat[] = []
  if (startIdx > 0) {
    const take = Math.min(countInBeats, startIdx)
    for (let i = startIdx - take; i < startIdx; i++) preStartBeats.push(sorted[i]!)
  }
  const numActual = preStartBeats.length
  const numSynth = countInBeats - numActual
  // Synthesized clicks extend backward from the earliest available real beat
  // (or from the anchor itself if there are no pre-start beats at all).
  const synthAnchorOriginal = numActual > 0 ? preStartBeats[0]!.timeSec : start.timeSec

  const out: number[] = new Array(countInBeats)
  for (let k = 1; k <= countInBeats; k++) {
    let tOriginal: number
    if (k <= numSynth) {
      tOriginal = synthAnchorOriginal - (numSynth - k + 1) * bd
    } else {
      tOriginal = preStartBeats[k - numSynth - 1]!.timeSec
    }
    out[k - 1] = songStartNoPrelude - (start.timeSec - tOriginal)
  }
  return out
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
  const countInBeats = effectiveCountInBeats(sm)
  if (countInBeats > 0) {
    const ci = computeCountIn(sm, countInBeats)
    if (ci) prependSec = ci.prependSec
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
