import { _ as rpcPushSong, u as listCloudSongs } from "../../../../../../../../chunks/cloudRepo.js";
import { error, json } from "@sveltejs/kit";
//#region src/routes/api/cloud/projects/[id]/songs/[songId]/+server.ts
/**
* `/api/cloud/projects/:id/songs/:songId` — per-song push.
*
*   PUT body { songMap, expectedAudio?, sortOrder?, hidden?, clientBaseRevision }
*
* Returns `{ ok: true, revision }` on success or `{ ok: false, conflict: true, remote }`
* (409) when the row has moved past `clientBaseRevision`. The client
* then runs the Phase 8 merge to decide how to proceed.
*/
var PUT = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, "Sign in required.");
	if (locals.accessStatus !== "granted") throw error(403, "Awaiting access approval.");
	const projectId = params.id;
	const songId = params.songId;
	if (!projectId || !songId) throw error(400, "Missing project / song id.");
	const body = await request.json().catch(() => null);
	if (!body || typeof body.clientBaseRevision !== "number" || body.songMap === void 0) throw error(400, "songMap + clientBaseRevision are required.");
	const args = {
		projectId,
		songId,
		songMap: body.songMap,
		expectedAudio: body.expectedAudio,
		sortOrder: body.sortOrder,
		hidden: body.hidden,
		clientBaseRevision: body.clientBaseRevision
	};
	const r = await rpcPushSong(locals.supabase, args);
	if (r.ok) return json({
		ok: true,
		revision: r.revision
	});
	if (r.conflict) return json({
		ok: false,
		conflict: true,
		remote: (await listCloudSongs(locals.supabase, projectId)).find((s) => s.id === songId) ?? null,
		error: r.error
	}, { status: 409 });
	throw error(500, r.error);
};
//#endregion
export { PUT };
