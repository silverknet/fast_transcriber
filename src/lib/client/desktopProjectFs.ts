/**
 * Web ⇄ desktop project filesystem bridge.
 *
 * All project I/O (manifest read/write, song.smap create/read/write,
 * stems scan, song-folder remove) goes through these loopback HTTP calls.
 * The browser File System Access API is NOT used for project mode — the
 * desktop sidecar is the only disk-IO layer.
 *
 * Every function returns a typed Result `{ ok: true, ... } | { ok: false, error }`.
 * No throws on network failure; callers handle the sidecar-offline case
 * explicitly (project mode requires the desktop client).
 */

import { BARBRO_DESKTOP_BEACON_PORT } from './desktopBeacon'
import type { ProjectFile } from '$lib/project/types'
import type { SongKey } from '$lib/songmap'
import type { StemRefs } from '$lib/songmap/types'

const BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

/** Per-song lite metadata returned by `getProjectInfo`. */
export interface ProjectSongMetadataInfo {
  title: string
  artist?: string
  keyDetail?: SongKey
  bpm?: number
  /** Count-in beats when `cues.mode === 'countIn'`; 0/absent otherwise. */
  countInBeats?: number
  stemRefs?: StemRefs
  hasSmap: boolean
  hasAls: boolean
  /** True iff `<song>/cue/cue-track.wav` exists on disk. */
  hasCueTrack: boolean
  /** True iff `<song>/cue/click-track.wav` exists on disk. */
  hasClickTrack: boolean
  /**
   * Stem renderings grouped by quality preset. Keys are preset slugs
   * (`best` / `balanced` / `preview`) corresponding to subfolders under
   * `<song>/stems/<slug>/`. Flat-layout legacy files (directly under
   * `<song>/stems/`) appear under the `'legacy'` key. Empty object when
   * no stems exist anywhere.
   */
  stemsByPreset: Record<string, string[]>
}

export type CreateProjectResult =
  | { ok: true; projectPath: string; manifest: ProjectFile }
  | { ok: false; error: string }

export type ProjectInfoResult =
  | {
      ok: true
      manifest: ProjectFile
      songsMetadata: Record<string, ProjectSongMetadataInfo>
    }
  | { ok: false; error: string }

export type ProjectOkResult = { ok: true } | { ok: false; error: string }

async function postJson<T>(url: string, body: unknown): Promise<T | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    return (await res.json()) as T
  } catch {
    return { ok: false, error: `Sidecar returned non-JSON (HTTP ${res.status})` }
  }
}

/** Encode a Uint8Array as base64 (browser-safe). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export async function createProject(parentPath: string, name: string): Promise<CreateProjectResult> {
  return await postJson<CreateProjectResult>(`${BASE_URL}/native/project/create`, { parentPath, name })
}

export async function getProjectInfo(projectPath: string): Promise<ProjectInfoResult> {
  return await postJson<ProjectInfoResult>(`${BASE_URL}/native/project/info`, { projectPath })
}

export async function writeProjectManifest(
  projectPath: string,
  manifest: ProjectFile,
): Promise<ProjectOkResult> {
  return await postJson<ProjectOkResult>(`${BASE_URL}/native/project/manifest/write`, {
    projectPath,
    manifest,
  })
}

export async function createProjectSong(
  projectPath: string,
  songFolder: string,
  smapBytes: Uint8Array,
): Promise<ProjectOkResult> {
  return await postJson<ProjectOkResult>(`${BASE_URL}/native/project/song/create`, {
    projectPath,
    songFolder,
    smapBase64: bytesToBase64(smapBytes),
  })
}

export async function readProjectSong(
  projectPath: string,
  songFolder: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const url = new URL(`${BASE_URL}/native/project/song/read`)
  url.searchParams.set('projectPath', projectPath)
  url.searchParams.set('songFolder', songFolder)
  let res: Response
  try {
    res = await fetch(url.toString(), { cache: 'no-store' })
  } catch (e) {
    return { ok: false, error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) {
    let err = `Read failed (HTTP ${res.status})`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) err = j.error
    } catch {
      /* keep default */
    }
    return { ok: false, error: err }
  }
  const buf = await res.arrayBuffer()
  return { ok: true, bytes: new Uint8Array(buf) }
}

export async function writeProjectSong(
  projectPath: string,
  songFolder: string,
  smapBytes: Uint8Array,
): Promise<ProjectOkResult> {
  return await postJson<ProjectOkResult>(`${BASE_URL}/native/project/song/write`, {
    projectPath,
    songFolder,
    smapBase64: bytesToBase64(smapBytes),
  })
}

export async function removeProjectSong(
  projectPath: string,
  songFolder: string,
  deleteFiles: boolean,
): Promise<ProjectOkResult> {
  return await postJson<ProjectOkResult>(`${BASE_URL}/native/project/song/remove`, {
    projectPath,
    songFolder,
    deleteFiles,
  })
}

/**
 * Write an arbitrary file under a song folder (e.g. `cue/cue-track.wav`).
 * Path is validated by the sidecar; no `..` segments allowed. Intermediate
 * directories are created.
 */
export async function writeProjectSongAsset(
  projectPath: string,
  songFolder: string,
  subpath: string,
  bytes: Uint8Array,
): Promise<ProjectOkResult> {
  return await postJson<ProjectOkResult>(`${BASE_URL}/native/project/song/asset/write`, {
    projectPath,
    songFolder,
    subpath,
    contentBase64: bytesToBase64(bytes),
  })
}

/**
 * Write a single file at the PROJECT ROOT (e.g. `<projectName>.als`).
 * Path is validated by the sidecar; no `..` segments allowed. Intermediate
 * directories are created.
 */
export async function writeProjectAsset(
  projectPath: string,
  subpath: string,
  bytes: Uint8Array,
): Promise<ProjectOkResult> {
  return await postJson<ProjectOkResult>(`${BASE_URL}/native/project/asset/write`, {
    projectPath,
    subpath,
    contentBase64: bytesToBase64(bytes),
  })
}

/** One entry in a `getProjectWavInfoBatch` response. */
export type ProjectWavInfo =
  | {
      songFolder: string
      subpath: string
      durationSec: number
      sampleRate: number
      channels: number
      fileSize: number
      /** Present iff the caller passed `withSha: true`. */
      sha256?: string
    }
  | {
      songFolder: string
      subpath: string
      error: string
    }

export type ProjectWavInfoBatchResult =
  | { ok: true; items: ProjectWavInfo[] }
  | { ok: false; error: string }

/**
 * Read WAV header info (duration / sample rate / channels) for a batch of
 * files under the project tree. Per-file errors don't abort the batch
 * — each item either has the info fields or an `error` field.
 *
 * `withSha` opts into per-file SHA-256. Costs ~50ms per WAV at typical
 * sizes — fine for one-shot work like the Phase 3 identity backfill
 * sweep, but skip it for hot paths like `refreshProjectInfo`.
 */
export async function getProjectWavInfoBatch(
  projectPath: string,
  files: Array<{ songFolder: string; subpath: string }>,
  options: { withSha?: boolean } = {},
): Promise<ProjectWavInfoBatchResult> {
  return await postJson<ProjectWavInfoBatchResult>(`${BASE_URL}/native/project/wav-info/batch`, {
    projectPath,
    files,
    ...(options.withSha ? { withSha: true } : {}),
  })
}

/** One entry in a `scanProjectSongAudio` response. */
export type ProjectAudioScanItem = {
  fileName: string
  sha256?: string
  durationSec?: number
  sampleRate?: number
  channels?: number
  fileSize?: number
  error?: string
}

export type ProjectAudioScanResult =
  | { ok: true; items: ProjectAudioScanItem[] }
  | { ok: false; error: string }

/**
 * Walk `<projectPath>/<songFolder>/audio/` and return an identity bundle
 * (sha256 + duration + sample rate + channels + file size) for each
 * audio file. Used by the Phase 5 reconciler to find files matching
 * `expectedAudio` even when the path recorded in the SongMap has
 * drifted (file renamed, dropped from a hydration pack, etc.).
 *
 * The sidecar caches hashes by `(path, mtime, size)` in memory, so
 * repeated calls on the same files are cheap.
 */
export async function scanProjectSongAudio(
  projectPath: string,
  songFolder: string,
): Promise<ProjectAudioScanResult> {
  return await postJson<ProjectAudioScanResult>(`${BASE_URL}/native/project/song/audio/scan`, {
    projectPath,
    songFolder,
  })
}

export type TranscodeToWavResult =
  | { ok: true; cached: boolean }
  | { ok: false; error: string }

/**
 * Transcode a compressed audio file (typically MP3) to 16-bit PCM WAV
 * inside the project tree. Cache-aware via sidecar mtime check — the
 * actual ffmpeg call only runs when needed.
 *
 * Used by the Ableton setlist export to ensure every clip is uncompressed
 * (no encoder priming offsets) for sample-accurate alignment.
 */
export async function transcodeProjectAudioToWav(
  projectPath: string,
  songFolder: string,
  srcSubpath: string,
  dstSubpath: string,
): Promise<TranscodeToWavResult> {
  return await postJson<TranscodeToWavResult>(`${BASE_URL}/native/project/transcode-to-wav`, {
    projectPath,
    songFolder,
    srcSubpath,
    dstSubpath,
  })
}

export type RelinkAudioResult =
  | {
      ok: true
      /** Relative POSIX path under the song folder, e.g. `audio/song.mp3`. */
      relPath: string
      /** Basename component of `relPath`. */
      fileName: string
      /** SHA-256 hex of the bytes that were just copied to disk. */
      sha256: string
      size: number
      /**
       * Identity bundle — Phase 3 made these mandatory on the sidecar
       * (we always read the WAV/MP3 header at relink time), but they're
       * declared optional here in case the user is talking to an older
       * sidecar that doesn't return them yet.
       */
      fileSize?: number
      durationSec?: number
      sampleRate?: number
      channels?: number
    }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }

/**
 * Open the OS file picker, copy the chosen audio file into
 * `<song>/audio/<filename>`, and return the relative path + SHA-256 in one
 * round-trip. Callers compare the returned `sha256` against the SongMap's
 * `audio.originalSha256` to detect a content mismatch.
 */
export async function relinkProjectSongAudio(
  projectPath: string,
  songFolder: string,
  defaultName?: string,
): Promise<RelinkAudioResult> {
  return await postJson<RelinkAudioResult>(`${BASE_URL}/native/project/song/audio/relink`, {
    projectPath,
    songFolder,
    defaultName: defaultName ?? null,
  })
}

/**
 * Read an arbitrary file from under a song folder (e.g. `stems/vocals.wav`,
 * `cue/cue-track.wav`). Returns the bytes as a Blob for direct use with
 * `AudioContext.decodeAudioData`. 404 → ok:false.
 */
export async function readProjectSongAsset(
  projectPath: string,
  songFolder: string,
  subpath: string,
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  const url = new URL(`${BASE_URL}/native/project/song/asset/read`)
  url.searchParams.set('projectPath', projectPath)
  url.searchParams.set('songFolder', songFolder)
  url.searchParams.set('subpath', subpath)
  let res: Response
  try {
    res = await fetch(url.toString(), { cache: 'no-store' })
  } catch (e) {
    return { ok: false, error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) {
    let err = `Read failed (HTTP ${res.status})`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) err = j.error
    } catch {
      /* keep default */
    }
    return { ok: false, error: err }
  }
  return { ok: true, blob: await res.blob() }
}
