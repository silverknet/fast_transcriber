import { json } from '@sveltejs/kit'
import { createHash } from 'node:crypto'
import { parseSongMapJsonString } from '$lib/songmap/persist'
import { parseFingerprintHeaderOrQuery } from '$lib/server/db/fingerprintHttp'
import { isDatabaseConfigured } from '$lib/server/db/pool'
import { listProjects, createProject } from '$lib/server/db/projectRepo'

export const config = { maxRequestBodySize: 100 * 1024 * 1024 }

const MAX_AUDIO_BYTES = 80 * 1024 * 1024

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

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ ok: false, error: 'Expected multipart form data' }, { status: 400 })
  }

  const name = ((form.get('name') as string) ?? '').trim() || 'Untitled Project'
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
      return json(
        { ok: false, error: `Audio too large (max ${MAX_AUDIO_BYTES / (1024 * 1024)} MB)` },
        { status: 413 },
      )
    }
    const ab = await audio.arrayBuffer()
    const bytes = Buffer.from(ab)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    audioPart = { bytes, sha256 }
  }

  const id = await createProject(fingerprint, name, songMapJson, audioPart)
  if (!id) {
    return json({ ok: false, error: 'Failed to create project' }, { status: 500 })
  }

  return json(
    { ok: true, id, audioSha256: audioPart?.sha256 ?? null, updatedAt: new Date().toISOString() },
    { status: 201 },
  )
}
