import { n as isDatabaseConfigured } from "../../../../../chunks/pool2.js";
import { i as parseSongMapJsonString } from "../../../../../chunks/persist.js";
import { t as parseFingerprintHeaderOrQuery } from "../../../../../chunks/fingerprintHttp.js";
import { a as saveEditorSession, n as isValidSessionId, r as loadEditorSession } from "../../../../../chunks/sessionRepo.js";
import { json } from "@sveltejs/kit";
import { createHash } from "node:crypto";
//#region src/routes/api/sessions/[id]/+server.ts
/** Large multipart saves (audio clip). */
var config = { maxRequestBodySize: 100 * 1024 * 1024 };
var MAX_AUDIO_BYTES = 80 * 1024 * 1024;
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
		hasAudio: row.hasAudio,
		audioSha256: row.audioSha256,
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
	let form;
	try {
		form = await request.formData();
	} catch {
		return json({
			ok: false,
			error: "Expected multipart form data"
		}, { status: 400 });
	}
	const songMapJson = form.get("songMapJson");
	if (typeof songMapJson !== "string") return json({
		ok: false,
		error: "songMapJson field required"
	}, { status: 400 });
	const parsed = parseSongMapJsonString(songMapJson);
	if (!parsed.ok) return json({
		ok: false,
		error: parsed.error
	}, { status: 400 });
	const audio = form.get("audio");
	let audioPart;
	if (audio instanceof File && audio.size > 0) {
		if (audio.size > MAX_AUDIO_BYTES) return json({
			ok: false,
			error: `Audio too large (max ${MAX_AUDIO_BYTES / (1024 * 1024)} MB)`
		}, { status: 413 });
		const ab = await audio.arrayBuffer();
		const bytes = Buffer.from(ab);
		audioPart = {
			bytes,
			sha256: createHash("sha256").update(bytes).digest("hex")
		};
	}
	if (!await saveEditorSession(id, fingerprint, songMapJson, audioPart)) return json({
		ok: false,
		error: "Session not found or fingerprint mismatch"
	}, { status: 404 });
	return json({
		ok: true,
		audioSha256: audioPart?.sha256 ?? null,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
//#endregion
export { GET, PUT, config };
