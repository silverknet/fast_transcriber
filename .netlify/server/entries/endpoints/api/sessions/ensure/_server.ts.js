import { n as isDatabaseConfigured } from "../../../../../chunks/pool2.js";
import { t as ensureEditorSession } from "../../../../../chunks/sessionRepo.js";
import { json } from "@sveltejs/kit";
//#region src/routes/api/sessions/ensure/+server.ts
var FP_RE = /^[0-9a-f]{64}$/i;
async function POST({ request, cookies }) {
	if (!isDatabaseConfigured()) return json({
		ok: false,
		error: "Database not configured (set DATABASE_URL)"
	}, { status: 503 });
	let body;
	try {
		body = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Invalid JSON"
		}, { status: 400 });
	}
	const fp = typeof body === "object" && body && "fingerprint" in body ? String(body.fingerprint) : "";
	if (!FP_RE.test(fp)) return json({
		ok: false,
		error: "fingerprint must be a 64-character hex SHA-256 string"
	}, { status: 400 });
	const row = await ensureEditorSession(fp.toLowerCase());
	if (!row) return json({
		ok: false,
		error: "Could not create or load session"
	}, { status: 500 });
	cookies.set("barbro_session", row.sessionId, {
		path: "/",
		httpOnly: false,
		sameSite: "lax",
		maxAge: 3600 * 24 * 365,
		secure: false
	});
	return json({
		ok: true,
		sessionId: row.sessionId,
		hasSongMap: row.hasSongMap,
		updatedAt: row.updatedAt
	});
}
//#endregion
export { POST };
