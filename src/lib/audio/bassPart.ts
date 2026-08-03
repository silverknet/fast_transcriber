/**
 * Where a bass part sits on the mix timeline.
 *
 * The drum sibling of this lives in `drumPart.ts`; the LAYOUT is shared (it's a
 * property of the song, not of the instrument), so this reuses
 * `drumTrackLayout` rather than deriving the same numbers a second time — the
 * two must agree or the generated tracks would sit at different offsets.
 *
 * Notes come out in mix time, monophonic-guarded, ready to schedule.
 */
import { drumTrackLayout, type DrumTrackLayout } from './drumPart'
import { transposeMidiNote } from './midiTranspose'
import { trimBassOverlaps } from './renderBassTrack'
import type { BassVoiceNote } from './bassVoiceGraph'
import type { BassMidiEvent, SongMap } from '$lib/songmap/types'

export type BassPart = {
  notes: BassVoiceNote[]
  durationSec: number
}

/** Same layout the drum track uses — one definition for both. */
export function bassTrackLayout(sm: SongMap): DrumTrackLayout | null {
  return drumTrackLayout(sm)
}

/**
 * Position notes on the mix timeline.
 *
 * `trimBassOverlaps` is applied HERE, not left to the caller: the generator
 * doesn't do it, and without it two notes on the same pitch can stack and
 * double their amplitude — audible as a bump. The offline renderer calls it too.
 */
export function buildBassPart(
  events: BassMidiEvent[],
  layout: DrumTrackLayout,
  transposeSemitones = 0,
): BassPart {
  const notes: BassVoiceNote[] = []
  for (const e of trimBassOverlaps(events)) {
    if (e.timeSec < layout.trimStartSec || e.timeSec >= layout.trimEndSec) continue
    notes.push({
      atSec: layout.shiftSec + (e.timeSec - layout.trimStartSec),
      durationSec: e.durationSec,
      midi: transposeMidiNote(e.midi, transposeSemitones),
      velocity: e.velocity,
    })
  }
  notes.sort((a, b) => a.atSec - b.atSec)
  return { notes, durationSec: layout.durationSec }
}
