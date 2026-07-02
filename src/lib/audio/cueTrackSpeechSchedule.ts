/**
 * Spoken phrases for the offline cue WAV (mixed after click render).
 * Times are seconds on the **cue file** timeline (0 = start of exported WAV).
 *
 * Count-in numbers use **grid time** (same spacing as `computeCountIn` / metronome clicks),
 * not one continuous TTS phrase at speech rate.
 */
import { computeCountIn } from '$lib/audio/computeCountIn'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { Bar, Beat, CueAnchor, CueEvent, CueTrack, SongMap } from '$lib/songmap/types'

const END_EPS = 0.028

const MIN_SPEECH_ON_CUE_TIMELINE_SEC = 0.02

/**
 * Single source of truth for the spoken pre-song announcement text.
 *
 * Resolves in this priority:
 *  1. First enabled intro event on the selected/primary cue track.
 *  2. `sm.metadata.title` — historical default for older surfaces that still
 *     need a label before the user creates an intro cue.
 *  3. `'Untitled song'` — last-resort fallback for songs with neither.
 *
 * Whitespace is trimmed; empty strings count as "not set" so the user
 * can clear the field to revert to title-based behaviour.
 */
export function resolvedSpokenIntroText(sm: SongMap, track: CueTrack | undefined = getPrimaryCueTrack(sm)): string {
  const override = track?.events.find((event) => event.enabled && event.kind === 'intro')?.text?.trim()
  if (override) return override
  const title = sm.metadata.title?.trim()
  if (title) return title
  return 'Untitled song'
}

/**
 * Seconds of **cue-file** timeline reserved at t=0 before the first count-in click, so the
 * spoken title can finish without overlapping count numbers (desktop TTS).
 *
 * Needed whenever there's speech to fit at the head of the cue WAV — that is,
 * when the cue mode is `'spoken'` OR a count-in is active (both create content
 * the title would otherwise step on).
 *
 * Length math uses `resolvedSpokenIntroText(sm)` so the override shrinks /
 * grows the prelude just like a different title would.
 */
export function titleCuePreludeSec(sm: SongMap, track: CueTrack | undefined = getPrimaryCueTrack(sm)): number {
  const intro = track?.enabled
    ? track.events.find((event) => event.enabled && event.kind === 'intro' && event.text?.trim())
    : undefined
  if (!intro) return 0
  const len = Math.min(72, resolvedSpokenIntroText(sm, track).length)
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

export type CueSpeechKind = 'title' | 'count' | 'section' | 'custom'

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

function leadOffsetSec(anchor: CueAnchor, bar: Bar | undefined): number {
  if (!bar) return 0
  const barDur = bar.endSec - bar.startSec
  const beatDur = bar.beatCount > 0 ? barDur / bar.beatCount : 0
  const leadBars = anchor.leadBars ?? 0
  const leadBeats = anchor.leadBeats ?? 0
  const lead = leadBars * barDur + leadBeats * beatDur
  return Number.isFinite(lead) ? lead : 0
}

export function resolveCueEventOriginalTimeSec(sm: SongMap, event: CueEvent): number | null {
  const anchor = event.anchor
  const offset = anchor.offsetSec ?? 0
  if (anchor.kind === 'time') {
    const leadBar = sm.timeline.bars.find(
      (bar) => anchor.timeSec >= bar.startSec && anchor.timeSec < bar.endSec,
    )
    const t = anchor.timeSec - leadOffsetSec(anchor, leadBar) + offset
    return Number.isFinite(t) ? t : null
  }
  if (anchor.kind === 'beat') {
    const beat = sm.timeline.beats.find((b) => b.id === anchor.beatId)
    if (!beat) return null
    const bar = sm.timeline.bars.find((b) => b.id === beat.barId)
    const t = beat.timeSec - leadOffsetSec(anchor, bar) + offset
    return Number.isFinite(t) ? t : null
  }
  const bar = sm.timeline.bars.find((b) => b.id === anchor.barId)
  if (!bar) return null
  const t = bar.startSec - leadOffsetSec(anchor, bar) + offset
  return Number.isFinite(t) ? t : null
}

function speechKindForEvent(event: CueEvent): CueSpeechKind {
  if (event.kind === 'intro') return 'title'
  if (event.kind === 'count') return 'count'
  if (event.kind === 'section') return 'section'
  return 'custom'
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
 * Build speech events from an explicit cue track. Section/count generation
 * happens before this, in `generateCueTrackFromSections()`, so rendering and
 * playback preview never synthesize hidden cue content.
 */
export function buildCueSpeechEvents(
  sm: SongMap,
  track: CueTrack | undefined = getPrimaryCueTrack(sm),
): CueSpeechEvent[] {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) return []
  if (!track?.enabled) return []

  let prependSec = 0
  const countInBeats = effectiveCountInBeats(sm)
  if (countInBeats > 0) {
    const ci = computeCountIn(sm, countInBeats)
    if (ci) prependSec = ci.prependSec
  }

  const preludeSec = titleCuePreludeSec(sm, track)
  const events: CueSpeechEvent[] = []

  for (const event of track.events) {
    if (!event.enabled) continue
    const raw = event.text?.trim()
    if (!raw) continue
    const kind = speechKindForEvent(event)
    const maxLen = kind === 'title' ? 72 : 120
    const text = sanitizeCueSpeechText(raw.endsWith('.') ? raw : `${raw}.`, maxLen)
    if (kind === 'title') {
      events.push({ kind, tSec: MIN_SPEECH_ON_CUE_TIMELINE_SEC, text })
      continue
    }
    const originalTime = resolveCueEventOriginalTimeSec(sm, event)
    if (originalTime == null) continue
    const tSec = preludeSec + prependSec + (originalTime - trim.startSec)
    if (!Number.isFinite(tSec)) continue
    events.push({ kind, tSec: Math.max(MIN_SPEECH_ON_CUE_TIMELINE_SEC, tSec), text })
  }

  return events.sort((a, b) => a.tSec - b.tSec)
}
