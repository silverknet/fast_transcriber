/**
 * `/api/cloud/projects/:id/songs` — read the song roster.
 *
 *   GET ?since=<rev>   → all songs with row revision > since (delta sync)
 *   GET               → full snapshot (used by joinCloudProject)
 *
 * Push happens through `/songs/:songId` (PUT) — see the sibling route.
 */
import { error, json } from '@sveltejs/kit'
import { listCloudSongs } from '$lib/server/db/cloudRepo'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.user) throw error(401, 'Sign in required.')
  if (locals.accessStatus !== 'granted') throw error(403, 'Awaiting access approval.')
  const projectId = params.id
  if (!projectId) throw error(400, 'Missing project id.')
  const sinceRaw = url.searchParams.get('since')
  const sinceRevision = sinceRaw === null ? undefined : Number(sinceRaw)
  if (sinceRaw !== null && !Number.isFinite(sinceRevision)) {
    throw error(400, 'since must be a number.')
  }
  const songs = await listCloudSongs(locals.supabase, projectId, sinceRevision)
  return json({ ok: true, songs })
}
