import { n as isDatabaseConfigured } from "../../../../../chunks/pool2.js";
import { i as parseSongMapJsonString } from "../../../../../chunks/persist.js";
import { t as parseFingerprintHeaderOrQuery } from "../../../../../chunks/fingerprintHttp.js";
import { i as saveEditorSession, n as isValidSessionId, r as loadEditorSession } from "../../../../../chunks/sessionRepo.js";
import { json } from "@sveltejs/kit";
//#region src/routes/api/sessions/[id]/+server.ts
async function GET({ params, url, request }) {
	if (!isDatabaseConfigured()) return json({
		ok: false,
		error: "Database not configured"
	}, { status: 503 });
	const id = params.id ?? "";
	if (!isValidSessionId(id)) return json({
		ok: false,
		error: "Invalid session id"
	}, { status: 400 });
	const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get("x-barbro-fingerprint"), url.searchParams.get("fingerprint"));
	if (!fingerprint) return json({
		ok: false,
		error: "Missing or invalid fingerprint"
	}, { status: 400 });
	const row = await loadEditorSession(id, fingerprint);
	if (!row) return json({
		ok: false,
		error: "Session not found"
	}, { status: 404 });
	return json({
		ok: true,
		sessionId: row.id,
		songMap: row.songMapJson,
		updatedAt: row.updatedAt
	});
}
async function PUT({ params, request }) {
	if (!isDatabaseConfigured()) return json({
		ok: false,
		error: "Database not configured"
	}, { status: 503 });
	const id = params.id ?? "";
	if (!isValidSessionId(id)) return json({
		ok: false,
		error: "Invalid session id"
	}, { status: 400 });
	const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get("x-barbro-fingerprint"), null);
	if (!fingerprint) return json({
		ok: false,
		error: "Missing or invalid X-BarBro-Fingerprint header"
	}, { status: 400 });
	let songMapJson;
	try {
		songMapJson = await request.text();
	} catch {
		return json({
			ok: false,
			error: "Expected JSON body"
		}, { status: 400 });
	}
	const parsed = parseSongMapJsonString(songMapJson);
	if (!parsed.ok) return json({
		ok: false,
		error: parsed.error
	}, { status: 400 });
	if (!await saveEditorSession(id, fingerprint, songMapJson)) return json({
		ok: false,
		error: "Session not found or fingerprint mismatch"
	}, { status: 404 });
	return json({
		ok: true,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
//#endregion
export { GET, PUT };
