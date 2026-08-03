/**
 * The pending "you edited these offline" review.
 *
 * Non-null exactly when a project has been opened online, an offline session
 * marker was found, and at least one touched song really differs from what the
 * cloud last saw. `OfflineChangesDialog` renders it.
 *
 * A store rather than component state because the check runs in the root layout
 * as the project opens, and the dialog lives in the layout's chrome — the same
 * shape as `cloudConflict`.
 */
import { writable } from 'svelte/store'
import type { OfflineChange } from '$lib/client/offlineReconcile'
import type { ProjectFile } from '$lib/project/types'
import type { OfflineSession } from '$lib/project/offlineSession'

export type OfflineChangesPrompt = {
  osPath: string
  data: ProjectFile
  session: OfflineSession
  changes: OfflineChange[]
  /** Touched but identical — counted in the summary, not offered for review. */
  unchangedCount: number
}

export const offlineChanges = writable<OfflineChangesPrompt | null>(null)
