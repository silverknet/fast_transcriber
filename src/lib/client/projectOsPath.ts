/**
 * IndexedDB-backed cache of `projectId → absolute OS path`.
 *
 * The browser's File System Access API doesn't expose OS paths, but the
 * desktop sidecar's filesystem-direct features (stems with no audio over
 * HTTP, future direct .smap writes, …) need them. We bridge the gap with a
 * one-time-per-project `pickFolderViaDesktop` prompt and remember the
 * answer in IndexedDB so the user is never asked twice for the same
 * project.
 *
 * Stored in the same DB as `folderHandle.ts` to avoid extra schema churn.
 */

import { browser } from '$app/environment'
import { pickFolderViaDesktop } from './desktopBridge'

const DB_NAME = 'barbro'
const DB_VERSION = 1
const STORE = 'folderHandles'

/** All entries live under this key, value is `Record<projectId, path>`. */
const KEY = 'barbro::projectOsPaths'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readAll(): Promise<Record<string, string>> {
  if (!browser) return {}
  try {
    const db = await openDb()
    return await new Promise<Record<string, string>>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => {
        db.close()
        const v = req.result as Record<string, string> | undefined
        resolve(v && typeof v === 'object' ? v : {})
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    })
  } catch {
    return {}
  }
}

async function writeAll(value: Record<string, string>): Promise<void> {
  if (!browser) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, KEY)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  } catch {
    /* non-critical */
  }
}

/** Returns the cached OS path for a project id, or null. */
export async function getProjectOsPath(projectId: string): Promise<string | null> {
  const all = await readAll()
  return all[projectId] ?? null
}

export async function setProjectOsPath(projectId: string, osPath: string): Promise<void> {
  const all = await readAll()
  all[projectId] = osPath
  await writeAll(all)
}

export async function clearProjectOsPath(projectId: string): Promise<void> {
  const all = await readAll()
  if (!(projectId in all)) return
  delete all[projectId]
  await writeAll(all)
}

/**
 * Get the OS path for a project, prompting the user via the desktop
 * picker if not already cached. Returns null if the user cancels or the
 * desktop isn't reachable.
 *
 * `expectedBasename` (typically the project folder's leaf name) is used
 * only for the picker title so the user knows what to navigate to.
 */
export async function ensureProjectOsPath(
  projectId: string,
  expectedBasename: string,
): Promise<string | null> {
  const cached = await getProjectOsPath(projectId)
  if (cached) return cached
  const r = await pickFolderViaDesktop({
    title: `Locate the "${expectedBasename}" project folder on disk`,
  })
  if (!r.ok) return null
  await setProjectOsPath(projectId, r.path)
  return r.path
}
