/**
 * `/api/cloud/projects/:id/songs/:songId` — per-song push.
 *
 *   PUT body { songMap, expectedAudio?, sortOrder?, hidden?, clientBaseRevision }
 *
 * Returns `{ ok: true, revision }` on success or `{ ok: false, conflict: true, remote }`
 * (409) when the row has moved past `clientBaseRevision`. The client
 * then runs the Phase 8 merge to decide how to proceed.
 */
import { error, json } from '@sveltejs/kit'
import { listCloudSongs, rpcPushSong, type PushSongArgs } from '$lib/server/db/cloudRepo'
import type { RequestHandler } from './$types'

interface PushBody {
  songMap: unknown
  expectedAudio?: unknown
  sortOrder?: number
  hidden?: boolean
  clientBaseRevision: number
}

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) throw error(401, 'Sign in required.')
  if (locals.accessStatus !== 'granted') throw error(403, 'Awaiting access approval.')
  const projectId = params.id
  const songId = params.songId
  if (!projectId || !songId) throw error(400, 'Missing project / song id.')

  const body = (await request.json().catch(() => null)) as PushBody | null
  if (!body || typeof body.clientBaseRevision !== 'number' || body.songMap === undefined) {
    throw error(400, 'songMap + clientBaseRevision are required.')
  }

  const args: PushSongArgs = {
    projectId,
    songId,
    songMap: body.songMap,
    expectedAudio: body.expectedAudio,
    sortOrder: body.sortOrder,
    hidden: body.hidden,
    clientBaseRevision: body.clientBaseRevision,
  }

  const r = await rpcPushSong(locals.supabase, args)
  if (r.ok) return json({ ok: true, revision: r.revision })

  if (r.conflict) {
    // Fetch just the conflicting song so the client can diff. Cheap —
    // RLS already vouched for membership in the push call.
    const songs = await listCloudSongs(locals.supabase, projectId)
    const remote = songs.find((s) => s.id === songId) ?? null
    return json(
      { ok: false, conflict: true, remote, error: r.error },
      { status: 409 },
    )
  }
  throw error(500, r.error)
}
