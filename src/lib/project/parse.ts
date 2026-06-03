/**
 * Parse and validate `barbro.project.json`.
 * Path validation runs here — any invalid `folder` field fails parse with
 * a specific error pointing at the offending entry. The project will not
 * load with broken paths; this protects every downstream consumer that
 * might write to disk based on `entry.folder`.
 */

import {
  PROJECT_FILE_VERSION,
  validateProjectFolderPath,
  type ProjectFile,
  type ProjectSongEntry,
} from './types'

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectParseError'
  }
}

export function parseProjectJson(text: string): ProjectFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectParseError('Invalid barbro.project.json: not valid JSON')
  }
  if (!raw || typeof raw !== 'object') {
    throw new ProjectParseError('Invalid barbro.project.json: root must be an object')
  }

  const o = raw as Record<string, unknown>

  if (o.formatVersion !== PROJECT_FILE_VERSION) {
    throw new ProjectParseError(
      `Unsupported project formatVersion: ${String(o.formatVersion)} (expected ${PROJECT_FILE_VERSION})`,
    )
  }
  if (typeof o.id !== 'string' || o.id.length === 0) {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `id`')
  }
  if (typeof o.name !== 'string') {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `name`')
  }
  if (typeof o.createdAt !== 'string') {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `createdAt`')
  }
  if (typeof o.updatedAt !== 'string') {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `updatedAt`')
  }
  if (!Array.isArray(o.songs)) {
    throw new ProjectParseError('Invalid barbro.project.json: `songs` must be an array')
  }

  const songs: ProjectSongEntry[] = []
  for (let i = 0; i < o.songs.length; i++) {
    const e = o.songs[i] as Record<string, unknown> | null
    if (!e || typeof e !== 'object') {
      throw new ProjectParseError(`Invalid songs[${i}]: must be an object`)
    }
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new ProjectParseError(`Invalid songs[${i}].id: must be a non-empty string`)
    }
    let folder: string
    try {
      folder = validateProjectFolderPath(e.folder, `songs[${i}].folder`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new ProjectParseError(msg)
    }
    const entry: ProjectSongEntry = { id: e.id, folder }
    if (typeof e.hidden === 'boolean' && e.hidden) entry.hidden = true
    if (typeof e.cloudSongId === 'string' && e.cloudSongId.length > 0) {
      entry.cloudSongId = e.cloudSongId
    }
    if (typeof e.lastSyncedRevision === 'number' && Number.isFinite(e.lastSyncedRevision)) {
      entry.lastSyncedRevision = e.lastSyncedRevision
    }
    songs.push(entry)
  }

  // Cloud-link block is optional; only present on collab-enabled
  // projects. Unknown shapes are silently dropped so a future schema
  // bump doesn't refuse to open older clients' manifests.
  let cloud: ProjectFile['cloud']
  if (o.cloud && typeof o.cloud === 'object') {
    const c = o.cloud as Record<string, unknown>
    if (typeof c.projectId === 'string' && c.projectId.length > 0
        && typeof c.lastSyncedRevision === 'number' && Number.isFinite(c.lastSyncedRevision)) {
      cloud = {
        projectId: c.projectId,
        lastSyncedRevision: c.lastSyncedRevision,
      }
      if (typeof c.pendingChanges === 'number' && Number.isFinite(c.pendingChanges)) {
        cloud.pendingChanges = c.pendingChanges
      }
      if (typeof c.lastPushedAt === 'string') cloud.lastPushedAt = c.lastPushedAt
      if (typeof c.lastPulledAt === 'string') cloud.lastPulledAt = c.lastPulledAt
    }
  }

  return {
    formatVersion: PROJECT_FILE_VERSION,
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    songs,
    ...(cloud ? { cloud } : {}),
  }
}
