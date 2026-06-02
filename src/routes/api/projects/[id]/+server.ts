import { json } from '@sveltejs/kit'
import { parseSongMapJsonString } from '$lib/songmap/persist'
import { parseFingerprintHeaderOrQuery } from '$lib/server/db/fingerprintHttp'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import {
  isValidProjectId,
  loadProject,
  updateProject,
  deleteProject,
} from '$lib/server/db/projectRepo'

export async function GET({ params, url, request }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured' }, { status: 503 })
  }

  const id = params.id ?? ''
  if (!isValidProjectId(id)) {
    return json({ ok: false, error: 'Invalid project id' }, { status: 400 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(
    request.headers.get('x-barbro-fingerprint'),
    url.searchParams.get('fingerprint'),
  )
  if (!fingerprint) {
    return json({ ok: false, error: 'Missing or invalid fingerprint' }, { status: 400 })
  }

  const row = await loadProject(id, fingerprint)
  if (!row) {
    return json({ ok: false, error: 'Project not found' }, { status: 404 })
  }

  return json({
    ok: true,
    id: row.id,
    name: row.name,
    songMap: row.songMapJson,
    updatedAt: row.updatedAt,
  })
}

export async function PUT({ params, request }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured' }, { status: 503 })
  }

  const id = params.id ?? ''
  if (!isValidProjectId(id)) {
    return json({ ok: false, error: 'Invalid project id' }, { status: 400 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(
    request.headers.get('x-barbro-fingerprint'),
    null,
  )
  if (!fingerprint) {
    return json({ ok: false, error: 'Missing or invalid X-BarBro-Fingerprint header' }, { status: 400 })
  }

  // SongMap JSON only — audio is never stored server-side.
  let body: { songMapJson?: string }
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Expected JSON body' }, { status: 400 })
  }

  const songMapJson = body.songMapJson
  if (typeof songMapJson !== 'string') {
    return json({ ok: false, error: 'songMapJson field required' }, { status: 400 })
  }

  const parsed = parseSongMapJsonString(songMapJson)
  if (!parsed.ok) {
    return json({ ok: false, error: parsed.error }, { status: 400 })
  }

  const ok = await updateProject(id, fingerprint, songMapJson)
  if (!ok) {
    return json({ ok: false, error: 'Project not found or fingerprint mismatch' }, { status: 404 })
  }

  return json({ ok: true, updatedAt: new Date().toISOString() })
}

export async function DELETE({ params, request }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured' }, { status: 503 })
  }

  const id = params.id ?? ''
  if (!isValidProjectId(id)) {
    return json({ ok: false, error: 'Invalid project id' }, { status: 400 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(
    request.headers.get('x-barbro-fingerprint'),
    null,
  )
  if (!fingerprint) {
    return json({ ok: false, error: 'Missing or invalid X-BarBro-Fingerprint header' }, { status: 400 })
  }

  const ok = await deleteProject(id, fingerprint)
  if (!ok) {
    return json({ ok: false, error: 'Project not found or fingerprint mismatch' }, { status: 404 })
  }

  return json({ ok: true })
}
