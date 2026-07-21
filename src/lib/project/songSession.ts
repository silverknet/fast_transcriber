/**
 * Phase 1 of [`docs/domains/collab-sync-architecture.md`] — one owner for the
 * ACTIVE song.
 *
 * Before this module, a remote change went straight to disk
 * (`applyCloudSongIntoLocal`) and never touched the `songMap` store. If the
 * editor happened to have that song open it kept a stale copy, and its next
 * autosave wrote that stale copy back over what had just been pulled. The only
 * thing preventing that lost update was an unrelated gap — realtime auto-pull
 * being mounted on `/project` alone, so a pull could not land while `/edit` was
 * open. One bug was masking another.
 *
 * The rule this module exists to enforce (rule 3 in the architecture doc):
 *
 *   > Remote changes land in MEMORY first, then flow to disk. Never disk-only.
 *
 * It does not own the debounced writes yet — `projectAutosave.ts` still does —
 * so this is deliberately the seam, not the whole session. Later phases move
 * the write scheduling in here and then swap the merge for a CRDT.
 */
import { get } from 'svelte/store'
import { collabContentFingerprint, mergeLocalIntoCollab } from '$lib/songmap/collab'
import { mergeForConflict } from '$lib/songmap/collabMerge'
import { project } from '$lib/stores/project'
import { patchSongMap, songMap } from '$lib/stores/songMap'
import type { ExpectedAudio, SongMap } from '$lib/songmap/types'

/** Identity of the song the editor currently has loaded, if any. */
export type ActiveSongRef = {
  osPath: string
  folder: string
  songId: string
}

/**
 * The song the editor has open, or `null`. Requires the full identity —
 * a folder without an id (or vice versa) means the manifest moved underneath
 * us and nothing should be treated as active.
 */
export function activeSongRef(): ActiveSongRef | null {
  const snap = get(project)
  if (!snap.osPath || !snap.activeSongFolder || !snap.activeSongId) return null
  if (snap.editingMode !== 'project-song') return null
  return { osPath: snap.osPath, folder: snap.activeSongFolder, songId: snap.activeSongId }
}

/** True when `songId` is the song currently loaded in the editor. */
export function isActiveSong(songId: string): boolean {
  return activeSongRef()?.songId === songId
}

export type RemoteApplicationPlan = {
  /** The map to install: in memory when active, and always to disk. */
  merged: SongMap
  /**
   * Which local copy the remote change was merged against. `memory` whenever
   * the song is open in the editor — see below.
   */
  localSource: 'memory' | 'disk'
  /** Whether the editor's in-memory copy needs updating. */
  appliedToMemory: boolean
  /**
   * `clean` — local matched the last synced content, so the remote copy is
   * simply adopted. `dirty` — the editor holds unpushed edits, so the remote
   * change was merged item-by-item instead of overwriting them.
   */
  localState: 'clean' | 'dirty'
}

/**
 * Decide what a remote song should be merged against. Pure, so the decision is
 * testable without stores or disk.
 *
 * `memory` wins over `disk` when the song is open, and that is the whole point:
 * the in-memory map can hold edits made in the last debounce window that have
 * not reached disk yet. Merging the remote change against the DISK copy would
 * silently discard them.
 */
export function planRemoteApplication(args: {
  incoming: SongMap
  /** The editor's copy, or `null` when this song is not the active one. */
  memory: SongMap | null
  /** The copy read from `song.smap`. */
  disk: SongMap
  /**
   * Fingerprint of the last content successfully synced for this song. When
   * the local copy no longer matches it, the editor holds unpushed edits.
   */
  lastSyncedContentHash?: string
  /** Cloud's audio-identity claim, folded in before the map is installed. */
  expectedAudio?: ExpectedAudio
}): RemoteApplicationPlan {
  const local = args.memory ?? args.disk

  // Is the local copy carrying edits that never reached the cloud? Only
  // meaningful for the open editor: an inactive song's disk copy is whatever
  // the last pull or autosave wrote.
  const dirty =
    args.memory !== null &&
    args.lastSyncedContentHash !== undefined &&
    collabContentFingerprint(args.memory) !== args.lastSyncedContentHash

  // A clean local copy can simply adopt the remote one — that is the long
  // standing pull contract ("cloud wins for shared fields").
  //
  // A DIRTY one must not be overwritten. Before Phase 1 this could not happen
  // in practice, because pulls never reached an open editor; now that they do,
  // adopting wholesale would throw away whatever the user typed in the last few
  // seconds. `mergeForConflict` keeps every item that exists on only one side
  // and prefers cloud only where the two genuinely collide — the same defaults
  // the conflict dialog would apply, minus the dialog.
  //
  // `mergeForConflict` assembles from the CLOUD copy, which has local-only
  // fields stripped, so its result is run back through `mergeLocalIntoCollab`
  // to re-attach them.
  const shared = dirty ? mergeForConflict(local, args.incoming).merged : args.incoming
  const merged = mergeLocalIntoCollab(local, shared)

  // Fold the audio claim in HERE rather than mutating the map after it has been
  // installed in the store — a post-hoc mutation would change store contents
  // without notifying subscribers.
  if (args.expectedAudio !== undefined) merged.expectedAudio = args.expectedAudio

  return {
    merged,
    localSource: args.memory ? 'memory' : 'disk',
    appliedToMemory: args.memory !== null,
    localState: dirty ? 'dirty' : 'clean',
  }
}

/**
 * Apply a remote song to the editor when it is the active one.
 *
 * Returns the map that should be written to disk and stamped as synced, so the
 * caller persists exactly what was installed — memory and disk can never
 * disagree about what the pull produced.
 *
 * The caller stamps `lastSyncedContentHash` from this result, which is what
 * stops the autosave's dirty-check from immediately pushing freshly-pulled
 * content straight back (the phantom-conflict loop).
 */
export function applyRemoteSongMap(args: {
  songId: string
  incoming: SongMap
  disk: SongMap
  lastSyncedContentHash?: string
  expectedAudio?: ExpectedAudio
}): RemoteApplicationPlan {
  const active = isActiveSong(args.songId)
  const plan = planRemoteApplication({
    incoming: args.incoming,
    memory: active ? (get(songMap) ?? null) : null,
    disk: args.disk,
    lastSyncedContentHash: args.lastSyncedContentHash,
    expectedAudio: args.expectedAudio,
  })
  if (!plan.appliedToMemory) return plan

  // Replace wholesale rather than patching fields: `merged` already folded the
  // local-only fields back in via `mergeLocalIntoCollab`.
  const res = patchSongMap(() => plan.merged)
  if (res.ok) return plan

  // Validation rejected the merged map. Report that memory was NOT updated so
  // the caller doesn't write a copy to disk that the editor never accepted —
  // that would be the disk/memory divergence this module exists to prevent.
  console.warn('[songSession] rejected remote song map:', res.errors)
  return { ...plan, appliedToMemory: false }
}
