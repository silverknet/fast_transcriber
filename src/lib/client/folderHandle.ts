/**
 * Persist and restore FileSystemDirectoryHandle in IndexedDB.
 * Handles are keyed by song title so different projects each remember their own folder.
 * The restored handle must still call requestPermission() before use — browsers require
 * a user gesture, but the picker dialog itself counts.
 */

const DB_NAME = 'barbro'
const DB_VERSION = 1
const STORE = 'folderHandles'

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

export async function saveFolderHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadFolderHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => { db.close(); resolve((req.result as FileSystemDirectoryHandle) ?? null) }
      req.onerror = () => { db.close(); reject(req.error) }
    })
  } catch {
    return null
  }
}

export async function clearFolderHandle(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch {}
}

// The File System Access API types aren't shipped in all TS lib.dom versions — cast where needed.
type FSHandle = FileSystemDirectoryHandle & {
  queryPermission(opts: { mode: string }): Promise<string>
  requestPermission(opts: { mode: string }): Promise<string>
  values(): AsyncIterableIterator<FileSystemHandle & { kind: string; name: string }>
}

/** Returns true if the handle still has (or can request) read+write permission. */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const h = handle as FSHandle
    const status = await h.queryPermission({ mode: 'readwrite' })
    if (status === 'granted') return true
    const requested = await h.requestPermission({ mode: 'readwrite' })
    return requested === 'granted'
  } catch {
    return false
  }
}

/**
 * Scan a project folder for stem audio files.
 * Looks in stems/ first (preferred), then root as fallback.
 * Returns relative paths like "stems/drums.wav".
 */
export async function scanAudioFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const results: string[] = []
  const isAudio = (name: string) => /\.(wav|mp3|aiff|aif|flac|m4a|ogg)$/i.test(name)

  // Preferred: stems/ subfolder
  try {
    const stemsDir = await dir.getDirectoryHandle('stems') as FSHandle
    for await (const entry of stemsDir.values()) {
      if (entry.kind === 'file' && isAudio(entry.name)) {
        results.push(`stems/${entry.name}`)
      }
    }
  } catch {}

  // Fallback: root-level audio files (excluding audio/ subfolder originals)
  const d = dir as FSHandle
  for await (const entry of d.values()) {
    if (entry.kind === 'file' && isAudio(entry.name)) {
      results.push(entry.name)
    }
  }

  return results.sort()
}

/** Read a file from a directory handle given a relative path (may include one subdirectory). */
export async function readFileFromHandle(
  dir: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<File> {
  const parts = relativePath.split('/')
  if (parts.length === 1) {
    const fh = await dir.getFileHandle(parts[0]!)
    return fh.getFile()
  }
  const subDir = await dir.getDirectoryHandle(parts[0]!)
  const fh = await subDir.getFileHandle(parts[1]!)
  return fh.getFile()
}

/** Write bytes to a file in the directory, creating it if needed. */
export async function writeFileToHandle(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  data: Blob,
): Promise<void> {
  const fh = await dir.getFileHandle(fileName, { create: true })
  const writable = await fh.createWritable()
  await writable.write(data)
  await writable.close()
}

/**
 * Mark the directory as an Ableton Live Project folder by creating the
 * empty `Ableton Project Info/` subfolder Ableton uses as a project marker.
 * Without this, RelativePathType="1" audio refs inside the .als won't resolve.
 */
export async function ensureAbletonProjectFolder(dir: FileSystemDirectoryHandle): Promise<void> {
  await dir.getDirectoryHandle('Ableton Project Info', { create: true })
}

// ── Recent projects ─────────────────────────────────────────────────────────

/**
 * Single record stored at `RECENT_PROJECTS_KEY` in the same IndexedDB store
 * as individual handles. The whole list is read/written as one blob — simple
 * and avoids schema churn.
 */
const RECENT_PROJECTS_KEY = 'barbro::recentProjects'
const RECENT_PROJECTS_MAX = 10

export interface RecentProjectEntry {
  /** Stable id assigned on first record — useful for `forgetRecentProject`. */
  id: string
  /** Display name. */
  name: string
  /** ISO timestamp; entries are sorted desc on read. */
  lastOpenedAt: string
  /** The handle itself, persisted natively by IndexedDB. */
  handle: FileSystemDirectoryHandle
}

type StoredRecents = { entries: RecentProjectEntry[] } | undefined

async function readRecentsRaw(): Promise<RecentProjectEntry[]> {
  try {
    const db = await openDb()
    return await new Promise<RecentProjectEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(RECENT_PROJECTS_KEY)
      req.onsuccess = () => {
        db.close()
        const v = req.result as StoredRecents
        resolve(Array.isArray(v?.entries) ? v.entries : [])
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    })
  } catch {
    return []
  }
}

async function writeRecentsRaw(entries: RecentProjectEntry[]): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ entries }, RECENT_PROJECTS_KEY)
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
    /* swallow — recents are non-critical */
  }
}

/** Most-recent first. Returns [] on any read failure. */
export async function listRecentProjects(): Promise<RecentProjectEntry[]> {
  const entries = await readRecentsRaw()
  return [...entries].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}

type HandleWithIsSameEntry = FileSystemDirectoryHandle & {
  isSameEntry(other: FileSystemDirectoryHandle): Promise<boolean>
}

/**
 * Add or update a recent entry. Dedupes by `isSameEntry` against the picked
 * handle — re-opening the same folder bumps `lastOpenedAt` rather than
 * stacking duplicates. List is trimmed to `RECENT_PROJECTS_MAX`.
 */
export async function recordRecentProject(
  handle: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const entries = await readRecentsRaw()
  const now = new Date().toISOString()
  const h = handle as HandleWithIsSameEntry

  let matchIndex = -1
  for (let i = 0; i < entries.length; i++) {
    try {
      if (await h.isSameEntry(entries[i]!.handle)) {
        matchIndex = i
        break
      }
    } catch {
      /* a stale handle may throw — treat as no match and let it age out */
    }
  }

  let next: RecentProjectEntry[]
  if (matchIndex >= 0) {
    const existing = entries[matchIndex]!
    next = [
      { ...existing, name, lastOpenedAt: now, handle },
      ...entries.slice(0, matchIndex),
      ...entries.slice(matchIndex + 1),
    ]
  } else {
    next = [
      { id: crypto.randomUUID(), name, lastOpenedAt: now, handle },
      ...entries,
    ]
  }

  if (next.length > RECENT_PROJECTS_MAX) next = next.slice(0, RECENT_PROJECTS_MAX)
  await writeRecentsRaw(next)
}

/** Remove one entry by id (e.g. when re-permission fails). */
export async function forgetRecentProject(id: string): Promise<void> {
  const entries = await readRecentsRaw()
  await writeRecentsRaw(entries.filter((e) => e.id !== id))
}

/** Wipe the whole recents list. */
export async function clearRecentProjects(): Promise<void> {
  await writeRecentsRaw([])
}

/**
 * Resolve a nested subdirectory by relative path (forward-slash separated).
 * Each segment is `getDirectoryHandle(seg, { create })`. Throws on missing
 * intermediate when create=false.
 */
export async function getDirectoryHandleByPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  options: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  const create = options.create === true
  const parts = relativePath.split('/').filter((s) => s.length > 0)
  let current = root
  for (const seg of parts) {
    current = await current.getDirectoryHandle(seg, { create })
  }
  return current
}

/**
 * Best-effort recursive remove of a child entry. Returns true on success,
 * false on any failure (including the entry not existing). Used by the
 * project commit rollback path and the "Remove from project" UI.
 */
export async function removeEntryRecursive(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    const p = parent as FileSystemDirectoryHandle & {
      removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>
    }
    await p.removeEntry(name, { recursive: true })
    return true
  } catch {
    return false
  }
}

/**
 * Best-effort: remove a relative path within `root`. The final segment may
 * be a directory (recursive) or file. Returns true on success.
 */
export async function removePathBestEffort(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  const parts = relativePath.split('/').filter((s) => s.length > 0)
  if (parts.length === 0) return false
  const leaf = parts[parts.length - 1]!
  const parentPath = parts.slice(0, -1).join('/')
  try {
    const parent = parentPath ? await getDirectoryHandleByPath(root, parentPath) : root
    return await removeEntryRecursive(parent, leaf)
  } catch {
    return false
  }
}
