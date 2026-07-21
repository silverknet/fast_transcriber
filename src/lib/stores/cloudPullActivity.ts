import { writable } from 'svelte/store'

/**
 * True while a cloud pull is in flight. Written only by `cloudAutoPull.ts`;
 * read by status UI so the spinner no longer depends on which page owns the
 * subscription.
 */
export const cloudPullActivity = writable(false)
