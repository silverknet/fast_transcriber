/**
 * The offline build's server-side rules.
 *
 * These decide who gets in and what gets refused on a laptop at a venue. The
 * dangerous direction is not "too strict" — a locked-out musician notices
 * immediately — it is the hosted deploy accidentally inheriting any of this,
 * which would hand a public server a no-login branch. So the flag's SCOPE is
 * asserted first and hardest.
 */
import { describe, expect, it } from 'vitest'
import {
  OFFLINE_ACCESS_STATUS,
  OFFLINE_LOCAL_USER_ID,
  isCloudApiPath,
  isOfflineBuild,
  offlineLocalUser,
  offlineRouteRedirect,
} from './offlineMode'

describe('the flag is opt-in and narrow', () => {
  it('is off for an ordinary environment', () => {
    // Netlify sets nothing of the sort, so the hosted deploy takes the normal
    // auth path. This is the single assertion protecting the public server.
    expect(isOfflineBuild({})).toBe(false)
    expect(isOfflineBuild({ NODE_ENV: 'production', PUBLIC_SUPABASE_URL: 'https://x' })).toBe(false)
  })

  it('needs exactly "1" — not "true", not "yes", not empty', () => {
    expect(isOfflineBuild({ BARBRO_OFFLINE: '1' })).toBe(true)
    expect(isOfflineBuild({ BARBRO_OFFLINE: 'true' })).toBe(false)
    expect(isOfflineBuild({ BARBRO_OFFLINE: '0' })).toBe(false)
    expect(isOfflineBuild({ BARBRO_OFFLINE: '' })).toBe(false)
  })
})

describe('the local user', () => {
  it('is granted access, because the invite gate is a cloud concept', () => {
    expect(OFFLINE_ACCESS_STATUS).toBe('granted')
  })

  it('carries an id no cloud row could ever have', () => {
    // If this ever reached a database it must fail loudly rather than write a
    // row under a plausible-looking owner. A UUID would not.
    const u = offlineLocalUser()
    expect(u.id).toBe(OFFLINE_LOCAL_USER_ID)
    expect(u.id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('claims no email', () => {
    expect(offlineLocalUser().email).toBeNull()
  })
})

describe('routes that only make sense with a cloud', () => {
  it('sends the sign-in flow home', () => {
    // /login constructs a Supabase browser client, which THROWS without env —
    // so reaching it offline is a blank error page, not a dead end you can
    // navigate away from.
    for (const p of ['/login', '/welcome', '/pending', '/account', '/auth/callback', '/admin/access']) {
      expect(offlineRouteRedirect(p), p).toBe('/')
    }
  })

  it('leaves the app alone', () => {
    for (const p of ['/', '/edit', '/rig', '/project', '/project/playback', '/set', '/download']) {
      expect(offlineRouteRedirect(p), p).toBeNull()
    }
  })

  it('does not swallow a lookalike prefix', () => {
    // A sloppy startsWith would take these with it and break real routes.
    expect(offlineRouteRedirect('/logout-confirmation')).toBeNull()
    expect(offlineRouteRedirect('/welcomes')).toBeNull()
    expect(offlineRouteRedirect('/accounting')).toBeNull()
  })

  it('ignores a query string', () => {
    expect(offlineRouteRedirect('/login?next=/edit')).toBe('/')
    expect(offlineRouteRedirect('/edit?song=1')).toBeNull()
  })
})

describe('cloud API paths', () => {
  it('claims everything that talks to Supabase', () => {
    for (const p of [
      '/api/cloud/projects',
      '/api/cloud/projects/abc/songs',
      '/api/cloud/invites/mine',
      '/api/admin/granted-emails',
    ]) {
      expect(isCloudApiPath(p), p).toBe(true)
    }
  })

  it('leaves local endpoints alone', () => {
    // /api/health must keep answering: it is how you tell "the server is up"
    // from "the server is wedged" when something goes wrong at a venue.
    expect(isCloudApiPath('/api/health')).toBe(false)
    expect(isCloudApiPath('/edit')).toBe(false)
    expect(isCloudApiPath('/_app/immutable/entry/app.js')).toBe(false)
  })
})
