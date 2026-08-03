/**
 * OFFLINE MODE — the desktop build that has no login, because it has no cloud.
 *
 * The hosted app is a server-rendered site behind Supabase auth, which is the
 * correct posture for something reachable from the internet. At a venue there is
 * frequently no usable network, and that same posture ends the show: every route
 * bounces to `/welcome`.
 *
 * The previous attempt kept a *previously verified* cloud session alive offline —
 * a cached credential with an expiry, raced against a timeout. It worked, and it
 * still died on a constraint no amount of engineering removes: Google refuses
 * OAuth inside an app window, so the desktop client can never sign in at all.
 *
 * So this build does not ask. Auth exists to protect CLOUD resources; a client
 * with no cloud access has nothing to protect, and requiring a sign-in there
 * protects nothing while adding three ways to fail at load-in.
 *
 * ## Why a synthetic local user is safe
 *
 * The guarantee is CAPABILITY, not permission. The offline build ships no
 * `PUBLIC_SUPABASE_*` values, and `prepareOfflineEnv` in
 * `desktop/electron/offlineUi.mjs` deletes them from the environment even when
 * running from a source checkout whose `.env` has them. With no URL and no anon
 * key there is no client to construct, in the browser or on the server — the app
 * cannot reach the cloud even if something asked it to.
 *
 * Given that, the only resource this server can reach is the project folder on
 * the user's own machine, over loopback, on a laptop they are holding. A login
 * would be a lock on a door with no room behind it.
 *
 * Everything here is a pure function of the environment or a path, so the rules
 * can be tested without booting a server.
 */
import type { AccessStatus } from '$lib/server/access'

/** Set by the desktop app and nowhere else. Netlify never sets it. */
export const OFFLINE_ENV_FLAG = 'BARBRO_OFFLINE'

/**
 * The id the local user carries.
 *
 * Deliberately not a UUID: it must never be mistaken for a Supabase user id, and
 * anything that tried to send it to the cloud should fail loudly rather than
 * write a row under a plausible-looking owner.
 */
export const OFFLINE_LOCAL_USER_ID = 'local-offline-user'

/** True only in the desktop build that serves the app to itself. */
export function isOfflineBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OFFLINE_ENV_FLAG] === '1'
}

/**
 * The user object the offline build hands to every request.
 *
 * Shaped like a Supabase user so nothing downstream needs a special case, with
 * `accessStatus: 'granted'` because the invite gate is a cloud concept and there
 * is no cloud here to be invited to.
 */
export function offlineLocalUser(): {
  id: string
  email: string | null
  user_metadata: { full_name: string }
} {
  return {
    id: OFFLINE_LOCAL_USER_ID,
    email: null,
    user_metadata: { full_name: 'This machine' },
  }
}

export const OFFLINE_ACCESS_STATUS: AccessStatus = 'granted'

/**
 * Routes that only make sense with a cloud behind them.
 *
 * Reached offline they would not merely fail — `/login` constructs a Supabase
 * browser client, which THROWS without env, so the page renders as a blank
 * error. Redirecting is both kinder and less alarming than a stack trace at a
 * venue.
 */
const OFFLINE_REDIRECTED_PREFIXES = ['/login', '/welcome', '/pending', '/auth', '/account', '/admin']

/** Where an offline request to a cloud-only route should go, or null to proceed. */
export function offlineRouteRedirect(pathname: string): string | null {
  const path = pathname.split('?')[0]
  if (path === '/') return null
  for (const prefix of OFFLINE_REDIRECTED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return '/'
  }
  return null
}

/**
 * API paths that talk to Supabase.
 *
 * Answered offline with an explicit 503 rather than letting the handler
 * dereference a null client and produce a 500 with a stack trace. The caller
 * gets a sentence it can show; nothing hangs waiting on DNS.
 */
export function isCloudApiPath(pathname: string): boolean {
  const path = pathname.split('?')[0]
  return path.startsWith('/api/cloud') || path.startsWith('/api/admin')
}

/** The one sentence a caller sees when it asks the offline build for the cloud. */
export const OFFLINE_CLOUD_MESSAGE =
  'This copy of BarBro runs offline and has no connection to your BarBro account. Open BarBro in your browser to sync.'
