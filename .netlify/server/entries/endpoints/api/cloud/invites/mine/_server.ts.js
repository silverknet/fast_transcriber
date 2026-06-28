import { f as listPendingInvitesForCurrentUser, t as acceptPendingInvite } from "../../../../../../chunks/cloudRepo.js";
import { error, json } from "@sveltejs/kit";
//#region src/routes/api/cloud/invites/mine/+server.ts
/**
* `/api/cloud/invites/mine` — invitee-side view of pending invites.
*
*   GET                          → invites where invited_email matches
*                                  the caller's JWT email. Returned with
*                                  project_name so the UI can show
*                                  "Invited to: My Project" without an
*                                  extra round-trip per row.
*   POST { projectId }           → accept one invite. Promotes the
*                                  pending row into a real membership
*                                  via `cloud_accept_pending_invite`,
*                                  returns `{ ok, accepted }`. Caller
*                                  follows up with the existing
*                                  `joinCloudProject` flow to materialize
*                                  the project locally.
*/
function requireGranted(locals) {
	if (!locals.user) throw error(401, "Sign in required.");
	if (locals.accessStatus !== "granted") throw error(403, "Awaiting access approval.");
}
var GET = async ({ locals }) => {
	requireGranted(locals);
	return json({
		ok: true,
		invites: await listPendingInvitesForCurrentUser(locals.supabase)
	});
};
var POST = async ({ locals, request }) => {
	requireGranted(locals);
	const projectId = (await request.json().catch(() => null))?.projectId?.trim() ?? "";
	if (!projectId) throw error(400, "projectId required.");
	const r = await acceptPendingInvite(locals.supabase, projectId);
	if (!r.ok) throw error(500, r.error);
	return json({
		ok: true,
		accepted: r.accepted
	});
};
//#endregion
export { GET, POST };
