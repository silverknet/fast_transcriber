/**
 * Root layout load — exposes the signed-in user (if any) to every page.
 *
 * `hooks.server.ts` already resolved `event.locals.user` from Supabase; we
 * just project the few fields the UI cares about so we don't ship the
 * entire User JWT shape to the client.
 *
 * No project/song restoration happens here: the desktop sidecar owns
 * project state, and `+layout.svelte` calls `tryRestoreLastProject` on
 * mount for that. This file's only job is auth + opting out of any
 * inherited parent loads.
 */
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
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
  }
}
