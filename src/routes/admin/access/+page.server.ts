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
import { isAdminUser } from '$lib/server/access'
import { getSupabaseServiceClient } from '$lib/server/supabase/serverClient'
import type { Actions, PageServerLoad } from './$types'

interface AccessRow {
  id: string | null
  key: string
  email: string
  user_id: string | null
  status: 'pending' | 'granted' | 'denied'
  requested_at: string
  decided_at: string | null
  decided_by: string | null
  note: string | null
  source: 'grant' | 'auth'
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

  if (error) {
    return {
      rows: [] as AccessRow[],
      error: error.message,
    }
  }

  const rows: AccessRow[] = ((data ?? []) as Array<Omit<AccessRow, 'key' | 'source'>>)
    .map((row) => ({
      ...row,
      key: `grant:${row.id}`,
      source: 'grant',
    }))

  const byEmail = new Set(rows.map((row) => row.email.toLowerCase()))
  const byUserId = new Set(rows.map((row) => row.user_id).filter(Boolean))
  let page = 1
  let authError: string | null = null

  while (true) {
    const { data: authData, error: listError } = await supa.auth.admin.listUsers({
      page,
      perPage: 1000,
    })

    if (listError) {
      authError = listError.message
      break
    }

    const users = authData.users ?? []
    for (const user of users) {
      // Admin access is controlled by ADMIN_USER_IDS, not access_grants.
      // Don't synthesize a review row for bootstrap/admin accounts.
      if (isAdminUser(user)) continue

      const email = user.email?.toLowerCase().trim()
      if (!email) continue
      if (byUserId.has(user.id) || byEmail.has(email)) continue

      rows.push({
        id: null,
        key: `auth:${user.id}`,
        email,
        user_id: user.id,
        status: 'pending',
        requested_at: user.created_at,
        decided_at: null,
        decided_by: null,
        note: 'Signed up in Supabase Auth; no access row yet.',
        source: 'auth',
      })
      byEmail.add(email)
      byUserId.add(user.id)
    }

    if (users.length < 1000) break
    page += 1
  }

  const statusRank = { pending: 0, granted: 1, denied: 2 }
  rows.sort((a, b) => {
    const byStatus = statusRank[a.status] - statusRank[b.status]
    if (byStatus !== 0) return byStatus
    return Date.parse(b.requested_at) - Date.parse(a.requested_at)
  })

  return {
    rows,
    error: authError,
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
    const email = String(form.get('email') ?? '').trim().toLowerCase()
    const userId = String(form.get('user_id') ?? '').trim() || null
    if (!id && !email) return fail(400, { error: 'Missing user.' })

    const supa = getSupabaseServiceClient()
    const decision = {
      status: 'granted' as const,
      decided_by: locals.user!.id,
      decided_at: new Date().toISOString(),
    }
    const { error } = id
      ? await supa
          .from('access_grants')
          .update(decision)
          .eq('id', id)
      : await supa
          .from('access_grants')
          .upsert(
            {
              email,
              user_id: userId,
              ...decision,
            },
            { onConflict: 'email' },
          )
    if (error) return fail(500, { error: error.message })
    return { ok: true, action: 'approve', id, email }
  },

  deny: async ({ request, locals }) => {
    guardAdmin(locals)
    const form = await request.formData()
    const id = String(form.get('id') ?? '').trim()
    const email = String(form.get('email') ?? '').trim().toLowerCase()
    const userId = String(form.get('user_id') ?? '').trim() || null
    if (!id && !email) return fail(400, { error: 'Missing user.' })

    const supa = getSupabaseServiceClient()
    const decision = {
      status: 'denied' as const,
      decided_by: locals.user!.id,
      decided_at: new Date().toISOString(),
    }
    const { error } = id
      ? await supa
          .from('access_grants')
          .update(decision)
          .eq('id', id)
      : await supa
          .from('access_grants')
          .upsert(
            {
              email,
              user_id: userId,
              ...decision,
            },
            { onConflict: 'email' },
          )
    if (error) return fail(500, { error: error.message })
    return { ok: true, action: 'deny', id, email }
  },
}
