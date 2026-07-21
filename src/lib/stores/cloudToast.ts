/**
 * "Someone else changed something" notice.
 *
 * Remote changes arrive whenever a collaborator saves, which during a working
 * session is often. One toast per arrival would be a stream of popups, so
 * arrivals COALESCE: while a notice is on screen, a new arrival folds into the
 * one already showing and extends its life rather than stacking a second.
 *
 * Two things are deliberately never announced:
 *  - your own push echoing back (`pullCloudChanges` reports `changed: false`
 *    for those — see the self-echo guard in `applyCloudSongIntoLocal`);
 *  - a pull that changed nothing.
 */
import { writable } from 'svelte/store'

/** How long a notice stays up. Each new arrival restarts the clock. */
export const CLOUD_TOAST_MS = 6000

/** Titles listed by name before collapsing into "and N more". */
const MAX_NAMED = 2

export type CloudToast = {
  /** Song titles in arrival order, de-duplicated. */
  titles: string[]
  /** How many separate arrivals folded into this notice. */
  arrivals: number
}

/**
 * Fold a new arrival into whatever is already showing. Pure, so the coalescing
 * rule is testable without timers or a DOM.
 *
 * Re-listing a song that is already named does not duplicate it: a collaborator
 * saving the same song five times in a row should read as one song, not five.
 */
export function mergeToast(current: CloudToast | null, incoming: string[]): CloudToast | null {
  const clean = incoming.map((t) => t.trim()).filter((t) => t.length > 0)
  if (clean.length === 0) return current
  if (!current) return { titles: [...new Set(clean)], arrivals: 1 }
  return {
    titles: [...new Set([...current.titles, ...clean])],
    arrivals: current.arrivals + 1,
  }
}

/** User-facing text. No jargon: people know "song", not "song map" or "revision". */
export function toastMessage(toast: CloudToast): string {
  const { titles } = toast
  if (titles.length === 1) return `${titles[0]} was updated by someone else`
  const named = titles.slice(0, MAX_NAMED).join(', ')
  const rest = titles.length - MAX_NAMED
  return rest > 0
    ? `Updated by someone else: ${named} and ${rest} more`
    : `Updated by someone else: ${named}`
}

export const cloudToast = writable<CloudToast | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Announce that songs arrived from the cloud. Safe to call with an empty list
 * (does nothing), so callers need not check first.
 */
export function notifyCloudChange(titles: string[]): void {
  let next: CloudToast | null = null
  cloudToast.update((current) => {
    next = mergeToast(current, titles)
    return next
  })
  if (!next) return
  // Restart rather than stack: the notice should outlive the LAST arrival, not
  // vanish mid-burst because the first one's timer ran out.
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    cloudToast.set(null)
  }, CLOUD_TOAST_MS)
}

export function dismissCloudToast(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  cloudToast.set(null)
}
