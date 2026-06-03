/**
 * Root route gate.
 *
 * `/` is no longer a destination of its own — everything is project-based
 * now. Signed-in users with access go to `/project`. The standalone audio
 * importer that lives in `+page.svelte` is still reachable via
 * `/?project=1` because that's how `/project` triggers the "add a song
 * to the active project" flow; we let that through unchanged.
 *
 * The route gate in `hooks.server.ts` + `+layout.server.ts` already
 * handles signed-out / pending / denied visitors (they get redirected to
 * `/welcome` or `/pending`), so we only need to consider the
 * signed-in-and-granted case here.
 */
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
  // Keep the "add song to project" entry point reachable.
  if (url.searchParams.has('project')) return {}

  if (locals.user && locals.accessStatus === 'granted') {
    throw redirect(303, '/project')
  }
  return {}
}
