import { r as public_env } from "../chunks/shared-server.js";
import { t as createSupabaseServerClient } from "../chunks/serverClient.js";
import { i as loadAccessForUser, t as consumePendingInvitesIfGranted } from "../chunks/access.js";
//#region src/hooks.server.ts
/**
* Per-request hook that wires Supabase into every server-side handler.
*
* Responsibilities:
*  1. Instantiate a request-scoped Supabase client bound to this request's
*     cookie jar (see [src/lib/server/supabase/serverClient.ts](./lib/server/supabase/serverClient.ts)).
*  2. Resolve the current session via `getUser()` (not `getSession()` — the
*     latter trusts the cookie blindly; `getUser()` re-validates with the
*     Supabase auth server, which is what we want for any server-side
*     authorization decision).
*  3. Attach `supabase`, `session`, `user` to `event.locals` so any
*     `+page.server.ts` or any `/api/.../+server.ts` can use them.
*
* The `filterSerializedResponseHeaders` line is mandatory per
* `@supabase/ssr` docs — without it the auth helper's internal `Range`
* header probing can break SvelteKit's response serialization.
*/
var handle = async ({ event, resolve }) => {
	if (!public_env.PUBLIC_SUPABASE_URL || !public_env.PUBLIC_SUPABASE_ANON_KEY) {
		event.locals.supabase = null;
		event.locals.session = null;
		event.locals.user = null;
		event.locals.accessStatus = "none";
		event.locals.isAdmin = false;
		return resolve(event, { filterSerializedResponseHeaders: (name) => name === "content-range" });
	}
	event.locals.supabase = createSupabaseServerClient(event.cookies);
	const { data: { user }, error } = await event.locals.supabase.auth.getUser();
	if (error || !user) {
		event.locals.user = null;
		event.locals.session = null;
		event.locals.accessStatus = "none";
		event.locals.isAdmin = false;
	} else {
		event.locals.user = user;
		const { data: { session } } = await event.locals.supabase.auth.getSession();
		event.locals.session = session;
		try {
			const access = await loadAccessForUser(user);
			event.locals.accessStatus = access.status;
			event.locals.isAdmin = access.isAdmin;
			consumePendingInvitesIfGranted(event.locals.supabase, access.status).catch((e) => {
				console.warn("[cloud] consumePendingInvitesIfGranted failed:", e);
			});
		} catch (e) {
			console.warn("[access] loadAccessForUser failed:", e);
			event.locals.accessStatus = "none";
			event.locals.isAdmin = false;
		}
	}
	return resolve(event, { filterSerializedResponseHeaders: (name) => name === "content-range" });
};
//#endregion
export { handle };
