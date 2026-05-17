/**
 * Project mutation primitives — create / open / commit-new-song /
 * import-smap / hide / remove. All disk I/O goes through the desktop
 * sidecar's `/native/project/*` endpoints (see [desktopProjectFs](../client/desktopProjectFs.ts));
 * the browser File System Access API is not used for project mode.
 *
 * Canonical identity for a project is its absolute OS path. The store's
 * `osPath` is the single source of truth; `localStorage[barbro::lastProjectPath]`
 * persists it across reloads.
 *
 * The invariant: a manifest entry never points to a missing or invalid
 * `song.smap` — the commit ladder writes the .smap first, then the
 * manifest, with rollback if anything in between fails.
 */
import { get } from 'svelte/store'
import type { ProjectFile, ProjectSongEntry } from './types'
import {
  PROJECT_FILE_VERSION,
  PROJECT_SONGS_DIR,
  songFolderLeaf,
} from './types'
import {
  decodeSmapFile,
  encodeSmapFile,
  exportRestorableStateAsSmapBlob,
  safeExportBasename,
  smapFileDataToRestorableState,
  SONG_PROJECT_FORMAT_VERSION,
} from '$lib/songmap/persist'
import type { RestorableSongState, SongMap } from '$lib/songmap'
import {
  createProject,
  createProjectSong,
  getProjectInfo,
  readProjectSong,
  removeProjectSong,
  writeProjectManifest,
  writeProjectSong,
  type ProjectSongMetadataInfo,
} from '$lib/client/desktopProjectFs'
import { STEM_PRESET_PRIORITY } from '$lib/client/desktopBridge'
import { hydrateRestorableSong } from '$lib/stores/restorableSong'
import {
  patchMetadataForFolder,
  project,
  setActiveProject,
  setActiveSong,
  setMetadataByFolder,
  setProjectData,
  type ProjectSongMetadataLite,
} from '$lib/stores/project'

/** localStorage key for "abs OS path of the project that was open when the user last left BarBro". */
export const LAST_PROJECT_PATH_KEY = 'barbro::lastProjectPath'

/** localStorage key for "song that was active when the user last left BarBro". */
export const ACTIVE_SONG_ID_KEY = 'barbro::activeSongId'

/** localStorage key for the recents list (`string[]` of abs OS paths). */
export const RECENT_PROJECTS_KEY = 'barbro::recentProjects'

export const SONG_SMAP_FILENAME = 'song.smap'
export const SONG_ALS_FILENAME = 'song.als'

const RECENT_PROJECTS_CAP = 10

// ── localStorage helpers ────────────────────────────────────────────────────

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* localStorage may be disabled — persistence is best-effort */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function readLastProjectPath(): string | null {
  const v = lsGet(LAST_PROJECT_PATH_KEY)
  return v && v.trim() ? v : null
}

export function writeLastProjectPath(p: string): void {
  lsSet(LAST_PROJECT_PATH_KEY, p)
}

export function clearLastProjectPath(): void {
  lsRemove(LAST_PROJECT_PATH_KEY)
}

/** Recents are pure paths — names are derived on read from `getProjectInfo`. */
export function readRecentProjectPaths(): string[] {
  try {
    const raw = lsGet(RECENT_PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && !!x.trim())
  } catch {
    return []
  }
}

export function recordRecentProjectPath(projectPath: string): void {
  const existing = readRecentProjectPaths().filter((p) => p !== projectPath)
  const next = [projectPath, ...existing].slice(0, RECENT_PROJECTS_CAP)
  lsSet(RECENT_PROJECTS_KEY, JSON.stringify(next))
}

export function dropRecentProjectPath(projectPath: string): void {
  const next = readRecentProjectPaths().filter((p) => p !== projectPath)
  lsSet(RECENT_PROJECTS_KEY, JSON.stringify(next))
}

// ── Metadata helpers ────────────────────────────────────────────────────────

/** Extract the lite metadata used by the project list view from a SongMap. */
export function metadataLiteFromSongMap(map: SongMap): ProjectSongMetadataLite {
  const m = map.metadata
  const out: ProjectSongMetadataLite = { title: m.title }
  if (m.artist) out.artist = m.artist
  if (m.keyDetail) out.keyDetail = m.keyDetail
  if (m.bpm !== undefined) out.bpm = m.bpm
  if (map.stemRefs && Object.keys(map.stemRefs).length > 0) {
    out.stemRefs = { ...map.stemRefs }
  }
  return out
}

/** Translate the sidecar's per-song info shape into the store-friendly lite shape. */
function liteFromInfo(info: ProjectSongMetadataInfo, fallbackFolder: string): ProjectSongMetadataLite {
  const out: ProjectSongMetadataLite = { title: info.title || songFolderLeaf(fallbackFolder) }
  if (info.artist) out.artist = info.artist
  if (info.keyDetail) out.keyDetail = info.keyDetail
  if (typeof info.bpm === 'number') out.bpm = info.bpm
  if (info.stemRefs && Object.keys(info.stemRefs).length > 0) out.stemRefs = info.stemRefs
  if (info.stemsByPreset && Object.keys(info.stemsByPreset).length > 0) {
    out.stemsByPreset = info.stemsByPreset
  }
  if (info.hasAls) out.hasAls = true
  if (info.hasCueTrack) out.hasCueTrack = true
  if (info.hasClickTrack) out.hasClickTrack = true
  return out
}

/**
 * Best stem set available for a song, by preset priority. Returns null
 * when no stems are on disk. The returned `pathPrefix` is the relative
 * folder to prepend to each file name to get a sidecar-readable path —
 * `stems/<preset>/` for tagged sets, `stems/` for legacy.
 */
export function selectBestStemSet(
  meta: ProjectSongMetadataLite | undefined,
): { preset: string; files: string[]; pathPrefix: string } | null {
  const sets = meta?.stemsByPreset
  if (!sets) return null
  for (const slug of STEM_PRESET_PRIORITY) {
    const files = sets[slug]
    if (files && files.length > 0) {
      return {
        preset: slug,
        files,
        pathPrefix: slug === 'legacy' ? 'stems/' : `stems/${slug}/`,
      }
    }
  }
  // Unknown / future preset slug — fall back to whichever non-empty set
  // we find first. Keeps the mixer working if a newer sidecar invents a
  // tier this web build doesn't know about yet.
  for (const [slug, files] of Object.entries(sets)) {
    if (files.length > 0) {
      return { preset: slug, files, pathPrefix: `stems/${slug}/` }
    }
  }
  return null
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Compute folder name `<slug>-<id.slice(0,8)>` for a song. */
export function songFolderName(title: string, id: string): string {
  const slug = safeExportBasename(title)
  return `${slug}-${id.slice(0, 8)}`
}

// ── Lifecycle: create / open / restore / close ─────────────────────────────

/**
 * Create a brand-new project on disk via the sidecar. The picked
 * `parentPath` is the containing location; the sidecar slugifies `name`
 * and creates a subfolder there. Hydrates the project store on success.
 */
export async function createProjectOnDisk(parentPath: string, name: string): Promise<ProjectFile> {
  const r = await createProject(parentPath, name)
  if (!r.ok) throw new Error(r.error)
  setActiveProject(r.projectPath, r.manifest, {})
  writeLastProjectPath(r.projectPath)
  recordRecentProjectPath(r.projectPath)
  return r.manifest
}

/**
 * Open an existing project by absolute OS path. The sidecar reads the
 * manifest, scans each song's folder (smap header + stems), and we
 * populate the store in one shot.
 */
export async function openProjectByPath(projectPath: string): Promise<ProjectFile> {
  const r = await getProjectInfo(projectPath)
  if (!r.ok) throw new Error(r.error)
  const meta: Record<string, ProjectSongMetadataLite> = {}
  for (const [folder, info] of Object.entries(r.songsMetadata)) {
    meta[folder] = liteFromInfo(info, folder)
  }
  setActiveProject(projectPath, r.manifest, meta)
  writeLastProjectPath(projectPath)
  recordRecentProjectPath(projectPath)
  return r.manifest
}

/**
 * Best-effort restore of the most-recently-opened project on app load.
 * Reads `lastProjectPath` from localStorage and re-hydrates via the
 * sidecar. Silent on any failure — the user can re-open from the File menu.
 */
export async function tryRestoreLastProject(): Promise<ProjectFile | null> {
  const p = readLastProjectPath()
  if (!p) return null
  try {
    return await openProjectByPath(p)
  } catch {
    return null
  }
}

/**
 * Re-fetch project info from the sidecar and refresh the in-memory caches.
 * Used after stems land, after manual file moves, and on `/project` mount.
 * The sidecar's scan is the source of truth for what stems exist on disk;
 * we also sync each song's `.smap.stemRefs` to match what was discovered.
 */
export async function refreshProjectInfo(): Promise<{ updatedSongs: number; errors: string[] }> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) return { updatedSongs: 0, errors: ['No active project'] }

  const r = await getProjectInfo(snap.osPath)
  if (!r.ok) return { updatedSongs: 0, errors: [r.error] }

  const errors: string[] = []
  let updatedSongs = 0
  const nextMeta: Record<string, ProjectSongMetadataLite> = {}

  for (const entry of r.manifest.songs) {
    const info = r.songsMetadata[entry.folder]
    if (!info) {
      nextMeta[entry.folder] = { title: songFolderLeaf(entry.folder) }
      continue
    }
    nextMeta[entry.folder] = liteFromInfo(info, entry.folder)

    // If the .smap's stemRefs don't match the highest-quality set on disk,
    // rewrite them. Lower-quality renderings are ignored here so the .smap
    // never points at a preview file when a Best render is also available.
    const best = selectBestStemSet(nextMeta[entry.folder])
    const discoveredRefs: Record<string, string> = {}
    if (best) {
      for (const filename of best.files) {
        const slot = slotForStemFilename(filename)
        if (slot) discoveredRefs[slot] = `${best.pathPrefix}${filename}`
      }
    }
    const existingRefs = info.stemRefs ?? {}
    const toAdd: Record<string, string> = {}
    for (const [slot, rel] of Object.entries(discoveredRefs)) {
      if (existingRefs[slot] !== rel) toAdd[slot] = rel
    }
    if (Object.keys(toAdd).length > 0 && info.hasSmap) {
      try {
        await mergeStemRefsIntoSmap(snap.osPath, entry.folder, toAdd)
        updatedSongs++
        nextMeta[entry.folder] = {
          ...nextMeta[entry.folder],
          stemRefs: { ...existingRefs, ...toAdd },
        }
      } catch (e) {
        errors.push(`${entry.folder}: ${e instanceof Error ? e.message : 'unknown'}`)
      }
    }
  }

  setProjectData(r.manifest)
  setMetadataByFolder(nextMeta)
  return { updatedSongs, errors }
}

// ── Song commit ladder ──────────────────────────────────────────────────────

/**
 * Atomic-ish commit: write song.smap to disk, then update the manifest.
 * Folder collisions are handled by regenerating the song id (cap 3 retries).
 * On manifest-write failure, the orphan song folder is removed. On
 * song.smap-create failure, no manifest mutation has happened so the
 * invariant holds.
 */
async function writeSongIntoProject(
  projectPath: string,
  manifest: ProjectFile,
  smapBytes: Uint8Array,
  meta: ProjectSongMetadataLite,
): Promise<{ entry: ProjectSongEntry; nextManifest: ProjectFile }> {
  let id = crypto.randomUUID()
  let leaf = songFolderName(meta.title, id)
  let folderRel = `${PROJECT_SONGS_DIR}/${leaf}`

  let attempt = 0
  while (attempt < 3) {
    const r = await createProjectSong(projectPath, folderRel, smapBytes)
    if (r.ok) break
    // 409 conflict (folder already has song.smap) — regenerate id.
    if (r.error.toLowerCase().includes('already exists') && attempt < 2) {
      attempt++
      id = crypto.randomUUID()
      leaf = songFolderName(meta.title, id)
      folderRel = `${PROJECT_SONGS_DIR}/${leaf}`
      continue
    }
    throw new Error(`Failed to create song.smap: ${r.error}`)
  }

  const entry: ProjectSongEntry = { id, folder: folderRel }
  const nextManifest: ProjectFile = {
    ...manifest,
    updatedAt: nowIso(),
    songs: [...manifest.songs, entry],
  }
  const w = await writeProjectManifest(projectPath, nextManifest)
  if (!w.ok) {
    // Roll back the orphan song folder.
    await removeProjectSong(projectPath, folderRel, true).catch(() => {})
    throw new Error(`Failed to update barbro.project.json: ${w.error}`)
  }
  return { entry, nextManifest }
}

/**
 * Commit a brand-new song (from the analyze flow) into the active project.
 * Updates the project store and sets the song as active so autosave takes
 * over.
 */
export async function commitNewSongToProject(state: RestorableSongState): Promise<{
  entry: ProjectSongEntry
}> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const meta = metadataLiteFromSongMap(state.songMap)
  const blob = await exportRestorableStateAsSmapBlob(state)
  const smapBytes = new Uint8Array(await blob.arrayBuffer())
  const { entry, nextManifest } = await writeSongIntoProject(snap.osPath, snap.data, smapBytes, meta)
  setProjectData(nextManifest)
  patchMetadataForFolder(entry.folder, meta)
  setActiveSong(entry.folder, entry.id)
  return { entry }
}

/**
 * Import an existing `.smap` file from anywhere into the active project.
 * Bytes are copied as-is (audio preserved); a fresh song id is generated.
 */
export async function importSmapToProject(
  smapBlob: Blob,
  meta: ProjectSongMetadataLite,
): Promise<{ entry: ProjectSongEntry }> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const smapBytes = new Uint8Array(await smapBlob.arrayBuffer())
  const { entry, nextManifest } = await writeSongIntoProject(snap.osPath, snap.data, smapBytes, meta)
  setProjectData(nextManifest)
  patchMetadataForFolder(entry.folder, meta)
  return { entry }
}

// ── Edit / load ─────────────────────────────────────────────────────────────

/**
 * Read a project song's `.smap` (with audio) and hydrate the editor stores.
 * Caller still navigates to /edit.
 */
export async function loadProjectSongIntoEditor(songId: string): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const entry = snap.data.songs.find((s) => s.id === songId)
  if (!entry) throw new Error('Song not found in project')

  const r = await readProjectSong(snap.osPath, entry.folder)
  if (!r.ok) throw new Error(`Could not read song.smap: ${r.error}`)
  const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
  const data = await decodeSmapFile(blob)
  const state = smapFileDataToRestorableState(data, entry.id)
  hydrateRestorableSong(state)
  patchMetadataForFolder(entry.folder, metadataLiteFromSongMap(state.songMap))
  setActiveSong(entry.folder, entry.id)
}

// ── Manifest-only mutations ─────────────────────────────────────────────────

export async function moveProjectSong(songId: string, delta: -1 | 1): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const songs = snap.data.songs
  const idx = songs.findIndex((s) => s.id === songId)
  if (idx === -1) throw new Error('Song not found in project')
  const newIdx = idx + delta
  if (newIdx < 0 || newIdx >= songs.length) return

  const nextSongs = [...songs]
  const [removed] = nextSongs.splice(idx, 1)
  nextSongs.splice(newIdx, 0, removed)

  const next: ProjectFile = { ...snap.data, updatedAt: nowIso(), songs: nextSongs }
  const w = await writeProjectManifest(snap.osPath, next)
  if (!w.ok) throw new Error(`Failed to write manifest: ${w.error}`)
  setProjectData(next)
}

export async function setSongHidden(songId: string, hidden: boolean): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const idx = snap.data.songs.findIndex((s) => s.id === songId)
  if (idx === -1) throw new Error('Song not found in project')
  const next: ProjectFile = {
    ...snap.data,
    updatedAt: nowIso(),
    songs: snap.data.songs.map((s, i) => (i === idx ? { ...s, hidden: hidden || undefined } : s)),
  }
  const w = await writeProjectManifest(snap.osPath, next)
  if (!w.ok) throw new Error(`Failed to write manifest: ${w.error}`)
  setProjectData(next)
}

export async function renameProject(newName: string): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const next: ProjectFile = {
    ...snap.data,
    name: newName.trim() || 'Untitled Project',
    updatedAt: nowIso(),
  }
  const w = await writeProjectManifest(snap.osPath, next)
  if (!w.ok) throw new Error(`Failed to write manifest: ${w.error}`)
  setProjectData(next)
}

export async function removeSongFromProject(
  songId: string,
  options: { deleteFiles?: boolean } = {},
): Promise<{ filesRemoved: boolean }> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const entry = snap.data.songs.find((s) => s.id === songId)
  if (!entry) throw new Error('Song not found in project')

  let filesRemoved = false
  if (options.deleteFiles) {
    const r = await removeProjectSong(snap.osPath, entry.folder, true)
    filesRemoved = r.ok
  }

  const next: ProjectFile = {
    ...snap.data,
    updatedAt: nowIso(),
    songs: snap.data.songs.filter((s) => s.id !== songId),
  }
  const w = await writeProjectManifest(snap.osPath, next)
  if (!w.ok) throw new Error(`Failed to write manifest: ${w.error}`)

  setProjectData(next)
  project.update((s) => {
    const m = { ...s.metadataByFolder }
    delete m[entry.folder]
    return { ...s, metadataByFolder: m }
  })
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

// ── Stems helpers ───────────────────────────────────────────────────────────

/**
 * Map a Demucs output filename like `vocals.wav` to the canonical
 * `STEM_TRACKS` slot name. Returns null when no obvious match.
 */
export function slotForStemFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase()
  const direct: Record<string, string> = {
    vocals: 'Vocals',
    drums: 'Drums',
    bass: 'Bass',
    other: 'Guitar',
    guitar: 'Guitar',
    fx: 'FX',
  }
  return direct[base] ?? null
}

/**
 * Read a song's `.smap` via the sidecar, merge in extra stemRefs, write back.
 * Used by `refreshProjectInfo` when stems on disk drift from the manifest.
 */
async function mergeStemRefsIntoSmap(
  projectPath: string,
  songFolder: string,
  newRefs: Record<string, string>,
): Promise<void> {
  const r = await readProjectSong(projectPath, songFolder)
  if (!r.ok) throw new Error(r.error)
  const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
  const data = await decodeSmapFile(blob)
  const mergedMap = {
    ...data.project.songMap,
    stemRefs: { ...(data.project.songMap.stemRefs ?? {}), ...newRefs },
  }
  const out = await encodeSmapFile({
    project: { projectFormatVersion: SONG_PROJECT_FORMAT_VERSION, songMap: mergedMap },
    audioBlob: data.audioBlob,
  })
  const outBytes = new Uint8Array(await out.arrayBuffer())
  const w = await writeProjectSong(projectPath, songFolder, outBytes)
  if (!w.ok) throw new Error(w.error)
}

// Re-exports kept for legacy callers (project format version reference).
export { PROJECT_FILE_VERSION }
