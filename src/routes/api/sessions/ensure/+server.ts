import { json } from '@sveltejs/kit'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import { ensureEditorSession } from '$lib/server/db/sessionRepo'

const FP_RE = /^[0-9a-f]{64}$/i

export async function POST({ request, cookies }) {
  if (!isDatabaseConfigured()) {
    return json({ ok: false, error: 'Database not configured (set DATABASE_URL)' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const fp = typeof body === 'object' && body && 'fingerprint' in body ? String((body as { fingerprint: unknown }).fingerprint) : ''
  if (!FP_RE.test(fp)) {
    return json({ ok: false, error: 'fingerprint must be a 64-character hex SHA-256 string' }, { status: 400 })
  }

  const fingerprintHash = fp.toLowerCase()
  const row = await ensureEditorSession(fingerprintHash)
  if (!row) {
    return json({ ok: false, error: 'Could not create or load session' }, { status: 500 })
  }

  cookies.set('barbro_session', row.sessionId, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    secure: false,
  })

  return json({
    ok: true,
    sessionId: row.sessionId,
    hasSongMap: row.hasSongMap,
    updatedAt: row.updatedAt,
  })
}
