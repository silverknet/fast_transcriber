//#region src/lib/server/db/cloudRepo.ts
async function listMemberProjects(supa) {
	const { data, error } = await supa.from("cloud_projects").select("id,owner_user_id,name,created_at,updated_at,revision").order("updated_at", { ascending: false });
	if (error) throw new Error(error.message);
	return data ?? [];
}
async function getCloudProject(supa, projectId) {
	const { data, error } = await supa.from("cloud_projects").select("id,owner_user_id,name,created_at,updated_at,revision").eq("id", projectId).maybeSingle();
	if (error) throw new Error(error.message);
	return data ?? null;
}
/**
* Pull songs that have changed since `sinceRevision`. Omit for full
* snapshot (used by joinCloudProject). RLS filters to member projects;
* the .eq enforces single-project scope.
*/
async function listCloudSongs(supa, projectId, sinceRevision) {
	let q = supa.from("cloud_songs").select("id,cloud_project_id,song_map,expected_audio,hidden,sort_order,updated_at,updated_by,revision").eq("cloud_project_id", projectId).order("sort_order", { ascending: true });
	if (typeof sinceRevision === "number" && sinceRevision > 0) q = q.gt("revision", sinceRevision);
	const { data, error } = await q;
	if (error) throw new Error(error.message);
	return data ?? [];
}
async function listCloudMembers(supa, projectId) {
	const { data, error } = await supa.from("cloud_project_members").select("cloud_project_id,user_id,role,added_at").eq("cloud_project_id", projectId).order("added_at", { ascending: true });
	if (error) throw new Error(error.message);
	return data ?? [];
}
async function rpcCreateCloudProject(supa, args) {
	const { data, error } = await supa.rpc("cloud_create_project", {
		p_project_id: args.projectId,
		p_name: args.name,
		p_songs: args.songs
	});
	if (error) throw new Error(error.message);
	return typeof data === "number" ? data : 0;
}
async function rpcPushSong(supa, args) {
	const { data, error } = await supa.rpc("cloud_push_song", {
		p_project_id: args.projectId,
		p_song_id: args.songId,
		p_song_map: args.songMap,
		p_expected_audio: args.expectedAudio ?? null,
		p_sort_order: args.sortOrder ?? null,
		p_hidden: args.hidden ?? null,
		p_client_base_revision: args.clientBaseRevision
	});
	if (error) return {
		ok: false,
		conflict: error.code === "P0001" || /conflict/i.test(error.message),
		error: error.message
	};
	return {
		ok: true,
		revision: typeof data === "number" ? data : 0
	};
}
async function rpcPatchManifest(supa, args) {
	const { data, error } = await supa.rpc("cloud_patch_manifest", {
		p_project_id: args.projectId,
		p_name: args.name ?? null,
		p_ordered_song_ids: args.orderedSongIds ?? null,
		p_hidden_map: args.hiddenMap ?? null,
		p_client_base_revision: args.clientBaseRevision
	});
	if (error) return {
		ok: false,
		conflict: error.code === "P0001" || /conflict/i.test(error.message),
		error: error.message
	};
	return {
		ok: true,
		revision: typeof data === "number" ? data : 0
	};
}
/**
* Look up a user by email via the auth admin API (service-role only).
* Returns null when no such user exists. Used by member invites — if
* the invitee hasn't signed up yet, the route surfaces a clear error
* instead of inserting a dangling membership row.
*/
async function findUserIdByEmail(service, email) {
	const { data, error } = await service.auth.admin.listUsers({
		page: 1,
		perPage: 200
	});
	if (error || !data) return null;
	const wanted = email.toLowerCase().trim();
	return (data.users ?? []).find((u) => (u.email ?? "").toLowerCase() === wanted)?.id ?? null;
}
async function addMember(service, projectId, userId, role) {
	const { error } = await service.from("cloud_project_members").upsert({
		cloud_project_id: projectId,
		user_id: userId,
		role
	}, { onConflict: "cloud_project_id,user_id" });
	if (error) return {
		ok: false,
		error: error.message
	};
	return { ok: true };
}
async function removeMember(service, projectId, userId) {
	const { error } = await service.from("cloud_project_members").delete().eq("cloud_project_id", projectId).eq("user_id", userId);
	if (error) return {
		ok: false,
		error: error.message
	};
	return { ok: true };
}
/**
* Owner-only cascade-delete. Drops the cloud_projects row; ON DELETE
* CASCADE on cloud_songs / cloud_project_members / cloud_project_revisions
* cleans up the rest. Goes through the user's SSR client so RLS enforces
* the owner check via the existing `cloud_projects_owner_delete` policy.
*/
async function deleteCloudProject(supa, projectId) {
	const { error } = await supa.from("cloud_projects").delete().eq("id", projectId);
	if (error) return {
		ok: false,
		error: error.message
	};
	return { ok: true };
}
/** Owner view of a project's pending invites. RLS gates by `is_project_owner`. */
async function listPendingInvitesForProject(supa, projectId) {
	const { data, error } = await supa.from("cloud_pending_invites").select("id,cloud_project_id,invited_email,role,invited_by,created_at").eq("cloud_project_id", projectId).order("created_at", { ascending: true });
	if (error) throw new Error(error.message);
	return data ?? [];
}
/**
* Pending invites visible to the current caller (matched by JWT email).
* Returned shape includes the project name so the invitee can decide
* whether to accept without an extra lookup per row.
*/
async function listPendingInvitesForCurrentUser(supa) {
	const { data: invites, error: invErr } = await supa.from("cloud_pending_invites").select("id,cloud_project_id,invited_email,role,invited_by,created_at").order("created_at", { ascending: false });
	if (invErr) throw new Error(invErr.message);
	const rows = invites ?? [];
	if (rows.length === 0) return [];
	const { data: names, error: nameErr } = await supa.rpc("cloud_pending_invite_project_names");
	if (nameErr) throw new Error(nameErr.message);
	const nameById = new Map((names ?? []).map((r) => [r.project_id, r.name]));
	return rows.map((r) => ({
		...r,
		project_name: nameById.get(r.cloud_project_id) ?? ""
	}));
}
/**
* Create a pending invite. Idempotent on `(project, lower(email))` — a
* duplicate insert just updates the role. Goes through service-role
* because the owner-insert policy requires `invited_by = auth.uid()`
* but we want the route to set the inviter explicitly.
*/
async function createPendingInvite(service, projectId, email, role, invitedBy) {
	const { error } = await service.from("cloud_pending_invites").upsert({
		cloud_project_id: projectId,
		invited_email: email,
		role,
		invited_by: invitedBy
	}, { onConflict: "cloud_project_id,invited_email" });
	if (error) return {
		ok: false,
		error: error.message
	};
	return { ok: true };
}
async function deletePendingInvite(supa, inviteId) {
	const { error } = await supa.from("cloud_pending_invites").delete().eq("id", inviteId);
	if (error) return {
		ok: false,
		error: error.message
	};
	return { ok: true };
}
/**
* Promote one pending invite (matched by project + caller email) into a
* `cloud_project_members` row and delete the pending row. Returns true
* if the invite existed and was consumed.
*/
async function acceptPendingInvite(supa, projectId) {
	const { data, error } = await supa.rpc("cloud_accept_pending_invite", { p_project_id: projectId });
	if (error) return {
		ok: false,
		error: error.message
	};
	return {
		ok: true,
		accepted: Boolean(data)
	};
}
/**
* Called from the access-gate after a fresh sign-in. Walks every pending
* invite for the caller's email, inserts memberships, deletes the rows.
* Idempotent — returns 0 when there's nothing to do.
*/
async function consumePendingInvitesForCurrentUser(supa) {
	const { data, error } = await supa.rpc("cloud_consume_pending_invites_for_email");
	if (error) {
		console.warn("[cloud] consume pending invites failed:", error.message);
		return 0;
	}
	return typeof data === "number" ? data : 0;
}
//#endregion
export { rpcPushSong as _, deleteCloudProject as a, getCloudProject as c, listMemberProjects as d, listPendingInvitesForCurrentUser as f, rpcPatchManifest as g, rpcCreateCloudProject as h, createPendingInvite as i, listCloudMembers as l, removeMember as m, addMember as n, deletePendingInvite as o, listPendingInvitesForProject as p, consumePendingInvitesForCurrentUser as r, findUserIdByEmail as s, acceptPendingInvite as t, listCloudSongs as u };
