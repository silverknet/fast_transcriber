import { redirect } from "@sveltejs/kit";
//#region src/routes/logout/+server.ts
/**
* `/logout` — sign-out endpoint. POST-only (browsers don't pre-fetch POST).
* Clears the Supabase session cookies via `signOut()` and redirects home.
*/
var POST = async ({ locals }) => {
	if (locals.supabase) await locals.supabase.auth.signOut();
	throw redirect(303, "/");
};
//#endregion
export { POST };
