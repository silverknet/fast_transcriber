/**
 * Phase 5 — audio identity reconciliation.
 *
 * The SongMap names the audio file at `audio.originalPath` (a path
 * relative to the song folder, e.g. `audio/master.wav`). On a fresh
 * machine — or after a hydration-pack import, or after a manual file
 * rename — that named path may not resolve to a real file, OR the
 * file at that path may not be the one the SongMap actually means.
 *
 * The reconciler fixes both cases by content-matching the song's
 * `<song>/audio/` folder against `expectedAudio` (the cloud's claim)
 * or, when absent, `audio` (the local claim). Match priority:
 *
 *   1. Strict — sha256 of either the stored audio or the original
 *      source file matches. Conclusive; we stamp the matched filename
 *      into `audio.originalPath` immediately.
 *   2. Loose — duration/sampleRate/channels/fileSize all agree. We
 *      return the candidate but let the caller surface a soft prompt
 *      ("looks like this might be the same audio?") before mutating.
 *
 * Match logic is pure (lives in `audioIdentity.ts`). This file owns
 * the orchestration: scan disk → score candidates → return a
 * structured outcome the loader can act on.
 */
import type { SongMap, AudioReference } from '$lib/songmap'
import type { ExpectedAudio } from '$lib/songmap/types'
import {
  identityFromAudioRef,
  identityMatchesStrict,
  identityMatchesLoose,
  type AudioIdentity,
} from '$lib/songmap/audioIdentity'
import { scanProjectSongAudio, type ProjectAudioScanItem } from '$lib/client/desktopProjectFs'

/**
 * The identity bundle the SongMap claims the song's audio should be.
 * Falls back to `audio` when `expectedAudio` (cloud-collab) isn't set.
 */
export function expectedIdentityForSong(songMap: SongMap): AudioIdentity {
  const exp = songMap.expectedAudio
  if (exp) return identityFromAudioRef(exp)
  return identityFromAudioRef(songMap.audio)
}

export type ReconcileOutcome =
  | {
      kind: 'strict-match'
      fileName: string
      identity: AudioIdentity
    }
  | {
      kind: 'loose-match'
      fileName: string
      identity: AudioIdentity
    }
  | {
      kind: 'no-match'
      expected: AudioIdentity
      scanned: ProjectAudioScanItem[]
    }
  | {
      kind: 'no-expected'
      scanned: ProjectAudioScanItem[]
    }
  | {
      kind: 'scan-failed'
      error: string
    }

/**
 * Walk `<projectPath>/<songFolder>/audio/` and try to identify which
 * file (if any) matches what the SongMap expects. Does NOT mutate
 * anything — caller decides whether to stamp `audio.originalPath`,
 * surface a banner, or both.
 *
 * Pure I/O: no Svelte stores read or written; safe to call from any
 * load / refresh path.
 */
export async function reconcileSongAudio(
  songMap: SongMap,
  projectPath: string,
  songFolder: string,
): Promise<ReconcileOutcome> {
  const expected = expectedIdentityForSong(songMap)
  const scan = await scanProjectSongAudio(projectPath, songFolder)
  if (!scan.ok) return { kind: 'scan-failed', error: scan.error }
  const scanned = scan.items.filter((i) => !i.error)

  // No identity to match against. Caller may still know the path
  // (Path A in loadProjectSongIntoEditor) — they handle it.
  const hasExpectedShas = !!(expected.sha256 || expected.originalSha256)
  const hasExpectedFields =
    expected.durationSec !== undefined ||
    expected.sampleRate !== undefined ||
    expected.channels !== undefined ||
    expected.fileSize !== undefined
  if (!hasExpectedShas && !hasExpectedFields) {
    return { kind: 'no-expected', scanned }
  }

  // Pass 1 — strict sha match. Conclusive when present.
  for (const item of scanned) {
    const local: AudioIdentity = {
      sha256: item.sha256,
      durationSec: item.durationSec,
      sampleRate: item.sampleRate,
      channels: item.channels,
      fileSize: item.fileSize,
      fileName: item.fileName,
    }
    if (identityMatchesStrict(local, expected) === true) {
      return { kind: 'strict-match', fileName: item.fileName, identity: local }
    }
  }

  // Pass 2 — loose match (every comparable field agrees). We don't
  // auto-stamp on a loose match because two different masters of the
  // same song can pass loose; let the UI prompt before mutating.
  for (const item of scanned) {
    const local: AudioIdentity = {
      sha256: item.sha256,
      durationSec: item.durationSec,
      sampleRate: item.sampleRate,
      channels: item.channels,
      fileSize: item.fileSize,
      fileName: item.fileName,
    }
    if (identityMatchesLoose(local, expected)) {
      return { kind: 'loose-match', fileName: item.fileName, identity: local }
    }
  }

  return { kind: 'no-match', expected, scanned }
}

/**
 * Stamp the matched filename into `audio.originalPath` and (when the
 * scan recovered them) the missing identity fields. Returns the
 * updated `AudioReference`. Caller is responsible for persisting the
 * .smap on disk and updating any store.
 */
export function applyReconcileMatch(
  audio: AudioReference | undefined,
  match: { fileName: string; identity: AudioIdentity },
): AudioReference {
  const base: AudioReference = audio ?? {
    fileName: match.fileName,
    trim: { startSec: 0, endSec: 0 },
    source: 'import',
  }
  const next: AudioReference = {
    ...base,
    fileName: base.fileName || match.fileName,
    originalPath: `audio/${match.fileName}`,
  }
  if (match.identity.sha256 && !next.sha256) next.sha256 = match.identity.sha256
  if (match.identity.durationSec !== undefined && next.durationSec === undefined) {
    next.durationSec = match.identity.durationSec
  }
  if (match.identity.sampleRate !== undefined && next.sampleRate === undefined) {
    next.sampleRate = match.identity.sampleRate
  }
  if (match.identity.channels !== undefined && next.channels === undefined) {
    next.channels = match.identity.channels
  }
  if (match.identity.fileSize !== undefined && next.fileSize === undefined) {
    next.fileSize = match.identity.fileSize
  }
  return next
}
