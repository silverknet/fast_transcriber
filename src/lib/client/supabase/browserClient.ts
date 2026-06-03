/**
 * Browser-side Supabase client.
 *
 * `@supabase/ssr`'s `createBrowserClient` reads/writes session cookies that
 * `hooks.server.ts` also reads — keeps client + server in lockstep without
 * passing tokens around manually. Returned client is safe to use from
 * Svelte components for client-only flows (e.g. signOut, listening to
 * onAuthStateChange).
 *
 * Lazy singleton: created on first access so we don't fail SSR import for
 * pages that don't need it.
 */
import { createBrowserClient } from '@supabase/ssr'
import { env as publicEnv } from '$env/dynamic/public'
import type { SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached
  const url = publicEnv.PUBLIC_SUPABASE_URL
  const anon = publicEnv.PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error(
      'Missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY. Set them in .env (dev) or Netlify env vars (prod).',
    )
  }
  cached = createBrowserClient(url, anon)
  return cached
}
