import { parseFingerprintHeaderOrQuery } from '$lib/server/db/fingerprintHttp'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import { isValidSessionId, loadSessionAudio } from '$lib/server/db/sessionRepo'

export async function GET({ params, url, request }) {
  if (!isDatabaseConfigured()) {
    return new Response('Database not configured', { status: 503 })
  }

  const id = params.id ?? ''
  if (!isValidSessionId(id)) {
    return new Response('Invalid session id', { status: 400 })
  }

  const fingerprint = parseFingerprintHeaderOrQuery(
    request.headers.get('x-barbro-fingerprint'),
    url.searchParams.get('fingerprint'),
  )
  if (!fingerprint) {
    return new Response('Missing or invalid fingerprint', { status: 400 })
  }

  const buf = await loadSessionAudio(id, fingerprint)
  if (!buf?.length) {
    return new Response('No audio for this session', { status: 404 })
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  })
}
