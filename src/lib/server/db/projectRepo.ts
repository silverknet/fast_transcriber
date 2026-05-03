import { getPgPool } from './pool'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidProjectId(id: string): boolean {
  return UUID_RE.test(id)
}

export type ProjectListItem = {
  id: string
  name: string
  hasSongMap: boolean
  updatedAt: string
  createdAt: string
}

export type LoadedProject = {
  id: string
  name: string
  songMapJson: unknown | null
  audioSha256: string | null
  hasAudio: boolean
  updatedAt: string
}

export async function listProjects(fingerprintHash: string): Promise<ProjectListItem[]> {
  const pool = getPgPool()
  if (!pool) return []

  const r = await pool.query<{
    id: string
    name: string
    has_song: boolean
    updated_at: Date
    created_at: Date
  }>(
    `SELECT id::text AS id, name,
            (song_map_json IS NOT NULL) AS has_song,
            updated_at, created_at
     FROM projects
     WHERE fingerprint_hash = $1
     ORDER BY updated_at DESC`,
    [fingerprintHash],
  )

  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    hasSongMap: row.has_song,
    updatedAt: row.updated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  }))
}

export async function createProject(
  fingerprintHash: string,
  name: string,
  songMapJsonText: string,
  audio?: { bytes: Buffer; sha256: string },
): Promise<string | null> {
  const pool = getPgPool()
  if (!pool) return null

  if (audio) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO projects (fingerprint_hash, name, song_map_json, audio_bytes, audio_sha256)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING id::text AS id`,
      [fingerprintHash, name, songMapJsonText, audio.bytes, audio.sha256],
    )
    return r.rows[0]?.id ?? null
  }

  const r = await pool.query<{ id: string }>(
    `INSERT INTO projects (fingerprint_hash, name, song_map_json)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id::text AS id`,
    [fingerprintHash, name, songMapJsonText],
  )
  return r.rows[0]?.id ?? null
}

export async function loadProject(
  projectId: string,
  fingerprintHash: string,
): Promise<LoadedProject | null> {
  const pool = getPgPool()
  if (!pool || !isValidProjectId(projectId)) return null

  const r = await pool.query<{
    id: string
    name: string
    song_map_json: unknown
    audio_sha256: string | null
    audio_bytes: Buffer | null
    updated_at: Date
  }>(
    `SELECT id::text AS id, name, song_map_json, audio_sha256, audio_bytes, updated_at
     FROM projects
     WHERE id = $1::uuid AND fingerprint_hash = $2`,
    [projectId, fingerprintHash],
  )

  const row = r.rows[0]
  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    songMapJson: row.song_map_json,
    audioSha256: row.audio_sha256,
    hasAudio: row.audio_bytes != null && row.audio_bytes.length > 0,
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function updateProject(
  projectId: string,
  fingerprintHash: string,
  songMapJsonText: string,
  audio?: { bytes: Buffer; sha256: string },
): Promise<boolean> {
  const pool = getPgPool()
  if (!pool || !isValidProjectId(projectId)) return false

  if (audio) {
    const r = await pool.query(
      `UPDATE projects
       SET song_map_json = $1::jsonb,
           audio_bytes = $2,
           audio_sha256 = $3,
           updated_at = now()
       WHERE id = $4::uuid AND fingerprint_hash = $5`,
      [songMapJsonText, audio.bytes, audio.sha256, projectId, fingerprintHash],
    )
    return (r.rowCount ?? 0) > 0
  }

  const r = await pool.query(
    `UPDATE projects
     SET song_map_json = $1::jsonb,
         updated_at = now()
     WHERE id = $2::uuid AND fingerprint_hash = $3`,
    [songMapJsonText, projectId, fingerprintHash],
  )
  return (r.rowCount ?? 0) > 0
}

export async function deleteProject(
  projectId: string,
  fingerprintHash: string,
): Promise<boolean> {
  const pool = getPgPool()
  if (!pool || !isValidProjectId(projectId)) return false

  const r = await pool.query(
    `DELETE FROM projects WHERE id = $1::uuid AND fingerprint_hash = $2`,
    [projectId, fingerprintHash],
  )
  return (r.rowCount ?? 0) > 0
}

export async function loadProjectAudio(
  projectId: string,
  fingerprintHash: string,
): Promise<Buffer | null> {
  const pool = getPgPool()
  if (!pool || !isValidProjectId(projectId)) return null

  const r = await pool.query<{ audio_bytes: Buffer | null }>(
    `SELECT audio_bytes FROM projects
     WHERE id = $1::uuid AND fingerprint_hash = $2`,
    [projectId, fingerprintHash],
  )
  const b = r.rows[0]?.audio_bytes
  return b && b.length > 0 ? Buffer.from(b) : null
}
