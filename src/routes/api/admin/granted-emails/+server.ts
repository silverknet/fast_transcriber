/**
 * `GET /api/admin/granted-emails` — admin-only.
 *
 * Returns the de-duplicated list of emails that have been **accepted** into
 * the app (`access_grants.status = 'granted'`). Powers the project Share
 * dialog's invite-field autocomplete so an admin can pick a known BarBro
 * user instead of retyping their email.
 *
 * Admin-gated here defensively: this is under `/api/admin/...`, which the
 * `/admin` layout guard does NOT cover (it only matches `/admin`), so the
 * `locals.isAdmin` check below is the real gate. Non-admins get 403 and the
 * Share dialog simply falls back to manual typing.
 */
import { error, json } from '@sveltejs/kit'
import { getSupabaseServiceClient } from '$lib/server/supabase/serverClient'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Sign in required.')
  if (!locals.isAdmin) throw error(403, 'Admin only.')

  const supa = getSupabaseServiceClient()
  const { data, error: e } = await supa
    .from('access_grants')
    .select('email')
    .eq('status', 'granted')
    .order('email', { ascending: true })
  if (e) throw error(500, e.message)

  const emails = Array.from(
    new Set(
      (data ?? [])
        .map((r) => (typeof r.email === 'string' ? r.email.toLowerCase().trim() : ''))
        .filter((s) => s.length > 0),
    ),
  )
  return json({ ok: true, emails })
}
