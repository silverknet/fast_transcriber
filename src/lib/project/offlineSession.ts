/**
 * The OFFLINE SESSION MARKER — `offline-session.json` at the project root.
 *
 * ## The problem it solves
 *
 * The offline desktop build has no cloud, so edits made at a venue live only on
 * disk. Back in the browser, nothing distinguishes "this song was edited on a
 * laptop last night" from "this song is exactly as the cloud left it" except a
 * content hash comparison — and the app had no reason to run one, so offline
 * edits would sit on disk indefinitely and quietly lose to the next cloud pull.
 *
 * A second folder would have made that visible, at the cost of a THIRD place a
 * song can live (cloud, working copy, package) and a second set of sync
 * watermarks to reconcile. This is the cheaper answer: the working copy stays
 * the only local copy, and a small marker file records that a session happened.
 * The app then says "3 songs changed offline" rather than leaving you to
 * remember.
 *
 * ## What it is NOT
 *
 * Not a queue, and not a diff. It records WHICH songs were touched and what
 * revision they were at when the session began — enough to know where to look.
 * Whether a song actually differs is decided at reconcile time by hashing its
 * shared content, because a song can be touched and end up identical (open,
 * play, undo), and a marker claiming a change that isn't there would train
 * people to dismiss the dialog.
 *
 * Everything here is pure. `offlineSessionIo.ts` does the disk half.
 */

/** The file's name at the project root. */
export const OFFLINE_SESSION_FILENAME = 'offline-session.json'

/** Bumped only for an incompatible shape change; unknown versions are ignored. */
export const OFFLINE_SESSION_VERSION = 1

export type OfflineSession = {
  version: number
  /** ISO timestamp — when "Prepare for offline" ran. */
  startedAt: string
  /**
   * The cloud revision each song sat at when the session began.
   *
   * Recorded so a reconcile can tell "I edited this offline" from "someone else
   * edited it in the cloud meanwhile" — the second needs the conflict path, and
   * without a base revision both look the same.
   */
  baseRevisions: Record<string, number>
  /** Song ids saved to disk at least once during the session. */
  touchedSongIds: string[]
}

export function newOfflineSession(
  startedAt: string,
  baseRevisions: Record<string, number> = {},
): OfflineSession {
  return {
    version: OFFLINE_SESSION_VERSION,
    startedAt,
    baseRevisions: { ...baseRevisions },
    touchedSongIds: [],
  }
}

/**
 * Parse a marker, or null if it is absent, malformed, or from a future version.
 *
 * Tolerant on purpose: a corrupt marker must degrade to "no offline session"
 * rather than block the app. The cost of a missed marker is that you push the
 * songs yourself; the cost of a thrown parse error is an app that will not open
 * the project at all.
 */
export function parseOfflineSession(raw: string | null | undefined): OfflineSession | null {
  if (!raw || !raw.trim()) return null
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const rec = o as Partial<OfflineSession>
  if (rec.version !== OFFLINE_SESSION_VERSION) return null
  if (typeof rec.startedAt !== 'string' || !rec.startedAt) return null

  const baseRevisions: Record<string, number> = {}
  if (rec.baseRevisions && typeof rec.baseRevisions === 'object') {
    for (const [id, rev] of Object.entries(rec.baseRevisions)) {
      if (typeof id === 'string' && id && Number.isFinite(rev)) baseRevisions[id] = Number(rev)
    }
  }

  const touchedSongIds = Array.isArray(rec.touchedSongIds)
    ? [...new Set(rec.touchedSongIds.filter((x): x is string => typeof x === 'string' && !!x))]
    : []

  return { version: OFFLINE_SESSION_VERSION, startedAt: rec.startedAt, baseRevisions, touchedSongIds }
}

export function serializeOfflineSession(session: OfflineSession): string {
  return JSON.stringify(session, null, 2)
}

/**
 * Record that a song was saved during the session.
 *
 * Returns the SAME object when nothing changed, so a caller can skip a disk
 * write on the common path — this runs on every autosave, and rewriting an
 * identical file 1500 ms apart for a whole set is pointless churn.
 */
export function withTouchedSong(session: OfflineSession, songId: string): OfflineSession {
  if (!songId || session.touchedSongIds.includes(songId)) return session
  return { ...session, touchedSongIds: [...session.touchedSongIds, songId] }
}

/**
 * Merge a marker found on disk with one for a session starting now.
 *
 * The case this exists for: you prepare for offline, play a gig, come home,
 * and prepare again WITHOUT having reconciled — perhaps two nights running.
 * Taking the new session wholesale would erase the first night's touched list
 * and those edits would never be offered for review. So touched songs
 * accumulate, and a base revision is kept from the EARLIER session: it is the
 * last revision known to match the cloud, and re-basing to a revision the cloud
 * never saw would make a genuine conflict look like a clean fast-forward.
 */
export function mergeOfflineSessions(
  existing: OfflineSession | null,
  fresh: OfflineSession,
): OfflineSession {
  if (!existing) return fresh
  return {
    version: OFFLINE_SESSION_VERSION,
    startedAt: existing.startedAt,
    baseRevisions: { ...fresh.baseRevisions, ...existing.baseRevisions },
    touchedSongIds: [...new Set([...existing.touchedSongIds, ...fresh.touchedSongIds])],
  }
}

/** Is there anything to review? A session with no touched song is not news. */
export function hasOfflineEdits(session: OfflineSession | null): boolean {
  return !!session && session.touchedSongIds.length > 0
}
