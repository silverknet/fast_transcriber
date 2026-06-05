/**
 * Project song auto-save: subscribes to the songMap store and writes
 * `song.smap` to the project folder via the desktop sidecar when **all**
 * of the following hold:
 *
 * 1. A project is open (`project.osPath` non-null)
 * 2. `project.activeSongFolder` is non-null
 * 3. `project.activeSongId` is non-null
 * 4. `project.editingMode === 'project-song'`
 * 5. Current route is `/edit` (read from `$page.route.id`)
 * 6. The desktop companion is reachable (sidecar ping succeeded)
 * 7. **Manifest invariant**: there exists an entry `e` in the manifest with
 *    `e.folder === activeSongFolder` AND `e.id === activeSongId`
 *
 * Any failure of these guards aborts the write — no exception leaks. The
 * `id` mismatch in (7) catches the case where the manifest changed
 * underneath us (entry removed, replaced, path-edited).
 *
 * The manifest itself is NOT rewritten by autosave. Manifest changes only
 * happen in response to structural edits (add/remove/hide/reorder/rename).
 */

import { get, type Unsubscriber } from 'svelte/store'
import { browser } from '$app/environment'
import { page } from '$app/stores'
import { pushCloudSong } from '$lib/client/cloudSync'
import { writeProjectSong } from '$lib/client/desktopProjectFs'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import { metadataLiteFromSongMap } from '$lib/project/commit'
import { exportRestorableStateAsSmapBlob } from '$lib/songmap/persist'
import { mergeForConflict } from '$lib/songmap/collabMerge'
import { cloudConflict } from '$lib/stores/cloudConflict'
import { restorableSongState } from '$lib/songmap/session'
import { audioSession } from '$lib/stores/audioSession'
import { patchMetadataForFolder, project, setProjectData } from '$lib/stores/project'
import { songMap } from '$lib/stores/songMap'
import type { ProjectFile } from '$lib/project/types'

const DEBOUNCE_MS = 1500
/**
 * Cloud push runs on its own longer debounce so we don't fire on every
 * keystroke. Disk write fires first (faster, local) and is independent;
 * a failed cloud push must never block the local save.
 */
const CLOUD_DEBOUNCE_MS = 7000

let started = false
let unsubs: Unsubscriber[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let cloudDebounceTimer: ReturnType<typeof setTimeout> | null = null
let writing = false
let pendingWhileWriting = false
let cloudPushing = false
let cloudPendingWhilePushing = false

async function tryWriteOnce(): Promise<void> {
  const snap = get(project)
  const sm = get(songMap)
  if (!sm) return

  // Guards 1–4
  if (!snap.data || !snap.osPath) return
  if (!snap.activeSongFolder || !snap.activeSongId) return
  if (snap.editingMode !== 'project-song') return

  // Guard 5: route
  const p = get(page)
  if (p?.route?.id !== '/edit') return

  // Guard 7: manifest invariant (id + folder match)
  const entry = snap.data.songs.find(
    (e) => e.folder === snap.activeSongFolder && e.id === snap.activeSongId,
  )
  if (!entry) return

  // Guard 6: sidecar reachable
  if (!get(desktopCompanionStatus).reachable) return

  const sess = get(audioSession)
  const state = restorableSongState(sm, sess.file ?? null)

  let blob: Blob
  try {
    blob = await exportRestorableStateAsSmapBlob(state)
  } catch {
    return
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const r = await writeProjectSong(snap.osPath, snap.activeSongFolder, bytes)
  if (!r.ok) return

  patchMetadataForFolder(snap.activeSongFolder, metadataLiteFromSongMap(sm))
}

function schedule(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (writing) {
      pendingWhileWriting = true
      return
    }
    writing = true
    tryWriteOnce()
      .catch(() => {})
      .finally(() => {
        writing = false
        if (pendingWhileWriting) {
          pendingWhileWriting = false
          schedule()
        }
      })
  }, DEBOUNCE_MS)
}

/**
 * Push the current active song to the cloud if the project is linked.
 * Independent of disk write — runs on its own debounce, fails silently
 * (the local .smap on disk stays the source of truth).
 *
 * Conflict handling here is minimal for Phase 4 (caller sees the
 * 409, increments pendingChanges, and a later pull will resolve).
 * Phase 8 wires the actual merge UI.
 */
async function tryCloudPushOnce(): Promise<void> {
  const snap = get(project)
  const sm = get(songMap)
  if (!sm || !snap.data || !snap.data.cloud) return
  if (!snap.activeSongId) return
  if (snap.editingMode !== 'project-song') return
  // Only push when actively editing in /edit, mirroring the disk-write guard.
  if (get(page)?.route?.id !== '/edit') return

  const cloud = snap.data.cloud
  const entry = snap.data.songs.find((e) => e.id === snap.activeSongId)
  if (!entry) return
  const cloudSongId = entry.cloudSongId ?? entry.id
  const baseRev = entry.lastSyncedRevision ?? cloud.lastSyncedRevision
  const sortOrder = snap.data.songs.indexOf(entry)
  if (sortOrder < 0) return

  const r = await pushCloudSong(
    cloud.projectId,
    cloudSongId,
    sm,
    sortOrder,
    !!entry.hidden,
    baseRev,
  )

  if (r.ok) {
    // Mark this song + the project as synced through the returned revision.
    const next: ProjectFile = {
      ...snap.data,
      cloud: {
        ...cloud,
        lastSyncedRevision: r.revision,
        lastPushedAt: new Date().toISOString(),
        pendingChanges: 0,
      },
      songs: snap.data.songs.map((s) =>
        s.id === entry.id
          ? { ...s, cloudSongId, lastSyncedRevision: r.revision }
          : s,
      ),
    }
    setProjectData(next)
    return
  }

  // Conflict path (Phase 8): surface the disagreement to the user via
  // the cloudConflict store. The dialog renders the merge report; the
  // user picks per-row before applying. We bump pendingChanges so the
  // status pill reflects the unsynced state until they resolve.
  if ('conflict' in r && r.conflict && r.remote?.song_map) {
    // Don't replace an already-pending conflict — the user is mid-resolve.
    if (get(cloudConflict) === null) {
      const report = mergeForConflict(sm, r.remote.song_map)
      cloudConflict.set({
        cloudProjectId: cloud.projectId,
        cloudSongId,
        localSongId: entry.id,
        local: sm,
        remote: r.remote.song_map,
        remoteRevision: r.remote.revision,
        report,
      })
    }
  }

  const next: ProjectFile = {
    ...snap.data,
    cloud: {
      ...cloud,
      pendingChanges: (cloud.pendingChanges ?? 0) + 1,
    },
  }
  setProjectData(next)
}

function scheduleCloudPush(): void {
  if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer)
  cloudDebounceTimer = setTimeout(() => {
    cloudDebounceTimer = null
    if (cloudPushing) {
      cloudPendingWhilePushing = true
      return
    }
    cloudPushing = true
    tryCloudPushOnce()
      .catch(() => {})
      .finally(() => {
        cloudPushing = false
        if (cloudPendingWhilePushing) {
          cloudPendingWhilePushing = false
          scheduleCloudPush()
        }
      })
  }, CLOUD_DEBOUNCE_MS)
}

/**
 * Phase 7 — let external code (the "online" event listener in
 * `startProjectAutosave`, or a manual "retry" button somewhere) ask
 * for a cloud push attempt to be queued through the same debounce
 * that the songMap subscription uses. No-op when the autosave isn't
 * started or there's nothing pending.
 */
export function requestCloudPush(): void {
  if (!browser || !started) return
  scheduleCloudPush()
}

/**
 * Start the global autosave subscription. Idempotent — safe to call
 * multiple times. Should be invoked once from the root layout in browser.
 */
export function startProjectAutosave(): void {
  if (!browser || started) return
  started = true
  unsubs.push(
    songMap.subscribe(() => {
      schedule()
      // Independent timer — cloud push runs in parallel with disk write,
      // not chained after it. Disk failure must not block cloud, and
      // vice versa.
      scheduleCloudPush()
    }),
  )
  // Phase 7 — when the browser regains connectivity, flush any queued
  // cloud pushes. The debounced scheduleCloudPush picks up the current
  // active song; offline-accumulated edits from previously-active songs
  // will be flushed individually as the user navigates back to them.
  const onOnline = () => scheduleCloudPush()
  window.addEventListener('online', onOnline)
  unsubs.push(() => window.removeEventListener('online', onOnline))
}

export function stopProjectAutosave(): void {
  for (const u of unsubs) u()
  unsubs = []
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (cloudDebounceTimer) {
    clearTimeout(cloudDebounceTimer)
    cloudDebounceTimer = null
  }
  started = false
}
