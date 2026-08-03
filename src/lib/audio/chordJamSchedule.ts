/**
 * What the chord voices PLAY, as pure functions of the song plus settings.
 *
 * These derivations used to live only inside `ChordJam`'s `$derived` fields,
 * which was fine while the Chords tab was the only surface that sounded them.
 * The mixer now hosts the same voices as scheduled MIDI lanes, and a second
 * copy of "which notes, when" would drift from the first — the same lesson the
 * drum and bass migrations taught. So the schedule lives here, and `ChordJam`
 * derives from it rather than alongside it.
 *
 * Everything here is in ORIGINAL audio time (the base `Beat.timeSec` uses).
 * Mapping to mix time is the caller's job — see `chordMachinePart.ts`.
 */
import { formatChordSymbol, resolveChordAtEachBeat } from '$lib/chords'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { ChordSymbol, SongMap } from '$lib/songmap/types'
import { voiceChordProgression } from './chordPlaybackVoicing'
import { arpSubsPerBeat, buildArpHits, type ArpDirection, type ArpRate } from './chordArp'

export type ChordChange = { timeSec: number; chord: ChordSymbol | null }
export type KeysPoint = { timeSec: number; notes: number[] }

/**
 * Chord CHANGE points. A chord carried across several beats yields ONE point,
 * so a held chord doesn't re-attack on every beat.
 *
 * Stored chords are voiced, NOT the display transpose: the audio is in its
 * original key, so the jam must be too.
 */
export function chordChangePoints(sm: SongMap): ChordChange[] {
  const resolved = resolveChordAtEachBeat(sm)
  const changes: ChordChange[] = []
  let prevKey: string | null = '--init--'
  for (const b of sortBeatsByTime(sm.timeline.beats)) {
    const chord = resolved.get(b.id) ?? null
    const key = chord ? formatChordSymbol(chord) : 'none'
    if (key === prevKey) continue
    prevKey = key
    changes.push({ timeSec: b.timeSec, chord })
  }
  return changes
}

/** Chord changes voiced to MIDI notes — what the keys voice holds. */
export function keysPoints(sm: SongMap, octave: number): KeysPoint[] {
  const changes = chordChangePoints(sm)
  const voiced = voiceChordProgression(
    changes.map((c) => c.chord),
    octave,
  )
  return changes.map((c, i) => ({ timeSec: c.timeSec, notes: voiced[i] ?? [] }))
}

/** The voiced chord in force at each beat — the arp's input grid. */
export function beatsWithVoicedNotes(sm: SongMap, octave: number): KeysPoint[] {
  const pts = keysPoints(sm, octave)
  return sortBeatsByTime(sm.timeline.beats).map((b) => {
    let notes: number[] = []
    for (const p of pts) {
      if (p.timeSec <= b.timeSec + 1e-6) notes = p.notes
      else break
    }
    return { timeSec: b.timeSec, notes }
  })
}

export type ArpSettings = {
  octave: number
  rate: ArpRate
  direction: ArpDirection
  /** How many octaves the pattern spans before repeating. Default 1. */
  octaves?: number
  /** 0..1 swing on the off-beats. Default 0 (straight). */
  swing?: number
}

/**
 * The arpeggiator's hits. `rnd` is injectable because the 'random' direction
 * would otherwise make a scheduled lane differ from the live one every pass.
 */
export function arpHitPoints(
  sm: SongMap,
  settings: ArpSettings,
  rnd: () => number = Math.random,
): { timeSec: number; midi: number }[] {
  return buildArpHits(
    beatsWithVoicedNotes(sm, settings.octave),
    arpSubsPerBeat(settings.rate),
    settings.direction,
    settings.octaves ?? 1,
    settings.swing ?? 0,
    rnd,
  )
}

/**
 * A deterministic RNG, so a scheduled arp lane plays the SAME line every time
 * it is re-scheduled. Live, `Math.random` is fine — nobody re-hears a note.
 * Scheduled, a re-render after a fader move would otherwise change the part.
 */
export function seededRandom(seed = 0x9e3779b9): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
