/**
 * RECONCILE ON RETURN — send what was edited offline, once you are back.
 *
 * The offline build has no cloud, so a night's work lives only in `song.smap`
 * on disk. This is the other end of that: when a project is opened online and
 * an offline session marker is present, work out which songs actually differ
 * from what the cloud last saw, show them, and push the ones you approve.
 *
 * ## Why "actually differ" is decided here and not by the marker
 *
 * The marker records which songs were SAVED, which is not the same as which
 * songs CHANGED — opening a song, pressing play and undoing writes a `.smap`
 * whose shared content is identical. Listing those as offline changes would
 * teach you to click through the dialog without reading it, which costs you the
 * one time it mattered. So the marker narrows the search and
 * `collabContentFingerprint` makes the call.
 *
 * ## Why sequential
 *
 * `pushCloudSong` takes a base revision and the project's revision counter is
 * shared across songs, so two concurrent pushes guarantee one 409 for no gain.
 * Pushing one at a time also means a failure part-way through leaves an honest
 * marker: the songs that made it are recorded as synced, the rest are still
 * listed, and re-running finishes the job.
 *
 * This fills a real gap rather than adding a nicety — there is no persistent
 * offline queue anywhere in the app. The `online` listener in `projectAutosave`
 * re-pushes only the CURRENTLY ACTIVE song, so anything edited and navigated
 * away from was never coming back on its own.
 */
import { get } from 'svelte/store'
import { readProjectSong } from '$lib/client/desktopProjectFs'
import { clearOfflineSession, readOfflineSession } from '$lib/client/offlineSessionIo'
import { pushCloudSong } from '$lib/client/cloudSync'
import { decodeSmapBytes } from '$lib/songmap/smapFile'
import { collabContentFingerprint } from '$lib/songmap/collab'
import { hasDangerousConflict, mergeForConflict } from '$lib/songmap/collabMerge'
import { hasOfflineEdits, type OfflineSession } from '$lib/project/offlineSession'
import { project, setProjectData } from '$lib/stores/project'
import { writeProjectManifest } from '$lib/client/desktopProjectFs'
import type { ProjectFile, ProjectSongEntry } from '$lib/project/types'
import type { SongMap } from '$lib/songmap/types'

/** One song that was edited offline and has not reached the cloud. */
export type OfflineChange = {
  songId: string
  title: string
  folder: string
  /** The `.smap` as it is on disk right now — what would be pushed. */
  songMap: SongMap
  /** `collabContentFingerprint` of the above. */
  contentHash: string
  /** The revision to push against. */
  baseRevision: number
  /**
   * True when this song has never successfully synced, so there is no hash to
   * compare against. Treated as changed — assuming "probably fine" here is how
   * a song silently never reaches the cloud.
   */
  neverSynced: boolean
}

export type ReconcileScan = {
  changes: OfflineChange[]
  /** Songs in the marker that turned out to be identical to the cloud copy. */
  unchangedSongIds: string[]
  /** Ids in the marker with no matching manifest entry (song deleted since). */
  missingSongIds: string[]
}

/**
 * Is a song's on-disk content different from what the cloud last saw?
 *
 * Pure so the rule is testable without a project. `undefined` for the last
 * synced hash means "never synced", which counts as changed.
 */
export function isDirtyAgainstCloud(
  contentHash: string,
  lastSyncedContentHash: string | undefined,
): boolean {
  if (!lastSyncedContentHash) return true
  return contentHash !== lastSyncedContentHash
}

/**
 * Which revision to push a song against.
 *
 * The song's own watermark first; the session's recorded base next; the
 * project's watermark last. The session base matters when the manifest was
 * advanced by something else after the offline session began — pushing against
 * the newer number would claim to have seen a cloud edit that this laptop never
 * had.
 */
export function baseRevisionFor(
  entry: Pick<ProjectSongEntry, 'id' | 'lastSyncedRevision'>,
  session: OfflineSession | null,
  projectRevision: number,
): number {
  const fromSession = session?.baseRevisions?.[entry.id]
  if (typeof fromSession === 'number') {
    // The LOWER of the two: the offline laptop's view of the world cannot be
    // newer than what it actually pulled, and overstating it turns a conflict
    // into a silent overwrite of someone else's work.
    if (typeof entry.lastSyncedRevision === 'number') {
      return Math.min(entry.lastSyncedRevision, fromSession)
    }
    return fromSession
  }
  return entry.lastSyncedRevision ?? projectRevision
}

/**
 * Read each touched song from disk and decide whether it really changed.
 *
 * Reads from DISK rather than the in-memory store because only one song is
 * loaded at a time and the whole point is the ones you are not looking at.
 */
export async function scanOfflineChanges(
  osPath: string,
  data: ProjectFile,
  session: OfflineSession,
): Promise<ReconcileScan> {
  const changes: OfflineChange[] = []
  const unchangedSongIds: string[] = []
  const missingSongIds: string[] = []
  const projectRevision = data.cloud?.lastSyncedRevision ?? 0

  for (const songId of session.touchedSongIds) {
    const entry = data.songs.find((s) => s.id === songId)
    if (!entry) {
      missingSongIds.push(songId)
      continue
    }
    let sm: SongMap
    try {
      const r = await readProjectSong(osPath, entry.folder)
      if (!r.ok) {
        missingSongIds.push(songId)
        continue
      }
      sm = decodeSmapBytes(r.bytes).project.songMap
    } catch {
      // Unreadable on disk — say so rather than reporting it as clean.
      missingSongIds.push(songId)
      continue
    }

    const contentHash = collabContentFingerprint(sm)
    if (!isDirtyAgainstCloud(contentHash, entry.lastSyncedContentHash)) {
      unchangedSongIds.push(songId)
      continue
    }
    changes.push({
      songId,
      title: sm.metadata?.title?.trim() || 'Untitled',
      folder: entry.folder,
      songMap: sm,
      contentHash,
      baseRevision: baseRevisionFor(entry, session, projectRevision),
      neverSynced: !entry.lastSyncedContentHash,
    })
  }

  return { changes, unchangedSongIds, missingSongIds }
}

export type PushOutcome =
  | { songId: string; status: 'pushed'; revision: number }
  | { songId: string; status: 'conflict'; remote: SongMap; remoteRevision: number }
  | { songId: string; status: 'failed'; error: string }

/**
 * Push one offline change.
 *
 * A 409 whose remote content hashes the SAME as ours is not a conflict — the
 * revision moved without the shared content moving (another device pushed
 * identical content, or a render-cache-only diff). Adopting the revision there
 * mirrors what the ordinary autosave does and keeps a benign bump from turning
 * into a dialog.
 *
 * Anything a merge calls DANGEROUS is handed back for a human, unchanged. This
 * function never resolves a conflict on its own: reconciling a gig's worth of
 * edits is the wrong moment to be clever.
 */
export async function pushOfflineChange(
  cloudProjectId: string,
  change: OfflineChange,
  cloudSongId: string,
  sortOrder: number,
  hidden: boolean,
): Promise<PushOutcome> {
  const r = await pushCloudSong(
    cloudProjectId,
    cloudSongId,
    change.songMap,
    sortOrder,
    hidden,
    change.baseRevision,
  )
  if (r.ok) return { songId: change.songId, status: 'pushed', revision: r.revision }

  if ('conflict' in r && r.conflict && r.remote?.song_map) {
    const remote = r.remote.song_map
    if (collabContentFingerprint(remote) === change.contentHash) {
      // Same content, newer number. Nothing to reconcile.
      return { songId: change.songId, status: 'pushed', revision: r.remote.revision }
    }
    const report = mergeForConflict(change.songMap, remote)
    if (hasDangerousConflict(report)) {
      return {
        songId: change.songId,
        status: 'conflict',
        remote,
        remoteRevision: r.remote.revision,
      }
    }
    // Not dangerous, but still a real divergence: someone edited this song in
    // the cloud while the laptop was away. Retry once against the server's
    // revision with our content — last-write-wins on non-dangerous fields is
    // what the autosave does, and it is what the user asked for by approving
    // the push.
    const retry = await pushCloudSong(
      cloudProjectId,
      cloudSongId,
      change.songMap,
      sortOrder,
      hidden,
      r.remote.revision,
    )
    if (retry.ok) return { songId: change.songId, status: 'pushed', revision: retry.revision }
    if ('conflict' in retry && retry.conflict && retry.remote?.song_map) {
      return {
        songId: change.songId,
        status: 'conflict',
        remote: retry.remote.song_map,
        remoteRevision: retry.remote.revision,
      }
    }
    return {
      songId: change.songId,
      status: 'failed',
      error: 'conflict' in retry && !retry.conflict ? retry.error : 'Could not push this song.',
    }
  }

  return {
    songId: change.songId,
    status: 'failed',
    error: 'conflict' in r && !r.conflict ? r.error : 'Could not push this song.',
  }
}

/**
 * Mark one song synced through `revision`/`hash`, in the store and on disk.
 *
 * Persisted immediately rather than at the end, so an interrupted reconcile
 * leaves accurate watermarks: a reload must not re-offer songs that already
 * made it, nor forget the ones that did not.
 */
function markSongSynced(songId: string, revision: number, hash: string, cloudSongId: string): void {
  const cur = get(project)
  if (!cur.data?.cloud) return
  const next: ProjectFile = {
    ...cur.data,
    cloud: { ...cur.data.cloud, lastSyncedRevision: revision, lastPushedAt: new Date().toISOString() },
    songs: cur.data.songs.map((s) =>
      s.id === songId
        ? { ...s, cloudSongId, lastSyncedRevision: revision, lastSyncedContentHash: hash }
        : s,
    ),
  }
  setProjectData(next)
  if (cur.osPath) void writeProjectManifest(cur.osPath, next).catch(() => {})
}

export type ReconcileResult = {
  outcomes: PushOutcome[]
  /** True when every change was resolved and the marker was cleared. */
  complete: boolean
}

/**
 * Push the approved changes, one at a time, and clear the marker if all of them
 * landed.
 *
 * `discardedSongIds` count as resolved — the user looked and chose not to send
 * them — which is why the marker can be cleared with them outstanding. Anything
 * that FAILED or CONFLICTED leaves the marker in place, so the offer comes back.
 */
export async function reconcileOfflineChanges(
  osPath: string,
  data: ProjectFile,
  changes: OfflineChange[],
  discardedSongIds: string[] = [],
): Promise<ReconcileResult> {
  const cloud = data.cloud
  if (!cloud) return { outcomes: [], complete: false }

  const discarded = new Set(discardedSongIds)
  const outcomes: PushOutcome[] = []

  for (const change of changes) {
    if (discarded.has(change.songId)) continue
    const entry = data.songs.find((s) => s.id === change.songId)
    if (!entry) continue
    const cloudSongId = entry.cloudSongId ?? entry.id
    const sortOrder = data.songs.indexOf(entry)
    const outcome = await pushOfflineChange(
      cloud.projectId,
      change,
      cloudSongId,
      sortOrder,
      !!entry.hidden,
    )
    outcomes.push(outcome)
    if (outcome.status === 'pushed') {
      markSongSynced(change.songId, outcome.revision, change.contentHash, cloudSongId)
    }
  }

  const complete = outcomes.every((o) => o.status === 'pushed')
  if (complete) await clearOfflineSession(osPath)
  return { outcomes, complete }
}

/**
 * The whole check, for the layout to call when a project opens online.
 *
 * Returns null when there is nothing to say — no marker, nothing touched, no
 * cloud link, or every touched song turned out identical. Silence is the right
 * answer for all four.
 */
export async function checkForOfflineChanges(
  osPath: string,
  data: ProjectFile,
): Promise<{ session: OfflineSession; scan: ReconcileScan } | null> {
  if (!data.cloud) return null
  const session = await readOfflineSession(osPath)
  if (!hasOfflineEdits(session) || !session) return null
  const scan = await scanOfflineChanges(osPath, data, session)
  if (scan.changes.length === 0) {
    // Touched but identical — nothing to review, and the marker has served its
    // purpose. Clearing it stops the same non-event being re-checked forever.
    await clearOfflineSession(osPath)
    return null
  }
  return { session, scan }
}
