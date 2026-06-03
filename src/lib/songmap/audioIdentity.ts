/**
 * Audio content-identity primitives.
 *
 * "Identity" here means: the set of metrics that lets us say "this file
 * on this disk is the same audio as the one the cloud says belongs to
 * this song" — without ever syncing file paths.
 *
 * Strict identity = sha256 match (either `sha256` of the stored file or
 *   `originalSha256` of the HQ source). Cheap and conclusive once
 *   computed.
 *
 * Loose identity = (durationSec ± 0.1s) AND sampleRate AND channels AND
 *   fileSize all match. Used as a high-confidence fallback when the
 *   strict path doesn't have hashes to compare (legacy songs, freshly
 *   imported files where sha256 hasn't been stamped yet). Still strong
 *   enough that a coincidental match is vanishingly unlikely for any
 *   real audio file.
 *
 * Phase 5 reconciliation uses `identityMatches` against
 * `SongMap.expectedAudio` (cloud's claim) and the on-disk file's
 * computed identity (from the sidecar's wav-info / sha256 endpoints).
 */
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
  }
}

/** Tolerance for the loose duration comparison. ~100ms covers transcoding jitter. */
const DURATION_TOLERANCE_SEC = 0.1

/**
 * Strict identity: matching sha256 of either the stored or original file.
 * Conclusive — two files with the same sha256 are byte-identical.
 *
 * Returns `null` (= undecided) when neither side has any sha256 to
 * compare against. Returns `false` when both sides have a sha256 of the
 * same kind but they disagree.
 */
export function identityMatchesStrict(
  local: AudioIdentity,
  expected: AudioIdentity,
): boolean | null {
  if (local.sha256 && expected.sha256) return local.sha256 === expected.sha256
  if (local.originalSha256 && expected.originalSha256) {
    return local.originalSha256 === expected.originalSha256
  }
  // Cross-kind matches: a stored sha256 won't match an originalSha256
  // for the same logical file (different encoding) — only check within
  // the same kind. Decide undecided.
  return null
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

/**
 * One-call matcher used by Phase 5 reconciliation:
 *   - 'strict'      — sha256 agreement
 *   - 'loose'       — strict undecided, but all loose fields match
 *   - 'mismatch'    — strict decided false OR a loose field disagreed
 *   - 'undecided'   — neither side has enough info to compare
 */
export type IdentityMatch = 'strict' | 'loose' | 'mismatch' | 'undecided'

export function identityMatches(local: AudioIdentity, expected: AudioIdentity): IdentityMatch {
  const strict = identityMatchesStrict(local, expected)
  if (strict === true) return 'strict'
  if (strict === false) return 'mismatch'
  return identityMatchesLoose(local, expected) ? 'loose' : 'undecided'
}
