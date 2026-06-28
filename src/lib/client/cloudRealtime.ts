/**
 * Supabase Realtime helper for cloud-project collaboration.
 *
 * Subscribes to `postgres_changes` on `cloud_songs` and `cloud_projects`
 * filtered to one project id. Fires the supplied callback (debounced)
 * whenever a remote actor mutates one of those rows. Caller is expected
 * to react by re-fetching what they care about — typically `pullCloudChanges()`
 * plus a manifest/members refresh.
 *
 * Returns an unsubscribe function. Subscriptions are membership-gated by
 * RLS, so the channel will silently produce nothing for non-members; we
 * don't have to do an extra access check here.
 *
 * The debounce collapses bursts (one save → 1 cloud_songs UPDATE + 1
 * cloud_projects UPDATE for the bumped revision) into a single callback
 * invocation. 500ms is short enough to feel real-time and long enough to
 * coalesce typical save patterns.
 */
import { getSupabaseBrowserClient } from '$lib/client/supabase/browserClient'
import type { RealtimeChannel } from '@supabase/supabase-js'

export interface SubscribeOptions {
  /** Override the default 500ms debounce window. */
  debounceMs?: number
}

export type Unsubscribe = () => void

export function subscribeToCloudProject(
  projectId: string,
  onRemoteChange: () => void,
  opts: SubscribeOptions = {},
): Unsubscribe {
  const supa = getSupabaseBrowserClient()
  const debounceMs = opts.debounceMs ?? 500
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  const fire = () => {
    if (cancelled) return
    if (timer != null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (cancelled) return
      onRemoteChange()
    }, debounceMs)
  }

  const channel: RealtimeChannel = supa
    .channel(`project:${projectId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'cloud_songs',
        filter: `cloud_project_id=eq.${projectId}`,
      },
      fire,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'cloud_projects',
        filter: `id=eq.${projectId}`,
      },
      fire,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'cloud_project_members',
        filter: `cloud_project_id=eq.${projectId}`,
      },
      fire,
    )
    .subscribe()

  return () => {
    cancelled = true
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    void supa.removeChannel(channel)
  }
}
