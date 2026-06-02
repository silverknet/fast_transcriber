import { n as isDatabaseConfigured } from "../../../../chunks/pool2.js";
import { i as parseSongMapJsonString } from "../../../../chunks/persist.js";
import { t as parseFingerprintHeaderOrQuery } from "../../../../chunks/fingerprintHttp.js";
import { i as listProjects, t as createProject } from "../../../../chunks/projectRepo.js";
import { json } from "@sveltejs/kit";
//#region src/routes/api/projects/+server.ts
async function GET({ request, url }) {
	if (!isDatabaseConfigured()) return json({
		ok: false,
		error: "Database not configured"
	}, { status: 503 });
	const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get("x-barbro-fingerprint"), url.searchParams.get("fingerprint"));
	if (!fingerprint) return json({
		ok: false,
		error: "Missing or invalid fingerprint"
	}, { status: 400 });
	return json({
		ok: true,
		projects: await listProjects(fingerprint)
	});
}
async function POST({ request }) {
	if (!isDatabaseConfigured()) return json({
		ok: false,
		error: "Database not configured"
	}, { status: 503 });
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
	const name = (body.name ?? "").trim() || "Untitled Project";
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
	const id = await createProject(fingerprint, name, songMapJson);
	if (!id) return json({
		ok: false,
		error: "Failed to create project"
	}, { status: 500 });
	return json({
		ok: true,
		id,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	}, { status: 201 });
}
//#endregion
export { GET, POST };
