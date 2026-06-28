import { d as listMemberProjects } from "../../../chunks/cloudRepo.js";
import { redirect } from "@sveltejs/kit";
//#region src/routes/account/+page.server.ts
/**
* `/account` server load — redirect signed-out visitors to `/login?next=/account`
* so they get bounced back here after sign-in.
*
* The signed-in user is already on `locals.user` from `hooks.server.ts`;
* we just gate access here.
*/
var load = async ({ locals }) => {
	if (!locals.user) throw redirect(303, "/login?next=/account");
	let cloudProjects = [];
	try {
		cloudProjects = await listMemberProjects(locals.supabase);
	} catch {}
	return {
		accountUser: {
			id: locals.user.id,
			email: locals.user.email ?? null,
			name: locals.user.user_metadata?.full_name ?? null,
			avatarUrl: locals.user.user_metadata?.avatar_url ?? null,
			createdAt: locals.user.created_at,
			provider: locals.user.app_metadata?.provider ?? "unknown"
		},
		cloudProjects: cloudProjects.map((p) => ({
			id: p.id,
			name: p.name,
			revision: p.revision,
			updatedAt: p.updated_at,
			isOwner: p.owner_user_id === locals.user.id
		}))
	};
};
//#endregion
export { load };
