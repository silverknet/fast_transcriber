import { json } from '@sveltejs/kit'
import { parseSongMapJsonString } from '$lib/songmap/persist'
import { parseFingerprintHeaderOrQuery } from '$lib/server/db/fingerprintHttp'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import { listProjects, createProject } from '$lib/server/db/projectRepo'

export async function GET({ request, url }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured' }, { status: 503 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(
    request.headers.get('x-barbro-fingerprint'),
    url.searchParams.get('fingerprint'),
  )
  if (!fingerprint) {
    return json({ ok: false, error: 'Missing or invalid fingerprint' }, { status: 400 })
  }

  const projects = await listProjects(fingerprint)
  return json({ ok: true, projects })
}

export async function POST({ request }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured' }, { status: 503 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(
    request.headers.get('x-barbro-fingerprint'),
    null,
  )
  if (!fingerprint) {
    return json({ ok: false, error: 'Missing or invalid X-BarBro-Fingerprint header' }, { status: 400 })
  }

  // SongMap + name only; the server never accepts audio uploads anymore.
  let body: { name?: string; songMapJson?: string }
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Expected JSON body' }, { status: 400 })
  }

  const name = (body.name ?? '').trim() || 'Untitled Project'
  const songMapJson = body.songMapJson
  if (typeof songMapJson !== 'string') {
    return json({ ok: false, error: 'songMapJson field required' }, { status: 400 })
  }

  const parsed = parseSongMapJsonString(songMapJson)
  if (!parsed.ok) {
    return json({ ok: false, error: parsed.error }, { status: 400 })
  }

  const id = await createProject(fingerprint, name, songMapJson)
  if (!id) {
    return json({ ok: false, error: 'Failed to create project' }, { status: 500 })
  }

  return json({ ok: true, id, updatedAt: new Date().toISOString() }, { status: 201 })
}
