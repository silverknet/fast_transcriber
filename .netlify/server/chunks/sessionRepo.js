import { t as getPgPool } from "./pool2.js";
//#region src/lib/server/db/sessionRepo.ts
/**
* Editor-session persistence — anonymous browser-fingerprint keyed.
*
* Only the musical document (`song_map_json`) is stored. Audio bytes are
* NEVER persisted server-side; the BarBro Desktop sidecar owns the user's
* audio files on their local disk. This module assumes the schema after
* migration `003_drop_audio_storage.sql` (no `audio_bytes` / `audio_sha256`
* columns).
*/
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidSessionId(id) {
	return UUID_RE.test(id);
}
async function ensureEditorSession(fingerprintHash) {
	const pool = getPgPool();
	if (!pool) return null;
	await pool.query(`INSERT INTO editor_sessions (fingerprint_hash) VALUES ($1)
     ON CONFLICT (fingerprint_hash) DO NOTHING`, [fingerprintHash]);
	const row = (await pool.query(`SELECT id::text AS id,
            (song_map_json IS NOT NULL) AS has_song,
            updated_at
     FROM editor_sessions WHERE fingerprint_hash = $1`, [fingerprintHash])).rows[0];
	if (!row) return null;
	return {
		sessionId: row.id,
		hasSongMap: row.has_song,
		updatedAt: row.updated_at.toISOString()
	};
}
async function loadEditorSession(sessionId, fingerprintHash) {
	const pool = getPgPool();
	if (!pool || !isValidSessionId(sessionId)) return null;
	const row = (await pool.query(`SELECT id::text AS id, song_map_json, updated_at
     FROM editor_sessions
     WHERE id = $1::uuid AND fingerprint_hash = $2`, [sessionId, fingerprintHash])).rows[0];
	if (!row) return null;
	return {
		id: row.id,
		songMapJson: row.song_map_json,
		updatedAt: row.updated_at.toISOString()
	};
}
async function saveEditorSession(sessionId, fingerprintHash, songMapJsonText) {
	const pool = getPgPool();
	if (!pool || !isValidSessionId(sessionId)) return false;
	return (await pool.query(`UPDATE editor_sessions
     SET song_map_json = $1::jsonb,
         updated_at = now()
     WHERE id = $2::uuid AND fingerprint_hash = $3`, [
		songMapJsonText,
		sessionId,
		fingerprintHash
	])).rowCount === 1;
}
//#endregion
export { saveEditorSession as i, isValidSessionId as n, loadEditorSession as r, ensureEditorSession as t };
