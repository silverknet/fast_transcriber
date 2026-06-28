import { n as decideRouteAccess } from "../../chunks/access.js";
import { redirect } from "@sveltejs/kit";
//#region src/routes/+layout.server.ts
/**
* Root layout load.
*
*  1. Resolve the route-level access gate (invite-only). Signed-out
*     visitors get bounced to /welcome on any protected route; signed-in
*     but-not-yet-granted users get bounced to /pending. The decision
*     table lives in `src/lib/server/access.ts:decideRouteAccess`.
*
*  2. Expose the projected user shape to every page (also `accessStatus`
*     and `isAdmin` so the UI can render chips / hide admin entries).
*
* Auth and access are read from `event.locals.{user,accessStatus,isAdmin}`,
* which `hooks.server.ts` populated. No DB round-trip in here.
*/
var load = async ({ locals, route, url }) => {
	const gate = decideRouteAccess(route.id, !!locals.user, locals.accessStatus);
	if (!gate.allow && url.pathname !== gate.redirectTo) throw redirect(303, gate.redirectTo);
	if (route.id?.startsWith("/admin") && !locals.isAdmin) throw redirect(303, locals.user ? "/pending" : "/welcome");
	const u = locals.user;
	return {
		user: u ? {
			id: u.id,
			email: u.email ?? null,
			name: u.user_metadata?.full_name ?? null,
			avatarUrl: u.user_metadata?.avatar_url ?? null
		} : null,
		accessStatus: locals.accessStatus,
		isAdmin: locals.isAdmin
	};
};
//#endregion
export { load };
