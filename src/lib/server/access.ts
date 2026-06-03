/**
 * Server-side helpers for the invite-only access gate.
 *
 * Resolves the current user's access status (granted / pending / denied)
 * and decides whether a route is allowed for that status. Admin
 * identification is env-driven (`ADMIN_USER_IDS` comma-separated UUIDs)
 * so we don't need an admin role table — keeps schema simple while we
 * have one or two admins.
 *
 * The auto-create-pending path runs through the **service-role client**
 * (`getSupabaseServiceClient`) because the access_grants table doesn't
 * grant INSERT to ordinary users — only admins write to it. From the
 * user's perspective, walking up to a gated route for the first time
 * triggers a row creation as a side effect, then a redirect to /pending.
 */
import { env } from '$env/dynamic/private'
import { getSupabaseServiceClient } from '$lib/server/supabase/serverClient'
import type { User } from '@supabase/supabase-js'

export type AccessStatus = 'granted' | 'pending' | 'denied' | 'none'

export interface AccessState {
  status: AccessStatus
  isAdmin: boolean
}

const ADMIN_USER_IDS = new Set<string>(
  (env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

export function isAdminUser(user: User | null): boolean {
  if (!user) return false
  return ADMIN_USER_IDS.has(user.id)
}

/**
 * Look up (and, if needed, create) the access_grants row for this user.
 *
 *  1. Try by user_id (most rows after first link).
 *  2. Fall back to email match — covers admin pre-invites where the row
 *     exists with `user_id = null`. If we find one, **link** the user_id
 *     atomically on the way out.
 *  3. If still nothing → insert a fresh pending row. Returns 'pending'.
 *
 * Uses the service-role client throughout so RLS doesn't block the
 * lookup/upsert (the user can SELECT their own row, but can't INSERT or
 * UPDATE — that's admin/service work).
 */
export async function loadAccessForUser(user: User): Promise<AccessState> {
  const admin = isAdminUser(user)
  // Admins always have access without needing a grants row — keeps
  // bootstrap simple (you don't need to grant yourself).
  if (admin) return { status: 'granted', isAdmin: true }

  const supa = getSupabaseServiceClient()
  const email = user.email?.toLowerCase().trim() ?? null

  // 1) by user_id
  const byId = await supa
    .from('access_grants')
    .select('status,email,user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (byId.data) {
    return { status: byId.data.status as AccessStatus, isAdmin: false }
  }

  // 2) by email (pre-invite case)
  if (email) {
    const byEmail = await supa
      .from('access_grants')
      .select('status,email,user_id')
      .eq('email', email)
      .maybeSingle()
    if (byEmail.data) {
      // Link the existing row to the now-known user_id. Best-effort — if
      // the update fails, the user still gets the right status this turn
      // and we'll try again next request.
      if (!byEmail.data.user_id) {
        await supa
          .from('access_grants')
          .update({ user_id: user.id })
          .eq('email', email)
      }
      return { status: byEmail.data.status as AccessStatus, isAdmin: false }
    }
  }

  // 3) Cold sign-in — auto-create a pending row. Insert ignores conflicts
  // because two concurrent requests for the same brand-new user could
  // race (unlikely but possible during sign-in).
  if (email) {
    await supa
      .from('access_grants')
      .upsert(
        { email, user_id: user.id, status: 'pending' },
        { onConflict: 'email' },
      )
    return { status: 'pending', isAdmin: false }
  }

  // No email on the user object at all — shouldn't happen in practice
  // (both Google OAuth and magic link yield an email), but treat as
  // 'none' so the gate redirects to /welcome instead of looping.
  return { status: 'none', isAdmin: false }
}

/**
 * Public routes — anyone, signed in or not, can reach these. Used by the
 * layout-level route gate to decide whether to redirect.
 *
 * Anything not in this list AND not in `pendingAllowedRoutes` is
 * "members only" — requires `status === 'granted'`.
 */
const PUBLIC_ROUTE_IDS = new Set<string>([
  '/welcome',
  '/login',
  '/logout',
  '/auth/callback',
  '/download', // sidecar install page is intentionally public
])

/** Allowed for signed-in users whose access is `pending` or `denied`. */
const PENDING_OR_DENIED_ROUTE_IDS = new Set<string>([
  '/pending',
  '/account', // so they can sign out
])

export type RouteGateDecision =
  | { allow: true }
  | { allow: false; redirectTo: string }

/**
 * Decide whether `routeId` is reachable given the caller's auth + access
 * state. Returns either `{ allow: true }` or a redirect target.
 *
 *  - Signed out → only public routes allowed → else /welcome.
 *  - Signed in + granted → all routes allowed.
 *  - Signed in + pending/denied/none → public + pending allowed → else /pending.
 *  - Admin → always granted (loadAccessForUser sets that), so the granted
 *    branch covers them.
 */
export function decideRouteAccess(
  routeId: string | null | undefined,
  signedIn: boolean,
  status: AccessStatus,
): RouteGateDecision {
  const id = routeId ?? ''

  if (!signedIn) {
    if (PUBLIC_ROUTE_IDS.has(id)) return { allow: true }
    return { allow: false, redirectTo: '/welcome' }
  }

  if (status === 'granted') return { allow: true }

  if (PUBLIC_ROUTE_IDS.has(id) || PENDING_OR_DENIED_ROUTE_IDS.has(id)) {
    return { allow: true }
  }
  return { allow: false, redirectTo: '/pending' }
}
