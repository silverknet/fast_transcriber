/**
 * Pure timing math for the Ableton setlist export.
 *
 * Single source of truth for "where does the song start", "how long is the
 * count-in", "where do the clip play ranges sit". The Ableton orchestrator
 * and the mixer both ultimately reference these numbers — no per-clip math
 * scattered around.
 *
 * Time conventions:
 *
 *   - `original-time` ........ seconds in the uploaded audio file (sample 0 = 0)
 *   - `scene-time` ........... time from when an Ableton scene fires.
 *                              In Live, all clips in a scene fire at scene-time 0.
 *
 * Anchor model:
 *
 *   - The **song start** is the first musical downbeat (bar 1, beat 1)
 *     in original-time. This is what count-in clicks lead INTO.
 *   - Scene fire (scene-time 0) maps to original-time
 *     `firstDownbeatOriginalSec − countInDurationSec`. The first `countInDurationSec`
 *     of scene-time is the count-in: clicks ring while the stems play whatever
 *     audio sits before the downbeat (silence, a drum riff, a pickup).
 *   - At scene-time `countInDurationSec`, both click and stems hit bar 1 beat 1
 *     in lockstep.
 *
 * The click WAV (rendered by `renderCueTrackWavBlob` and stored at
 * `cue/click-track.wav`) embeds the count-in clicks. Its `preludeOffsetSec`
 * field — recorded in `clickTrackExport` at render time — marks where the
 * song proper (= trim.startSec) lands inside the WAV. The clip's playStart
 * within the WAV is computed from this offset; see `clickPlayRange`.
 */

import type { SongMap } from '$lib/songmap/types'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { songStartBeat } from '$lib/audio/cueTrackSpeechSchedule'
import { effectiveCountInBeats } from '$lib/songmap/countIn'

/** Default BPM when the SongMap has none — used only as a last resort. */
export const DEFAULT_BPM = 120

export type SongTimings = {
  /** Beats-per-minute used to convert clip play-range seconds to beats. */
  bpm: number
  /** Where the song proper starts within the original uploaded audio. */
  trimStartSec: number
  /** Where the song ends within the original uploaded audio. */
  trimEndSec: number
  /** `trimEndSec - trimStartSec`. */
  songDurationSec: number
  /** Time of the first audible beat in song-time (≥ 0). */
  firstBeatSongTimeSec: number
  /**
   * Original-time of bar 1, beat 1 — the "song start" anchor that both
   * count-in and song-aligned clicks reference. Falls back to `trimStartSec`
   * when no first-bar downbeat is present.
   */
  firstDownbeatOriginalSec: number
  /** Beat duration at the first bar (seconds), or 60/bpm if no first bar. */
  beatDurationSec: number
  /** Top-level `countInBeats` from the SongMap; 0 when absent or non-positive. */
  countInBeats: number
  /** `countInBeats × beatDurationSec`. Total length of the count-in lead-in. */
  countInDurationSec: number
}

/** Compute timings for one song. Throws on missing/invalid trim. */
export function songTimings(sm: SongMap): SongTimings {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) {
    throw new Error('Song has no valid audio.trim')
  }
  const bpm = sm.metadata.bpm && sm.metadata.bpm > 0 ? sm.metadata.bpm : DEFAULT_BPM

  const bars = [...sm.timeline.bars].sort((a, b) => a.index - b.index)
  const sortedBeats = sortBeatsByTime(sm.timeline.beats)

  // Honor an explicit `startBeatId` override via `songStartBeat`; otherwise
  // fall back to bar 1 beat 1 (the historical implicit anchor).
  const startBeat = songStartBeat(sm)
  const firstDownbeatOriginalSec = startBeat?.timeSec ?? trim.startSec
  // Use THIS beat's bar for `beatDurationSec` so count-in spacing follows
  // local meter when the user moves the start into a later bar.
  const startBar = startBeat ? bars.find((b) => b.id === startBeat.barId) : undefined
  const beatDurationSec =
    startBar && startBar.beatCount > 0
      ? (startBar.endSec - startBar.startSec) / startBar.beatCount
      : 60 / bpm

  const countInBeats = effectiveCountInBeats(sm)
  const countInDurationSec = countInBeats * beatDurationSec

  // First-beat reference is the first beat AT OR AFTER `trim.startSec`.
  // Beats before the trim window aren't part of the song proper.
  const firstBeat = sortedBeats.find((b) => b.timeSec >= trim.startSec - 1e-9)
  const firstBeatSongTimeSec = firstBeat
    ? Math.max(0, firstBeat.timeSec - trim.startSec)
    : 0

  return {
    bpm,
    trimStartSec: trim.startSec,
    trimEndSec: trim.endSec,
    songDurationSec: trim.endSec - trim.startSec,
    firstBeatSongTimeSec,
    firstDownbeatOriginalSec,
    beatDurationSec,
    countInBeats,
    countInDurationSec,
  }
}

export type ClipPlayRange = {
  /** Where to start playing within the clip's audio file, in seconds. */
  playStartSec: number
  /** Where to stop playing within the clip's audio file, in seconds. */
  playEndSec: number
}

/**
 * Play range for a stem clip.
 *
 *   playStart = max(0, firstDownbeatOriginalSec − countInDurationSec)
 *   playEnd   = min(trimEndSec, stemDurationSec)
 *
 * When there's no count-in (`countInDurationSec === 0`), the stem starts
 * at the first downbeat — preserving lockstep with the click. When there
 * IS a count-in, the stem rewinds by `countInDurationSec`, playing whatever
 * lead-in audio is there (silence, drum riff, pickup) while the click ticks
 * the count.
 *
 * The clamp at 0 protects songs whose audio starts at or near the downbeat
 * (insufficient lead-in for the requested count-in); they'll get a partial
 * count-in head with stems starting at sample 0.
 */
export function stemPlayRange(t: SongTimings, stemDurationSec: number): ClipPlayRange {
  const idealStart = t.firstDownbeatOriginalSec - t.countInDurationSec
  const playStartSec = Math.max(0, Math.min(stemDurationSec, idealStart))
  const playEndSec = Math.max(playStartSec, Math.min(t.trimEndSec, stemDurationSec))
  return { playStartSec, playEndSec }
}

/**
 * Play range for the click clip given the click WAV's actual layout.
 *
 * Inputs:
 *   - `clickWavDurationSec` — total duration of the click WAV on disk.
 *   - `clickWavPreludeOffsetSec` — `preludeSec + prependSec` from the render;
 *     marks where `trim.startSec` lands inside the WAV. (Read this from
 *     the SongMap's `clickTrackExport.preludeOffsetSec`.)
 *
 * Maths:
 *   - `clickWavFirstDownbeatSec = preludeOffsetSec + (firstDownbeat − trimStart)`
 *     is where bar 1 beat 1 lives on the click WAV.
 *   - Subtract `countInDurationSec` to land on the first count-in click;
 *     that's our playStart inside the WAV.
 *   - Play to the end of the WAV (covers count-in + the entire song's clicks).
 */
export function clickPlayRange(
  t: SongTimings,
  clickWavDurationSec: number,
  clickWavPreludeOffsetSec: number,
): ClipPlayRange {
  const clickWavFirstDownbeatSec =
    clickWavPreludeOffsetSec + (t.firstDownbeatOriginalSec - t.trimStartSec)
  const idealStart = clickWavFirstDownbeatSec - t.countInDurationSec
  const playStartSec = Math.max(0, Math.min(clickWavDurationSec, idealStart))
  return { playStartSec, playEndSec: clickWavDurationSec }
}
