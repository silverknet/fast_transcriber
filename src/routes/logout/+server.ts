/**
 * `/logout` — sign-out endpoint. POST-only (browsers don't pre-fetch POST).
 * Clears the Supabase session cookies via `signOut()` and redirects home.
 */
import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals }) => {
  if (locals.supabase) {
    await locals.supabase.auth.signOut()
  }
  throw redirect(303, '/')
}
