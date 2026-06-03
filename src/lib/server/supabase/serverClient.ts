/**
 * Per-request Supabase client for SvelteKit server endpoints.
 *
 * Why per-request instead of a module-level singleton: each request has its
 * own cookies, and `@supabase/ssr`'s cookie methods need to read/write the
 * SvelteKit `event.cookies` jar for THIS request. A shared client across
 * requests would mix sessions.
 *
 * The factory is called once from `hooks.server.ts` and the resulting
 * client is attached to `event.locals.supabase` for handlers to reuse —
 * see [src/hooks.server.ts](../../../hooks.server.ts).
 *
 * Cookie names follow the `@supabase/ssr` defaults. `path: '/'` is
 * required so the same cookie is sent on every request, including the
 * `/auth/callback` round-trip.
 */
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { env as publicEnv } from '$env/dynamic/public'
import type { Cookies } from '@sveltejs/kit'
import type { SupabaseClient } from '@supabase/supabase-js'

export function createSupabaseServerClient(cookies: Cookies) {
  const url = publicEnv.PUBLIC_SUPABASE_URL
  const anon = publicEnv.PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error(
      'Missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY. Set them in .env (dev) or Netlify env vars (prod).',
    )
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          cookies.set(name, value, { ...options, path: '/' })
        }
      },
    },
  })
}

/**
 * Service-role client — bypasses RLS. Reserved for trusted server-side
 * operations that can't be expressed through user-scoped policies:
 *
 *  - Admin endpoints that mutate `access_grants` (grant/deny/invite).
 *  - The auto-create-pending-row path during the access gate, since the
 *    user can't INSERT their own access_grants row (RLS denies it).
 *
 * NEVER import from client-side code. NEVER expose
 * `SUPABASE_SERVICE_ROLE_KEY` via `PUBLIC_*` env. The client is built
 * lazily so missing env doesn't break server boot for callers that
 * don't need it.
 */
let serviceClient: SupabaseClient | null = null
export function getSupabaseServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient
  const url = publicEnv.PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (server-only).',
    )
  }
  serviceClient = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return serviceClient
}
