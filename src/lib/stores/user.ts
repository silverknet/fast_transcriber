/**
 * Current signed-in user, mirrored from the SvelteKit server-side session.
 *
 * Populated by `+layout.svelte` from the layout load's `user` field, which
 * `hooks.server.ts` resolves via `supabase.auth.getUser()`. Components that
 * want to render conditionally on auth state subscribe to this store.
 *
 * Why a store + not just `$page.data.user`: the store decouples auth-state
 * consumers from SvelteKit's page-data subscription, lets us update from
 * client-side `onAuthStateChange` events (no full navigation needed), and
 * gives us a single source of truth that works in both Svelte components
 * and plain `.ts` modules via `get(userStore)`.
 */
import { writable } from 'svelte/store'

export interface SignedInUser {
  id: string
  email: string | null
  /** Display name from OAuth provider (Google "name", etc.), or null for magic-link signups. */
  name: string | null
  /** Avatar URL if the provider supplied one. */
  avatarUrl: string | null
}

export const userStore = writable<SignedInUser | null>(null)
