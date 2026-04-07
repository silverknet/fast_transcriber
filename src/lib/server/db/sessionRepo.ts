import { getPgPool } from './pool'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidSessionId(id: string): boolean {
  return UUID_RE.test(id)
}

export type EnsureSessionResult = {
  sessionId: string
  hasSongMap: boolean
  updatedAt: string
}

export async function ensureEditorSession(
  fingerprintHash: string,
): Promise<EnsureSessionResult | null> {
  const pool = getPgPool()
  if (!pool) return null

  await pool.query(
    `INSERT INTO editor_sessions (fingerprint_hash) VALUES ($1)
     ON CONFLICT (fingerprint_hash) DO NOTHING`,
    [fingerprintHash],
  )

  const r = await pool.query<{ id: string; has_song: boolean; updated_at: Date }>(
    `SELECT id::text AS id,
            (song_map_json IS NOT NULL) AS has_song,
            updated_at
     FROM editor_sessions WHERE fingerprint_hash = $1`,
    [fingerprintHash],
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    sessionId: row.id,
    hasSongMap: row.has_song,
    updatedAt: row.updated_at.toISOString(),
  }
}

export type LoadedSession = {
  id: string
  songMapJson: unknown | null
  audioSha256: string | null
  hasAudio: boolean
  updatedAt: string
}

export async function loadEditorSession(
  sessionId: string,
  fingerprintHash: string,
): Promise<LoadedSession | null> {
  const pool = getPgPool()
  if (!pool || !isValidSessionId(sessionId)) return null

  const r = await pool.query<{
    id: string
    song_map_json: unknown
    audio_sha256: string | null
    audio_bytes: Buffer | null
    updated_at: Date
  }>(
    `SELECT id::text AS id, song_map_json, audio_sha256, audio_bytes, updated_at
     FROM editor_sessions
     WHERE id = $1::uuid AND fingerprint_hash = $2`,
    [sessionId, fingerprintHash],
  )

  const row = r.rows[0]
  if (!row) return null

  return {
    id: row.id,
    songMapJson: row.song_map_json,
    audioSha256: row.audio_sha256,
    hasAudio: row.audio_bytes != null && row.audio_bytes.length > 0,
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function loadSessionAudio(
  sessionId: string,
  fingerprintHash: string,
): Promise<Buffer | null> {
  const pool = getPgPool()
  if (!pool || !isValidSessionId(sessionId)) return null

  const r = await pool.query<{ audio_bytes: Buffer | null }>(
    `SELECT audio_bytes FROM editor_sessions
     WHERE id = $1::uuid AND fingerprint_hash = $2`,
    [sessionId, fingerprintHash],
  )
  const b = r.rows[0]?.audio_bytes
  return b && b.length > 0 ? Buffer.from(b) : null
}

export async function saveEditorSession(
  sessionId: string,
  fingerprintHash: string,
  songMapJsonText: string,
  audio?: { bytes: Buffer; sha256: string },
): Promise<boolean> {
  const pool = getPgPool()
  if (!pool || !isValidSessionId(sessionId)) return false

  if (audio) {
    const r = await pool.query(
      `UPDATE editor_sessions
       SET song_map_json = $1::jsonb,
           audio_bytes = $2,
           audio_sha256 = $3,
           updated_at = now()
       WHERE id = $4::uuid AND fingerprint_hash = $5`,
      [songMapJsonText, audio.bytes, audio.sha256, sessionId, fingerprintHash],
    )
    return r.rowCount === 1
  }

  const r = await pool.query(
    `UPDATE editor_sessions
     SET song_map_json = $1::jsonb,
         updated_at = now()
     WHERE id = $2::uuid AND fingerprint_hash = $3`,
    [songMapJsonText, sessionId, fingerprintHash],
  )
  return r.rowCount === 1
}
