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
import { writeProjectSong } from '$lib/client/desktopProjectFs'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import { metadataLiteFromSongMap } from '$lib/project/commit'
import { exportRestorableStateAsSmapBlob } from '$lib/songmap/persist'
import { restorableSongState } from '$lib/songmap/session'
import { audioSession } from '$lib/stores/audioSession'
import { patchMetadataForFolder, project } from '$lib/stores/project'
import { songMap } from '$lib/stores/songMap'

const DEBOUNCE_MS = 1500

let started = false
let unsubs: Unsubscriber[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let writing = false
let pendingWhileWriting = false

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
 * Start the global autosave subscription. Idempotent — safe to call
 * multiple times. Should be invoked once from the root layout in browser.
 */
export function startProjectAutosave(): void {
  if (!browser || started) return
  started = true
  unsubs.push(
    songMap.subscribe(() => {
      schedule()
    }),
  )
}

export function stopProjectAutosave(): void {
  for (const u of unsubs) u()
  unsubs = []
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  started = false
}
