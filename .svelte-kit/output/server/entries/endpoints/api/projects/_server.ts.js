import { n as isDatabaseConfigured } from "../../../../chunks/pool2.js";
import { i as parseSongMapJsonString } from "../../../../chunks/persist.js";
import { t as parseFingerprintHeaderOrQuery } from "../../../../chunks/fingerprintHttp.js";
import { i as listProjects, t as createProject } from "../../../../chunks/projectRepo.js";
import { json } from "@sveltejs/kit";
import { createHash } from "node:crypto";
//#region src/routes/api/projects/+server.ts
var config = { maxRequestBodySize: 100 * 1024 * 1024 };
var MAX_AUDIO_BYTES = 80 * 1024 * 1024;
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
	let form;
	try {
		form = await request.formData();
	} catch {
		return json({
			ok: false,
			error: "Expected multipart form data"
		}, { status: 400 });
	}
	const name = (form.get("name") ?? "").trim() || "Untitled Project";
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
	const id = await createProject(fingerprint, name, songMapJson, audioPart);
	if (!id) return json({
		ok: false,
		error: "Failed to create project"
	}, { status: 500 });
	return json({
		ok: true,
		id,
		audioSha256: audioPart?.sha256 ?? null,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	}, { status: 201 });
}
//#endregion
export { GET, POST, config };
