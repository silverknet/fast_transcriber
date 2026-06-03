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
