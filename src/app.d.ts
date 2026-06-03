import type { SupabaseClient, Session, User } from '@supabase/supabase-js'

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
