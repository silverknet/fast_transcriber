/**
 * `/account` server load — redirect signed-out visitors to `/login?next=/account`
 * so they get bounced back here after sign-in.
 *
 * The signed-in user is already on `locals.user` from `hooks.server.ts`;
 * we just gate access here.
 */
import { redirect } from '@sveltejs/kit'
import { listMemberProjects } from '$lib/server/db/cloudRepo'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/login?next=/account')
  }

  // Cloud projects the user has access to. Empty for users who haven't
  // enabled collaboration on any local project yet — the UI shows a
  // helpful placeholder in that case.
  let cloudProjects: Awaited<ReturnType<typeof listMemberProjects>> = []
  try {
    cloudProjects = await listMemberProjects(locals.supabase)
  } catch {
    // Falling back to empty is correct: DB unreachable shouldn't block
    // the rest of the account page from rendering.
  }

  return {
    accountUser: {
      id: locals.user.id,
      email: locals.user.email ?? null,
      name: (locals.user.user_metadata?.full_name as string | undefined) ?? null,
      avatarUrl: (locals.user.user_metadata?.avatar_url as string | undefined) ?? null,
      createdAt: locals.user.created_at,
      provider:
        (locals.user.app_metadata?.provider as string | undefined) ?? 'unknown',
    },
    cloudProjects: cloudProjects.map((p) => ({
      id: p.id,
      name: p.name,
      revision: p.revision,
      updatedAt: p.updated_at,
      isOwner: p.owner_user_id === locals.user!.id,
    })),
  }
}
