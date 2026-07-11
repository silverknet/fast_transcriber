/**
 * Drum-track helpers: freshness, honesty counts, canonical paths.
 */
import type { DrumClass, DrumMidiEvent, SongMap } from './types'

/**
 * Mirror of `ANALYZER_VERSION` in
 * `desktop/native/python/sections/transcribe_drums.py`. Events produced by an
 * older analyzer are treated as stale — the panel offers a re-detect.
 */
export const DRUM_ANALYZER_VERSION = 1

/** Where the saved render lives inside a project song folder. */
export const DRUM_TRACK_REL = 'renders/drum-track.wav'

/** Same audio-identity string the chordHints flow uses. */
export function drumAudioFingerprint(sm: SongMap): string {
  const a = sm.audio
  if (!a) return ''
  return a.sha256 ?? `${a.fileName}:${a.fileSize ?? 0}`
}

/** Are the stored events from the current analyzer AND the current audio? */
export function hasFreshDrumMidi(sm: SongMap): boolean {
  const dm = sm.drumMidi
  if (!dm || dm.events.length === 0) return false
  if (dm.analyzerVersion !== DRUM_ANALYZER_VERSION) return false
  return dm.audioFingerprint === drumAudioFingerprint(sm)
}

/** Per-class hit counts for the honesty summary. */
export function drumClassCounts(events: DrumMidiEvent[]): Record<DrumClass, number> {
  const out: Record<DrumClass, number> = { kick: 0, snare: 0, hihat: 0, tom: 0, cymbal: 0 }
  for (const e of events) out[e.cls]++
  return out
}
