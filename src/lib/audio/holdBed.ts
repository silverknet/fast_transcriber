/**
 * THE BED THAT FILLS THE GAP BETWEEN TWO SONGS.
 *
 * Every other transition is time-deterministic: the next song must load inside
 * a fixed window, which is why the hand-off can report a late landing at all.
 * A HOLD transition removes that race entirely — the outgoing song ends, a bed
 * loops for as long as you need, the next song loads underneath it with no
 * deadline, and you start it when the band is ready.
 *
 * ## Why the bed is in the INCOMING song's tempo and key
 *
 * Because then the gap is not dead air, it is an open-ended count-in. By the
 * time the trigger is pressed, everyone has been hearing the next song's tempo
 * for twenty seconds and is already inside it. The weakest moment in a set
 * becomes the most prepared one. That is the whole point of this module, and
 * it is why `holdBedPattern` takes the INCOMING song's numbers.
 *
 * ## Pure, like every other decision layer here
 *
 * One bar of events out; the engine loops it. No audio, no Web Audio, no
 * component — so the beds can be reasoned about and tested as music rather
 * than as a graph.
 */
import type { DrumClass } from '$lib/songmap/types'

/** What plays under the gap. */
export type HoldBedKind =
  /** Four-on-the-floor. Holds a room, primes the tempo, says nothing about key. */
  | 'kick'
  /** Kick plus the incoming song's root note — tempo AND key. The default. */
  | 'kick-bass'
  /** Kick and off-beat hats: more motion, for two up-tempo numbers in a row. */
  | 'kick-hat'
  /** Just the new key, breathing. For after a ballad, where a kick would be brutal. */
  | 'pad'

export const HOLD_BED_KINDS: readonly HoldBedKind[] = ['kick', 'kick-bass', 'kick-hat', 'pad']

export const HOLD_BED_LABELS: Record<HoldBedKind, string> = {
  kick: 'Kick pulse',
  'kick-bass': 'Kick + root note',
  'kick-hat': 'Kick + hats',
  pad: 'Pad on the new key',
}

/** One drum hit inside the loop. `atBeat` is beats from the top of the bar. */
export type HoldDrumHit = { cls: DrumClass; atBeat: number; level: number }
/** One sustained/plucked note inside the loop. */
export type HoldNote = { midi: number; atBeat: number; beats: number; level: number }

export type HoldBedPattern = {
  /** Length of one loop, in beats. */
  loopBeats: number
  /** Seconds per beat, from the INCOMING song's tempo. */
  beatDurationSec: number
  drums: HoldDrumHit[]
  notes: HoldNote[]
}

export type HoldBedInput = {
  kind: HoldBedKind
  /** Incoming song's tempo. Falls back to a walking 100 when unknown. */
  bpm: number | undefined
  /**
   * Incoming song's tonic as a MIDI note, or null when the key is unknown.
   * A bed that needs a pitch and has none degrades to its drums-only sibling
   * rather than guessing a key — a wrong key under a gap is worse than none.
   */
  tonicMidi: number | null
  /** 0..1, authored per transition. */
  level: number
}

const DEFAULT_BPM = 100
/** Below this a "tempo" is a typo, above it a mis-detected double-time. */
const MIN_BPM = 40
const MAX_BPM = 220

function beatSec(bpm: number | undefined): number {
  const v = Number.isFinite(bpm) && (bpm ?? 0) > 0 ? (bpm as number) : DEFAULT_BPM
  return 60 / Math.min(MAX_BPM, Math.max(MIN_BPM, v))
}

/**
 * Build one bar of the bed.
 *
 * Levels are relative to the authored `level`, so one control rides the whole
 * bed and the internal balance (hats under kick, bass under both) is fixed
 * here rather than being four more sliders nobody will tune under pressure.
 */
export function holdBedPattern(input: HoldBedInput): HoldBedPattern {
  const beatDurationSec = beatSec(input.bpm)
  const level = Math.min(1, Math.max(0, input.level))
  const loopBeats = 4

  // A bed that needs a pitch and has none falls back rather than guessing.
  const kind: HoldBedKind =
    (input.kind === 'kick-bass' || input.kind === 'pad') && input.tonicMidi == null
      ? input.kind === 'pad'
        ? 'kick'
        : 'kick'
      : input.kind

  const drums: HoldDrumHit[] = []
  const notes: HoldNote[] = []

  if (kind === 'kick' || kind === 'kick-bass' || kind === 'kick-hat') {
    for (let b = 0; b < loopBeats; b++) {
      // Beat 1 slightly stronger, so the loop has a top and you can hear where
      // "one" is while you are counting yourself in.
      drums.push({ cls: 'kick', atBeat: b, level: level * (b === 0 ? 1 : 0.82) })
    }
  }
  if (kind === 'kick-hat') {
    for (let b = 0; b < loopBeats; b++) {
      drums.push({ cls: 'hihat', atBeat: b + 0.5, level: level * 0.45 })
    }
  }
  if (kind === 'kick-bass' && input.tonicMidi != null) {
    // Root on every beat, an octave below the tonic — under the kick, not
    // fighting it.
    for (let b = 0; b < loopBeats; b++) {
      notes.push({
        midi: input.tonicMidi - 12,
        atBeat: b,
        beats: 0.9,
        level: level * 0.7,
      })
    }
  }
  if (kind === 'pad' && input.tonicMidi != null) {
    // One sustained root + fifth across the whole bar: the new key, breathing.
    notes.push({ midi: input.tonicMidi, atBeat: 0, beats: loopBeats, level: level * 0.55 })
    notes.push({ midi: input.tonicMidi + 7, atBeat: 0, beats: loopBeats, level: level * 0.4 })
  }

  return { loopBeats, beatDurationSec, drums, notes }
}

/** Is this bed silent — nothing to schedule? */
export function holdBedIsSilent(pattern: HoldBedPattern): boolean {
  return pattern.drums.length === 0 && pattern.notes.length === 0
}
