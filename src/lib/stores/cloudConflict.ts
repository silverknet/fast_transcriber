import { writable } from 'svelte/store'
import type { SongMap } from '$lib/songmap'
import type { MergeReport } from '$lib/songmap/collabMerge'

/**
 * Phase 8 — pending cloud conflict awaiting user resolution.
 *
 * Populated when `pushCloudSong` returns `{ conflict: true }` and the
 * autosave runs `mergeForConflict(local, cloud)`. Reset to `null`
 * after the user resolves the dialog (Keep mine / Take theirs /
 * apply per-row decisions and push).
 *
 * One conflict at a time is enough — the dialog is modal, and the
 * autosave won't queue another push until this one is resolved.
 */
export interface CloudConflictState {
  cloudProjectId: string
  cloudSongId: string
  /** Song's identity at the receiver — used by the resolve handler to push back. */
  localSongId: string
  /** What the user had locally when the 409 fired. */
  local: SongMap
  /** What the server reported as the current state. */
  remote: SongMap
  /** New base revision to push back with (the cloud's current rev). */
  remoteRevision: number
  /** Merge result + conflicts list. */
  report: MergeReport
}

export const cloudConflict = writable<CloudConflictState | null>(null)
