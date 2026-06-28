import { a as deleteCloudProject, c as getCloudProject, g as rpcPatchManifest, l as listCloudMembers } from "../../../../../../chunks/cloudRepo.js";
import { error, json } from "@sveltejs/kit";
//#region src/routes/api/cloud/projects/[id]/+server.ts
/**
* `/api/cloud/projects/:id` — manifest get + patch.
*
*  - GET   → project meta + members. Songs come from `/songs?since=…`.
*  - PATCH → rename / reorder / hide-flag updates. Single atomic call
*            to `cloud_patch_manifest`. Returns the new revision or a
*            409 conflict.
*/
function requireGranted(locals) {
	if (!locals.user) throw error(401, "Sign in required.");
	if (locals.accessStatus !== "granted") throw error(403, "Awaiting access approval.");
}
var GET = async ({ locals, params }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	const project = await getCloudProject(locals.supabase, projectId);
	if (!project) throw error(404, "Project not found.");
	return json({
		ok: true,
		project,
		members: await listCloudMembers(locals.supabase, projectId)
	});
};
var PATCH = async ({ locals, params, request }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	const body = await request.json().catch(() => null);
	if (!body || typeof body.clientBaseRevision !== "number") throw error(400, "clientBaseRevision (number) is required.");
	const args = {
		projectId,
		name: body.name ?? null,
		orderedSongIds: body.orderedSongIds ?? null,
		hiddenMap: body.hiddenMap ?? null,
		clientBaseRevision: body.clientBaseRevision
	};
	const r = await rpcPatchManifest(locals.supabase, args);
	if (r.ok) return json({
		ok: true,
		revision: r.revision
	});
	if (r.conflict) return json({
		ok: false,
		conflict: true,
		remote: await getCloudProject(locals.supabase, projectId),
		error: r.error
	}, { status: 409 });
	throw error(500, r.error);
};
/**
* DELETE — owner-only cascade. Drops cloud_projects + everything
* referencing it. Local manifest cleanup (clearing the `cloud` block) is
* the client's job after the 200.
*/
var DELETE = async ({ locals, params }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	const r = await deleteCloudProject(locals.supabase, projectId);
	if (!r.ok) throw error(500, r.error);
	return json({ ok: true });
};
//#endregion
export { DELETE, GET, PATCH };
