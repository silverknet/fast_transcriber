import { n as getSupabaseServiceClient } from "../../../../chunks/serverClient.js";
import { r as isAdminUser } from "../../../../chunks/access.js";
import { fail } from "@sveltejs/kit";
//#region src/routes/admin/access/+page.server.ts
/**
* `/admin/access` — admin-only invite + access management.
*
* Loads every access_grants row via the service-role client (bypasses
* RLS — admin needs to see all rows). Provides three form actions:
*
*   - `invite`  : pre-approve an email (status='granted', user_id=null).
*                 When that user signs in for the first time, the access
*                 helper links their user_id automatically.
*   - `approve` : flip a 'pending' or 'denied' row to 'granted'.
*   - `deny`    : flip to 'denied'. Sign-in still works for them but
*                 the gate redirects to /pending which then shows the
*                 denied copy.
*
* The layout guard already blocked non-admins from reaching this route,
* so we don't need to re-check here. We DO re-check in actions
* defensively (defense in depth — never trust route guards alone for
* mutating endpoints).
*/
var load = async ({ locals }) => {
	if (!locals.isAdmin) return {
		rows: [],
		error: null
	};
	const supa = getSupabaseServiceClient();
	const { data, error } = await supa.from("access_grants").select("id,email,user_id,status,requested_at,decided_at,decided_by,note").order("status", { ascending: true }).order("requested_at", { ascending: false });
	if (error) return {
		rows: [],
		error: error.message
	};
	const rows = (data ?? []).map((row) => ({
		...row,
		key: `grant:${row.id}`,
		source: "grant"
	}));
	const byEmail = new Set(rows.map((row) => row.email.toLowerCase()));
	const byUserId = new Set(rows.map((row) => row.user_id).filter(Boolean));
	let page = 1;
	let authError = null;
	while (true) {
		const { data: authData, error: listError } = await supa.auth.admin.listUsers({
			page,
			perPage: 1e3
		});
		if (listError) {
			authError = listError.message;
			break;
		}
		const users = authData.users ?? [];
		for (const user of users) {
			if (isAdminUser(user)) continue;
			const email = user.email?.toLowerCase().trim();
			if (!email) continue;
			if (byUserId.has(user.id) || byEmail.has(email)) continue;
			rows.push({
				id: null,
				key: `auth:${user.id}`,
				email,
				user_id: user.id,
				status: "pending",
				requested_at: user.created_at,
				decided_at: null,
				decided_by: null,
				note: "Signed up in Supabase Auth; no access row yet.",
				source: "auth"
			});
			byEmail.add(email);
			byUserId.add(user.id);
		}
		if (users.length < 1e3) break;
		page += 1;
	}
	const statusRank = {
		pending: 0,
		granted: 1,
		denied: 2
	};
	rows.sort((a, b) => {
		const byStatus = statusRank[a.status] - statusRank[b.status];
		if (byStatus !== 0) return byStatus;
		return Date.parse(b.requested_at) - Date.parse(a.requested_at);
	});
	return {
		rows,
		error: authError
	};
};
function guardAdmin(locals) {
	if (!locals.isAdmin || !locals.user) throw fail(403, { error: "Admins only." });
}
var actions = {
	invite: async ({ request, locals }) => {
		guardAdmin(locals);
		const form = await request.formData();
		const email = String(form.get("email") ?? "").trim().toLowerCase();
		const note = String(form.get("note") ?? "").trim() || null;
		if (!email || !email.includes("@")) return fail(400, { error: "Valid email required." });
		const { error } = await getSupabaseServiceClient().from("access_grants").upsert({
			email,
			status: "granted",
			decided_by: locals.user.id,
			decided_at: (/* @__PURE__ */ new Date()).toISOString(),
			note
		}, { onConflict: "email" });
		if (error) return fail(500, { error: error.message });
		return {
			ok: true,
			action: "invite",
			email
		};
	},
	approve: async ({ request, locals }) => {
		guardAdmin(locals);
		const form = await request.formData();
		const id = String(form.get("id") ?? "").trim();
		const email = String(form.get("email") ?? "").trim().toLowerCase();
		const userId = String(form.get("user_id") ?? "").trim() || null;
		if (!id && !email) return fail(400, { error: "Missing user." });
		const supa = getSupabaseServiceClient();
		const decision = {
			status: "granted",
			decided_by: locals.user.id,
			decided_at: (/* @__PURE__ */ new Date()).toISOString()
		};
		const { error } = id ? await supa.from("access_grants").update(decision).eq("id", id) : await supa.from("access_grants").upsert({
			email,
			user_id: userId,
			...decision
		}, { onConflict: "email" });
		if (error) return fail(500, { error: error.message });
		return {
			ok: true,
			action: "approve",
			id,
			email
		};
	},
	deny: async ({ request, locals }) => {
		guardAdmin(locals);
		const form = await request.formData();
		const id = String(form.get("id") ?? "").trim();
		const email = String(form.get("email") ?? "").trim().toLowerCase();
		const userId = String(form.get("user_id") ?? "").trim() || null;
		if (!id && !email) return fail(400, { error: "Missing user." });
		const supa = getSupabaseServiceClient();
		const decision = {
			status: "denied",
			decided_by: locals.user.id,
			decided_at: (/* @__PURE__ */ new Date()).toISOString()
		};
		const { error } = id ? await supa.from("access_grants").update(decision).eq("id", id) : await supa.from("access_grants").upsert({
			email,
			user_id: userId,
			...decision
		}, { onConflict: "email" });
		if (error) return fail(500, { error: error.message });
		return {
			ok: true,
			action: "deny",
			id,
			email
		};
	}
};
//#endregion
export { actions, load };
