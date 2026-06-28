import { d as listMemberProjects, h as rpcCreateCloudProject } from "../../../../../chunks/cloudRepo.js";
import { error, json } from "@sveltejs/kit";
//#region src/routes/api/cloud/projects/+server.ts
/**
* `/api/cloud/projects` — list (GET) + create (POST).
*
* All cloud endpoints require a granted user (RLS would block anyway,
* but we surface a clean 401/403 instead of a confusing empty result).
* Access gate is enforced by `hooks.server.ts` + `decideRouteAccess`;
* here we just check `event.locals.user` and `event.locals.accessStatus`.
*/
function requireGranted(locals) {
	if (!locals.user) throw error(401, "Sign in required.");
	if (locals.accessStatus !== "granted") throw error(403, "Awaiting access approval.");
}
var GET = async ({ locals }) => {
	requireGranted(locals);
	return json({
		ok: true,
		projects: await listMemberProjects(locals.supabase)
	});
};
var POST = async ({ locals, request }) => {
	requireGranted(locals);
	const body = await request.json().catch(() => null);
	if (!body?.projectId || !body.name) throw error(400, "projectId and name are required.");
	if (!Array.isArray(body.songs)) throw error(400, "songs[] is required (may be empty).");
	const args = {
		projectId: body.projectId,
		name: body.name,
		songs: body.songs.map((s) => ({
			id: s.id,
			song_map: s.songMap,
			expected_audio: s.expectedAudio ?? null,
			hidden: s.hidden ?? false,
			sort_order: s.sortOrder
		}))
	};
	try {
		const revision = await rpcCreateCloudProject(locals.supabase, args);
		return json({
			ok: true,
			cloudProjectId: args.projectId,
			revision
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (/duplicate|unique/i.test(msg)) throw error(409, `Project id already in use: ${msg}`);
		throw error(500, msg);
	}
};
//#endregion
export { GET, POST };
