/**
 * `/admin/access` — admin-only invite + access management.
 *
 * Loads every access_grants row via the service-role client (bypasses
 * RLS — admin needs to see all rows). Provides three form actions:
 *
 *   - `invite`  : pre-approve an email (status='granted', user_id=null).
 *                 When that user signs in for the first time, the access
 *                 helper links their user_id automatically.
 *   - `approve` : flip a 'pending' or 'denied' row to 'granted'.
 *   - `deny`    : flip to 'denied'. Sign-in still works for them but
 *                 the gate redirects to /pending which then shows the
 *                 denied copy.
 *
 * The layout guard already blocked non-admins from reaching this route,
 * so we don't need to re-check here. We DO re-check in actions
 * defensively (defense in depth — never trust route guards alone for
 * mutating endpoints).
 */
import { fail } from '@sveltejs/kit'
import { getSupabaseServiceClient } from '$lib/server/supabase/serverClient'
import type { Actions, PageServerLoad } from './$types'

interface AccessRow {
  id: string
  email: string
  user_id: string | null
  status: 'pending' | 'granted' | 'denied'
  requested_at: string
  decided_at: string | null
  decided_by: string | null
  note: string | null
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.isAdmin) return { rows: [] as AccessRow[], error: null }
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('access_grants')
    .select(
      'id,email,user_id,status,requested_at,decided_at,decided_by,note',
    )
    .order('status', { ascending: true })
    .order('requested_at', { ascending: false })

  return {
    rows: (data ?? []) as AccessRow[],
    error: error ? error.message : null,
  }
}

function guardAdmin(locals: App.Locals) {
  if (!locals.isAdmin || !locals.user) {
    throw fail(403, { error: 'Admins only.' })
  }
}

export const actions: Actions = {
  invite: async ({ request, locals }) => {
    guardAdmin(locals)
    const form = await request.formData()
    const email = String(form.get('email') ?? '').trim().toLowerCase()
    const note = String(form.get('note') ?? '').trim() || null
    if (!email || !email.includes('@')) {
      return fail(400, { error: 'Valid email required.' })
    }

    const supa = getSupabaseServiceClient()
    const { error } = await supa
      .from('access_grants')
      .upsert(
        {
          email,
          status: 'granted',
          decided_by: locals.user!.id,
          decided_at: new Date().toISOString(),
          note,
        },
        { onConflict: 'email' },
      )
    if (error) return fail(500, { error: error.message })
    return { ok: true, action: 'invite', email }
  },

  approve: async ({ request, locals }) => {
    guardAdmin(locals)
    const form = await request.formData()
    const id = String(form.get('id') ?? '').trim()
    if (!id) return fail(400, { error: 'Missing id.' })

    const supa = getSupabaseServiceClient()
    const { error } = await supa
      .from('access_grants')
      .update({
        status: 'granted',
        decided_by: locals.user!.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return fail(500, { error: error.message })
    return { ok: true, action: 'approve', id }
  },

  deny: async ({ request, locals }) => {
    guardAdmin(locals)
    const form = await request.formData()
    const id = String(form.get('id') ?? '').trim()
    if (!id) return fail(400, { error: 'Missing id.' })

    const supa = getSupabaseServiceClient()
    const { error } = await supa
      .from('access_grants')
      .update({
        status: 'denied',
        decided_by: locals.user!.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return fail(500, { error: error.message })
    return { ok: true, action: 'deny', id }
  },
}
