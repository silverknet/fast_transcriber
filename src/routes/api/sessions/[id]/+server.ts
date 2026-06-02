import { json } from '@sveltejs/kit'
import { parseSongMapJsonString } from '$lib/songmap/persist'
import { parseFingerprintHeaderOrQuery } from '$lib/server/db/fingerprintHttp'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import { isValidSessionId, loadEditorSession, saveEditorSession } from '$lib/server/db/sessionRepo'

export async function GET({ params, url, request }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured' }, { status: 503 })
  }

  const id = params.id ?? ''
  if (!isValidSessionId(id)) {
    return json({ ok: false, error: 'Invalid session id' }, { status: 400 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(
    request.headers.get('x-barbro-fingerprint'),
    url.searchParams.get('fingerprint'),
  )
  if (!fingerprint) {
    return json({ ok: false, error: 'Missing or invalid fingerprint' }, { status: 400 })
  }

  const row = await loadEditorSession(id, fingerprint)
  if (!row) {
    return json({ ok: false, error: 'Session not found' }, { status: 404 })
  }

  return json({
    ok: true,
    sessionId: row.id,
    songMap: row.songMapJson,
    updatedAt: row.updatedAt,
  })
}

export async function PUT({ params, request }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured' }, { status: 503 })
  }

  const id = params.id ?? ''
  if (!isValidSessionId(id)) {
    return json({ ok: false, error: 'Invalid session id' }, { status: 400 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(request.headers.get('x-barbro-fingerprint'), null)
  if (!fingerprint) {
    return json({ ok: false, error: 'Missing or invalid X-BarBro-Fingerprint header' }, { status: 400 })
  }

  // SongMap only — server never stores audio. The body is plain JSON.
  let songMapJson: string
  try {
    songMapJson = await request.text()
  } catch {
    return json({ ok: false, error: 'Expected JSON body' }, { status: 400 })
  }

  const parsed = parseSongMapJsonString(songMapJson)
  if (!parsed.ok) {
    return json({ ok: false, error: parsed.error }, { status: 400 })
  }

  const ok = await saveEditorSession(id, fingerprint, songMapJson)
  if (!ok) {
    return json({ ok: false, error: 'Session not found or fingerprint mismatch' }, { status: 404 })
  }

  return json({ ok: true, updatedAt: new Date().toISOString() })
}
