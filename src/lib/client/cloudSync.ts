/**
 * Client-side wrapper for the cloud collab REST surface
 * (`/api/cloud/projects/**`). Translates between local types
 * (`ProjectFile`, `SongMap`) and the wire shape, strips local-only
 * SongMap fields via `toCollabSongMap` on the way out, and stamps
 * `ProjectFile.cloud.lastSyncedRevision` on success.
 *
 * Naming convention: every public function reads or writes through the
 * SvelteKit `/api/cloud/**` routes — no direct PostgREST. The session
 * cookie is on the same origin so plain `fetch` carries auth.
 */
import { get } from 'svelte/store'
import type {
  ProjectFile,
  ProjectSongEntry,
  ProjectCloudLink,
} from '$lib/project/types'
import { PROJECT_FILE_VERSION, PROJECT_SONGS_DIR } from '$lib/project/types'
import type { SongMap, ExpectedAudio } from '$lib/songmap/types'
import { toCollabSongMap } from '$lib/songmap/collab'
import {
  patchMetadataForFolder,
  project as projectStore,
  setActiveProject,
  setProjectData,
  type ProjectSongMetadataLite,
} from '$lib/stores/project'
import {
  createProject,
  createProjectSong,
  writeProjectManifest,
  readProjectSong,
} from './desktopProjectFs'
import { decodeSmapFile } from '$lib/songmap/persist'
import { encodeSmapFile, SONG_PROJECT_FORMAT_VERSION } from '$lib/songmap/smapFile'
import {
  metadataLiteFromSongMap,
  recordRecentProjectPath,
  songFolderName,
  writeLastProjectPath,
} from '$lib/project/commit'

const BASE = '/api/cloud'

// ── Wire types (mirror the server responses) ──────────────────────────

export interface CloudProjectMeta {
  id: string
  owner_user_id: string
  name: string
  created_at: string
  updated_at: string
  revision: number
}

export interface CloudSongView {
  id: string
  cloud_project_id: string
  song_map: SongMap
  expected_audio: ExpectedAudio | null
  hidden: boolean
  sort_order: number
  updated_at: string
  updated_by: string | null
  revision: number
}

export interface CloudMemberView {
  cloud_project_id: string
  user_id: string
  role: 'owner' | 'editor'
  added_at: string
}

// ── Read paths ────────────────────────────────────────────────────────

/** Returns the projects the current user is a member of. */
export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  const res = await fetch(`${BASE}/projects`, { cache: 'no-store' })
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as
    | { ok: boolean; projects: CloudProjectMeta[] }
    | null
  return data?.ok ? (data.projects ?? []) : []
}

export interface CloudPendingInviteView {
  id: string
  cloud_project_id: string
  invited_email: string
  role: 'owner' | 'editor'
  created_at: string
}

export interface CloudPendingInviteForMe extends CloudPendingInviteView {
  project_name: string
}

/** Pending invites owned by the current user's project (owner-only). */
export async function listPendingInvites(
  cloudProjectId: string,
): Promise<CloudPendingInviteView[]> {
  const res = await fetch(`${BASE}/projects/${cloudProjectId}/pending-invites`, {
    cache: 'no-store',
  })
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as
    | { ok: boolean; invites: CloudPendingInviteView[] }
    | null
  return data?.ok ? (data.invites ?? []) : []
}

export async function revokePendingInvite(
  cloudProjectId: string,
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(
    `${BASE}/projects/${cloudProjectId}/pending-invites?id=${encodeURIComponent(inviteId)}`,
    { method: 'DELETE', cache: 'no-store' },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: text || `HTTP ${res.status}` }
  }
  return { ok: true }
}

/** Pending invites visible to the signed-in user (matched by email). */
export async function listMyPendingInvites(): Promise<CloudPendingInviteForMe[]> {
  const res = await fetch(`${BASE}/invites/mine`, { cache: 'no-store' })
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as
    | { ok: boolean; invites: CloudPendingInviteForMe[] }
    | null
  return data?.ok ? (data.invites ?? []) : []
}

/**
 * Accept one pending invite — promotes it to a `cloud_project_members`
 * row server-side. Caller still has to call `joinCloudProject()` to
 * materialize the project locally.
 */
export async function acceptPendingInvite(
  cloudProjectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${BASE}/invites/mine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: cloudProjectId }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: text || `HTTP ${res.status}` }
  }
  return { ok: true }
}

export async function getCloudProjectManifest(
  cloudProjectId: string,
): Promise<{ project: CloudProjectMeta; members: CloudMemberView[] } | null> {
  const res = await fetch(`${BASE}/projects/${cloudProjectId}`, { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as {
    ok: boolean
    project: CloudProjectMeta
    members: CloudMemberView[]
  } | null
  return data?.ok ? { project: data.project, members: data.members } : null
}

export async function fetchCloudSongs(
  cloudProjectId: string,
  sinceRevision?: number,
): Promise<CloudSongView[]> {
  const u = new URL(`${BASE}/projects/${cloudProjectId}/songs`, window.location.origin)
  if (typeof sinceRevision === 'number' && sinceRevision > 0) {
    u.searchParams.set('since', String(sinceRevision))
  }
  const res = await fetch(u.pathname + u.search, { cache: 'no-store' })
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as
    | { ok: boolean; songs: CloudSongView[] }
    | null
  return data?.ok ? (data.songs ?? []) : []
}

// ── Write paths ───────────────────────────────────────────────────────

/**
 * Turn the currently-open local project into a cloud project. Strips
 * local-only SongMap fields, posts the create payload, and stamps the
 * `cloud` block onto the project manifest.
 *
 * Caller must ensure every song's `.smap` is on disk first (autosave's
 * standard guarantee — the manifest only ever references songs that
 * actually exist).
 */
export async function createCloudProject(): Promise<
  { ok: true; cloudProjectId: string; revision: number; adopted?: boolean } | { ok: false; error: string }
> {
  const snap = get(projectStore)
  const proj = snap.data
  const osPath = snap.osPath
  if (!proj || !osPath) return { ok: false, error: 'No project open.' }
  if (proj.cloud) return { ok: false, error: 'Project is already linked to the cloud.' }

  // Read each song's .smap, strip to collab shape, and gather expectedAudio.
  const songs: Array<{
    id: string
    songMap: SongMap
    expectedAudio: ExpectedAudio | null
    hidden: boolean
    sortOrder: number
  }> = []
  for (let i = 0; i < proj.songs.length; i++) {
    const entry = proj.songs[i]
    const r = await readProjectSong(osPath, entry.folder)
    if (!r.ok) return { ok: false, error: `Read failed for ${entry.folder}: ${r.error}` }
    const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
    const data = await decodeSmapFile(blob)
    const sm = data.project.songMap
    const collab = toCollabSongMap(sm)
    const expected = expectedAudioFromSongMap(sm)
    songs.push({
      id: entry.id,
      songMap: collab,
      expectedAudio: expected,
      hidden: !!entry.hidden,
      sortOrder: i,
    })
  }

  // Cloud project id == local project id at create time (per the
  // "authoritative ids" cross-cutting decision).
  const body = {
    projectId: proj.id,
    name: proj.name,
    songs,
  }
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: text || `HTTP ${res.status}` }
  }
  const data = (await res.json()) as {
    ok: boolean
    cloudProjectId: string
    revision: number
    adopted?: boolean
  }
  // For a re-adopted project, do not mark all local songs as already synced
  // through the current project revision. A follow-up pull should still see
  // any remote song rows that changed while this manifest had lost its link.
  const syncedRevision = data.adopted ? 0 : data.revision

  // Stamp the cloud block onto the in-memory project + persist the
  // manifest to disk so the link survives a reload.
  const cloud: ProjectCloudLink = {
    projectId: data.cloudProjectId,
    lastSyncedRevision: syncedRevision,
    lastPushedAt: data.adopted ? undefined : new Date().toISOString(),
    lastPulledAt: data.adopted ? undefined : new Date().toISOString(),
  }
  const next: ProjectFile = {
    ...proj,
    cloud,
    songs: proj.songs.map(
      (s): ProjectSongEntry => ({
        ...s,
        cloudSongId: s.id,
        lastSyncedRevision: syncedRevision,
      }),
    ),
  }
  setProjectData(next)
  await persistManifest(osPath, next)

  return { ok: true, cloudProjectId: data.cloudProjectId, revision: data.revision }
}

/**
 * Pull all changes since `cloud.lastSyncedRevision`, merge them into
 * each song's `.smap` on disk, and bump the sync watermark.
 *
 * For now this is a straight overwrite (Phase 4 model). Phase 8 will
 * route same-song conflicts through `collabMerge.ts` before writing.
 */
export async function pullCloudChanges(): Promise<
  { ok: true; pulledSongs: number; revision: number } | { ok: false; error: string }
> {
  const snap = get(projectStore)
  const proj = snap.data
  const osPath = snap.osPath
  if (!proj || !osPath || !proj.cloud) return { ok: false, error: 'No cloud project.' }
  const cloudProjectId = proj.cloud.projectId

  const manifest = await getCloudProjectManifest(cloudProjectId)
  if (!manifest) return { ok: false, error: 'Could not fetch cloud manifest.' }

  const sinceRev = proj.cloud.lastSyncedRevision
  const songs = await fetchCloudSongs(cloudProjectId, sinceRev)

  // Apply each cloud song into the local .smap. Songs we don't have
  // locally yet (new ones added on another machine) trigger a
  // `commitCloudSongToProject`-style stamp — for Phase 4's MVP we
  // simply append to the manifest and leave the audio missing for
  // Phase 6 to surface.
  for (const cloudSong of songs) {
    await applyCloudSongIntoLocal(osPath, proj, cloudSong)
  }

  const nextManifest: ProjectFile = {
    ...proj,
    name: manifest.project.name,
    cloud: {
      ...proj.cloud,
      lastSyncedRevision: manifest.project.revision,
      lastPulledAt: new Date().toISOString(),
    },
  }
  setProjectData(nextManifest)
  await persistManifest(osPath, nextManifest)
  return { ok: true, pulledSongs: songs.length, revision: manifest.project.revision }
}

/**
 * Join a cloud project on this machine. Creates a fresh local project
 * folder under `parentPath`, materializes every cloud song as a local
 * `.smap` (no audio bytes — those land via Phase 6's audio pack or a
 * relink), and stamps the local↔cloud link onto the new manifest.
 *
 * Mostly intended for first-time joins on a new machine. If the user
 * already has the project locally somewhere else, this creates a
 * second copy — the linked cloud row is the same, so edits between
 * the two copies sync; the redundancy is benign but worth flagging
 * in the UI.
 */
export async function joinCloudProject(
  cloudProjectId: string,
  parentPath: string,
): Promise<{ ok: true; projectPath: string } | { ok: false; error: string }> {
  // 1. Pull the cloud manifest + every song. Full snapshot since this
  //    is a cold-start; no `since=` revision filter.
  const manifest = await getCloudProjectManifest(cloudProjectId)
  if (!manifest) return { ok: false, error: 'Could not fetch cloud project manifest.' }
  const cloudSongs = await fetchCloudSongs(cloudProjectId)

  // 2. Create the local project folder. The sidecar generates a fresh
  //    random project id we'll overwrite in step 4 — keeping id ==
  //    cloudProjectId so future syncs match.
  const created = await createProject(parentPath, manifest.project.name)
  if (!created.ok) return { ok: false, error: created.error }
  const projectPath = created.projectPath

  // 3. For every cloud song, create a song folder + .smap on disk.
  //    `cloudSongId == localId == cs.id` by design (the "authoritative
  //    ids" cross-cutting decision). expectedAudio is stamped into the
  //    .smap so Phase 5 reconciliation can match local audio when a
  //    pack lands later.
  const localSongs: ProjectSongEntry[] = []
  const meta: Record<string, ProjectSongMetadataLite> = {}
  for (const cs of cloudSongs) {
    const sm = cs.song_map as SongMap
    const withExpected: SongMap = cs.expected_audio
      ? { ...sm, expectedAudio: cs.expected_audio }
      : sm
    const smapBlob = await encodeSmapFile({
      project: { projectFormatVersion: SONG_PROJECT_FORMAT_VERSION, songMap: withExpected },
    })
    const smapBytes = new Uint8Array(await smapBlob.arrayBuffer())
    const leaf = songFolderName(sm.metadata?.title ?? 'song', cs.id)
    const folderRel = `${PROJECT_SONGS_DIR}/${leaf}`
    const songCreate = await createProjectSong(projectPath, folderRel, smapBytes)
    if (!songCreate.ok) {
      console.warn(`[cloudSync] join: createProjectSong failed for ${cs.id}: ${songCreate.error}`)
      continue
    }
    const entry: ProjectSongEntry = {
      id: cs.id,
      folder: folderRel,
      cloudSongId: cs.id,
      lastSyncedRevision: cs.revision,
    }
    if (cs.hidden) entry.hidden = true
    localSongs.push(entry)
    meta[folderRel] = metadataLiteFromSongMap(withExpected)
  }

  // 4. Rewrite the manifest: cloud id, cloud link, songs sorted by the
  //    cloud's sort_order. Overwrites the auto-generated id from
  //    createProject so the local file's id matches the cloud row.
  const now = new Date().toISOString()
  const finalManifest: ProjectFile = {
    formatVersion: PROJECT_FILE_VERSION,
    id: cloudProjectId,
    name: manifest.project.name,
    createdAt: created.manifest.createdAt,
    updatedAt: now,
    songs: localSongs,
    cloud: {
      projectId: cloudProjectId,
      lastSyncedRevision: manifest.project.revision,
      lastPushedAt: now,
      lastPulledAt: now,
    },
  }
  const write = await writeProjectManifest(projectPath, finalManifest)
  if (!write.ok) {
    return { ok: false, error: `Manifest write failed after join: ${write.error}` }
  }

  // 5. Activate locally + persist as last-opened so a reload picks it up.
  setActiveProject(projectPath, finalManifest, meta)
  writeLastProjectPath(projectPath)
  recordRecentProjectPath(projectPath)

  return { ok: true, projectPath }
}

/**
 * Disable cloud collab for the current project.
 *
 *  - `deleteRemote: true`  → owner-only. DELETE on the cloud row; cascades
 *                            to songs/members/revisions. Then clears the
 *                            local `cloud` block.
 *  - `deleteRemote: false` → just clears the local `cloud` block (project
 *                            stays in the cloud for other members). Use
 *                            this to "leave" a project you don't own.
 *
 * Audio + .smap files on disk are untouched either way.
 */
export async function disableCloudProject(
  options: { deleteRemote: boolean } = { deleteRemote: false },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const snap = get(projectStore)
  const proj = snap.data
  const osPath = snap.osPath
  if (!proj || !osPath) return { ok: false, error: 'No project open.' }
  if (!proj.cloud) return { ok: false, error: 'Project is not linked.' }

  if (options.deleteRemote) {
    const res = await fetch(`${BASE}/projects/${proj.cloud.projectId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: text || `HTTP ${res.status}` }
    }
  }

  const next: ProjectFile = {
    ...proj,
    songs: proj.songs.map(
      (s): ProjectSongEntry => {
        const { cloudSongId: _c, lastSyncedRevision: _r, ...rest } = s
        return rest
      },
    ),
  }
  delete (next as { cloud?: ProjectCloudLink }).cloud
  setProjectData(next)
  await persistManifest(osPath, next)
  return { ok: true }
}

/**
 * Push one local song's current `.smap` to the cloud. Used by the
 * autosave's debounced cloud-push subscription — see
 * `projectAutosave.ts`. On 409 conflict the caller is expected to
 * trigger a `pullCloudChanges` and let the merge layer (Phase 8) sort
 * it out; for Phase 4 we just surface the conflict.
 */
export async function pushCloudSong(
  cloudProjectId: string,
  cloudSongId: string,
  songMap: SongMap,
  sortOrder: number,
  hidden: boolean,
  clientBaseRevision: number,
): Promise<
  { ok: true; revision: number }
  | { ok: false; conflict: true; remote: CloudSongView | null }
  | { ok: false; conflict: false; error: string }
> {
  const body = {
    songMap: toCollabSongMap(songMap),
    expectedAudio: expectedAudioFromSongMap(songMap),
    sortOrder,
    hidden,
    clientBaseRevision,
  }
  const res = await fetch(`${BASE}/projects/${cloudProjectId}/songs/${cloudSongId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) {
    const data = (await res.json()) as { ok: boolean; revision: number }
    return { ok: true, revision: data.revision }
  }
  if (res.status === 409) {
    const data = (await res.json().catch(() => null)) as {
      ok: false
      conflict: true
      remote: CloudSongView | null
    } | null
    return { ok: false, conflict: true, remote: data?.remote ?? null }
  }
  const text = await res.text().catch(() => '')
  return { ok: false, conflict: false, error: text || `HTTP ${res.status}` }
}

// ── Internal helpers ──────────────────────────────────────────────────

function expectedAudioFromSongMap(sm: SongMap): ExpectedAudio | null {
  const a = sm.audio
  if (!a) return null
  const out: ExpectedAudio = { fileName: a.fileName }
  if (a.mimeType) out.mimeType = a.mimeType
  if (a.durationSec !== undefined) out.durationSec = a.durationSec
  if (a.sampleRate !== undefined) out.sampleRate = a.sampleRate
  if (a.channels !== undefined) out.channels = a.channels
  if (a.fileSize !== undefined) out.fileSize = a.fileSize
  if (a.sha256) out.sha256 = a.sha256
  if (a.originalSha256) out.originalSha256 = a.originalSha256
  return out
}

async function persistManifest(osPath: string, next: ProjectFile): Promise<void> {
  // Best-effort — failure here means the in-memory state has the cloud
  // link but disk doesn't. The next manifest write (rename, reorder,
  // etc.) will catch up. Logged for diagnosis.
  const r = await writeProjectManifest(osPath, next)
  if (!r.ok) console.warn('[cloudSync] persistManifest failed:', r.error)
}

/**
 * Apply one cloud song into the local project, by:
 *   1. Finding the matching local song by id (== cloud_song.id).
 *   2. Reading its current .smap, merging the cloud song_map fields
 *      back in via the strip rule (so local-only fields survive).
 *   3. Writing the updated .smap.
 * Songs that don't exist locally yet are skipped here — Phase 4 MVP
 * doesn't auto-create a new song folder mid-sync (that's
 * `joinCloudProject` territory which lands later).
 */
async function applyCloudSongIntoLocal(
  osPath: string,
  proj: ProjectFile,
  cloudSong: CloudSongView,
): Promise<void> {
  const entry = proj.songs.find((s) => s.id === cloudSong.id)
  if (!entry) {
    // New song from another machine. For Phase 4 MVP we record the
    // existence but don't create the folder/audio (Phase 6 covers
    // missing-audio UX).
    patchMetadataForFolder(`songs/${cloudSong.id.slice(0, 8)}`, {
      title:
        (cloudSong.song_map.metadata?.title as string | undefined) ?? cloudSong.id.slice(0, 8),
    })
    return
  }
  const r = await readProjectSong(osPath, entry.folder)
  if (!r.ok) {
    console.warn('[cloudSync] readProjectSong failed during pull:', r.error)
    return
  }
  const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
  const data = await decodeSmapFile(blob)
  const local = data.project.songMap
  const { mergeLocalIntoCollab } = await import('$lib/songmap/collab')
  const merged = mergeLocalIntoCollab(local, cloudSong.song_map)
  // Stamp expectedAudio onto the local map so the Phase 5 reconciler
  // can use it without re-fetching from the server.
  merged.expectedAudio = cloudSong.expected_audio ?? undefined
  // Encode + persist.
  const { encodeSmapFile } = await import('$lib/songmap/smapFile')
  const blobOut = await encodeSmapFile({
    project: { projectFormatVersion: 1, songMap: merged },
  })
  const { writeProjectSong } = await import('./desktopProjectFs')
  await writeProjectSong(osPath, entry.folder, new Uint8Array(await blobOut.arrayBuffer()))
}
