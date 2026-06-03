import type { SupabaseClient, Session, User } from '@supabase/supabase-js'
import type { AccessStatus } from '$lib/server/access'

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      /** Per-request Supabase client created in `hooks.server.ts`. */
      supabase: SupabaseClient
      /** Resolved Supabase session for this request, or null when signed out. */
      session: Session | null
      /** Resolved Supabase user for this request, or null when signed out. */
      user: User | null
      /** Access-gate status. 'none' when signed out OR when no row exists yet. */
      accessStatus: AccessStatus
      /** Whether the user is an admin (env-driven ADMIN_USER_IDS). */
      isAdmin: boolean
    }
    // interface PageData {}
    // interface Platform {}
  }
}

declare module '*.xml?raw' {
  const content: string
  export default content
}

export {}
