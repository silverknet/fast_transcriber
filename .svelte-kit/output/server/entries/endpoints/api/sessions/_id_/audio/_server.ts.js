import { n as isDatabaseConfigured } from "../../../../../../chunks/pool2.js";
import { t as parseFingerprintHeaderOrQuery } from "../../../../../../chunks/fingerprintHttp.js";
import { i as loadSessionAudio, n as isValidSessionId } from "../../../../../../chunks/sessionRepo.js";
//#region src/routes/api/sessions/[id]/audio/+server.ts
async function GET({ params, url, request }) {
	if (!isDatabaseConfigured()) return new Response("Database not configured", { status: 503 });
	const id = params.id ?? "";
	if (!isValidSessionId(id)) return new Response("Invalid session id", { status: 400 });
	const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get("x-barbro-fingerprint"), url.searchParams.get("fingerprint"));
	if (!fingerprint) return new Response("Missing or invalid fingerprint", { status: 400 });
	const buf = await loadSessionAudio(id, fingerprint);
	if (!buf?.length) return new Response("No audio for this session", { status: 404 });
	return new Response(new Uint8Array(buf), { headers: {
		"Content-Type": "application/octet-stream",
		"Cache-Control": "no-store"
	} });
}
//#endregion
export { GET };
