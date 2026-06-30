/**
 * Canonical playback plan for a song — the **single source of truth**
 * consumed by every runtime and offline surface that needs to align
 * to the song's beats:
 *
 *   - The live `PlaybackController` (grid-mode editor click loop, cue
 *     mix-preview click overlay).
 *   - The offline cue + click WAV renderers (`renderCueTrack.ts`).
 *   - The mix-preview WAV builder (`mixSongCuePreview.ts`).
 *   - The Ableton setlist orchestrator (via the legacy `songTimings`
 *     re-export in `src/lib/export/setlist/timings.ts`).
 *
 * Pure, deterministic, no `$state`. Consumers wrap it in `$derived` at
 * their call sites; it recomputes whenever any songMap field it reads
 * changes.
 *
 * Time conventions:
 *
 *   - **`original-time`** is seconds in the uploaded audio file
 *     (sample 0 = 0). `firstDownbeatOriginalSec` lives here.
 *   - **`audio-element-time`** is seconds in the trimmed audio that
 *     the `<audio>` element actually plays back (audio.trim.startSec
 *     = 0). `clickPoints[].timeSec` lives here. Count-in beats have
 *     NEGATIVE values — they fall before the audio element starts
 *     playing and are scheduled via Web Audio.
 *   - **`scene-time`** is Ableton's clock, where every clip in a
 *     scene fires together at 0. Translation is owned by the export
 *     orchestrator; the plan only commits to original- and audio-
 *     element-times.
 */
import { effectiveCountInBeats } from './countIn'
import { sortBeatsByTime } from './normalize'
import {
  countInSpeechOutputTimes,
  resolvedSpokenIntroText,
  songStartBeat,
  titleCuePreludeSec,
} from '$lib/audio/cueTrackSpeechSchedule'
import type { SongMap } from './types'

/** Default BPM when the SongMap has none — last-resort only. */
export const DEFAULT_BPM = 120

/** Auto-stop epsilon at clip ends; mirrored in transport / render code. */
const END_EPS = 0.028

export type PlaybackClickPoint = {
  /**
   * Time on the audio-element timeline (audio.trim.startSec = 0).
   * Count-in beats have NEGATIVE timeSec — they ring BEFORE the audio
   * element starts playing. Sorted ascending.
   */
  timeSec: number
  downbeat: boolean
  isCountIn: boolean
}

export type PlaybackPlan = {
  // ── Anchor + tempo ────────────────────────────────────────────────
  bpm: number
  trimStartSec: number
  trimEndSec: number
  songDurationSec: number
  /**
   * Original-time of bar 1, beat 1 (or the `startBeatId` override).
   * Both count-in clicks and song-aligned clicks reference this point.
   * Falls back to `trimStartSec` when no first-bar downbeat exists.
   */
  firstDownbeatOriginalSec: number
  /** Beat duration at the song-start anchor's bar. */
  beatDurationSec: number
  /** First audible beat ≥ `trimStartSec`, expressed in song-time. */
  firstBeatSongTimeSec: number

  // ── Count-in ──────────────────────────────────────────────────────
  countInBeats: number
  countInDurationSec: number
  /**
   * Pre-roll silence that must sit before the trimmed audio so all N
   * count-in clicks fit between scene-fire / play-start and bar 1.
   * `0` when the trim already has enough lead-in. Equivalent to
   * `computeCountIn(sm, countInBeats)?.prependSec ?? 0`.
   */
  prependSec: number

  // ── Spoken cue layer ──────────────────────────────────────────────
  /**
   * Headroom for the spoken pre-song announcement before count-in.
   * `0` when no speech is active. Computed from the resolved
   * announcement length, not the song title directly.
   */
  titlePreludeSec: number
  /**
   * The resolved announcement text — `cues.spokenIntroText` if set,
   * else `metadata.title`, else `'Untitled song'`.
   */
  spokenIntroText: string

  // ── Click schedule ────────────────────────────────────────────────
  /**
   * All clicks the song wants, on the audio-element timeline.
   * Negative entries are count-in (ring before audio starts).
   * Sorted ascending.
   */
  clickPoints: PlaybackClickPoint[]
}

/**
 * Compute the canonical playback plan, or `null` when the song can't
 * be played (no trim, no usable timeline).
 */
export function songPlaybackPlan(sm: SongMap): PlaybackPlan | null {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) return null

  const bpm = sm.metadata.bpm && sm.metadata.bpm > 0 ? sm.metadata.bpm : DEFAULT_BPM
  const bars = [...sm.timeline.bars].sort((a, b) => a.index - b.index)
  const sortedBeats = sortBeatsByTime(sm.timeline.beats)

  // ── Anchor + per-bar beat duration ────────────────────────────────
  // Honor `startBeatId` via `songStartBeat`; fall back to bar 1 beat 1.
  // Beat duration is taken from THIS beat's bar so count-in spacing
  // follows the local meter when the user moves the start anchor.
  const startBeat = songStartBeat(sm)
  const firstDownbeatOriginalSec = startBeat?.timeSec ?? trim.startSec
  const startBar = startBeat ? bars.find((b) => b.id === startBeat.barId) : undefined
  const beatDurationSec =
    startBar && startBar.beatCount > 0
      ? (startBar.endSec - startBar.startSec) / startBar.beatCount
      : 60 / bpm

  // ── Count-in ──────────────────────────────────────────────────────
  const countInBeats = effectiveCountInBeats(sm)
  const countInDurationSec = countInBeats * beatDurationSec
  const effectiveFirstDownbeatSec = firstDownbeatOriginalSec - trim.startSec
  const prependSec = Math.max(0, countInDurationSec - effectiveFirstDownbeatSec)

  // First audible beat in song-time.
  const firstBeat = sortedBeats.find((b) => b.timeSec >= trim.startSec - 1e-9)
  const firstBeatSongTimeSec = firstBeat ? Math.max(0, firstBeat.timeSec - trim.startSec) : 0

  // ── Spoken cue layer ──────────────────────────────────────────────
  const titlePreludeSec = titleCuePreludeSec(sm)
  const spokenIntroText = resolvedSpokenIntroText(sm)

  // ── Click schedule on audio-element timeline ──────────────────────
  //
  // `countInSpeechOutputTimes` returns N times on the pre-prelude
  // cue-WAV timeline (= audio-element-time + prependSec). The last
  // value sits exactly one beat before `firstDownbeat - trimStart +
  // prependSec`; the first sits N beats before it. Subtracting
  // `prependSec` lands them on audio-element-time, where:
  //
  //   * positive values fall inside the trimmed audio's lead-in
  //     (drum riff, pickup, silence — audible during normal playback);
  //   * negative values fall before audio plays at all (Web Audio
  //     scheduled pre-roll handled by the controller).
  //
  // Song beats: emit `beat.timeSec - trim.startSec` for beats inside
  // the trim window. When count-in is active AND the user moved the
  // start anchor, skip any beats before that anchor (the count-in
  // grid already covers them).
  const clickPoints: PlaybackClickPoint[] = []

  if (countInBeats > 0 && startBeat) {
    const grid = countInSpeechOutputTimes(sm, trim, prependSec, countInBeats)
    for (const t of grid) {
      clickPoints.push({
        timeSec: t - prependSec,
        downbeat: false,
        isCountIn: true,
      })
    }
  }

  for (const b of sortedBeats) {
    if (b.timeSec < trim.startSec - 1e-9) continue
    if (b.timeSec >= trim.endSec - END_EPS) continue
    if (countInBeats > 0 && startBeat && b.timeSec < startBeat.timeSec) continue
    clickPoints.push({
      timeSec: b.timeSec - trim.startSec,
      downbeat: b.indexInBar === 0,
      isCountIn: false,
    })
  }

  clickPoints.sort((a, b) => a.timeSec - b.timeSec)

  return {
    bpm,
    trimStartSec: trim.startSec,
    trimEndSec: trim.endSec,
    songDurationSec: trim.endSec - trim.startSec,
    firstDownbeatOriginalSec,
    beatDurationSec,
    firstBeatSongTimeSec,
    countInBeats,
    countInDurationSec,
    prependSec,
    titlePreludeSec,
    spokenIntroText,
    clickPoints,
  }
}
