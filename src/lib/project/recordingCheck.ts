/**
 * "Is everyone playing the same recording?"
 *
 * A shared song carries the audio's identity but never its bytes, so each
 * member supplies their own file. That is normal and fine — a WAV and an MP3 of
 * the same master both fit the grid. What is NOT fine is a different cut: bars
 * and beats are stored as absolute seconds, so a version with a longer intro or
 * an extra verse silently puts every downbeat in the wrong place. Nothing
 * re-checked that after import; this does.
 *
 * Compares the local audio's recording identity against `expectedAudio` — the
 * identity the person who shared the song stamped. Only meaningful for
 * cloud-linked songs, since `expectedAudio` is absent otherwise.
 */
import {
  FINGERPRINT_DURATION_TOLERANCE_SEC,
  compareFingerprints,
} from '$lib/audio/audioFingerprint'
import type { SongMap } from '$lib/songmap/types'

export type RecordingCheck =
  /** Same recording as the shared one — the grid fits. */
  | { status: 'ok' }
  /**
   * Not comparable: the song isn't shared, or one side predates recording
   * identity and hasn't been opened since. Never shown to the user — an
   * "unknown" is not a problem, just an absence of evidence.
   */
  | { status: 'unknown' }
  /** Definitely a different recording. */
  | {
      status: 'different'
      /** `length` when the durations disagree, `content` when the audio does. */
      reason: 'length' | 'content'
      localDurationSec?: number
      sharedDurationSec?: number
    }

export function checkRecordingMatchesShared(map: SongMap | null | undefined): RecordingCheck {
  const local = map?.audio?.fingerprint
  const shared = map?.expectedAudio?.fingerprint
  if (!local || !shared) return { status: 'unknown' }

  const verdict = compareFingerprints(local, shared)
  if (verdict === 'undecided') return { status: 'unknown' }
  if (verdict === 'same') return { status: 'ok' }

  // Separate the two failures so the message can be concrete. A length
  // difference is something the user can check for themselves in seconds; a
  // content difference means same length, different music.
  const lengthDiffers =
    Math.abs(local.durationSec - shared.durationSec) > FINGERPRINT_DURATION_TOLERANCE_SEC
  return {
    status: 'different',
    reason: lengthDiffers ? 'length' : 'content',
    localDurationSec: local.durationSec,
    sharedDurationSec: shared.durationSec,
  }
}

/** `3:42` — for showing two durations side by side. */
export function formatDurationShort(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
