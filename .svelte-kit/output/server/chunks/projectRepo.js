import { t as getPgPool } from "./pool2.js";
//#region src/lib/server/db/projectRepo.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidProjectId(id) {
	return UUID_RE.test(id);
}
async function listProjects(fingerprintHash) {
	const pool = getPgPool();
	if (!pool) return [];
	return (await pool.query(`SELECT id::text AS id, name,
            (song_map_json IS NOT NULL) AS has_song,
            updated_at, created_at
     FROM projects
     WHERE fingerprint_hash = $1
     ORDER BY updated_at DESC`, [fingerprintHash])).rows.map((row) => ({
		id: row.id,
		name: row.name,
		hasSongMap: row.has_song,
		updatedAt: row.updated_at.toISOString(),
		createdAt: row.created_at.toISOString()
	}));
}
async function createProject(fingerprintHash, name, songMapJsonText, audio) {
	const pool = getPgPool();
	if (!pool) return null;
	if (audio) return (await pool.query(`INSERT INTO projects (fingerprint_hash, name, song_map_json, audio_bytes, audio_sha256)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING id::text AS id`, [
		fingerprintHash,
		name,
		songMapJsonText,
		audio.bytes,
		audio.sha256
	])).rows[0]?.id ?? null;
	return (await pool.query(`INSERT INTO projects (fingerprint_hash, name, song_map_json)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id::text AS id`, [
		fingerprintHash,
		name,
		songMapJsonText
	])).rows[0]?.id ?? null;
}
async function loadProject(projectId, fingerprintHash) {
	const pool = getPgPool();
	if (!pool || !isValidProjectId(projectId)) return null;
	const row = (await pool.query(`SELECT id::text AS id, name, song_map_json, audio_sha256, audio_bytes, updated_at
     FROM projects
     WHERE id = $1::uuid AND fingerprint_hash = $2`, [projectId, fingerprintHash])).rows[0];
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		songMapJson: row.song_map_json,
		audioSha256: row.audio_sha256,
		hasAudio: row.audio_bytes != null && row.audio_bytes.length > 0,
		updatedAt: row.updated_at.toISOString()
	};
}
async function updateProject(projectId, fingerprintHash, songMapJsonText, audio) {
	const pool = getPgPool();
	if (!pool || !isValidProjectId(projectId)) return false;
	if (audio) return ((await pool.query(`UPDATE projects
       SET song_map_json = $1::jsonb,
           audio_bytes = $2,
           audio_sha256 = $3,
           updated_at = now()
       WHERE id = $4::uuid AND fingerprint_hash = $5`, [
		songMapJsonText,
		audio.bytes,
		audio.sha256,
		projectId,
		fingerprintHash
	])).rowCount ?? 0) > 0;
	return ((await pool.query(`UPDATE projects
     SET song_map_json = $1::jsonb,
         updated_at = now()
     WHERE id = $2::uuid AND fingerprint_hash = $3`, [
		songMapJsonText,
		projectId,
		fingerprintHash
	])).rowCount ?? 0) > 0;
}
async function deleteProject(projectId, fingerprintHash) {
	const pool = getPgPool();
	if (!pool || !isValidProjectId(projectId)) return false;
	return ((await pool.query(`DELETE FROM projects WHERE id = $1::uuid AND fingerprint_hash = $2`, [projectId, fingerprintHash])).rowCount ?? 0) > 0;
}
async function loadProjectAudio(projectId, fingerprintHash) {
	const pool = getPgPool();
	if (!pool || !isValidProjectId(projectId)) return null;
	const b = (await pool.query(`SELECT audio_bytes FROM projects
     WHERE id = $1::uuid AND fingerprint_hash = $2`, [projectId, fingerprintHash])).rows[0]?.audio_bytes;
	return b && b.length > 0 ? Buffer.from(b) : null;
}
//#endregion
export { loadProject as a, listProjects as i, deleteProject as n, loadProjectAudio as o, isValidProjectId as r, updateProject as s, createProject as t };
