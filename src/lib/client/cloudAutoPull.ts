/**
 * Phase 1 of [`docs/domains/collab-sync-architecture.md`] — remote changes
 * reach the editor.
 *
 * The Realtime subscription used to live inside `CloudStatusChip.svelte`, which
 * is mounted on `/project` only. A collaborator's edit therefore never reached
 * an open editor: you kept working on a stale copy until you navigated away and
 * back. Auto-pull belongs to the app, not to one page, so it lives here and is
 * started once from the root layout alongside the autosave.
 *
 * Moving it was only SAFE once `songSession.applyRemoteSongMap` existed. Before
 * that, a pull landing while `/edit` was open would have written disk while the
 * editor held a stale copy in memory — and the next autosave would have written
 * that stale copy back. The `/project`-only mounting was accidentally the thing
 * preventing that lost update.
 *
 * Lives in its own module rather than in `songSession.ts` to keep the import
 * graph acyclic: this imports `cloudSync`, `cloudSync` imports `songSession`.
 */
import { browser } from '$app/environment'
import { get } from 'svelte/store'
import { subscribeToCloudProject, type Unsubscribe } from '$lib/client/cloudRealtime'
import { pullCloudChanges } from '$lib/client/cloudSync'
import { cloudPullActivity } from '$lib/stores/cloudPullActivity'
import { notifyCloudChange } from '$lib/stores/cloudToast'
import { project } from '$lib/stores/project'

let started = false
let unsubProject: (() => void) | null = null
let unsubRealtime: Unsubscribe | null = null
let subscribedProjectId: string | null = null
/** Serialises pulls — a burst of remote edits must not stack overlapping pulls. */
let pulling = false
let pullAgain = false

async function pullOnce(): Promise<void> {
  if (pulling) {
    pullAgain = true
    return
  }
  pulling = true
  cloudPullActivity.set(true)
  try {
    const r = await pullCloudChanges()
    // Only songs whose shared content actually moved — `pullCloudChanges`
    // filters out our own push echoing back, so you are never told about
    // your own edit.
    if (r.ok && r.changedTitles.length > 0) notifyCloudChange(r.changedTitles)
  } catch {
    // A failed pull is not fatal: the next remote change (or reopening the
    // project) retries. Local work is never blocked on the network.
  } finally {
    pulling = false
    cloudPullActivity.set(false)
    if (pullAgain) {
      pullAgain = false
      void pullOnce()
    }
  }
}

/** Subscribe/resubscribe as the open cloud project changes. */
function syncSubscription(projectId: string | null): void {
  if (projectId === subscribedProjectId) return
  unsubRealtime?.()
  unsubRealtime = null
  subscribedProjectId = projectId
  if (!projectId) return
  try {
    unsubRealtime = subscribeToCloudProject(projectId, () => void pullOnce())
    // Catch-up pull on subscribe. Realtime only delivers events that happen
    // WHILE subscribed, so without this a reload, a fresh project open, or a
    // websocket reconnect would silently miss everything pushed in the gap —
    // the editor would sit on stale content until the next live change. Pull
    // once now so subscribing is self-healing.
    void pullOnce()
  } catch (e) {
    // Constructing the Supabase client throws when env isn't configured. That
    // must degrade to "no live updates", never break the app.
    console.warn('[cloudAutoPull] realtime unavailable:', e)
    subscribedProjectId = null
  }
}

/**
 * Start listening for remote changes. Idempotent; call once from the root
 * layout in the browser.
 */
export function startCloudAutoPull(): void {
  if (!browser || started) return
  started = true
  unsubProject = project.subscribe((snap) => {
    syncSubscription(snap.data?.cloud?.projectId ?? null)
  })
  // Reconnect after being offline: the subscription may have missed changes
  // while down, and catch-up is by revision watermark rather than event replay.
  const onOnline = () => void pullOnce()
  window.addEventListener('online', onOnline)
  const prevUnsub = unsubProject
  unsubProject = () => {
    prevUnsub?.()
    window.removeEventListener('online', onOnline)
  }
}

export function stopCloudAutoPull(): void {
  unsubRealtime?.()
  unsubRealtime = null
  unsubProject?.()
  unsubProject = null
  subscribedProjectId = null
  started = false
  cloudPullActivity.set(false)
}

/** Manual "pull now", for a retry button. */
export function requestCloudPull(): void {
  if (!browser) return
  void pullOnce()
}
