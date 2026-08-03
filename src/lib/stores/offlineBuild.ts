/**
 * Is this the offline desktop build?
 *
 * The server knows (`locals.offline`, from `BARBRO_OFFLINE`); the client learns
 * it once from the root layout's data and remembers it here. It cannot change
 * within a running process — the flag is a property of how the app was started,
 * not of the current network — so this is set once and read everywhere.
 *
 * Two kinds of consumer:
 *
 *  - **Plain functions** (`projectAutosave`, `cloudAutoPull`) call
 *    `isOfflineClient()`. They run outside the component tree and only need the
 *    answer, not reactivity.
 *  - **Components** subscribe to `offlineBuild` to hide cloud-shaped UI.
 *
 * Note this is NOT "am I currently disconnected". A browser with the Wi-Fi off
 * is still the online build and should still behave like it — retrying, queueing
 * and syncing when the network returns. This flag means "this build has no cloud
 * at all", which is a different and permanent fact.
 */
import { readonly, writable } from 'svelte/store'

const internal = writable(false)

/** Subscribe in components: `$offlineBuild`. */
export const offlineBuild = readonly(internal)

let offline = false

/** Set once from the root layout. Idempotent. */
export function setOfflineBuild(value: boolean): void {
  offline = value === true
  internal.set(offline)
}

/** Synchronous read for non-component code. */
export function isOfflineClient(): boolean {
  return offline
}
