import { json } from '@sveltejs/kit'
import { parseFingerprintHeaderOrQuery } from '$lib/server/db/fingerprintHttp'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import { isValidProjectId, loadProjectAudio } from '$lib/server/db/projectRepo'

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

  const audio = await loadProjectAudio(id, fingerprint)
  if (!audio) {
    return json({ ok: false, error: 'Audio not found' }, { status: 404 })
  }

  return new Response(new Uint8Array(audio), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(audio.length),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
