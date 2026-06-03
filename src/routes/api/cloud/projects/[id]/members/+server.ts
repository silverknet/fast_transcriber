/**
 * `/api/cloud/projects/:id/members` — list + invite + remove.
 *
 *   GET                   → roster
 *   POST { email, role }  → owner-only; looks up user_id from auth.users
 *                           by email and inserts the membership row.
 *                           Fails closed: invitee must already have a
 *                           Supabase auth account. (The signup gate
 *                           from migration 009 means they ALSO need an
 *                           access grant to actually use anything.)
 *   DELETE ?userId=<uuid> → owner-only; cannot remove self if last owner.
 *
 * Membership writes go through the service-role client (`addMember` /
 * `removeMember`) because the user-facing `cloud_project_members` RLS
 * policies forbid the recursion-prone "owner inserts/removes" via the
 * normal client. Owner-check is performed in JS against the cloud
 * project's owner_user_id before delegating.
 */
import { error, json } from '@sveltejs/kit'
import { getSupabaseServiceClient } from '$lib/server/supabase/serverClient'
import {
  addMember,
  findUserIdByEmail,
  getCloudProject,
  listCloudMembers,
  removeMember,
} from '$lib/server/db/cloudRepo'
import type { RequestHandler } from './$types'

function requireGranted(locals: App.Locals) {
  if (!locals.user) throw error(401, 'Sign in required.')
  if (locals.accessStatus !== 'granted') throw error(403, 'Awaiting access approval.')
}

export const GET: RequestHandler = async ({ locals, params }) => {
  requireGranted(locals)
  const projectId = params.id
  if (!projectId) throw error(400, 'Missing project id.')
  const members = await listCloudMembers(locals.supabase, projectId)
  return json({ ok: true, members })
}

interface InviteBody {
  email?: string
  role?: 'owner' | 'editor'
}

async function requireProjectOwner(
  locals: App.Locals,
  projectId: string,
): Promise<void> {
  const proj = await getCloudProject(locals.supabase, projectId)
  if (!proj) throw error(404, 'Project not found.')
  if (proj.owner_user_id !== locals.user!.id) {
    throw error(403, 'Owner only.')
  }
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireGranted(locals)
  const projectId = params.id
  if (!projectId) throw error(400, 'Missing project id.')
  await requireProjectOwner(locals, projectId)

  const body = (await request.json().catch(() => null)) as InviteBody | null
  const email = body?.email?.trim().toLowerCase() ?? ''
  const role: 'owner' | 'editor' = body?.role === 'owner' ? 'owner' : 'editor'
  if (!email || !email.includes('@')) throw error(400, 'Valid email required.')

  const service = getSupabaseServiceClient()
  const userId = await findUserIdByEmail(service, email)
  if (!userId) {
    // Closed-fail: invitee hasn't signed up to Supabase yet. The plan
    // earmarks "magic-link invites for non-signups" as a Phase 8.5
    // follow-up.
    throw error(404, `No user found for ${email}. Have them sign in once first.`)
  }
  const r = await addMember(service, projectId, userId, role)
  if (!r.ok) throw error(500, r.error)
  return json({ ok: true, userId, role })
}

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  requireGranted(locals)
  const projectId = params.id
  if (!projectId) throw error(400, 'Missing project id.')
  await requireProjectOwner(locals, projectId)

  const userId = url.searchParams.get('userId')
  if (!userId) throw error(400, 'userId query param required.')

  const service = getSupabaseServiceClient()
  // Don't let the owner remove themselves — the cloud_projects row's
  // owner_user_id would still point at them but the membership row
  // would be gone, causing RLS confusion. Owner transfer is a future
  // feature.
  if (userId === locals.user!.id) {
    throw error(400, 'Owners cannot remove themselves. Transfer ownership first.')
  }
  const r = await removeMember(service, projectId, userId)
  if (!r.ok) throw error(500, r.error)
  return json({ ok: true })
}
