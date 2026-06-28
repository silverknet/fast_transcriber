import { redirect } from "@sveltejs/kit";
//#region src/routes/auth/callback/+server.ts
/**
* `/auth/callback` — completes both OAuth and magic-link sign-in.
*
* The PKCE flow lands here with `?code=<auth-code>`. We exchange the code
* for a session, which (via the `@supabase/ssr` cookie setters wired in
* [serverClient.ts](../../../lib/server/supabase/serverClient.ts)) writes
* the Supabase session cookies. Then we redirect to `?next=` (or `/`).
*
* On error (link expired, code already used, etc.) we send the user back
* to `/login` with a `?error=` so they see something useful.
*/
var GET = async ({ url, locals }) => {
	const code = url.searchParams.get("code");
	const next = url.searchParams.get("next") ?? "/";
	if (!locals.supabase) throw redirect(303, `/login?error=${encodeURIComponent("Auth not configured")}`);
	if (!code) throw redirect(303, `/login?error=${encodeURIComponent("Missing code")}`);
	const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
	if (error) throw redirect(303, `/login?error=${encodeURIComponent(error.message)}`);
	throw redirect(303, next);
};
//#endregion
export { GET };
