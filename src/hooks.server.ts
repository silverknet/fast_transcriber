/**
 * Per-request hook that wires Supabase into every server-side handler.
 *
 * Responsibilities:
 *  1. Instantiate a request-scoped Supabase client bound to this request's
 *     cookie jar (see [src/lib/server/supabase/serverClient.ts](./lib/server/supabase/serverClient.ts)).
 *  2. Resolve the current session via `getUser()` (not `getSession()` — the
 *     latter trusts the cookie blindly; `getUser()` re-validates with the
 *     Supabase auth server, which is what we want for any server-side
 *     authorization decision).
 *  3. Attach `supabase`, `session`, `user` to `event.locals` so any
 *     `+page.server.ts` or any `/api/.../+server.ts` can use them.
 *
 * The `filterSerializedResponseHeaders` line is mandatory per
 * `@supabase/ssr` docs — without it the auth helper's internal `Range`
 * header probing can break SvelteKit's response serialization.
 */
import { createSupabaseServerClient } from '$lib/server/supabase/serverClient'
import { env as publicEnv } from '$env/dynamic/public'
import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) => {
  // If Supabase env vars aren't configured (e.g. CI without secrets, or a
  // fresh checkout before .env is set up), short-circuit gracefully: keep
  // the app booting; `event.locals.user` is null; auth-gated routes will
  // see no user and respond accordingly. This avoids blowing up the
  // entire app over a missing env var during early development.
  if (!publicEnv.PUBLIC_SUPABASE_URL || !publicEnv.PUBLIC_SUPABASE_ANON_KEY) {
    // @ts-expect-error — locals.supabase is non-null in the type, but in
    // the un-configured branch we genuinely don't have a client. Any
    // handler that uses it must check for env presence first OR rely on
    // `locals.user === null` as the gate.
    event.locals.supabase = null
    event.locals.session = null
    event.locals.user = null
    return resolve(event, {
      filterSerializedResponseHeaders: (name) => name === 'content-range',
    })
  }

  event.locals.supabase = createSupabaseServerClient(event.cookies)

  // `getUser()` round-trips to Supabase to validate the JWT. That's a few
  // ms of latency per request, but it's the correct posture for any
  // server-side decision. `getSession()` only reads the cookie locally
  // and is fine for "is there a session-shaped cookie?" but NOT for
  // "is this user really who they claim to be?".
  const { data: { user }, error } = await event.locals.supabase.auth.getUser()
  if (error || !user) {
    event.locals.user = null
    event.locals.session = null
  } else {
    event.locals.user = user
    // `getSession()` is cheap (no round-trip) and we already trust the
    // user above — pair them up for handlers that want both.
    const { data: { session } } = await event.locals.supabase.auth.getSession()
    event.locals.session = session
  }

  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-range',
  })
}
