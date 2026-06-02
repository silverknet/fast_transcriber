/**
 * Setlist click WAV rendering.
 *
 * Single render path shared between the in-app mixer and the Ableton
 * setlist export: clicks only, no speech, count-in head + song-aligned
 * clicks. Lives at `cue/click-track.wav` (one file, one source of truth).
 * The mixer reads it from disk; the Ableton orchestrator (re-)renders it
 * before assembling the .als so the export is always fresh.
 *
 * `preludeOffsetSec` (= the position of `trim.startSec` inside the WAV)
 * is returned to callers so they can compute clip play ranges via
 * `clickPlayRange` in `timings.ts`.
 */

import { renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
import type { SongMap } from '$lib/songmap/types'

/** Relative path under a song folder for the click WAV. */
export const CLICK_TRACK_SUBPATH = 'cue/click-track.wav'

export type ClickRenderResult = {
  blob: Blob
  /**
   * Position of `trim.startSec` inside the rendered click WAV, in seconds.
   * Pass through to `clickPlayRange` so the Ableton clip's play range
   * starts on the first count-in click (or at song-start, if no count-in).
   */
  preludeOffsetSec: number
}

export async function renderClickTrackBlob(sm: SongMap): Promise<ClickRenderResult> {
  const result = await renderCueTrackWavBlob(sm, {
    includeClicks: true,
    includeSpeech: false,
  })
  return {
    blob: result.blob,
    preludeOffsetSec: result.preludeOffsetSec,
  }
}
