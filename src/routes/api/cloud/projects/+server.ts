/**
 * `/api/cloud/projects` — list (GET) + create (POST).
 *
 * All cloud endpoints require a granted user (RLS would block anyway,
 * but we surface a clean 401/403 instead of a confusing empty result).
 * Access gate is enforced by `hooks.server.ts` + `decideRouteAccess`;
 * here we just check `event.locals.user` and `event.locals.accessStatus`.
 */
import { error, json } from '@sveltejs/kit'
import {
  getCloudProject,
  listMemberProjects,
  rpcCreateCloudProject,
  type CreateCloudProjectArgs,
} from '$lib/server/db/cloudRepo'
import type { RequestHandler } from './$types'

function requireGranted(locals: App.Locals) {
  if (!locals.user) throw error(401, 'Sign in required.')
  if (locals.accessStatus !== 'granted') throw error(403, 'Awaiting access approval.')
}

export const GET: RequestHandler = async ({ locals }) => {
  requireGranted(locals)
  const rows = await listMemberProjects(locals.supabase)
  return json({ ok: true, projects: rows })
}

interface CreateBody {
  projectId?: string
  name?: string
  songs?: Array<{
    id: string
    songMap: unknown
    expectedAudio?: unknown
    hidden?: boolean
    sortOrder: number
  }>
}

export const POST: RequestHandler = async ({ locals, request }) => {
  requireGranted(locals)
  const body = (await request.json().catch(() => null)) as CreateBody | null
  if (!body?.projectId || !body.name) {
    throw error(400, 'projectId and name are required.')
  }
  if (!Array.isArray(body.songs)) {
    throw error(400, 'songs[] is required (may be empty).')
  }

  const args: CreateCloudProjectArgs = {
    projectId: body.projectId,
    name: body.name,
    // Map camelCase → snake_case at the boundary so the RPC signature
    // stays Postgres-idiomatic.
    songs: body.songs.map((s) => ({
      id: s.id,
      song_map: s.songMap,
      expected_audio: s.expectedAudio ?? null,
      hidden: s.hidden ?? false,
      sort_order: s.sortOrder,
    })),
  }

  try {
    const revision = await rpcCreateCloudProject(locals.supabase, args)
    return json({ ok: true, cloudProjectId: args.projectId, revision })
  } catch (e) {
    // Duplicate id can mean this local project was already enabled, but a
    // manifest round-trip stripped its `cloud` block. If the caller can see
    // that project through RLS, let the client re-adopt the existing cloud row.
    const msg = e instanceof Error ? e.message : String(e)
    if (/duplicate|unique/i.test(msg)) {
      const existing = await getCloudProject(locals.supabase, args.projectId)
      if (existing) {
        return json({
          ok: true,
          cloudProjectId: existing.id,
          revision: existing.revision,
          adopted: true,
        })
      }
      throw error(409, `Project id already in use: ${msg}`)
    }
    throw error(500, msg)
  }
}
