/**
 * Server-side helpers for the cloud collab tables. All reads go through
 * the per-request SSR Supabase client (so RLS auto-enforces access);
 * all writes that bump `cloud_projects.revision` go through the RPC
 * functions defined in migration 010 (so revision/content/log stay
 * atomic).
 *
 * The functions here are thin wrappers — most logic is in the SQL. They
 * exist so route handlers don't have to know table/column names or RPC
 * argument ordering.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Shape definitions (mirror the DB columns) ──────────────────────────

export interface CloudProjectRow {
  id: string
  owner_user_id: string
  name: string
  created_at: string
  updated_at: string
  revision: number
}

export interface CloudSongRow {
  id: string
  cloud_project_id: string
  song_map: unknown // collaborative SongMap shape; consumers cast
  expected_audio: unknown | null
  hidden: boolean
  sort_order: number
  updated_at: string
  updated_by: string | null
  revision: number
}

export interface CloudMemberRow {
  cloud_project_id: string
  user_id: string
  role: 'owner' | 'editor'
  added_at: string
}

// ── Reads ──────────────────────────────────────────────────────────────

export async function listMemberProjects(
  supa: SupabaseClient,
): Promise<CloudProjectRow[]> {
  const { data, error } = await supa
    .from('cloud_projects')
    .select('id,owner_user_id,name,created_at,updated_at,revision')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as CloudProjectRow[]
}

export async function getCloudProject(
  supa: SupabaseClient,
  projectId: string,
): Promise<CloudProjectRow | null> {
  const { data, error } = await supa
    .from('cloud_projects')
    .select('id,owner_user_id,name,created_at,updated_at,revision')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CloudProjectRow | null) ?? null
}

/**
 * Pull songs that have changed since `sinceRevision`. Omit for full
 * snapshot (used by joinCloudProject). RLS filters to member projects;
 * the .eq enforces single-project scope.
 */
export async function listCloudSongs(
  supa: SupabaseClient,
  projectId: string,
  sinceRevision?: number,
): Promise<CloudSongRow[]> {
  let q = supa
    .from('cloud_songs')
    .select('id,cloud_project_id,song_map,expected_audio,hidden,sort_order,updated_at,updated_by,revision')
    .eq('cloud_project_id', projectId)
    .order('sort_order', { ascending: true })
  if (typeof sinceRevision === 'number' && sinceRevision > 0) {
    q = q.gt('revision', sinceRevision)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as CloudSongRow[]
}

export async function listCloudMembers(
  supa: SupabaseClient,
  projectId: string,
): Promise<CloudMemberRow[]> {
  const { data, error } = await supa
    .from('cloud_project_members')
    .select('cloud_project_id,user_id,role,added_at')
    .eq('cloud_project_id', projectId)
    .order('added_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as CloudMemberRow[]
}

// ── Writes via RPC (atomic with revision bump + log) ───────────────────

export interface CreateCloudProjectArgs {
  projectId: string
  name: string
  songs: Array<{
    id: string
    song_map: unknown
    expected_audio?: unknown
    hidden?: boolean
    sort_order: number
  }>
}

export async function rpcCreateCloudProject(
  supa: SupabaseClient,
  args: CreateCloudProjectArgs,
): Promise<number> {
  const { data, error } = await supa.rpc('cloud_create_project', {
    p_project_id: args.projectId,
    p_name: args.name,
    p_songs: args.songs,
  })
  if (error) throw new Error(error.message)
  return typeof data === 'number' ? data : 0
}

export interface PushSongArgs {
  projectId: string
  songId: string
  songMap: unknown
  expectedAudio?: unknown
  sortOrder?: number
  hidden?: boolean
  clientBaseRevision: number
}

export type PushResult =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict: false; error: string }

export async function rpcPushSong(
  supa: SupabaseClient,
  args: PushSongArgs,
): Promise<PushResult> {
  const { data, error } = await supa.rpc('cloud_push_song', {
    p_project_id: args.projectId,
    p_song_id: args.songId,
    p_song_map: args.songMap,
    p_expected_audio: args.expectedAudio ?? null,
    p_sort_order: args.sortOrder ?? null,
    p_hidden: args.hidden ?? null,
    p_client_base_revision: args.clientBaseRevision,
  })
  if (error) {
    // PostgREST surfaces `code` as `error.code`. `P0001` is our conflict
    // signal raised inside the SQL function.
    const isConflict = error.code === 'P0001' || /conflict/i.test(error.message)
    return { ok: false, conflict: isConflict, error: error.message }
  }
  return { ok: true, revision: typeof data === 'number' ? data : 0 }
}

export interface PatchManifestArgs {
  projectId: string
  name?: string | null
  orderedSongIds?: string[] | null
  hiddenMap?: Record<string, boolean> | null
  clientBaseRevision: number
}

export async function rpcPatchManifest(
  supa: SupabaseClient,
  args: PatchManifestArgs,
): Promise<PushResult> {
  const { data, error } = await supa.rpc('cloud_patch_manifest', {
    p_project_id: args.projectId,
    p_name: args.name ?? null,
    p_ordered_song_ids: args.orderedSongIds ?? null,
    p_hidden_map: args.hiddenMap ?? null,
    p_client_base_revision: args.clientBaseRevision,
  })
  if (error) {
    const isConflict = error.code === 'P0001' || /conflict/i.test(error.message)
    return { ok: false, conflict: isConflict, error: error.message }
  }
  return { ok: true, revision: typeof data === 'number' ? data : 0 }
}

// ── Member management ──────────────────────────────────────────────────

/**
 * Look up a user by email via the auth admin API (service-role only).
 * Returns null when no such user exists. Used by member invites — if
 * the invitee hasn't signed up yet, the route surfaces a clear error
 * instead of inserting a dangling membership row.
 */
export async function findUserIdByEmail(
  service: SupabaseClient,
  email: string,
): Promise<string | null> {
  // Supabase doesn't expose a "get user by email" — listUsers with a
  // filter is the documented path. Reasonable for our scale (admin op,
  // low frequency). The admin namespace is typed on supabase-js >= 2.7,
  // which we're on, so no escape hatch is needed.
  const { data, error } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (error || !data) return null
  const wanted = email.toLowerCase().trim()
  const found = (data.users ?? []).find(
    (u: { email?: string | null }) => (u.email ?? '').toLowerCase() === wanted,
  )
  return found?.id ?? null
}

export async function addMember(
  service: SupabaseClient,
  projectId: string,
  userId: string,
  role: 'owner' | 'editor',
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Bypasses RLS — only the route handler (already gated by `is_owner`)
  // should call this.
  const { error } = await service
    .from('cloud_project_members')
    .upsert(
      { cloud_project_id: projectId, user_id: userId, role },
      { onConflict: 'cloud_project_id,user_id' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function removeMember(
  service: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await service
    .from('cloud_project_members')
    .delete()
    .eq('cloud_project_id', projectId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Owner-only cascade-delete. Drops the cloud_projects row; ON DELETE
 * CASCADE on cloud_songs / cloud_project_members / cloud_project_revisions
 * cleans up the rest. Goes through the user's SSR client so RLS enforces
 * the owner check via the existing `cloud_projects_owner_delete` policy.
 */
export async function deleteCloudProject(
  supa: SupabaseClient,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supa.from('cloud_projects').delete().eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Pending invites (migration 012) ────────────────────────────────────

export interface CloudPendingInviteRow {
  id: string
  cloud_project_id: string
  invited_email: string
  role: 'owner' | 'editor'
  invited_by: string | null
  created_at: string
}

/** Owner view of a project's pending invites. RLS gates by `is_project_owner`. */
export async function listPendingInvitesForProject(
  supa: SupabaseClient,
  projectId: string,
): Promise<CloudPendingInviteRow[]> {
  const { data, error } = await supa
    .from('cloud_pending_invites')
    .select('id,cloud_project_id,invited_email,role,invited_by,created_at')
    .eq('cloud_project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as CloudPendingInviteRow[]
}

/**
 * Pending invites visible to the current caller (matched by JWT email).
 * Returned shape includes the project name so the invitee can decide
 * whether to accept without an extra lookup per row.
 */
export async function listPendingInvitesForCurrentUser(
  supa: SupabaseClient,
): Promise<Array<CloudPendingInviteRow & { project_name: string }>> {
  // RLS limits rows to ones matching the caller's email. We can't join
  // through Supabase's auto-policy on cloud_projects (caller isn't a
  // member yet), so fetch invites first, then resolve names via a second
  // query that does a service-side lookup — but to stay RLS-only we
  // resolve names through a SECURITY DEFINER RPC. For now, lean on the
  // fact that a brand-new invitee can read the project NAME via a
  // dedicated SECURITY DEFINER function added below.
  const { data: invites, error: invErr } = await supa
    .from('cloud_pending_invites')
    .select('id,cloud_project_id,invited_email,role,invited_by,created_at')
    .order('created_at', { ascending: false })
  if (invErr) throw new Error(invErr.message)
  const rows = (invites ?? []) as CloudPendingInviteRow[]
  if (rows.length === 0) return []

  // Resolve names via the RPC `cloud_pending_invite_project_names` which
  // returns name for projects the caller has a pending invite to. This
  // sidesteps the membership-gated SELECT on cloud_projects.
  const { data: names, error: nameErr } = await supa.rpc(
    'cloud_pending_invite_project_names',
  )
  if (nameErr) throw new Error(nameErr.message)
  const nameById = new Map<string, string>(
    (names ?? []).map((r: { project_id: string; name: string }) => [r.project_id, r.name]),
  )
  return rows.map((r) => ({ ...r, project_name: nameById.get(r.cloud_project_id) ?? '' }))
}

/**
 * Create a pending invite. Idempotent on `(project, lower(email))` — a
 * duplicate insert just updates the role. Goes through service-role
 * because the owner-insert policy requires `invited_by = auth.uid()`
 * but we want the route to set the inviter explicitly.
 */
export async function createPendingInvite(
  service: SupabaseClient,
  projectId: string,
  email: string,
  role: 'owner' | 'editor',
  invitedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await service.from('cloud_pending_invites').upsert(
    {
      cloud_project_id: projectId,
      invited_email: email,
      role,
      invited_by: invitedBy,
    },
    { onConflict: 'cloud_project_id,invited_email' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deletePendingInvite(
  supa: SupabaseClient,
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supa.from('cloud_pending_invites').delete().eq('id', inviteId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Promote one pending invite (matched by project + caller email) into a
 * `cloud_project_members` row and delete the pending row. Returns true
 * if the invite existed and was consumed.
 */
export async function acceptPendingInvite(
  supa: SupabaseClient,
  projectId: string,
): Promise<{ ok: true; accepted: boolean } | { ok: false; error: string }> {
  const { data, error } = await supa.rpc('cloud_accept_pending_invite', {
    p_project_id: projectId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, accepted: Boolean(data) }
}

/**
 * Called from the access-gate after a fresh sign-in. Walks every pending
 * invite for the caller's email, inserts memberships, deletes the rows.
 * Idempotent — returns 0 when there's nothing to do.
 */
export async function consumePendingInvitesForCurrentUser(
  supa: SupabaseClient,
): Promise<number> {
  const { data, error } = await supa.rpc('cloud_consume_pending_invites_for_email')
  if (error) {
    // Don't blow up the access gate on a sync hiccup — log and continue.
    console.warn('[cloud] consume pending invites failed:', error.message)
    return 0
  }
  return typeof data === 'number' ? data : 0
}
