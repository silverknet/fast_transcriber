/**
 * # BarBro `.smap` — single logical project file
 *
 * One `.smap` file is **one project**: a **JSON chunk** (`SongProject` —
 * structure, metadata, `songMap`). Audio bytes are NOT embedded; the user's
 * audio file lives separately on disk (referenced by `audio.originalPath`)
 * and is owned by the desktop sidecar.
 *
 * ## On-disk layout — v2 (current writer, integers little-endian)
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ HEADER (16 bytes)                                                        │
 * │   [0..3]   magic      0x53 0x4D 0x41 0x50  ("SMAP")                    │
 * │   [4..7]   version    uint32 = 2                                         │
 * │   [8..15]  jsonLength uint64  byte length of UTF-8 JSON payload        │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ JSON chunk   jsonLength bytes  UTF-8 JSON `SongProject`                │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Legacy v1 layout (decoder still supports — read only)
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ HEADER (28 bytes)                                                        │
 * │   [0..3]   magic       "SMAP"                                            │
 * │   [4..7]   version     uint32 = 1                                        │
 * │   [8..11]  flags       uint32 (bit 0 = hasAudio)                         │
 * │   [12..19] jsonLength  uint64                                            │
 * │   [20..27] audioLength uint64                                            │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ JSON chunk   jsonLength bytes                                            │
 * │ Audio chunk  audioLength bytes (only when hasAudio set)                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * The decoder reads the first 8 bytes (magic + version), branches on version.
 * The encoder always writes v2. v1 files surface their audio chunk as
 * `audioBlob` in the decode result so existing in-session playback still
 * works on legacy file imports — but re-saving as v2 will drop those bytes.
 */

import { parseSongMap } from './parse'
import type { SongMap } from './types'
import type { RestorableSongState } from './session'

/** Current on-disk `.smap` container version. v2 is JSON-only. */
export const SMAP_FILE_VERSION = 2

/** Earlier container version. Decoder still supports for legacy file imports. */
export const SMAP_FILE_VERSION_V1 = 1

/** JSON envelope version inside the UTF-8 payload (`SongProject.projectFormatVersion`). */
export const SONG_PROJECT_FORMAT_VERSION = 1 as const

/** Legacy v1 flags: bit 0 = payload included a non-empty audio chunk. */
export const SMAP_FLAG_HAS_AUDIO = 1 << 0

/** MIME type for downloaded `.smap` files. */
export const SMAP_BLOB_TYPE = 'application/vnd.barbro.smap'

/** Magic bytes at file start (ASCII "SMAP"). */
const MAGIC = new Uint8Array([0x53, 0x4d, 0x41, 0x50])

/** Byte length of the v2 binary header. */
export const SMAP_HEADER_BYTE_LENGTH = 16
/** Byte length of the legacy v1 binary header. */
export const SMAP_HEADER_BYTE_LENGTH_V1 = 28

export type SongProject = {
  projectFormatVersion: typeof SONG_PROJECT_FORMAT_VERSION
  /** Canonical musical document; includes `audio` metadata when applicable. */
  songMap: SongMap
}

export type SmapFileData = {
  project: SongProject
  /**
   * Only populated when decoding a legacy v1 file that carried an embedded
   * audio chunk. The v2 encoder never emits this. New saves drop it.
   */
  audioBlob?: Blob
}

function readMagicMismatchError(): Error {
  return new Error(
    'Invalid .smap: wrong magic bytes (expected "SMAP" at offset 0). Is this a BarBro .smap file?',
  )
}

function readUnsupportedVersionError(found: number): Error {
  return new Error(
    `Invalid .smap: unsupported container version ${found} (only version ${SMAP_FILE_VERSION} is supported).`,
  )
}

function readTruncatedFileError(expectedBytes: number, actualBytes: number): Error {
  return new Error(
    `Invalid .smap: file is truncated (expected at least ${expectedBytes} bytes from header, got ${actualBytes}).`,
  )
}

function readInvalidJsonError(): Error {
  return new Error('Invalid .smap: JSON chunk is not valid JSON.')
}

function readHasAudioButZeroLengthError(): Error {
  return new Error('Invalid .smap: hasAudio flag is set but audioLength is 0.')
}

function readFileShorterThanDeclaredError(expectedTotal: number, actual: number): Error {
  return new Error(
    `Invalid .smap: file shorter than declared lengths (need ${expectedTotal} bytes total, got ${actual}).`,
  )
}

function readTrailingGarbageError(extra: number): Error {
  return new Error(`Invalid .smap: ${extra} unexpected byte(s) after the audio chunk.`)
}

function readFlagAudioMismatchError(): Error {
  return new Error(
    'Invalid .smap: audio bytes are present but hasAudio flag is not set (or inconsistent lengths).',
  )
}

/** Deep-sort object keys so `JSON.stringify` is stable for round-trip byte identity. Arrays keep order. */
function sortKeysDeep(x: unknown): unknown {
  if (x === undefined) return undefined
  if (x === null || typeof x !== 'object') return x
  if (Array.isArray(x)) return x.map(sortKeysDeep)
  const o = x as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) {
    const v = o[k]
    if (v === undefined) continue
    const inner = sortKeysDeep(v)
    if (inner !== undefined) out[k] = inner
  }
  return out
}

/**
 * Serialize `SongProject` to UTF-8 bytes deterministically (same logical project → same bytes).
 * Ensures save → load → save yields an identical `.smap` when data is unchanged.
 */
function serializeProjectToUtf8(project: SongProject): Uint8Array {
  const sorted = sortKeysDeep(project) as SongProject
  return new TextEncoder().encode(JSON.stringify(sorted))
}

function validateMagic(buf: Uint8Array): void {
  if (buf.byteLength < 4) {
    throw readMagicMismatchError()
  }
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== MAGIC[i]) {
      throw readMagicMismatchError()
    }
  }
}

function bigintToSafeNumber(n: bigint, label: string): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid .smap: ${label} is too large for this environment.`)
  }
  return Number(n)
}

/**
 * Build the canonical JSON project envelope from in-memory state.
 */
export function songProjectFromRestorableState(state: RestorableSongState): SongProject {
  return {
    projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
    songMap: state.songMap,
  }
}

/**
 * Convert decoded `.smap` data into the store hydration shape.
 */
export function smapFileDataToRestorableState(data: SmapFileData, songId?: string): RestorableSongState {
  const meta = data.project.songMap.audio
  const name = meta?.fileName ?? 'audio'
  const mime = meta?.mimeType ?? 'application/octet-stream'

  let audioBlob: Blob | File | null = null
  if (data.audioBlob !== undefined && data.audioBlob.size > 0) {
    const b = data.audioBlob
    audioBlob =
      b instanceof File
        ? b
        : new File([b], name, {
            type: b.type || mime,
            lastModified: Date.now(),
          })
  }

  return {
    songMap: data.project.songMap,
    audioBlob,
    songId,
  }
}

/**
 * Encode one `.smap` file: 16-byte header + UTF-8 JSON chunk.
 *
 * v2 is JSON-only. Audio is never embedded — it lives on disk via the
 * sidecar at `<song>/audio/<filename>` and is referenced by
 * `songMap.audio.originalPath`. The `audioBlob` field on `SmapFileData`
 * exists only so legacy v1 decode results can travel through the same
 * type; the encoder ignores it.
 */
export async function encodeSmapFile(data: { project: SongProject }): Promise<Blob> {
  if (data.project.projectFormatVersion !== SONG_PROJECT_FORMAT_VERSION) {
    throw new Error(`Unsupported SongProject format version: ${data.project.projectFormatVersion}`)
  }

  // --- JSON chunk (deterministic UTF-8 bytes) ---
  const jsonBytes = serializeProjectToUtf8(data.project)
  const jsonLen = BigInt(jsonBytes.byteLength)

  // --- Write 16-byte header (little-endian) ---
  const header = new ArrayBuffer(SMAP_HEADER_BYTE_LENGTH)
  const view = new DataView(header)
  // bytes 0–3: magic "SMAP"
  new Uint8Array(header, 0, 4).set(MAGIC)
  // bytes 4–7: container version
  view.setUint32(4, SMAP_FILE_VERSION, true)
  // bytes 8–15: JSON chunk length
  view.setBigUint64(8, jsonLen, true)

  const total = SMAP_HEADER_BYTE_LENGTH + jsonBytes.byteLength
  const out = new Uint8Array(total)
  out.set(new Uint8Array(header), 0)
  out.set(jsonBytes, SMAP_HEADER_BYTE_LENGTH)

  return new Blob([out], { type: SMAP_BLOB_TYPE })
}

/**
 * Decode a `.smap` from a `Blob` or `File`.
 */
export async function decodeSmapFile(fileOrBlob: Blob): Promise<SmapFileData> {
  const buf = new Uint8Array(await fileOrBlob.arrayBuffer())
  return decodeSmapBytes(buf)
}

export function decodeSmapBytes(buf: Uint8Array): SmapFileData {
  // Need magic (4) + version (4) before we can branch.
  if (buf.byteLength < 8) {
    throw readTruncatedFileError(8, buf.byteLength)
  }
  validateMagic(buf)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const version = view.getUint32(4, true)

  if (version === SMAP_FILE_VERSION) return decodeSmapV2(buf, view)
  if (version === SMAP_FILE_VERSION_V1) return decodeSmapV1(buf, view)
  throw readUnsupportedVersionError(version)
}

/**
 * v2 decode: 16-byte header + JSON chunk. No audio.
 */
function decodeSmapV2(buf: Uint8Array, view: DataView): SmapFileData {
  if (buf.byteLength < SMAP_HEADER_BYTE_LENGTH) {
    throw readTruncatedFileError(SMAP_HEADER_BYTE_LENGTH, buf.byteLength)
  }
  const jsonLen = bigintToSafeNumber(view.getBigUint64(8, true), 'jsonLength')
  const expectedTotal = SMAP_HEADER_BYTE_LENGTH + jsonLen
  if (buf.byteLength < expectedTotal) {
    throw readFileShorterThanDeclaredError(expectedTotal, buf.byteLength)
  }
  if (buf.byteLength > expectedTotal) {
    throw readTrailingGarbageError(buf.byteLength - expectedTotal)
  }
  const jsonBytes = buf.subarray(SMAP_HEADER_BYTE_LENGTH, expectedTotal)
  const project = parseProjectJson(jsonBytes)
  return { project }
}

/**
 * v1 decode (legacy): 28-byte header + JSON chunk + optional audio chunk.
 *
 * Kept so users can still open `.smap` files saved before the v2 cutover.
 * Re-saving any decoded v1 file produces v2 and drops the audio bytes —
 * users will need to re-link the audio file via the sidecar (or the
 * audio chunk will surface in-session for one editing session).
 */
function decodeSmapV1(buf: Uint8Array, view: DataView): SmapFileData {
  if (buf.byteLength < SMAP_HEADER_BYTE_LENGTH_V1) {
    throw readTruncatedFileError(SMAP_HEADER_BYTE_LENGTH_V1, buf.byteLength)
  }
  const flags = view.getUint32(8, true)
  const jsonLen = bigintToSafeNumber(view.getBigUint64(12, true), 'jsonLength')
  const audioLen = bigintToSafeNumber(view.getBigUint64(20, true), 'audioLength')

  const hasAudioFlag = (flags & SMAP_FLAG_HAS_AUDIO) !== 0
  if (hasAudioFlag && audioLen === 0) throw readHasAudioButZeroLengthError()
  if (!hasAudioFlag && audioLen > 0) throw readFlagAudioMismatchError()

  const expectedTotal = SMAP_HEADER_BYTE_LENGTH_V1 + jsonLen + audioLen
  if (buf.byteLength < expectedTotal) {
    throw readFileShorterThanDeclaredError(expectedTotal, buf.byteLength)
  }
  if (buf.byteLength > expectedTotal) {
    throw readTrailingGarbageError(buf.byteLength - expectedTotal)
  }

  const jsonStart = SMAP_HEADER_BYTE_LENGTH_V1
  const jsonEnd = jsonStart + jsonLen
  const project = parseProjectJson(buf.subarray(jsonStart, jsonEnd))

  if (!hasAudioFlag) return { project }

  const audioEnd = jsonEnd + audioLen
  const rawAudio = buf.subarray(jsonEnd, audioEnd)
  const mime = project.songMap.audio?.mimeType ?? 'application/octet-stream'
  const audioBlob = new Blob([new Uint8Array(rawAudio)], { type: mime })
  return { project, audioBlob }
}

/**
 * Decode the UTF-8 JSON chunk into a `SongProject`. Shared by v1 + v2.
 */
function parseProjectJson(jsonBytes: Uint8Array): SongProject {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)
  } catch {
    throw new Error('Invalid .smap: JSON chunk is not valid UTF-8.')
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw readInvalidJsonError()
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid .smap: JSON root must be an object.')
  }

  const o = raw as Record<string, unknown>
  if (o.projectFormatVersion !== SONG_PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Invalid .smap: unsupported SongProject version ${String(o.projectFormatVersion)} (expected ${SONG_PROJECT_FORMAT_VERSION}).`,
    )
  }
  if (!o.songMap || typeof o.songMap !== 'object') {
    throw new Error('Invalid .smap: missing or invalid songMap in JSON.')
  }

  let songMap: SongMap
  try {
    songMap = parseSongMap(JSON.stringify(o.songMap))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'parse failed'
    throw new Error(`Invalid .smap: songMap does not parse: ${msg}`)
  }

  return {
    projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
    songMap,
  }
}

export function looksLikeSmapFile(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3]
}

/** Sanity bound for `jsonLength`: 10 MB. Real projects are <100 KB. */
const MAX_REASONABLE_JSON_LENGTH = 10 * 1024 * 1024

/**
 * Fast-path read of just the JSON chunk without decoding the audio bytes.
 * Used by the project list view (load metadata for many songs cheaply) and
 * any other place that wants song metadata without paying for audio.
 *
 * Validates magic, version, length-sanity, and the size invariant
 * `28 + jsonLength + audioLength === file.size`. Audio bytes are skipped
 * entirely.
 */
export async function readSmapJsonOnly(fileOrBlob: Blob): Promise<SongProject> {
  const totalSize = fileOrBlob.size
  // Minimum bytes to know magic + version. v2 header (16) is the smallest
  // valid header; legacy v1 is 28 — we read the larger amount to cover both
  // versions in a single slice.
  const probeLen = Math.min(totalSize, SMAP_HEADER_BYTE_LENGTH_V1)
  if (probeLen < 8) {
    throw readTruncatedFileError(8, totalSize)
  }

  const headerBuf = new Uint8Array(await fileOrBlob.slice(0, probeLen).arrayBuffer())
  validateMagic(headerBuf)
  const headerView = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength)
  const version = headerView.getUint32(4, true)

  let headerLen: number
  let jsonLen: number
  let audioLen = 0

  if (version === SMAP_FILE_VERSION) {
    if (probeLen < SMAP_HEADER_BYTE_LENGTH) {
      throw readTruncatedFileError(SMAP_HEADER_BYTE_LENGTH, totalSize)
    }
    headerLen = SMAP_HEADER_BYTE_LENGTH
    jsonLen = bigintToSafeNumber(headerView.getBigUint64(8, true), 'jsonLength')
  } else if (version === SMAP_FILE_VERSION_V1) {
    if (probeLen < SMAP_HEADER_BYTE_LENGTH_V1) {
      throw readTruncatedFileError(SMAP_HEADER_BYTE_LENGTH_V1, totalSize)
    }
    headerLen = SMAP_HEADER_BYTE_LENGTH_V1
    const flags = headerView.getUint32(8, true)
    jsonLen = bigintToSafeNumber(headerView.getBigUint64(12, true), 'jsonLength')
    audioLen = bigintToSafeNumber(headerView.getBigUint64(20, true), 'audioLength')
    const hasAudioFlag = (flags & SMAP_FLAG_HAS_AUDIO) !== 0
    if (hasAudioFlag && audioLen === 0) throw readHasAudioButZeroLengthError()
    if (!hasAudioFlag && audioLen > 0) throw readFlagAudioMismatchError()
  } else {
    throw readUnsupportedVersionError(version)
  }

  if (jsonLen > MAX_REASONABLE_JSON_LENGTH) {
    throw new Error(`Invalid .smap: jsonLength ${jsonLen} exceeds reasonable bound`)
  }

  const expectedTotal = headerLen + jsonLen + audioLen
  if (totalSize !== expectedTotal) {
    if (totalSize < expectedTotal) {
      throw readFileShorterThanDeclaredError(expectedTotal, totalSize)
    }
    throw readTrailingGarbageError(totalSize - expectedTotal)
  }

  const jsonStart = headerLen
  const jsonEnd = jsonStart + jsonLen
  const jsonBuf = new Uint8Array(await fileOrBlob.slice(jsonStart, jsonEnd).arrayBuffer())

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(jsonBuf)
  } catch {
    throw new Error('Invalid .smap: JSON chunk is not valid UTF-8.')
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw readInvalidJsonError()
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid .smap: JSON root must be an object.')
  }
  const o = raw as Record<string, unknown>
  if (o.projectFormatVersion !== SONG_PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Invalid .smap: unsupported SongProject version ${String(o.projectFormatVersion)} (expected ${SONG_PROJECT_FORMAT_VERSION}).`,
    )
  }
  if (!o.songMap || typeof o.songMap !== 'object') {
    throw new Error('Invalid .smap: missing or invalid songMap in JSON.')
  }

  let songMap: SongMap
  try {
    songMap = parseSongMap(JSON.stringify(o.songMap))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'parse failed'
    throw new Error(`Invalid .smap: songMap does not parse: ${msg}`)
  }

  return {
    projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
    songMap,
  }
}
