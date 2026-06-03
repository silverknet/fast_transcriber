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
import { env as publicEnv } from '$env/dynamic/public'
import type { Cookies } from '@sveltejs/kit'

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
