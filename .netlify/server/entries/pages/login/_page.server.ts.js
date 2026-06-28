import { fail } from "@sveltejs/kit";
//#region src/routes/login/+page.server.ts
/**
* `/login` server actions.
*
*  - `magic`  : email-only sign-in via `signInWithOtp` (Supabase emails a
*               magic link to the user; clicking it lands on `/auth/callback`).
*  - `google` : returns the Google OAuth URL the client redirects to;
*               we don't do the redirect server-side because the desktop
*               app needs the client to know which window the redirect
*               should happen in (system browser vs in-window).
*
* Both actions resolve `redirectTo` from the `Origin`/`X-Forwarded-Host`
* so the same code works for localhost dev, prod web, and the desktop
* shell pointing at prod.
*/
function callbackUrl(origin) {
	return `${origin}/auth/callback`;
}
var load = async ({ locals, url }) => {
	return {
		isSignedIn: !!locals.user,
		next: url.searchParams.get("next") ?? "/"
	};
};
var actions = {
	magic: async ({ request, locals, url }) => {
		if (!locals.supabase) return fail(503, { error: "Auth is not configured on this server." });
		const form = await request.formData();
		const email = String(form.get("email") ?? "").trim();
		if (!email) return fail(400, {
			error: "Email required.",
			email
		});
		const { error } = await locals.supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo: callbackUrl(url.origin) }
		});
		if (error) return fail(400, {
			error: error.message,
			email
		});
		return {
			magicSent: true,
			email
		};
	},
	google: async ({ locals, url }) => {
		if (!locals.supabase) return fail(503, { error: "Auth is not configured on this server." });
		const { data, error } = await locals.supabase.auth.signInWithOAuth({
			provider: "google",
			options: {
				redirectTo: callbackUrl(url.origin),
				queryParams: {
					access_type: "offline",
					prompt: "consent"
				}
			}
		});
		if (error || !data?.url) return fail(400, { error: error?.message ?? "OAuth init failed" });
		return { googleUrl: data.url };
	}
};
//#endregion
export { actions, load };
