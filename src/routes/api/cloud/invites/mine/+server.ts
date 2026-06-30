/**
 * `/api/cloud/invites/mine` — invitee-side view of pending invites.
 *
 *   GET                          → invites where invited_email matches
 *                                  the caller's JWT email. Returned with
 *                                  project_name so the UI can show
 *                                  "Invited to: My Project" without an
 *                                  extra round-trip per row.
 *   POST { projectId }           → accept one invite. Promotes the
 *                                  pending row into a real membership
 *                                  via `cloud_accept_pending_invite`,
 *                                  returns `{ ok, accepted }`. Caller
 *                                  follows up with the existing
 *                                  `joinCloudProject` flow to materialize
 *                                  the project locally.
 */
import { error, json } from '@sveltejs/kit'
import {
  acceptPendingInvite,
  listPendingInvitesForCurrentUser,
} from '$lib/server/db/cloudRepo'
import type { RequestHandler } from './$types'

function requireGranted(locals: App.Locals) {
  if (!locals.user) throw error(401, 'Sign in required.')
  if (locals.accessStatus !== 'granted') throw error(403, 'Awaiting access approval.')
}

export const GET: RequestHandler = async ({ locals }) => {
  requireGranted(locals)
  const invites = await listPendingInvitesForCurrentUser(locals.supabase)
  return json({ ok: true, invites })
}

interface AcceptBody {
  projectId?: string
}

export const POST: RequestHandler = async ({ locals, request }) => {
  requireGranted(locals)
  const body = (await request.json().catch(() => null)) as AcceptBody | null
  const projectId = body?.projectId?.trim() ?? ''
  if (!projectId) throw error(400, 'projectId required.')
  const r = await acceptPendingInvite(locals.supabase, projectId)
  if (!r.ok) throw error(500, r.error)
  return json({ ok: true, accepted: r.accepted })
}
