/**
 * Audio content-identity primitives.
 *
 * "Identity" here means: the set of metrics that lets us say "this file
 * on this disk is the same audio as the one the cloud says belongs to
 * this song" — without ever syncing file paths.
 *
 * Strict identity = sha256 match (either `sha256` of the stored file or
 *   `originalSha256` of the HQ source). Cheap and conclusive once
 *   computed — but it answers "same FILE", and collaborators routinely
 *   hold the same recording as different files.
 *
 * Recording identity = the loudness-envelope fingerprint
 *   (`$lib/audio/audioFingerprint.ts`). Answers "same PERFORMANCE",
 *   which is the question that actually matters: `Bar.startSec` and
 *   `Beat.timeSec` are absolute seconds, so the grid fits any encoding
 *   of the same master and fits NO other cut. It both rescues a sha
 *   disagreement and vetoes a metadata agreement.
 *
 * Loose identity = (durationSec ± 0.1s) AND sampleRate AND channels AND
 *   fileSize all match. The weakest signal, used only when neither
 *   hashes nor fingerprints are available on both sides (legacy songs,
 *   freshly imported files). Two different masters CAN pass it — see
 *   `audioReconcile.ts`, which refuses to auto-stamp on a loose match.
 *
 * Phase 5 reconciliation uses `identityMatches` against
 * `SongMap.expectedAudio` (cloud's claim) and the on-disk file's
 * computed identity (from the sidecar's wav-info / sha256 endpoints).
 */
import { compareFingerprints, type AudioFingerprint } from '$lib/audio/audioFingerprint'
import type { AudioReference, ExpectedAudio } from './types'

/**
 * Bundle of identity fields. Either an `AudioReference` (what the local
 * SongMap currently claims) or an `ExpectedAudio` (what the cloud
 * claims) can be projected into this shape via `identityFromAudioRef`.
 */
export interface AudioIdentity {
  sha256?: string
  originalSha256?: string
  durationSec?: number
  sampleRate?: number
  channels?: number
  fileSize?: number
  fileName?: string
  /** Recording identity — see `$lib/audio/audioFingerprint.ts`. */
  fingerprint?: AudioFingerprint
}

export function identityFromAudioRef(audio: AudioReference | ExpectedAudio | null | undefined): AudioIdentity {
  if (!audio) return {}
  return {
    sha256: audio.sha256,
    originalSha256: audio.originalSha256,
    durationSec: audio.durationSec,
    sampleRate: audio.sampleRate,
    channels: audio.channels,
    fileSize: audio.fileSize,
    fileName: audio.fileName,
    fingerprint: audio.fingerprint,
  }
}

/** Tolerance for the loose duration comparison. ~100ms covers transcoding jitter. */
const DURATION_TOLERANCE_SEC = 0.1

/**
 * Strict identity: ANY sha256 on either side equal to ANY sha256 on
 * the other. Conclusive — two files with the same sha256 are
 * byte-identical, full stop. Cross-kind matches (a local sha256 from
 * a scanned file equalling the cloud's `originalSha256`) are valid:
 * the reconciler doesn't know whether the local file is a compressed
 * derivative or the original master, only that its bytes hash to a
 * value the SongMap claims somewhere.
 *
 * Returns `null` (= undecided) when neither side has any sha256 to
 * compare against. Returns `false` when both sides have at least one
 * sha256 each but none of them coincide.
 */
export function identityMatchesStrict(
  local: AudioIdentity,
  expected: AudioIdentity,
): boolean | null {
  const localShas = [local.sha256, local.originalSha256].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  const expectedShas = [expected.sha256, expected.originalSha256].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  if (localShas.length === 0 || expectedShas.length === 0) return null
  for (const a of localShas) {
    for (const b of expectedShas) {
      if (a === b) return true
    }
  }
  return false
}

/**
 * Loose identity: every comparable field must match within tolerance.
 *
 * Returns `true` only when ALL fields present on both sides match
 * (sample rate exact; channels exact; fileSize exact; duration within
 * the 100ms tolerance). Missing fields are not deal-breakers — a side
 * that doesn't claim a value can't disagree with one that does. But at
 * least ONE field must actually be compared, otherwise we'd happily
 * "match" two empty identities.
 */
export function identityMatchesLoose(
  local: AudioIdentity,
  expected: AudioIdentity,
): boolean {
  let compared = 0

  if (local.durationSec !== undefined && expected.durationSec !== undefined) {
    compared++
    if (Math.abs(local.durationSec - expected.durationSec) > DURATION_TOLERANCE_SEC) return false
  }
  if (local.sampleRate !== undefined && expected.sampleRate !== undefined) {
    compared++
    if (local.sampleRate !== expected.sampleRate) return false
  }
  if (local.channels !== undefined && expected.channels !== undefined) {
    compared++
    if (local.channels !== expected.channels) return false
  }
  if (local.fileSize !== undefined && expected.fileSize !== undefined) {
    compared++
    if (local.fileSize !== expected.fileSize) return false
  }

  return compared > 0
}

export type IdentityMatch =
  /** Byte-identical — same file. */
  | 'strict'
  /**
   * Different bytes, same RECORDING (a transcode, a different bounce). The
   * stored bars and beats still land correctly, so this is safe to accept.
   */
  | 'equivalent'
  /** No hashes to compare, but every metadata field agrees. Weakest positive. */
  | 'loose'
  /** Decisively not the same audio. */
  | 'mismatch'
  /** Not enough information either way. */
  | 'undecided'

/**
 * One-call matcher used by Phase 5 reconciliation.
 *
 * Order matters. The recording fingerprint is consulted BEFORE a sha
 * disagreement is treated as fatal, because "different bytes" is the normal
 * state between two collaborators — one has the WAV, one has the MP3. Calling
 * that a mismatch is what trains people to click through the warning. The
 * fingerprint is also allowed to VETO: if it says the recordings differ, that
 * is decisive regardless of how well the metadata lines up, because a different
 * cut means every stored `Bar.startSec` is wrong.
 */
export function identityMatches(local: AudioIdentity, expected: AudioIdentity): IdentityMatch {
  const strict = identityMatchesStrict(local, expected)
  if (strict === true) return 'strict'

  const recording = compareFingerprints(local.fingerprint, expected.fingerprint)
  if (recording === 'different') return 'mismatch'
  if (recording === 'same') return 'equivalent'

  if (strict === false) return 'mismatch'
  return identityMatchesLoose(local, expected) ? 'loose' : 'undecided'
}
