/**
 * `/account` server load — redirect signed-out visitors to `/login?next=/account`
 * so they get bounced back here after sign-in.
 *
 * The signed-in user is already on `locals.user` from `hooks.server.ts`;
 * we just gate access here.
 */
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/login?next=/account')
  }
  return {
    // Mirror the projected user from the layout load — the page can also
    // read `$page.data.user`, but having it here makes the gating obvious.
    accountUser: {
      id: locals.user.id,
      email: locals.user.email ?? null,
      name: (locals.user.user_metadata?.full_name as string | undefined) ?? null,
      avatarUrl: (locals.user.user_metadata?.avatar_url as string | undefined) ?? null,
      createdAt: locals.user.created_at,
      provider:
        (locals.user.app_metadata?.provider as string | undefined) ?? 'unknown',
    },
  }
}
