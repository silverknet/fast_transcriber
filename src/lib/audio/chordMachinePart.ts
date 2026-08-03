/**
 * The chords and arp voices as SCHEDULED parts on the mix timeline.
 *
 * The Chords tab plays these voices frame-driven: `ChordJam.setPosition` fires
 * whatever the playhead crossed since the last rAF tick. That is fine for a
 * preview — you cannot hear 8 ms of jitter on a pad — but a mixer lane has to
 * be sample-accurate against the click, survive varispeed, and keep playing
 * through a seek. So the mixer schedules the notes ahead on the audio clock
 * instead, which needs each note's START and LENGTH up front.
 *
 * What to play still comes from `chordJamSchedule`, so the two surfaces cannot
 * disagree about the notes — only about how they are delivered.
 *
 * Time base: `chordJamSchedule` returns ORIGINAL audio time; everything here is
 * converted to mix time with the SAME layout the drum and bass machines use.
 */
import { arpHitPoints, keysPoints, seededRandom, type ArpSettings } from './chordJamSchedule'
import { drumTrackLayout, type DrumTrackLayout } from './drumPart'
import { transposeMidiNote } from './midiTranspose'
import type { SongMap } from '$lib/songmap/types'

/** One scheduled note, on the mix timeline. */
export type ChordPartNote = {
  atSec: number
  durationSec: number
  midi: number
  /** 0..127, the velocity the synth expects. */
  velocity: number
}

export type ChordPart = {
  notes: ChordPartNote[]
  durationSec: number
}

/** The layout is a property of the SONG, not of the instrument playing it. */
export const chordTrackLayout = drumTrackLayout

/**
 * A chord's notes are held until the next change. The tail is clipped to the
 * trim end so a lane can't ring past the song.
 */
const KEYS_VELOCITY = 92
/** Arp notes are short and detached — the live arp is monophonic. */
const ARP_GATE = 0.9
const ARP_VELOCITY = 100
/** A note shorter than this is inaudible; scheduling it just costs nodes. */
const MIN_NOTE_SEC = 0.02

/**
 * Convert original-time points into mix-time notes, dropping anything outside
 * the trim window. `endSec` is the point's own end in ORIGINAL time.
 */
function place(
  points: { timeSec: number; endSec: number; midi: number; velocity: number }[],
  layout: DrumTrackLayout,
  transposeSemitones = 0,
): ChordPartNote[] {
  const notes: ChordPartNote[] = []
  for (const p of points) {
    // A note that starts outside the window never sounds, exactly as the drum
    // and bass window tests assert.
    if (p.timeSec < layout.trimStartSec || p.timeSec >= layout.trimEndSec) continue
    // ...but one that STARTS inside may run past the end, so clip rather than drop.
    const end = Math.min(p.endSec, layout.trimEndSec)
    const durationSec = end - p.timeSec
    if (!(durationSec > MIN_NOTE_SEC)) continue
    notes.push({
      atSec: layout.shiftSec + (p.timeSec - layout.trimStartSec),
      durationSec,
      midi: transposeMidiNote(p.midi, transposeSemitones),
      velocity: p.velocity,
    })
  }
  return notes.sort((a, b) => a.atSec - b.atSec)
}

/**
 * The keys (block chord) part: every voiced note of a chord, held until the
 * chord changes.
 */
export function buildKeysPart(
  sm: SongMap,
  octave: number,
  layout: DrumTrackLayout,
  transposeSemitones = 0,
): ChordPart {
  const pts = keysPoints(sm, octave)
  const flat: { timeSec: number; endSec: number; midi: number; velocity: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    // Held until the next CHANGE — including a change to "no chord", which ends
    // the note rather than starting one.
    const endSec = pts[i + 1]?.timeSec ?? layout.trimEndSec
    for (const midi of p.notes) {
      flat.push({ timeSec: p.timeSec, endSec, midi, velocity: KEYS_VELOCITY })
    }
  }
  return { notes: place(flat, layout, transposeSemitones), durationSec: layout.durationSec }
}

/**
 * The arp part. The RNG is SEEDED: the 'random' direction would otherwise play
 * a different line every time the lane re-scheduled (after a seek, a sound
 * change, a varispeed move), which is not what "random" means to a player.
 */
export function buildArpPart(
  sm: SongMap,
  settings: ArpSettings,
  layout: DrumTrackLayout,
  transposeSemitones = 0,
): ChordPart {
  const hits = arpHitPoints(sm, settings, seededRandom())
  const flat = hits.map((h, i) => {
    const next = hits[i + 1]?.timeSec ?? h.timeSec + 0.25
    return {
      timeSec: h.timeSec,
      // Gated to just under the step so consecutive notes re-attack instead of
      // blurring into one another — the live arp is monophonic for this reason.
      endSec: h.timeSec + Math.max(MIN_NOTE_SEC, (next - h.timeSec) * ARP_GATE),
      midi: h.midi,
      velocity: ARP_VELOCITY,
    }
  })
  return { notes: place(flat, layout, transposeSemitones), durationSec: layout.durationSec }
}
