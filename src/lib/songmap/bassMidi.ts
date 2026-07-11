/**
 * Bass-track helpers: freshness + canonical paths. `drumMidi.ts`'s sibling.
 */
import type { SongMap } from './types'

export { drumAudioFingerprint as bassAudioFingerprint } from './drumMidi'
import { drumAudioFingerprint } from './drumMidi'

/**
 * Mirror of `ANALYZER_VERSION` in
 * `desktop/native/python/sections/transcribe_bass.py`. Notes produced by an
 * older analyzer are treated as stale — the panel offers a re-detect.
 */
export const BASS_ANALYZER_VERSION = 1

/** Where the saved render lives inside a project song folder. */
export const BASS_TRACK_REL = 'renders/bass-track.wav'

/** Are the stored notes from the current analyzer AND the current audio? */
export function hasFreshBassMidi(sm: SongMap): boolean {
  const bm = sm.bassMidi
  if (!bm || bm.events.length === 0) return false
  if (bm.analyzerVersion !== BASS_ANALYZER_VERSION) return false
  return bm.audioFingerprint === drumAudioFingerprint(sm)
}
