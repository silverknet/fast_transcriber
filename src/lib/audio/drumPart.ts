/**
 * Where a drum part sits on the mix timeline — the ONE definition, shared by
 * the offline renderer and the live MIDI instrument.
 *
 * Generated events carry ORIGINAL audio time (the same base as `Beat.timeSec`).
 * Everything that plays them has to make the same two conversions: drop what
 * falls outside the trim, and shift the rest by the preamble the mix timeline
 * starts with. Today `mixDrumEvents` does that inline; if the live path did its
 * own version the two would drift a few milliseconds apart and nobody would
 * notice until the drums felt late against the click.
 *
 *   mixTimeSec = titleCuePreludeSec + plan.prependSec + (timeSec − trimStartSec)
 *
 * Pure — no AudioContext, no I/O — so the mapping is unit-testable on its own.
 */
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import { titleCuePreludeSec } from './cueTrackSpeechSchedule'
import { drumVelocityGain } from './renderDrumTrack'
import type { DrumClass, DrumMidiEvent, SongMap } from '$lib/songmap/types'

export type DrumTrackLayout = {
  trimStartSec: number
  trimEndSec: number
  /** Seconds of preamble before the trimmed audio starts. */
  shiftSec: number
  /** Full mix-timeline length of the track. */
  durationSec: number
}

/** One hit, positioned on the mix timeline and pre-gained. */
export type DrumPartHit = {
  mixTimeSec: number
  cls: DrumClass
  /** `drumVelocityGain(velocity)`, applied once here rather than per consumer. */
  gain: number
}

export type DrumPart = {
  hits: DrumPartHit[]
  durationSec: number
}

/**
 * The track's placement on the mix timeline, or null when the song has no
 * usable trim (the same condition the renderer throws on).
 */
export function drumTrackLayout(sm: SongMap): DrumTrackLayout | null {
  const trim = sm.audio?.trim
  if (!trim || !(trim.endSec > trim.startSec)) return null
  const plan = songPlaybackPlan(sm)
  if (!plan) return null
  const shiftSec = titleCuePreludeSec(sm) + plan.prependSec
  const durationSec = shiftSec + plan.songDurationSec
  if (!(durationSec > 0)) return null
  return { trimStartSec: trim.startSec, trimEndSec: trim.endSec, shiftSec, durationSec }
}

/**
 * Position events on the mix timeline.
 *
 * The window test is `< trimStartSec || >= trimEndSec` — deliberately the same
 * comparison, including which end is inclusive, that `mixDrumEvents` uses.
 */
export function buildDrumPart(events: DrumMidiEvent[], layout: DrumTrackLayout): DrumPart {
  const hits: DrumPartHit[] = []
  for (const e of events) {
    if (e.timeSec < layout.trimStartSec || e.timeSec >= layout.trimEndSec) continue
    hits.push({
      mixTimeSec: layout.shiftSec + (e.timeSec - layout.trimStartSec),
      cls: e.cls,
      gain: drumVelocityGain(e.velocity),
    })
  }
  hits.sort((a, b) => a.mixTimeSec - b.mixTimeSec)
  return { hits, durationSec: layout.durationSec }
}
