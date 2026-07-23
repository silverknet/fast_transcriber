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

/**
 * What happened to the song.
 *
 * `arrival` — a collaborator's change landed on a song you had no unsent edits
 * to. `reconciled` — you HAD unsent edits and they were combined with the
 * collaborator's automatically, so the notice must also say your work survived.
 * `reconciled` is the stronger statement and wins when both fold into one
 * notice: having been told your edits were kept, being told the song changed
 * adds nothing.
 */
export type CloudToastKind = 'arrival' | 'reconciled'

export type CloudToast = {
  /** Song titles in arrival order, de-duplicated. */
  titles: string[]
  /** How many separate arrivals folded into this notice. */
  arrivals: number
  /** Strongest kind folded in so far. */
  kind: CloudToastKind
}

/**
 * Fold a new arrival into whatever is already showing. Pure, so the coalescing
 * rule is testable without timers or a DOM.
 *
 * Re-listing a song that is already named does not duplicate it: a collaborator
 * saving the same song five times in a row should read as one song, not five.
 */
export function mergeToast(
  current: CloudToast | null,
  incoming: string[],
  kind: CloudToastKind = 'arrival',
): CloudToast | null {
  const clean = incoming.map((t) => t.trim()).filter((t) => t.length > 0)
  if (clean.length === 0) return current
  if (!current) return { titles: [...new Set(clean)], arrivals: 1, kind }
  return {
    titles: [...new Set([...current.titles, ...clean])],
    arrivals: current.arrivals + 1,
    kind: current.kind === 'reconciled' || kind === 'reconciled' ? 'reconciled' : 'arrival',
  }
}

/**
 * User-facing text. No jargon: people know "song", not "song map" or "revision"
 * — and not "merge" either, which is why the reconciled wording talks about
 * edits being KEPT. That is also the part users actually want to know after
 * something happened to a song they were working on.
 */
export function toastMessage(toast: CloudToast): string {
  const { titles, kind } = toast
  const reconciled = kind === 'reconciled'
  if (titles.length === 1) {
    return reconciled
      ? `${titles[0]} was updated by someone else — your edits were kept`
      : `${titles[0]} was updated by someone else`
  }
  const named = titles.slice(0, MAX_NAMED).join(', ')
  const rest = titles.length - MAX_NAMED
  const list = rest > 0 ? `${named} and ${rest} more` : named
  return reconciled
    ? `Updated by someone else, your edits kept: ${list}`
    : `Updated by someone else: ${list}`
}

export const cloudToast = writable<CloudToast | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Announce that songs arrived from the cloud. Safe to call with an empty list
 * (does nothing), so callers need not check first.
 */
export function notifyCloudChange(titles: string[], kind: CloudToastKind = 'arrival'): void {
  let next: CloudToast | null = null
  cloudToast.update((current) => {
    next = mergeToast(current, titles, kind)
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

/**
 * Announce that a song's unsent edits were combined with a collaborator's
 * automatically. Same notice, same coalescing — only the wording differs,
 * because here the user needs to know their own work survived.
 */
export function notifyCloudReconciled(titles: string[]): void {
  notifyCloudChange(titles, 'reconciled')
}

export function dismissCloudToast(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  cloudToast.set(null)
}
