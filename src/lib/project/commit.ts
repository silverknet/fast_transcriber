/**
 * Project mutation primitives — create / open / commit-new-song /
 * import-smap / hide / remove. Every disk-touching helper here uses the
 * atomic ladder described in the project plan: state is mutated only after
 * the bytes are durable on disk, and rollback is best-effort with a clear
 * "files may remain on disk" surface when even rollback fails.
 *
 * The key invariant: a manifest entry never points to a missing or invalid
 * `song.smap`.
 */

import { get } from 'svelte/store'
import type { ProjectFile, ProjectSongEntry } from './types'
import {
  PROJECT_FILE_VERSION,
  PROJECT_FILENAME,
  PROJECT_SONGS_DIR,
  songFolderLeaf,
} from './types'
import { parseProjectJson } from './parse'
import { projectToBlob } from './serialize'
import {
  ensurePermission,
  getDirectoryHandleByPath,
  removeEntryRecursive,
  removePathBestEffort,
  saveFolderHandle,
  writeFileToHandle,
} from '$lib/client/folderHandle'
import {
  decodeSmapFile,
  exportRestorableStateAsSmapBlob,
  readSmapJsonOnly,
  safeExportBasename,
  smapFileDataToRestorableState,
} from '$lib/songmap/persist'
import type { RestorableSongState, SongMap } from '$lib/songmap'
import { hydrateRestorableSong } from '$lib/stores/restorableSong'
import {
  patchMetadataForFolder,
  project,
  setActiveProject,
  setActiveSong,
  setProjectData,
  type ProjectSongMetadataLite,
} from '$lib/stores/project'

export const PROJECT_HANDLE_KEY = 'barbro::activeProject'

export const SONG_SMAP_FILENAME = 'song.smap'
export const SONG_ALS_FILENAME = 'song.als'

/** Extract the lite metadata used by the project list view. */
export function metadataLiteFromSongMap(map: SongMap): ProjectSongMetadataLite {
  const m = map.metadata
  const out: ProjectSongMetadataLite = { title: m.title }
  if (m.artist) out.artist = m.artist
  if (m.keyDetail) out.keyDetail = m.keyDetail
  if (m.bpm !== undefined) out.bpm = m.bpm
  return out
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Compute folder name `<slug>-<id.slice(0,8)>` for a song. */
export function songFolderName(title: string, id: string): string {
  const slug = safeExportBasename(title)
  return `${slug}-${id.slice(0, 8)}`
}

async function readManifestFromHandle(dir: FileSystemDirectoryHandle): Promise<ProjectFile> {
  const fh = await dir.getFileHandle(PROJECT_FILENAME)
  const file = await fh.getFile()
  const text = await file.text()
  return parseProjectJson(text)
}

async function writeManifestToHandle(
  dir: FileSystemDirectoryHandle,
  data: ProjectFile,
): Promise<void> {
  await writeFileToHandle(dir, PROJECT_FILENAME, projectToBlob(data))
}

async function ensureSongsDir(dir: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  return await dir.getDirectoryHandle(PROJECT_SONGS_DIR, { create: true })
}

/**
 * Returns true if `parent` already contains an entry (file or directory)
 * with that name. Used by the create-folder retry policy.
 */
async function hasChild(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  type V = FileSystemDirectoryHandle & {
    values(): AsyncIterableIterator<FileSystemHandle & { name: string }>
  }
  for await (const entry of (parent as V).values()) {
    if (entry.name === name) return true
  }
  return false
}

/**
 * Create a new project on disk. Picks a folder, writes
 * `barbro.project.json` with an empty songs array, persists the handle.
 * Caller is responsible for asking the user to pick the folder via
 * `showDirectoryPicker({ mode: 'readwrite' })` and passing the handle in.
 */
export async function createProjectOnDisk(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<ProjectFile> {
  const data: ProjectFile = {
    formatVersion: PROJECT_FILE_VERSION,
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled Project',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    songs: [],
  }
  await writeManifestToHandle(dir, data)
  // Pre-create songs/ so the project layout matches the documented shape.
  await ensureSongsDir(dir)
  await saveFolderHandle(PROJECT_HANDLE_KEY, dir)
  setActiveProject(dir, data, {})
  return data
}

/**
 * Open an existing project: validate the manifest, populate the per-song
 * metadata cache by reading each `<folder>/song.smap` JSON chunk only.
 * On manifest validation failure, throws — the project does not load.
 */
export async function openProjectFromHandle(
  dir: FileSystemDirectoryHandle,
): Promise<ProjectFile> {
  const data = await readManifestFromHandle(dir)
  const metadata: Record<string, ProjectSongMetadataLite> = {}
  for (const entry of data.songs) {
    try {
      const songDir = await getDirectoryHandleByPath(dir, entry.folder)
      const fh = await songDir.getFileHandle(SONG_SMAP_FILENAME)
      const f = await fh.getFile()
      const sp = await readSmapJsonOnly(f)
      metadata[entry.folder] = metadataLiteFromSongMap(sp.songMap)
    } catch {
      metadata[entry.folder] = { title: songFolderLeaf(entry.folder) }
    }
  }
  await saveFolderHandle(PROJECT_HANDLE_KEY, dir)
  setActiveProject(dir, data, metadata)
  return data
}

/**
 * Try to restore the active project from IndexedDB. Returns null on any
 * failure (no handle, permission denied, missing/invalid manifest).
 * The store is left untouched on failure.
 */
export async function tryRestoreActiveProject(
  loadedHandle: FileSystemDirectoryHandle | null,
): Promise<ProjectFile | null> {
  if (!loadedHandle) return null
  const ok = await ensurePermission(loadedHandle)
  if (!ok) return null
  try {
    return await openProjectFromHandle(loadedHandle)
  } catch {
    return null
  }
}

/**
 * Atomic commit ladder used by `commitNewSongToProject` and
 * `importSmapToProject`. Creates the folder, writes the .smap, appends the
 * manifest entry, all with rollback on failure. Returns the entry on
 * success.
 *
 * Failure surface:
 *  - At any step before manifest write: best-effort folder removal; if even
 *    that fails, throws an error explaining files may remain on disk.
 *  - After manifest write: in-memory state is updated; this step cannot
 *    fail.
 */
async function writeSongIntoProject(
  dir: FileSystemDirectoryHandle,
  manifest: ProjectFile,
  smapBlob: Blob,
  meta: ProjectSongMetadataLite,
): Promise<{ entry: ProjectSongEntry; nextManifest: ProjectFile }> {
  const songsDir = await ensureSongsDir(dir)

  // 1. Generate id + folder name with up to 3 retries on collision.
  let id = crypto.randomUUID()
  let leaf = songFolderName(meta.title, id)
  let attempts = 0
  while ((await hasChild(songsDir, leaf)) && attempts < 3) {
    id = crypto.randomUUID()
    leaf = songFolderName(meta.title, id)
    attempts++
  }
  if (await hasChild(songsDir, leaf)) {
    throw new Error('Could not create unique song folder after 3 attempts (permission issue?)')
  }

  // 2. Create the song directory.
  const songDir = await songsDir.getDirectoryHandle(leaf, { create: true })

  // 3. Write song.smap.
  try {
    await writeFileToHandle(songDir, SONG_SMAP_FILENAME, smapBlob)
  } catch (e) {
    const removed = await removeEntryRecursive(songsDir, leaf)
    if (!removed) {
      throw new Error(
        'Project was not updated, but files may remain on disk: failed to write song.smap and could not roll back the song folder.',
      )
    }
    const msg = e instanceof Error ? e.message : 'unknown error'
    throw new Error(`Failed to write song.smap: ${msg}`)
  }

  // 4. Append manifest entry + write manifest.
  const folderRel = `${PROJECT_SONGS_DIR}/${leaf}`
  const entry: ProjectSongEntry = { id, folder: folderRel }
  const nextManifest: ProjectFile = {
    ...manifest,
    updatedAt: nowIso(),
    songs: [...manifest.songs, entry],
  }
  try {
    await writeManifestToHandle(dir, nextManifest)
  } catch (e) {
    const removed = await removeEntryRecursive(songsDir, leaf)
    if (!removed) {
      throw new Error(
        'Project was not updated, but files may remain on disk: failed to update barbro.project.json and could not roll back the song folder.',
      )
    }
    const msg = e instanceof Error ? e.message : 'unknown error'
    throw new Error(`Failed to update barbro.project.json: ${msg}`)
  }

  return { entry, nextManifest }
}

/**
 * Commit a brand-new song (from the analyze flow) into the active
 * project. Updates the project store and sets the song as active so the
 * autosave subscription can take over.
 */
export async function commitNewSongToProject(state: RestorableSongState): Promise<{
  entry: ProjectSongEntry
}> {
  const snap = get(project)
  if (!snap.folderHandle || !snap.data) {
    throw new Error('No active project')
  }
  const meta = metadataLiteFromSongMap(state.songMap)
  const blob = await exportRestorableStateAsSmapBlob(state)
  const { entry, nextManifest } = await writeSongIntoProject(
    snap.folderHandle,
    snap.data,
    blob,
    meta,
  )
  setProjectData(nextManifest)
  patchMetadataForFolder(entry.folder, meta)
  setActiveSong(entry.folder, entry.id)
  return { entry }
}

/**
 * Import an existing `.smap` file from anywhere on disk into the active
 * project. The bytes are copied as-is (audio chunk preserved); a fresh
 * song id is generated for the new project entry.
 */
export async function importSmapToProject(
  smapBlob: Blob,
  meta: ProjectSongMetadataLite,
): Promise<{ entry: ProjectSongEntry }> {
  const snap = get(project)
  if (!snap.folderHandle || !snap.data) {
    throw new Error('No active project')
  }
  const { entry, nextManifest } = await writeSongIntoProject(
    snap.folderHandle,
    snap.data,
    smapBlob,
    meta,
  )
  setProjectData(nextManifest)
  patchMetadataForFolder(entry.folder, meta)
  return { entry }
}

/**
 * Open a project song into the editor: read the .smap (with audio bytes),
 * hydrate the songMap + audioSession stores, and mark this song as active
 * for autosave. Caller still navigates to /edit.
 */
export async function loadProjectSongIntoEditor(songId: string): Promise<void> {
  const snap = get(project)
  if (!snap.folderHandle || !snap.data) throw new Error('No active project')
  const entry = snap.data.songs.find((s) => s.id === songId)
  if (!entry) throw new Error('Song not found in project')

  const songDir = await getDirectoryHandleByPath(snap.folderHandle, entry.folder)
  const fh = await songDir.getFileHandle(SONG_SMAP_FILENAME)
  const file = await fh.getFile()
  const data = await decodeSmapFile(file)
  const state = smapFileDataToRestorableState(data, entry.id)
  hydrateRestorableSong(state)
  patchMetadataForFolder(entry.folder, metadataLiteFromSongMap(state.songMap))
  setActiveSong(entry.folder, entry.id)
}

/**
 * Move a song earlier or later in the manifest `songs` array (canonical setlist order).
 * No-op if already at the boundary. Writes `barbro.project.json` and bumps `updatedAt`.
 */
export async function moveProjectSong(songId: string, delta: -1 | 1): Promise<void> {
  const snap = get(project)
  if (!snap.folderHandle || !snap.data) throw new Error('No active project')
  const songs = snap.data.songs
  const idx = songs.findIndex((s) => s.id === songId)
  if (idx === -1) throw new Error('Song not found in project')
  const newIdx = idx + delta
  if (newIdx < 0 || newIdx >= songs.length) return

  const nextSongs = [...songs]
  const [removed] = nextSongs.splice(idx, 1)
  nextSongs.splice(newIdx, 0, removed)

  const next: ProjectFile = {
    ...snap.data,
    updatedAt: nowIso(),
    songs: nextSongs,
  }
  await writeManifestToHandle(snap.folderHandle, next)
  setProjectData(next)
}

/** Toggle the `hidden` flag for a song entry by id. */
export async function setSongHidden(songId: string, hidden: boolean): Promise<void> {
  const snap = get(project)
  if (!snap.folderHandle || !snap.data) throw new Error('No active project')
  const idx = snap.data.songs.findIndex((s) => s.id === songId)
  if (idx === -1) throw new Error('Song not found in project')
  const next: ProjectFile = {
    ...snap.data,
    updatedAt: nowIso(),
    songs: snap.data.songs.map((s, i) => (i === idx ? { ...s, hidden: hidden || undefined } : s)),
  }
  await writeManifestToHandle(snap.folderHandle, next)
  setProjectData(next)
}

/** Rename the project itself (not a song). Bumps `updatedAt`. */
export async function renameProject(newName: string): Promise<void> {
  const snap = get(project)
  if (!snap.folderHandle || !snap.data) throw new Error('No active project')
  const next: ProjectFile = {
    ...snap.data,
    name: newName.trim() || 'Untitled Project',
    updatedAt: nowIso(),
  }
  await writeManifestToHandle(snap.folderHandle, next)
  setProjectData(next)
}

/**
 * Remove a song from the project. With `deleteFiles=false`, only the
 * manifest entry goes away and the folder is left on disk. With
 * `deleteFiles=true`, a best-effort recursive remove of the song folder
 * runs *before* the manifest is rewritten — that order keeps the
 * manifest-never-points-to-broken-folder invariant safe even if disk
 * removal fails (we still drop the entry afterwards, but the folder is
 * clearly orphaned and the user is told).
 */
export async function removeSongFromProject(
  songId: string,
  options: { deleteFiles?: boolean } = {},
): Promise<{ filesRemoved: boolean }> {
  const snap = get(project)
  if (!snap.folderHandle || !snap.data) throw new Error('No active project')
  const entry = snap.data.songs.find((s) => s.id === songId)
  if (!entry) throw new Error('Song not found in project')

  let filesRemoved = false
  if (options.deleteFiles) {
    filesRemoved = await removePathBestEffort(snap.folderHandle, entry.folder)
  }

  const next: ProjectFile = {
    ...snap.data,
    updatedAt: nowIso(),
    songs: snap.data.songs.filter((s) => s.id !== songId),
  }
  await writeManifestToHandle(snap.folderHandle, next)

  setProjectData(next)
  // Drop cached metadata for the removed entry.
  project.update((s) => {
    const next = { ...s.metadataByFolder }
    delete next[entry.folder]
    return { ...s, metadataByFolder: next }
  })
  // If this was the active song, clear it.
  if (snap.activeSongId === songId) {
    project.update((s) => ({
      ...s,
      activeSongFolder: null,
      activeSongId: null,
      editingMode: s.editingMode === 'project-song' ? null : s.editingMode,
    }))
  }
  return { filesRemoved }
}
