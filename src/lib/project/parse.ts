/**
 * Parse and validate `barbro.project.json`.
 * Path validation runs here — any invalid `folder` field fails parse with
 * a specific error pointing at the offending entry. The project will not
 * load with broken paths; this protects every downstream consumer that
 * might write to disk based on `entry.folder`.
 */

import {
  AUTO_STEM_NAMES,
  AUTO_STEM_QUALITIES,
  PROJECT_FILE_VERSION,
  validateProjectFolderPath,
  type AutoStemName,
  type AutoStemQuality,
  type ProjectAutoStems,
  type ProjectFile,
  type ProjectSongEntry,
} from './types'

/**
 * Parse the optional `autoStems` block defensively. Unknown / malformed
 * shapes return `undefined` (treated as "not configured") rather than
 * failing the whole manifest — a future schema bump must not refuse to open
 * the project. `stems` is filtered to known names + de-duplicated; an
 * unknown `quality` falls back to `'balanced'`.
 */
function parseAutoStems(raw: unknown): ProjectAutoStems | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const enabled = o.enabled === true
  const stems: AutoStemName[] = []
  if (Array.isArray(o.stems)) {
    for (const s of o.stems) {
      if (typeof s === 'string' && (AUTO_STEM_NAMES as readonly string[]).includes(s)) {
        const name = s as AutoStemName
        if (!stems.includes(name)) stems.push(name)
      }
    }
  }
  const quality: AutoStemQuality =
    typeof o.quality === 'string' && (AUTO_STEM_QUALITIES as readonly string[]).includes(o.quality)
      ? (o.quality as AutoStemQuality)
      : 'balanced'
  return { enabled, stems, quality }
}

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
    if (typeof e.lastSyncedContentHash === 'string' && e.lastSyncedContentHash.length > 0) {
      entry.lastSyncedContentHash = e.lastSyncedContentHash
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

  const autoStems = parseAutoStems(o.autoStems)
  const defaults = parseDefaults(o.defaults)
  const mastering = parseMastering(o.mastering)
  const performers = parsePerformers(o.performers)

  return {
    formatVersion: PROJECT_FILE_VERSION,
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    songs,
    ...(cloud ? { cloud } : {}),
    ...(autoStems ? { autoStems } : {}),
    ...(defaults ? { defaults } : {}),
    ...(mastering ? { mastering } : {}),
    ...(performers ? { performers } : {}),
  }
}

/** Parse the optional `performers` roster defensively (skips malformed rows). */
function parsePerformers(raw: unknown): ProjectFile['performers'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<ProjectFile['performers']> = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue
    const p: NonNullable<ProjectFile['performers']>[number] = { id: o.id, name: o.name }
    if (typeof o.role === 'string' && o.role.trim()) p.role = o.role
    if (typeof o.userId === 'string' && o.userId) p.userId = o.userId
    if (typeof o.monitorBus === 'number' && o.monitorBus >= 1 && o.monitorBus <= 6) {
      p.monitorBus = Math.round(o.monitorBus)
    }
    out.push(p)
  }
  return out.length > 0 ? out : undefined
}

/** Parse the optional project-wide `mastering` (project sound) block. */
function parseMastering(raw: unknown): ProjectFile['mastering'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.enabled !== 'boolean') return undefined
  const out: NonNullable<ProjectFile['mastering']> = { enabled: r.enabled }
  if (typeof r.matchLoudness === 'boolean') out.matchLoudness = r.matchLoudness
  if (typeof r.masterGlue === 'boolean') out.masterGlue = r.masterGlue
  if (typeof r.kickPunch === 'number' && Number.isFinite(r.kickPunch)) {
    out.kickPunch = Math.max(0, Math.min(1, r.kickPunch))
  }
  const stems = r.stems as Record<string, unknown> | undefined
  if (stems && typeof stems === 'object') {
    const parsed: NonNullable<NonNullable<ProjectFile['mastering']>['stems']> = {}
    for (const name of AUTO_STEM_NAMES) {
      const v = stems[name]
      // Legacy shape (first release stored just the intensity string).
      if (v === 'off' || v === 'light' || v === 'firm') {
        parsed[name] = { intensity: v }
        continue
      }
      if (!v || typeof v !== 'object') continue
      const s = v as Record<string, unknown>
      const entry: NonNullable<typeof parsed[typeof name]> = {}
      if (s.intensity === 'off' || s.intensity === 'light' || s.intensity === 'firm') {
        entry.intensity = s.intensity
      }
      if (typeof s.trimDb === 'number' && Number.isFinite(s.trimDb)) {
        entry.trimDb = Math.max(-9, Math.min(9, s.trimDb))
      }
      if (s.tone === 'natural' || s.tone === 'shaped') entry.tone = s.tone
      if (Object.keys(entry).length > 0) parsed[name] = entry
    }
    if (Object.keys(parsed).length > 0) out.stems = parsed
  }
  return out
}

/** Parse the optional project-wide `defaults` (count-in + pre-count-in cue). */
function parseDefaults(raw: unknown): ProjectFile['defaults'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: NonNullable<ProjectFile['defaults']> = {}
  if (typeof r.countInBeats === 'number' && Number.isInteger(r.countInBeats) && r.countInBeats >= 0) {
    out.countInBeats = r.countInBeats
  }
  const pc = r.preCountInCue as Record<string, unknown> | undefined
  if (pc && typeof pc.mode === 'string') {
    // Migrate legacy modes: 'title'/'custom' both announced the song → 'auto'.
    const mode =
      pc.mode === 'auto' || pc.mode === 'title' || pc.mode === 'custom'
        ? 'auto'
        : pc.mode === 'triggered'
          ? 'triggered'
          : 'off'
    out.preCountInCue = { mode }
    if (typeof pc.text === 'string') out.preCountInCue.text = pc.text
  }
  return Object.keys(out).length > 0 ? out : undefined
}
