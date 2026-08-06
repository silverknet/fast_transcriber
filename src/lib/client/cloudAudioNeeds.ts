/**
 * WHICH SONGS ACTUALLY NEED THEIR AUDIO PREPARING FOR BROWSER MEMBERS.
 *
 * Preparing a song means transcoding its master and every stem to compressed
 * copies and uploading them. For a 17-song set with four stems each that is 85
 * transcodes and 85 uploads — minutes of CPU and a lot of bandwidth.
 *
 * `uploadProjectCloudAudio` used to do all of it, every time, unconditionally.
 * The only way to add ONE new song was to redo the other sixteen, so the button
 * that should take ten seconds took a coffee break, and nobody pressed it.
 *
 * A song is CURRENT when the cloud copy was made from the same master and
 * covers the same stems. `sourceSha256` is the master's identity, so a
 * re-analysed grid, a renamed section or a chord edit — none of which change a
 * byte of audio — do not trigger a re-upload. Replacing the audio does.
 */
import type { CloudAudioManifest } from './cloudAudio'
import { slugStem } from './cloudAudio'

export type CloudAudioNeed =
  /** Never prepared — browser members hear nothing. */
  | 'missing'
  /** Prepared from DIFFERENT audio, or missing stems it should have. */
  | 'stale'
  /** Cloud copy matches the local master and stems. Nothing to do. */
  | 'current'

export type LocalAudioIdentity = {
  /** sha256 of the local WAV master. Absent = we cannot prove a match. */
  sha256?: string
  /** Stem slot names the song has locally, e.g. ['Bass','Drums']. */
  stemNames: readonly string[]
}

/**
 * Compare a song's local audio against what the cloud already has.
 *
 * Unknowable cases resolve to `'stale'`, never `'current'`: a song we cannot
 * prove is up to date must be re-prepared, because the failure of guessing
 * wrong is silent — the band opens the app and hears the previous master, or
 * nothing, with no indication anything is out of date.
 */
export function cloudAudioNeed(
  local: LocalAudioIdentity,
  manifest: CloudAudioManifest | null | undefined,
): CloudAudioNeed {
  if (!manifest || !manifest.mix) return 'missing'
  // No local hash, or none recorded in the cloud → cannot prove identity.
  if (!local.sha256 || !manifest.sourceSha256) return 'stale'
  if (manifest.sourceSha256 !== local.sha256) return 'stale'

  // Every local stem must be present in the cloud copy. Extra cloud stems are
  // fine — a stem removed locally is not a reason to re-upload everything.
  const have = new Set(Object.keys(manifest.stems ?? {}).map(slugStem))
  for (const name of local.stemNames) {
    if (!have.has(slugStem(name))) return 'stale'
  }
  return 'current'
}

/** Does this song need work at all? */
export function needsCloudAudio(
  local: LocalAudioIdentity,
  manifest: CloudAudioManifest | null | undefined,
): boolean {
  return cloudAudioNeed(local, manifest) !== 'current'
}

/** "3 to prepare, 14 already done" — what the button should say before it runs. */
export function summariseCloudAudioNeeds(needs: readonly CloudAudioNeed[]): {
  missing: number
  stale: number
  current: number
  todo: number
} {
  const missing = needs.filter((n) => n === 'missing').length
  const stale = needs.filter((n) => n === 'stale').length
  const current = needs.filter((n) => n === 'current').length
  return { missing, stale, current, todo: missing + stale }
}
