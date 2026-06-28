import { c as getCloudProject, i as createPendingInvite, l as listCloudMembers, m as removeMember, n as addMember, s as findUserIdByEmail } from "../../../../../../../chunks/cloudRepo.js";
import { n as getSupabaseServiceClient } from "../../../../../../../chunks/serverClient.js";
import { error, json } from "@sveltejs/kit";
//#region src/routes/api/cloud/projects/[id]/members/+server.ts
/**
* `/api/cloud/projects/:id/members` — list + invite + remove.
*
*   GET                   → roster
*   POST { email, role }  → owner-only; looks up user_id from auth.users
*                           by email and inserts the membership row.
*                           Fails closed: invitee must already have a
*                           Supabase auth account. (The signup gate
*                           from migration 009 means they ALSO need an
*                           access grant to actually use anything.)
*   DELETE ?userId=<uuid> → owner-only; cannot remove self if last owner.
*
* Membership writes go through the service-role client (`addMember` /
* `removeMember`) because the user-facing `cloud_project_members` RLS
* policies forbid the recursion-prone "owner inserts/removes" via the
* normal client. Owner-check is performed in JS against the cloud
* project's owner_user_id before delegating.
*/
function requireGranted(locals) {
	if (!locals.user) throw error(401, "Sign in required.");
	if (locals.accessStatus !== "granted") throw error(403, "Awaiting access approval.");
}
var GET = async ({ locals, params }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	return json({
		ok: true,
		members: await listCloudMembers(locals.supabase, projectId)
	});
};
async function requireProjectOwner(locals, projectId) {
	const proj = await getCloudProject(locals.supabase, projectId);
	if (!proj) throw error(404, "Project not found.");
	if (proj.owner_user_id !== locals.user.id) throw error(403, "Owner only.");
}
var POST = async ({ locals, params, request }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	await requireProjectOwner(locals, projectId);
	const body = await request.json().catch(() => null);
	const email = body?.email?.trim().toLowerCase() ?? "";
	const role = body?.role === "owner" ? "owner" : "editor";
	if (!email || !email.includes("@")) throw error(400, "Valid email required.");
	const service = getSupabaseServiceClient();
	const userId = await findUserIdByEmail(service, email);
	if (!userId) {
		const r = await createPendingInvite(service, projectId, email, role, locals.user.id);
		if (!r.ok) throw error(500, r.error);
		return json({
			ok: true,
			pending: true,
			email,
			role
		});
	}
	const r = await addMember(service, projectId, userId, role);
	if (!r.ok) throw error(500, r.error);
	return json({
		ok: true,
		pending: false,
		userId,
		role
	});
};
var DELETE = async ({ locals, params, url }) => {
	requireGranted(locals);
	const projectId = params.id;
	if (!projectId) throw error(400, "Missing project id.");
	await requireProjectOwner(locals, projectId);
	const userId = url.searchParams.get("userId");
	if (!userId) throw error(400, "userId query param required.");
	const service = getSupabaseServiceClient();
	if (userId === locals.user.id) throw error(400, "Owners cannot remove themselves. Transfer ownership first.");
	const r = await removeMember(service, projectId, userId);
	if (!r.ok) throw error(500, r.error);
	return json({ ok: true });
};
//#endregion
export { DELETE, GET, POST };
