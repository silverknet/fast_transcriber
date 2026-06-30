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
import type { ProjectAutoStems, ProjectFile, ProjectSongEntry } from './types'
import { AUTO_STEM_NAMES } from './types'
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
  audioReferenceFromImportedArtifact,
  prepareImportedAudio,
  type ImportedAudioArtifact,
} from '$lib/audio/importedAudio'
import { createEmptySongMap } from '$lib/songmap/factory'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import {
  createProject,
  createProjectSong,
  getProjectInfo,
  getProjectWavInfoBatch,
  watchProjectForAutoStems,
  readProjectSong,
  readProjectSongAsset,
  removeProjectSong,
  writeProjectManifest,
  writeProjectSong,
  writeProjectSongAsset,
  type ProjectSongMetadataInfo,
} from '$lib/client/desktopProjectFs'
import { STEM_PRESET_PRIORITY } from '$lib/client/desktopBridge'
import { reconcileSongAudio, applyReconcileMatch } from '$lib/project/audioReconcile'
import { hydrateRestorableSong } from '$lib/stores/restorableSong'
import { audioSession } from '$lib/stores/audioSession'
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
  const countIn = effectiveCountInBeats(map)
  if (countIn > 0) {
    out.countInBeats = countIn
  }
  if (map.stemRefs && Object.keys(map.stemRefs).length > 0) {
    out.stemRefs = { ...map.stemRefs }
  }
  if (map.audio?.sha256) out.audioSha256 = map.audio.sha256
  if (map.audio?.durationSec !== undefined) out.audioDurationSec = map.audio.durationSec
  if (map.audio?.fileName || map.audio?.originalPath) out.hasAudio = true
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
  if (info.hasAudio) out.hasAudio = true
  if (typeof info.countInBeats === 'number' && info.countInBeats > 0) {
    out.countInBeats = info.countInBeats
  }
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
  void watchProjectForAutoStems(r.projectPath).catch(() => {})
  return r.manifest
}

/**
 * Open an existing project by absolute OS path. The sidecar reads the
 * manifest, scans each song's folder (smap header + stems), and we
 * populate the store in one shot.
 *
 * Side effect: runs `migrateProjectSongsToV2` after open so any legacy v1
 * `.smap` files (with embedded audio chunks) are converted to v2 +
 * `<song>/audio/<file>` layout in one pass. Idempotent — already-v2 songs
 * are skipped.
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
  // Hand the project to the sidecar's background stem daemon. Best-effort:
  // the daemon only acts if the manifest opts in (`autoStems.enabled`), and a
  // failure here must never block opening the project.
  void watchProjectForAutoStems(projectPath).catch(() => {})

  const migrated = await migrateProjectSongsToV2(projectPath, r.manifest).catch((e) => {
    console.warn('[project] migration sweep failed:', e)
    return { migrated: 0, skipped: 0, failed: 0 }
  })
  if (migrated.migrated > 0) {
    console.info(
      `[project] migrated ${migrated.migrated} song(s) to v2 (skipped ${migrated.skipped}, failed ${migrated.failed})`,
    )
  }

  // Phase 3 identity backfill — best-effort. Async-fired so opening a
  // project doesn't block on the sidecar reading every audio file (the
  // first sweep on a big library can take a few seconds). The next
  // project open will see the stamped fields and skip the work.
  void backfillAudioIdentity(projectPath, r.manifest)
    .then((res) => {
      if (res.stamped > 0) {
        console.info(
          `[project] identity backfill: stamped ${res.stamped} song(s) (skipped ${res.skipped}, failed ${res.failed})`,
        )
      }
    })
    .catch((e) => {
      console.warn('[project] identity backfill failed:', e)
    })

  return r.manifest
}

/**
 * Iterate every song in the manifest, migrating any v1 `.smap` (embedded
 * audio chunk, no `audio.originalPath`) to the v2 file-reference layout.
 * For each song that needs migration:
 *   1. Read the bytes via the sidecar and decode (v1 decoder extracts the
 *      embedded audio chunk into `data.audioBlob`).
 *   2. Write `data.audioBlob` to `<song>/audio/<fileName>` on disk.
 *   3. Stamp `audio.originalPath` into the SongMap.
 *   4. Re-encode as v2 (JSON-only) and overwrite `song.smap`.
 *
 * Already-v2 files (audio.originalPath set, or audio absent) are skipped.
 * Errors per song are caught — the sweep never aborts mid-project.
 */
export async function migrateProjectSongsToV2(
  projectPath: string,
  manifest: ProjectFile,
): Promise<{ migrated: number; skipped: number; failed: number }> {
  let migrated = 0
  let skipped = 0
  let failed = 0
  for (const entry of manifest.songs) {
    try {
      const r = await readProjectSong(projectPath, entry.folder)
      if (!r.ok) {
        failed++
        console.warn(`[project] migrate: read failed for ${entry.folder}: ${r.error}`)
        continue
      }
      const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
      const data = await decodeSmapFile(blob)
      const audio = data.project.songMap.audio
      // Already v2 (or never had audio) — nothing to do.
      if (!data.audioBlob || !audio || audio.originalPath) {
        skipped++
        continue
      }
      const fileName = sanitizeAudioFilename(audio.fileName ?? 'audio.bin')
      const audioBytes = new Uint8Array(await data.audioBlob.arrayBuffer())
      const w = await writeProjectSongAsset(
        projectPath,
        entry.folder,
        `audio/${fileName}`,
        audioBytes,
      )
      if (!w.ok) {
        failed++
        console.warn(`[project] migrate: asset write failed for ${entry.folder}: ${w.error}`)
        continue
      }
      const migratedMap: SongMap = {
        ...data.project.songMap,
        audio: { ...audio, originalPath: `audio/${fileName}` },
      }
      const out = await encodeSmapFile({
        project: {
          projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
          songMap: migratedMap,
        },
      })
      const outBytes = new Uint8Array(await out.arrayBuffer())
      const ws = await writeProjectSong(projectPath, entry.folder, outBytes)
      if (!ws.ok) {
        failed++
        console.warn(`[project] migrate: smap rewrite failed for ${entry.folder}: ${ws.error}`)
        continue
      }
      migrated++
    } catch (e) {
      failed++
      console.warn(`[project] migrate: exception for ${entry.folder}:`, e)
    }
  }
  return { migrated, skipped, failed }
}

/**
 * Phase 3 identity backfill: for every song that already has a resolvable
 * `audio.originalPath` but is missing any of the new identity fields
 * (`sampleRate`, `channels`, `fileSize`, or `sha256`), batch a single
 * sidecar `wav-info` call (with `withSha`) and stamp the results into the
 * .smap. One call covers the whole project, so this is cheap on next
 * open after the initial sweep.
 *
 * Idempotent — songs that already have a full identity bundle are
 * skipped before we even ask the sidecar.
 */
export async function backfillAudioIdentity(
  projectPath: string,
  manifest: ProjectFile,
): Promise<{ stamped: number; skipped: number; failed: number }> {
  let stamped = 0
  let skipped = 0
  let failed = 0

  // Phase 1: read every .smap, decide which need a backfill, gather the
  // wav-info batch input. SongMaps are kept in a temporary map so we
  // don't re-read them in phase 2.
  type PendingSong = {
    entry: ProjectSongEntry
    songMap: SongMap
    originalPath: string
  }
  const pending: PendingSong[] = []

  for (const entry of manifest.songs) {
    try {
      const r = await readProjectSong(projectPath, entry.folder)
      if (!r.ok) {
        failed++
        continue
      }
      const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
      const data = await decodeSmapFile(blob)
      const audio = data.project.songMap.audio
      if (!audio?.originalPath) {
        // No file to probe — nothing to backfill.
        skipped++
        continue
      }
      const needsIdentity =
        audio.sampleRate === undefined ||
        audio.channels === undefined ||
        audio.fileSize === undefined ||
        audio.sha256 === undefined
      if (!needsIdentity) {
        skipped++
        continue
      }
      pending.push({
        entry,
        songMap: data.project.songMap,
        originalPath: audio.originalPath,
      })
    } catch (e) {
      failed++
      console.warn(`[project] identity backfill: read failed for ${entry.folder}:`, e)
    }
  }

  if (pending.length === 0) {
    return { stamped, skipped, failed }
  }

  // Phase 2: one batch wav-info call for every song that needs it.
  // `withSha: true` makes this O(N) reads of the audio bytes — slow on
  // big libraries, but only the first time. Subsequent opens skip
  // everything in Phase 1.
  const info = await getProjectWavInfoBatch(
    projectPath,
    pending.map((p) => ({ songFolder: p.entry.folder, subpath: p.originalPath })),
    { withSha: true },
  )
  if (!info.ok) {
    return { stamped, skipped, failed: failed + pending.length }
  }

  const infoByFolder = new Map<string, (typeof info.items)[number]>()
  for (const item of info.items) infoByFolder.set(item.songFolder, item)

  // Phase 3: stamp + re-write each .smap. Failures are per-song.
  for (const p of pending) {
    try {
      const item = infoByFolder.get(p.entry.folder)
      if (!item || 'error' in item) {
        failed++
        continue
      }
      const audio = p.songMap.audio
      if (!audio) {
        failed++
        continue
      }
      const patched: SongMap = {
        ...p.songMap,
        audio: {
          ...audio,
          // Don't overwrite existing values — `withSha` returns sha256
          // for every file, but the SongMap's sha256 might already be
          // the upload-time hash. Keep the existing one.
          sampleRate: audio.sampleRate ?? item.sampleRate,
          channels: audio.channels ?? item.channels,
          fileSize: audio.fileSize ?? item.fileSize,
          durationSec: audio.durationSec ?? item.durationSec,
          sha256: audio.sha256 ?? item.sha256,
        },
      }
      const out = await encodeSmapFile({
        project: {
          projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
          songMap: patched,
        },
      })
      const outBytes = new Uint8Array(await out.arrayBuffer())
      const ws = await writeProjectSong(projectPath, p.entry.folder, outBytes)
      if (!ws.ok) {
        failed++
        continue
      }
      stamped++
    } catch (e) {
      failed++
      console.warn(`[project] identity backfill: rewrite failed for ${p.entry.folder}:`, e)
    }
  }

  return { stamped, skipped, failed }
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
 *
 * Side effects when `state.audioBlob` is present:
 *   1. The audio file is copied to `<song>/audio/<fileName>` on disk.
 *   2. `audio.originalPath` is stamped into the SongMap before the .smap
 *      is encoded, so the next reload can find the audio file.
 *
 * If the audio-write fails, the .smap is still committed (with no
 * `originalPath`) and the user will see the relink prompt on reload.
 */
export async function commitNewSongToProject(state: RestorableSongState): Promise<{
  entry: ProjectSongEntry
}> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')

  // Build the SongMap to be persisted. We stamp `audio.originalPath` BEFORE
  // encoding so it's baked into the v2 .smap; the actual audio-file write
  // happens after the folder is allocated (in writeSongIntoProject).
  const audioFileName = state.audioBlob && state.songMap.audio?.fileName
    ? sanitizeAudioFilename(state.songMap.audio.fileName)
    : null
  const songMapForPersist: SongMap = audioFileName && state.songMap.audio
    ? {
        ...state.songMap,
        audio: { ...state.songMap.audio, originalPath: `audio/${audioFileName}` },
      }
    : state.songMap
  const stateForPersist: RestorableSongState = { ...state, songMap: songMapForPersist }

  const meta = metadataLiteFromSongMap(songMapForPersist)
  const blob = await exportRestorableStateAsSmapBlob(stateForPersist)
  const smapBytes = new Uint8Array(await blob.arrayBuffer())
  const { entry, nextManifest } = await writeSongIntoProject(snap.osPath, snap.data, smapBytes, meta)

  // Write audio next. Errors are non-fatal — the song commits regardless
  // and the relink banner will surface the missing file on the next load.
  if (audioFileName && state.audioBlob) {
    try {
      const bytes = new Uint8Array(await state.audioBlob.arrayBuffer())
      await writeProjectSongAsset(snap.osPath, entry.folder, `audio/${audioFileName}`, bytes)
    } catch (e) {
      console.warn('[project] failed to copy audio for new song:', e)
    }
  }

  setProjectData(nextManifest)
  patchMetadataForFolder(entry.folder, meta)
  setActiveSong(entry.folder, entry.id)
  return { entry }
}

/**
 * Persist the in-memory state of the **already-active** project song back to
 * its existing folder. Unlike `commitNewSongToProject`, this allocates no new
 * folder or manifest entry — it overwrites the active song's `song.smap` in
 * place.
 *
 * Used by the analyze flow when the song already lives in the project (audio
 * was attached via the project row's "Add audio"). Calling
 * `commitNewSongToProject` there would duplicate the song; this updates it.
 * Same write the debounced autosave performs, but synchronous and immediate
 * so a fast navigation/reload right after analysis can't drop the result.
 *
 * Audio bytes are NOT rewritten — they already live on disk under
 * `<song>/audio/` and `audio.originalPath` survives in the SongMap.
 */
export async function updateActiveProjectSong(state: RestorableSongState): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  if (
    snap.editingMode !== 'project-song' ||
    !snap.activeSongFolder ||
    !snap.activeSongId
  ) {
    throw new Error('No active project song to update')
  }
  const entry = snap.data.songs.find(
    (e) => e.folder === snap.activeSongFolder && e.id === snap.activeSongId,
  )
  if (!entry) throw new Error('Active song is no longer in the project manifest')

  const blob = await exportRestorableStateAsSmapBlob(state)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const w = await writeProjectSong(snap.osPath, entry.folder, bytes)
  if (!w.ok) throw new Error(`Could not write song.smap: ${w.error}`)

  patchMetadataForFolder(entry.folder, metadataLiteFromSongMap(state.songMap))
}

/** Strip path separators / control chars so a filename is safe inside `audio/`. */
function sanitizeAudioFilename(name: string): string {
  const cleaned = name.replace(/[\/\\\x00-\x1f]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : 'audio.bin'
}

/**
 * Add a stub song (title only, no audio, empty timeline) to the active
 * project. Lets the user pre-populate a setlist and come back later to
 * drop the audio in via the analyze flow / "Open in editor" path.
 *
 * The .smap that lands on disk is the minimum the validator accepts:
 * format version + metadata (title + timestamps) + empty timeline +
 * empty sections + empty harmony + default cues. Once the user opens
 * the song in the editor and uploads audio, the analyze flow fills in
 * the timeline and stamps `audio.originalPath`.
 */
export async function createEmptySongInProject(
  title: string,
): Promise<{ entry: ProjectSongEntry }> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')

  const map = createEmptySongMap()
  map.metadata = { ...map.metadata, title: title.trim() || 'Untitled' }
  const stateForPersist: RestorableSongState = { songMap: map, audioBlob: null }
  const meta = metadataLiteFromSongMap(map)
  const blob = await exportRestorableStateAsSmapBlob(stateForPersist)
  const smapBytes = new Uint8Array(await blob.arrayBuffer())
  const { entry, nextManifest } = await writeSongIntoProject(
    snap.osPath,
    snap.data,
    smapBytes,
    meta,
  )
  setProjectData(nextManifest)
  patchMetadataForFolder(entry.folder, meta)
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

  let state = smapFileDataToRestorableState(data, entry.id)
  const audio = state.songMap.audio

  // Path A — v2 happy path: SongMap names a path under <song>/. Read the
  //                         file off disk via the sidecar and put it in
  //                         the session.
  if (!state.audioBlob && audio?.originalPath) {
    const got = await readProjectSongAsset(snap.osPath, entry.folder, audio.originalPath)
    if (got.ok) {
      const mime = audio.mimeType ?? 'audio/*'
      const file = new File([got.blob], audio.fileName ?? 'audio', { type: mime })
      state = { ...state, audioBlob: file }
    } else {
      console.warn(`[project] audio file missing at ${audio.originalPath}:`, got.error)
    }
  }

  // Path A.5 — Phase 5 reconcile. The named originalPath didn't resolve
  // (file renamed, hydration-pack drop, fresh-machine cloud join). Scan
  // <song>/audio/ and try to find the right file by content identity
  // — sha256 first, then duration/sr/channels/fileSize. On a strict
  // match we stamp the new path into the SongMap and persist the
  // .smap so the next open hits Path A cleanly.
  if (!state.audioBlob && state.songMap.audio) {
    try {
      const outcome = await reconcileSongAudio(state.songMap, snap.osPath, entry.folder)
      if (outcome.kind === 'strict-match') {
        const repaired = applyReconcileMatch(state.songMap.audio, {
          fileName: outcome.fileName,
          identity: outcome.identity,
        })
        const repairedMap: SongMap = { ...state.songMap, audio: repaired }
        // Pull the freshly-identified bytes from disk.
        const got = await readProjectSongAsset(snap.osPath, entry.folder, repaired.originalPath ?? `audio/${outcome.fileName}`)
        if (got.ok) {
          const file = new File([got.blob], repaired.fileName, { type: repaired.mimeType ?? 'audio/*' })
          state = { ...state, audioBlob: file, songMap: repairedMap }
          // Persist the stamped path so reconcile doesn't re-run next time.
          try {
            const repairedSmap = await exportRestorableStateAsSmapBlob(state)
            const repairedBytes = new Uint8Array(await repairedSmap.arrayBuffer())
            const ws = await writeProjectSong(snap.osPath, entry.folder, repairedBytes)
            if (!ws.ok) console.warn(`[project] reconcile .smap rewrite failed: ${ws.error}`)
          } catch (e) {
            console.warn('[project] reconcile .smap rewrite threw:', e)
          }
        }
      }
      // Loose-match and no-match cases fall through to the missing-audio
      // banner; the banner UI lets the user accept a loose match
      // explicitly rather than guessing here.
    } catch (e) {
      console.warn('[project] audio reconcile failed:', e)
    }
  }

  // Path B — legacy v1 file decoded with an embedded audio chunk AND no
  //          `originalPath` recorded yet. Migrate forward: write the bytes
  //          to <song>/audio/<fileName>, stamp `originalPath` into the
  //          SongMap, and re-encode the .smap as v2 so this only happens
  //          once. The audioBlob from the v1 decode hydrates the session
  //          either way, so the user notices no interruption.
  if (state.audioBlob && audio && !audio.originalPath) {
    const fileName = sanitizeAudioFilename(audio.fileName ?? 'audio.bin')
    try {
      const bytes = new Uint8Array(await state.audioBlob.arrayBuffer())
      const w = await writeProjectSongAsset(
        snap.osPath,
        entry.folder,
        `audio/${fileName}`,
        bytes,
      )
      if (w.ok) {
        const migratedMap: SongMap = {
          ...state.songMap,
          audio: { ...audio, originalPath: `audio/${fileName}` },
        }
        const migratedSmap = await exportRestorableStateAsSmapBlob({
          ...state,
          songMap: migratedMap,
        })
        const migratedBytes = new Uint8Array(await migratedSmap.arrayBuffer())
        const ws = await writeProjectSong(snap.osPath, entry.folder, migratedBytes)
        if (ws.ok) state = { ...state, songMap: migratedMap }
        else console.warn(`[project] v1→v2 .smap rewrite failed: ${ws.error}`)
      } else {
        console.warn(`[project] could not write audio for v1 migration: ${w.error}`)
      }
    } catch (e) {
      console.warn('[project] v1 → v2 audio migration failed:', e)
    }
  }

  hydrateRestorableSong(state)
  // Reset the per-session "ignore missing audio" flag — the user opted
  // out of the banner for the previous song; the new song gets a fresh
  // chance to show it. Then, if audio was referenced but not loaded,
  // flag the session so the relink banner renders.
  audioSession.update((s) => ({ ...s, missingAudioIgnored: false }))
  if (!state.audioBlob && state.songMap.audio?.originalPath) {
    audioSession.update((s) => ({ ...s, missingReason: 'file-not-found' }))
  }
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

/**
 * Replace the project's song order with `orderedIds`. The new array must
 * contain exactly the same ids as the current `songs` list (no duplicates,
 * no missing) — drag-and-drop reorder is the only caller and is purely a
 * permutation. Persisted to the manifest atomically.
 */
export async function setSongOrder(orderedIds: string[]): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const current = snap.data.songs
  if (orderedIds.length !== current.length) {
    throw new Error('Reorder rejected: id-list length mismatch')
  }
  const byId = new Map(current.map((s) => [s.id, s]))
  const reordered: ProjectSongEntry[] = []
  const seen = new Set<string>()
  for (const id of orderedIds) {
    const s = byId.get(id)
    if (!s) throw new Error(`Reorder rejected: unknown song id ${id}`)
    if (seen.has(id)) throw new Error(`Reorder rejected: duplicate song id ${id}`)
    seen.add(id)
    reordered.push(s)
  }
  const next: ProjectFile = { ...snap.data, updatedAt: nowIso(), songs: reordered }
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

/**
 * Attach an audio file to an existing song that has no audio yet (typically
 * a stub song from "Add empty"). One-shot: copies the bytes into
 * `<song>/audio/<sanitized fileName>`, stamps the SongMap's `audio` block
 * (fileName, mimeType, originalPath, source, trim covering the full clip),
 * forces `metadata.analyzed = false` so the next "Open in editor" routes
 * to `/analyzing`, and refreshes the project's lite-metadata cache so the
 * row immediately shows the audio dot.
 *
 * Doesn't trigger analysis itself — that happens when the user opens the
 * song. Lets the user attach to many songs in a row without spinning up
 * the sidecar repeatedly.
 */
export async function attachImportedAudioToSong(
  songId: string,
  artifact: ImportedAudioArtifact,
): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const entry = snap.data.songs.find((s) => s.id === songId)
  if (!entry) throw new Error('Song not found in project')

  const fileName = sanitizeAudioFilename(artifact.fileName || artifact.file?.name || 'audio.bin')
  const subpath = artifact.alreadyWrittenSubpath ?? `audio/${fileName}`

  if (!artifact.alreadyWrittenSubpath) {
    if (!artifact.file) throw new Error('No audio bytes available to attach.')
    const bytes = new Uint8Array(await artifact.file.arrayBuffer())
    const w = await writeProjectSongAsset(snap.osPath, entry.folder, subpath, bytes)
    if (!w.ok) throw new Error(`Could not write audio file: ${w.error}`)
  }

  // Read the existing .smap, stamp the audio block + analyzed=false, write back.
  const r = await readProjectSong(snap.osPath, entry.folder)
  if (!r.ok) throw new Error(`Could not read song.smap: ${r.error}`)
  const smapBlob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
  const data = await decodeSmapFile(smapBlob)
  const map = data.project.songMap
  const updatedMap: SongMap = {
    ...map,
    metadata: {
      ...map.metadata,
      analyzed: false,
      updatedAt: nowIso(),
    },
    audio: {
      ...audioReferenceFromImportedArtifact(
        {
          ...artifact,
          fileName,
          mimeType: artifact.mimeType || artifact.file?.type || map.audio?.mimeType,
          alreadyWrittenSubpath: subpath,
        },
        { startSec: 0, endSec: artifact.durationSec },
      ),
      originalPath: subpath,
    },
  }
  const updatedProject = { ...data.project, songMap: updatedMap }
  const reEncoded = await encodeSmapFile({ project: updatedProject })
  const reEncodedBytes = new Uint8Array(await reEncoded.arrayBuffer())
  const ww = await writeProjectSong(snap.osPath, entry.folder, reEncodedBytes)
  if (!ww.ok) throw new Error(`Could not write song.smap: ${ww.error}`)

  // Refresh the in-memory lite metadata so the project card flips its
  // audio dot to ready immediately.
  patchMetadataForFolder(entry.folder, metadataLiteFromSongMap(updatedMap))
}

export async function attachAudioToSong(
  songId: string,
  audioFile: File,
): Promise<void> {
  let artifact: ImportedAudioArtifact
  try {
    artifact = await prepareImportedAudio(audioFile, { source: 'upload' })
  } catch (e) {
    throw new Error(
      `Could not decode audio file: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  await attachImportedAudioToSong(songId, artifact)
}

/**
 * Rename a song in the active project. Rewrites `metadata.title` inside
 * the song's `.smap` and refreshes the in-memory lite-metadata cache so
 * the project view updates immediately.
 *
 * The folder name is intentionally NOT touched — it's also used as a
 * stable id for stem refs, cloud links, and audio-asset paths, so
 * mutating it would break a lot of resolution surfaces. Display title
 * lives in the .smap; folder name stays a stable slug.
 */
export async function renameSongInProject(songId: string, newTitle: string): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const entry = snap.data.songs.find((s) => s.id === songId)
  if (!entry) throw new Error('Song not found in project')

  const trimmed = newTitle.trim() || 'Untitled'

  // Read → mutate title → re-encode → write. Audio bytes (if any) survive
  // because the encoder preserves the original SongProject shape.
  const r = await readProjectSong(snap.osPath, entry.folder)
  if (!r.ok) throw new Error(`Could not read song.smap: ${r.error}`)
  const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
  const data = await decodeSmapFile(blob)
  const oldTitle = data.project.songMap.metadata.title
  if (oldTitle === trimmed) return // no-op

  const updatedMap: SongMap = {
    ...data.project.songMap,
    metadata: {
      ...data.project.songMap.metadata,
      title: trimmed,
      updatedAt: nowIso(),
    },
  }
  const updatedProject = { ...data.project, songMap: updatedMap }
  // v2 encoder never embeds audio (bytes live in `<song>/audio/<file>` on
  // disk). Any audioBlob from legacy decode is dropped here; the on-disk
  // audio file already covers v1→v2 carry-over.
  const reEncoded = await encodeSmapFile({ project: updatedProject })
  const bytes = new Uint8Array(await reEncoded.arrayBuffer())
  const w = await writeProjectSong(snap.osPath, entry.folder, bytes)
  if (!w.ok) throw new Error(`Could not write song.smap: ${w.error}`)

  // Refresh the lite-metadata cache so the project list shows the new
  // title without needing a full Refresh.
  const lite = metadataLiteFromSongMap(updatedMap)
  patchMetadataForFolder(entry.folder, lite)
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

/**
 * Persist the project-wide auto stem-separation policy into the manifest.
 * The background scheduler ([autoStems.ts]) reacts to the resulting
 * `projectStore` change. Writing the manifest (not a song .smap) is correct
 * — this is project-level config, like rename / reorder.
 */
export async function setProjectAutoStems(config: ProjectAutoStems): Promise<void> {
  const snap = get(project)
  if (!snap.osPath || !snap.data) throw new Error('No active project')
  const next: ProjectFile = {
    ...snap.data,
    autoStems: {
      enabled: config.enabled,
      // De-dupe + drop anything not a known stem name; keep a stable order.
      stems: AUTO_STEM_NAMES.filter((n) => config.stems.includes(n)),
      quality: config.quality,
    },
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
  // v2 encoder drops embedded audio; `data.audioBlob` (if present from a
  // legacy v1 file) stays in session only. The audio file on disk under
  // `<song>/audio/` is the canonical source going forward.
  const out = await encodeSmapFile({
    project: { projectFormatVersion: SONG_PROJECT_FORMAT_VERSION, songMap: mergedMap },
  })
  const outBytes = new Uint8Array(await out.arrayBuffer())
  const w = await writeProjectSong(projectPath, songFolder, outBytes)
  if (!w.ok) throw new Error(w.error)
}

// Re-exports kept for legacy callers (project format version reference).
export { PROJECT_FILE_VERSION }
