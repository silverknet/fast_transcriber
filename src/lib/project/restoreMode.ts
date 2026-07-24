/**
 * Pure arbitration for "which mode do we restore a project in on reload" — the
 * fix for mode STRANDING (a project opened in browser mode while the sidecar was
 * down staying on compressed cloud audio forever, even after the sidecar comes
 * back up and an HD copy sits on disk).
 *
 * The rule: **prefer DISK whenever the sidecar is up and a local copy exists** —
 * the last-opened disk path, or a known disk folder for the last cloud project.
 * Only fall to browser-cloud when there is no local option (no sidecar, or no
 * local copy of that cloud project on this machine).
 *
 * Kept pure (no stores/localStorage) so the precedence is exhaustively testable.
 * The caller supplies the persisted signals.
 */
export type RestoreDecision =
  | { mode: 'disk'; path: string }
  | { mode: 'cloud'; cloudId: string }
  | { mode: 'none' }

export function chooseRestoreMode(input: {
  /** `localStorage[LAST_PROJECT_PATH_KEY]` — the last disk project, if any. */
  lastPath: string | null
  /** `localStorage[LAST_CLOUD_PROJECT_ID_KEY]` — the last browser-cloud project. */
  lastCloudId: string | null
  /** Is the desktop sidecar reachable right now (disk mode needs it). */
  sidecarReachable: boolean
  /** A known local disk folder for `lastCloudId` on THIS machine, or null. */
  diskPathForCloudId: string | null
}): RestoreDecision {
  // Disk mode requires the sidecar (it reads local files through it). When it's
  // up, prefer a local copy — this is what un-strands a browser session.
  if (input.sidecarReachable) {
    if (input.lastPath) return { mode: 'disk', path: input.lastPath }
    if (input.lastCloudId && input.diskPathForCloudId) {
      return { mode: 'disk', path: input.diskPathForCloudId }
    }
    // Sidecar up but no local copy of the last project → fall through to cloud.
  }

  // No sidecar (or no local copy): a browser-cloud session works offline; prefer
  // it over a disk path we can't open without the sidecar.
  if (input.lastCloudId) return { mode: 'cloud', cloudId: input.lastCloudId }

  // Only a disk path and no sidecar: let the caller try it (it fails gracefully
  // if the sidecar is genuinely required). Preserves disk-only-user behavior.
  if (input.lastPath) return { mode: 'disk', path: input.lastPath }

  return { mode: 'none' }
}
