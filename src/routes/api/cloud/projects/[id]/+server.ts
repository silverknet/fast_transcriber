/**
 * `/api/cloud/projects/:id` — manifest get + patch.
 *
 *  - GET   → project meta + members. Songs come from `/songs?since=…`.
 *  - PATCH → rename / reorder / hide-flag updates. Single atomic call
 *            to `cloud_patch_manifest`. Returns the new revision or a
 *            409 conflict.
 */
import { error, json } from '@sveltejs/kit'
import {
  deleteCloudProject,
  getCloudProject,
  listCloudMembers,
  rpcPatchManifest,
  type PatchManifestArgs,
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
  const project = await getCloudProject(locals.supabase, projectId)
  if (!project) throw error(404, 'Project not found.')
  const members = await listCloudMembers(locals.supabase, projectId)
  return json({ ok: true, project, members })
}

interface PatchBody {
  name?: string | null
  orderedSongIds?: string[] | null
  hiddenMap?: Record<string, boolean> | null
  clientBaseRevision: number
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireGranted(locals)
  const projectId = params.id
  if (!projectId) throw error(400, 'Missing project id.')
  const body = (await request.json().catch(() => null)) as PatchBody | null
  if (!body || typeof body.clientBaseRevision !== 'number') {
    throw error(400, 'clientBaseRevision (number) is required.')
  }

  const args: PatchManifestArgs = {
    projectId,
    name: body.name ?? null,
    orderedSongIds: body.orderedSongIds ?? null,
    hiddenMap: body.hiddenMap ?? null,
    clientBaseRevision: body.clientBaseRevision,
  }
  const r = await rpcPatchManifest(locals.supabase, args)
  if (r.ok) return json({ ok: true, revision: r.revision })

  if (r.conflict) {
    // Pull the current authoritative project for the client to merge against.
    const remote = await getCloudProject(locals.supabase, projectId)
    return json(
      { ok: false, conflict: true, remote, error: r.error },
      { status: 409 },
    )
  }
  throw error(500, r.error)
}

/**
 * DELETE — owner-only cascade. Drops cloud_projects + everything
 * referencing it. Local manifest cleanup (clearing the `cloud` block) is
 * the client's job after the 200.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireGranted(locals)
  const projectId = params.id
  if (!projectId) throw error(400, 'Missing project id.')
  const r = await deleteCloudProject(locals.supabase, projectId)
  if (!r.ok) throw error(500, r.error)
  return json({ ok: true })
}
