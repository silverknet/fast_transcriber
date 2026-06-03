/**
 * Root layout load.
 *
 *  1. Resolve the route-level access gate (invite-only). Signed-out
 *     visitors get bounced to /welcome on any protected route; signed-in
 *     but-not-yet-granted users get bounced to /pending. The decision
 *     table lives in `src/lib/server/access.ts:decideRouteAccess`.
 *
 *  2. Expose the projected user shape to every page (also `accessStatus`
 *     and `isAdmin` so the UI can render chips / hide admin entries).
 *
 * Auth and access are read from `event.locals.{user,accessStatus,isAdmin}`,
 * which `hooks.server.ts` populated. No DB round-trip in here.
 */
import { redirect } from '@sveltejs/kit'
import { decideRouteAccess } from '$lib/server/access'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals, route, url }) => {
  // Route gate. Skip for `/admin/*` if not admin — handled separately so
  // we send a friendly 404-ish "not admin" instead of looping.
  const gate = decideRouteAccess(route.id, !!locals.user, locals.accessStatus)
  if (!gate.allow && url.pathname !== gate.redirectTo) {
    throw redirect(303, gate.redirectTo)
  }

  // Admin routes: only admins. Non-admins get a redirect away from the
  // admin tree so the route literally doesn't render.
  if (route.id?.startsWith('/admin') && !locals.isAdmin) {
    throw redirect(303, locals.user ? '/pending' : '/welcome')
  }

  const u = locals.user
  return {
    user: u
      ? {
          id: u.id,
          email: u.email ?? null,
          name: (u.user_metadata?.full_name as string | undefined) ?? null,
          avatarUrl: (u.user_metadata?.avatar_url as string | undefined) ?? null,
        }
      : null,
    accessStatus: locals.accessStatus,
    isAdmin: locals.isAdmin,
  }
}
