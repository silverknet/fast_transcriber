import { n as isDatabaseConfigured } from "../../../../../chunks/pool2.js";
import { i as parseSongMapJsonString } from "../../../../../chunks/persist.js";
import { t as parseFingerprintHeaderOrQuery } from "../../../../../chunks/fingerprintHttp.js";
import { a as loadProject, n as deleteProject, o as updateProject, r as isValidProjectId } from "../../../../../chunks/projectRepo.js";
import { json } from "@sveltejs/kit";
//#region src/routes/api/projects/[id]/+server.ts
async function GET({ params, url, request }) {
	if (!isDatabaseConfigured()) return json({
		ok: false,
		error: "Database not configured"
	}, { status: 503 });
	const id = params.id ?? "";
	if (!isValidProjectId(id)) return json({
		ok: false,
		error: "Invalid project id"
	}, { status: 400 });
	const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get("x-barbro-fingerprint"), url.searchParams.get("fingerprint"));
	if (!fingerprint) return json({
		ok: false,
		error: "Missing or invalid fingerprint"
	}, { status: 400 });
	const row = await loadProject(id, fingerprint);
	if (!row) return json({
		ok: false,
		error: "Project not found"
	}, { status: 404 });
	return json({
		ok: true,
		id: row.id,
		name: row.name,
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
	if (!isValidProjectId(id)) return json({
		ok: false,
		error: "Invalid project id"
	}, { status: 400 });
	const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get("x-barbro-fingerprint"), null);
	if (!fingerprint) return json({
		ok: false,
		error: "Missing or invalid X-BarBro-Fingerprint header"
	}, { status: 400 });
	let body;
	try {
		body = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Expected JSON body"
		}, { status: 400 });
	}
	const songMapJson = body.songMapJson;
	if (typeof songMapJson !== "string") return json({
		ok: false,
		error: "songMapJson field required"
	}, { status: 400 });
	const parsed = parseSongMapJsonString(songMapJson);
	if (!parsed.ok) return json({
		ok: false,
		error: parsed.error
	}, { status: 400 });
	if (!await updateProject(id, fingerprint, songMapJson)) return json({
		ok: false,
		error: "Project not found or fingerprint mismatch"
	}, { status: 404 });
	return json({
		ok: true,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
async function DELETE({ params, request }) {
	if (!isDatabaseConfigured()) return json({
		ok: false,
		error: "Database not configured"
	}, { status: 503 });
	const id = params.id ?? "";
	if (!isValidProjectId(id)) return json({
		ok: false,
		error: "Invalid project id"
	}, { status: 400 });
	const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get("x-barbro-fingerprint"), null);
	if (!fingerprint) return json({
		ok: false,
		error: "Missing or invalid X-BarBro-Fingerprint header"
	}, { status: 400 });
	if (!await deleteProject(id, fingerprint)) return json({
		ok: false,
		error: "Project not found or fingerprint mismatch"
	}, { status: 404 });
	return json({ ok: true });
}
//#endregion
export { DELETE, GET, PUT };
