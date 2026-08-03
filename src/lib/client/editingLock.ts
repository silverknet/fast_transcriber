/**
 * ONE BARBRO AT A TIME.
 *
 * The offline app and the website are two independent editors that can both be
 * pointed at the same project folder on disk. Both run `projectAutosave`. Both
 * write `song.smap` from their own copy in memory, on a 1.5 s debounce. Neither
 * reads what the other wrote. Last write wins and the other's edits are gone —
 * silently, with no conflict dialog, because the conflict machinery only covers
 * the CLOUD, not two local writers on one file.
 *
 * That is a data-loss path that a warning in a document does not close. Someone
 * leaves a tab open, plays a gig, comes home, and a night's edits are gone.
 *
 * So the rule is enforced: while the offline app is open, the website stands
 * down. The offline app wins because it is the one holding the gig — it is on
 * stage, its edits are the ones being made right now, and it is the only one of
 * the two that cannot simply be reopened later.
 *
 * The sidecar is the arbiter. It knows whether its own offline window is open
 * and reports it in `/ping`, which the website already polls every 12 s.
 */

export type EditingLock =
  | { paused: false }
  | { paused: true; title: string; detail: string }

export type EditingLockInput = {
  /** From `/ping` — the sidecar's own offline window is open. */
  offlineAppOpen: boolean
  /** Are WE the offline app? Then this is about us and we are the ones editing. */
  isOfflineApp: boolean
  /** A project with a folder on disk. The shared file is what makes this unsafe. */
  hasLocalProject: boolean
}

/**
 * Should this editor stand down?
 *
 * Gated on `hasLocalProject` because the shared `song.smap` is the actual
 * hazard. A browser-mode session with no folder has nothing to collide over on
 * disk, and its cloud pushes go through the existing 409 / merge path — which
 * is a real conflict resolution rather than a silent overwrite.
 */
export function editingLock(input: EditingLockInput): EditingLock {
  const { offlineAppOpen, isOfflineApp, hasLocalProject } = input
  if (isOfflineApp) return { paused: false }
  if (!offlineAppOpen) return { paused: false }
  if (!hasLocalProject) return { paused: false }
  return {
    paused: true,
    title: 'BarBro is open in the offline app',
    // Says what is happening, what it protects, and exactly how to undo it.
    // "Editing is disabled" alone would read as a bug.
    detail:
      'Saving is paused here so your two copies cannot overwrite each other. Close the offline app window to carry on editing in the browser.',
  }
}

/** Convenience for the write paths, which only care whether to abort. */
export function isEditingPaused(input: EditingLockInput): boolean {
  return editingLock(input).paused
}
