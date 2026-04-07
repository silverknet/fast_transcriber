import { SongMapParseError, parseSongMap } from './parse'
import { serializeSongMap } from './serialize'
import {
  decodeSmapBytes,
  encodeSmapFile,
  looksLikeSmapFile,
  songProjectFromRestorableState,
  smapFileDataToRestorableState,
  SONG_PROJECT_FORMAT_VERSION,
  type SongProject,
} from './smapFile'
import type { RestorableSongState } from './session'
import type { SongMap } from './types'

export type ExportBundle = {
  /** UTF-8 JSON; same shape as a DB `song_map` document column. */
  json: string
  /** Raw audio bytes; null when no blob (JSON-only export). */
  audioBlob: Blob | null
}

/**
 * Serialize the musical document for DB / plain JSON export. Does not embed audio bytes in JSON.
 */
export function exportSongMapJson(map: SongMap, pretty = true): string {
  return serializeSongMap(map, { pretty })
}

/**
 * Pair JSON + optional sidecar blob for file export or upload (multipart).
 */
export function exportRestorableBundle(state: RestorableSongState): ExportBundle {
  return {
    json: exportSongMapJson(state.songMap),
    audioBlob: state.audioBlob,
  }
}

export type ParsedSongMapJson = { ok: true; map: SongMap } | { ok: false; error: string }

export function parseSongMapJsonString(raw: string): ParsedSongMapJson {
  try {
    const map = parseSongMap(raw)
    return { ok: true, map }
  } catch (e) {
    const msg =
      e instanceof SongMapParseError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Parse failed'
    return { ok: false, error: msg }
  }
}

export function restorableStateFromJsonAndBlob(
  json: string,
  audioBlob: Blob | File | null,
  songId?: string,
): { ok: true; state: RestorableSongState } | { ok: false; error: string } {
  const parsed = parseSongMapJsonString(json)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    state: {
      songMap: parsed.map,
      audioBlob,
      songId,
    },
  }
}

/** SHA-256 hex digest; use for `AudioReference.sha256` and blob storage keys. */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Attach computed digest to map.audio when missing (immutably).
 */
export async function withAudioSha256(map: SongMap, blob: Blob): Promise<SongMap> {
  if (!map.audio) return map
  if (map.audio.sha256) return map
  const sha256 = await sha256HexOfBlob(blob)
  return {
    ...map,
    audio: { ...map.audio, sha256 },
  }
}

/**
 * Parse UTF-8 text as either a `SongProject` envelope or a legacy raw `SongMap` JSON root.
 */
export function parseSongProjectFromUtf8Text(
  text: string,
): { ok: true; project: SongProject } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'JSON root must be an object' }
  }
  const o = raw as Record<string, unknown>

  if (o.projectFormatVersion === SONG_PROJECT_FORMAT_VERSION && o.songMap && typeof o.songMap === 'object') {
    const inner = parseSongMapJsonString(JSON.stringify(o.songMap))
    if (!inner.ok) return inner
    return {
      ok: true,
      project: {
        projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
        songMap: inner.map,
      },
    }
  }

  const legacy = parseSongMapJsonString(text)
  if (legacy.ok) {
    return {
      ok: true,
      project: {
        projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
        songMap: legacy.map,
      },
    }
  }
  return { ok: false, error: legacy.error }
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

/**
 * Encode full restorable state as a single binary `.smap` file (see `smapFile.ts`).
 */
export async function exportRestorableStateAsSmapBlob(state: RestorableSongState): Promise<Blob> {
  const project = songProjectFromRestorableState(state)
  return encodeSmapFile({
    project,
    audioBlob: state.audioBlob ?? undefined,
  })
}

/**
 * Import a user-selected file: binary `.smap`, or plain JSON (`SongProject` or legacy `SongMap`).
 * JSON imports never include audio bytes.
 */
export async function parseImportedProjectFile(
  file: File,
): Promise<{ ok: true; state: RestorableSongState } | { ok: false; error: string }> {
  const buf = new Uint8Array(await file.arrayBuffer())

  if (looksLikeSmapFile(buf)) {
    try {
      const data = decodeSmapBytes(buf)
      return { ok: true, state: smapFileDataToRestorableState(data) }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid .smap file'
      return { ok: false, error: msg }
    }
  }

  if (looksLikeZip(buf)) {
    return {
      ok: false,
      error:
        'This file looks like an old .zip bundle. Re-export from BarBro as a single .smap file, or import plain JSON without audio.',
    }
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return { ok: false, error: 'File is not valid UTF-8 (expected .smap binary or JSON)' }
  }

  const proj = parseSongProjectFromUtf8Text(text)
  if (!proj.ok) return proj

  return {
    ok: true,
    state: {
      songMap: proj.project.songMap,
      audioBlob: null,
    },
  }
}

/** Browser download for a `Blob` (e.g. `.smap`). */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** @deprecated Prefer {@link downloadBlob} for `.smap`. */
export function downloadUint8ArrayAsFile(
  bytes: Uint8Array,
  filename: string,
  mime: string = 'application/octet-stream',
): void {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: mime }), filename)
}

/** Safe single-segment filename stem from song title. */
export function safeExportBasename(title: string): string {
  const t = title.trim() || 'song'
  const s = t.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80)
  return s || 'song'
}

export type { SongProject } from './smapFile'
export {
  decodeSmapFile,
  encodeSmapFile,
  looksLikeSmapFile,
  SMAP_BLOB_TYPE,
  SMAP_FILE_VERSION,
  SMAP_FLAG_HAS_AUDIO,
  SMAP_HEADER_BYTE_LENGTH,
  smapFileDataToRestorableState,
  songProjectFromRestorableState,
  SONG_PROJECT_FORMAT_VERSION,
} from './smapFile'
export type { SmapFileData } from './smapFile'
