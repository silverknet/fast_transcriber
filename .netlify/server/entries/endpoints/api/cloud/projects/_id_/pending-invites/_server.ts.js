import { c as getCloudProject, o as deletePendingInvite, p as listPendingInvitesForProject } from "../../../../../../../chunks/cloudRepo.js";
import { error, json } from "@sveltejs/kit";
//#region src/routes/api/cloud/projects/[id]/pending-invites/+server.ts
/**
* `/api/cloud/projects/:id/pending-invites` — owner-only.
*
*   GET                → list pending invites for this project
*   DELETE ?id=<uuid>  → revoke one
*
* Pending invites are created by `POST /api/cloud/projects/:id/members`
* when the invited email doesn't match an existing Supabase auth user.
* They're consumed when the invitee signs in for the first time (see
* `cloud_consume_pending_invites_for_email` in migration 012).
*/
function requireGranted(locals) {
	if (!locals.user) throw error(401, "Sign in required.");
	if (locals.accessStatus !== "granted") throw error(403, "Awaiting access approval.");
}
async function requireProjectOwner(locals, projectId) {
	const proj = await getCloudProject(locals.supabase, projectId);
	if (!proj) throw error(404, "Project not found.");
	if (proj.owner_user_id !== locals.user.id) throw error(403, "Owner only.");
}
var GET = async ({ locals, params }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	await requireProjectOwner(locals, projectId);
	return json({
		ok: true,
		invites: await listPendingInvitesForProject(locals.supabase, projectId)
	});
};
var DELETE = async ({ locals, params, url }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	await requireProjectOwner(locals, projectId);
	const inviteId = url.searchParams.get("id");
	if (!inviteId) throw error(400, "id query param required.");
	const r = await deletePendingInvite(locals.supabase, inviteId);
	if (!r.ok) throw error(500, r.error);
	return json({ ok: true });
};
//#endregion
export { DELETE, GET };
