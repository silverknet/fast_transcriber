import { n as private_env } from "./shared-server.js";
import { r as consumePendingInvitesForCurrentUser } from "./cloudRepo.js";
import { n as getSupabaseServiceClient } from "./serverClient.js";
//#region src/lib/server/access.ts
/**
* Server-side helpers for the invite-only access gate.
*
* Resolves the current user's access status (granted / pending / denied)
* and decides whether a route is allowed for that status. Admin
* identification is env-driven (`ADMIN_USER_IDS` comma-separated UUIDs)
* so we don't need an admin role table — keeps schema simple while we
* have one or two admins.
*
* The auto-create-pending path runs through the **service-role client**
* (`getSupabaseServiceClient`) because the access_grants table doesn't
* grant INSERT to ordinary users — only admins write to it. From the
* user's perspective, walking up to a gated route for the first time
* triggers a row creation as a side effect, then a redirect to /pending.
*/
var ADMIN_USER_IDS = new Set((private_env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
function isAdminUser(user) {
	if (!user) return false;
	return ADMIN_USER_IDS.has(user.id);
}
/**
* Look up (and, if needed, create) the access_grants row for this user.
*
*  1. Try by user_id (most rows after first link).
*  2. Fall back to email match — covers admin pre-invites where the row
*     exists with `user_id = null`. If we find one, **link** the user_id
*     atomically on the way out.
*  3. If still nothing → insert a fresh pending row. Returns 'pending'.
*
* Uses the service-role client throughout so RLS doesn't block the
* lookup/upsert (the user can SELECT their own row, but can't INSERT or
* UPDATE — that's admin/service work).
*/
async function loadAccessForUser(user) {
	if (isAdminUser(user)) return {
		status: "granted",
		isAdmin: true
	};
	const supa = getSupabaseServiceClient();
	const email = user.email?.toLowerCase().trim() ?? null;
	const byId = await supa.from("access_grants").select("status,email,user_id").eq("user_id", user.id).maybeSingle();
	if (byId.data) return {
		status: byId.data.status,
		isAdmin: false
	};
	if (email) {
		const byEmail = await supa.from("access_grants").select("status,email,user_id").eq("email", email).maybeSingle();
		if (byEmail.data) {
			if (!byEmail.data.user_id) await supa.from("access_grants").update({ user_id: user.id }).eq("email", email);
			return {
				status: byEmail.data.status,
				isAdmin: false
			};
		}
	}
	if (email) {
		await supa.from("access_grants").upsert({
			email,
			user_id: user.id,
			status: "pending"
		}, { onConflict: "email" });
		return {
			status: "pending",
			isAdmin: false
		};
	}
	return {
		status: "none",
		isAdmin: false
	};
}
/**
* Public routes — anyone, signed in or not, can reach these. Used by the
* layout-level route gate to decide whether to redirect.
*
* Anything not in this list AND not in `pendingAllowedRoutes` is
* "members only" — requires `status === 'granted'`.
*/
var PUBLIC_ROUTE_IDS = new Set([
	"/welcome",
	"/login",
	"/logout",
	"/auth/callback",
	"/download"
]);
/** Allowed for signed-in users whose access is `pending` or `denied`. */
var PENDING_OR_DENIED_ROUTE_IDS = new Set(["/pending", "/account"]);
/**
* After a user's access flips to `granted` (or is granted on first
* sign-in), drain any pending cloud-project invites that were addressed
* to their email. This is cheap (one RPC, usually returns 0) and runs
* per request — keep it idempotent. Errors are swallowed; the
* invitee can also accept invites manually from the no-project landing.
*
* Must be called with the per-request SSR client (auth.uid() needs to
* resolve to the signed-in user inside the RPC).
*/
async function consumePendingInvitesIfGranted(supa, status) {
	if (status !== "granted") return;
	await consumePendingInvitesForCurrentUser(supa);
}
/**
* Decide whether `routeId` is reachable given the caller's auth + access
* state. Returns either `{ allow: true }` or a redirect target.
*
*  - Signed out → only public routes allowed → else /welcome.
*  - Signed in + granted → all routes allowed.
*  - Signed in + pending/denied/none → public + pending allowed → else /pending.
*  - Admin → always granted (loadAccessForUser sets that), so the granted
*    branch covers them.
*/
function decideRouteAccess(routeId, signedIn, status) {
	const id = routeId ?? "";
	if (!signedIn) {
		if (PUBLIC_ROUTE_IDS.has(id)) return { allow: true };
		return {
			allow: false,
			redirectTo: "/welcome"
		};
	}
	if (status === "granted") return { allow: true };
	if (PUBLIC_ROUTE_IDS.has(id) || PENDING_OR_DENIED_ROUTE_IDS.has(id)) return { allow: true };
	return {
		allow: false,
		redirectTo: "/pending"
	};
}
//#endregion
export { loadAccessForUser as i, decideRouteAccess as n, isAdminUser as r, consumePendingInvitesIfGranted as t };
