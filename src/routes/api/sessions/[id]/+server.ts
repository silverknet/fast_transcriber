import { json } from '@sveltejs/kit'
import { createHash } from 'node:crypto'
import { parseSongMapJsonString } from '$lib/songmap/persist'
import { parseFingerprintHeaderOrQuery } from '$lib/server/db/fingerprintHttp'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import { isValidSessionId, loadEditorSession, saveEditorSession } from '$lib/server/db/sessionRepo'

/** Large multipart saves (audio clip). */
export const config = {
  maxRequestBodySize: 100 * 1024 * 1024,
}

const MAX_AUDIO_BYTES = 80 * 1024 * 1024

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
    hasAudio: row.hasAudio,
    audioSha256: row.audioSha256,
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

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ ok: false, error: 'Expected multipart form data' }, { status: 400 })
  }

  const songMapJson = form.get('songMapJson')
  if (typeof songMapJson !== 'string') {
    return json({ ok: false, error: 'songMapJson field required' }, { status: 400 })
  }

  const parsed = parseSongMapJsonString(songMapJson)
  if (!parsed.ok) {
    return json({ ok: false, error: parsed.error }, { status: 400 })
  }

  const audio = form.get('audio')
  let audioPart: { bytes: Buffer; sha256: string } | undefined

  if (audio instanceof File && audio.size > 0) {
    if (audio.size > MAX_AUDIO_BYTES) {
      return json({ ok: false, error: `Audio too large (max ${MAX_AUDIO_BYTES / (1024 * 1024)} MB)` }, { status: 413 })
    }
    const ab = await audio.arrayBuffer()
    const bytes = Buffer.from(ab)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    audioPart = { bytes, sha256 }
  }

  const ok = await saveEditorSession(id, fingerprint, songMapJson, audioPart)
  if (!ok) {
    return json({ ok: false, error: 'Session not found or fingerprint mismatch' }, { status: 404 })
  }

  return json({
    ok: true,
    audioSha256: audioPart?.sha256 ?? null,
    updatedAt: new Date().toISOString(),
  })
}
