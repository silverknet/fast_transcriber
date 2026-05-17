import { n as isDatabaseConfigured } from "../../chunks/pool2.js";
import { n as isValidSessionId } from "../../chunks/sessionRepo.js";
//#region src/routes/+layout.server.ts
async function load({ cookies }) {
	const sid = cookies.get("barbro_session") ?? "";
	if (!sid || !isValidSessionId(sid) || !isDatabaseConfigured()) return { savedSessionId: null };
	const { getPgPool } = await import("../../chunks/pool.js");
	const pool = getPgPool();
	if (!pool) return { savedSessionId: null };
	try {
		return { savedSessionId: (await pool.query(`SELECT (song_map_json IS NOT NULL) AS has_song
       FROM editor_sessions
       WHERE id = $1::uuid`, [sid])).rows[0]?.has_song === true ? sid : null };
	} catch (e) {
		console.warn("[layout.server] Postgres unavailable — skipping session restore:", e instanceof Error ? e.message : e);
		return { savedSessionId: null };
	}
}
//#endregion
export { load };
