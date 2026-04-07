/**
 * # BarBro `.smap` — single logical project file
 *
 * One `.smap` file is **one project**: a **JSON chunk** (canonical `SongProject`: structure,
 * metadata, `songMap`) plus an **optional binary audio chunk** (trimmed clip bytes only).
 * No zip, no base64-in-JSON for audio.
 *
 * ## On-disk layout (all integers **little-endian**)
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ HEADER (fixed 28 bytes)                                                  │
 * │   [0..3]   magic      0x53 0x4D 0x41 0x50  ("SMAP")                    │
 * │   [4..7]   version    uint32  (container version; currently 1)           │
 * │   [8..11]  flags      uint32  (bit 0 = hasAudio; rest reserved)        │
 * │   [12..19] jsonLength uint64  byte length of UTF-8 JSON payload        │
 * │   [20..27] audioLength uint64 byte length of raw audio (0 if no audio)   │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ JSON chunk   jsonLength bytes  UTF-8 JSON `SongProject`                │
 * │ Audio chunk  audioLength bytes raw bytes (present iff hasAudio flag)   │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * **Encode rules (v1):**
 * - `audioBlob` is **missing** or **empty** (`size === 0`) → `hasAudio = false`, `audioLength = 0`, no audio chunk.
 * - `audioBlob` is **non-empty** → `hasAudio = true`, `audioLength = byte length`, append raw bytes after JSON.
 *
 * **Decode rules (v1):**
 * - `hasAudio = false` → result has **only** `{ project }` (no `audioBlob` property).
 * - `hasAudio = true` → result includes `audioBlob` with the raw bytes (typed from `songMap.audio.mimeType` when set).
 */

import { parseSongMap } from './parse'
import type { SongMap } from './types'
import type { RestorableSongState } from './session'

/** Current on-disk `.smap` container version (binary header `version` field). */
export const SMAP_FILE_VERSION = 1

/** JSON envelope version inside the UTF-8 payload (`SongProject.projectFormatVersion`). */
export const SONG_PROJECT_FORMAT_VERSION = 1 as const

/** Flags: bit 0 = payload includes a non-empty audio chunk after JSON. */
export const SMAP_FLAG_HAS_AUDIO = 1 << 0

/** MIME type for downloaded `.smap` files. */
export const SMAP_BLOB_TYPE = 'application/vnd.barbro.smap'

/** Magic bytes at file start (ASCII "SMAP"). */
const MAGIC = new Uint8Array([0x53, 0x4d, 0x41, 0x50])

/** Byte length of the binary header (fixed). */
export const SMAP_HEADER_BYTE_LENGTH = 28

export type SongProject = {
  projectFormatVersion: typeof SONG_PROJECT_FORMAT_VERSION
  /** Canonical musical document; includes `audio` metadata when applicable. */
  songMap: SongMap
}

export type SmapFileData = {
  project: SongProject
  /** Present only when the file contained an audio chunk (`hasAudio`). */
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
 * Whether we should write an audio chunk: only a **non-empty** `Blob`.
 * `undefined`, missing, or `size === 0` → no audio chunk (`hasAudio = false`, `audioLength = 0`).
 */
function shouldWriteAudioChunk(audioBlob: Blob | undefined): audioBlob is Blob {
  return audioBlob !== undefined && audioBlob.size > 0
}

/**
 * Encode one `.smap` file: fixed header + UTF-8 JSON chunk + optional raw audio chunk.
 */
export async function encodeSmapFile(data: SmapFileData): Promise<Blob> {
  if (data.project.projectFormatVersion !== SONG_PROJECT_FORMAT_VERSION) {
    throw new Error(`Unsupported SongProject format version: ${data.project.projectFormatVersion}`)
  }

  // --- JSON chunk (deterministic UTF-8 bytes) ---
  const jsonBytes = serializeProjectToUtf8(data.project)

  // --- Audio chunk: only if `audioBlob` is present and non-empty ---
  let audioBytes: Uint8Array | null = null
  if (shouldWriteAudioChunk(data.audioBlob)) {
    audioBytes = new Uint8Array(await data.audioBlob.arrayBuffer())
  }

  const hasAudio = audioBytes !== null && audioBytes.byteLength > 0
  const flags = hasAudio ? SMAP_FLAG_HAS_AUDIO : 0
  const jsonLen = BigInt(jsonBytes.byteLength)
  const audioLen = hasAudio && audioBytes ? BigInt(audioBytes.byteLength) : 0n

  // --- Write 28-byte header (little-endian) ---
  const header = new ArrayBuffer(SMAP_HEADER_BYTE_LENGTH)
  const view = new DataView(header)
  // bytes 0–3: magic "SMAP"
  new Uint8Array(header, 0, 4).set(MAGIC)
  // bytes 4–7: container version
  view.setUint32(4, SMAP_FILE_VERSION, true)
  // bytes 8–11: flags (bit 0 = hasAudio)
  view.setUint32(8, flags, true)
  // bytes 12–19: JSON chunk length
  view.setBigUint64(12, jsonLen, true)
  // bytes 20–27: audio chunk length (0 when no audio)
  view.setBigUint64(20, audioLen, true)

  const total = SMAP_HEADER_BYTE_LENGTH + jsonBytes.byteLength + (audioBytes ? audioBytes.byteLength : 0)
  const out = new Uint8Array(total)
  out.set(new Uint8Array(header), 0)
  out.set(jsonBytes, SMAP_HEADER_BYTE_LENGTH)
  if (audioBytes) {
    out.set(audioBytes, SMAP_HEADER_BYTE_LENGTH + jsonBytes.byteLength)
  }

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
  // --- Minimum size: full header ---
  if (buf.byteLength < SMAP_HEADER_BYTE_LENGTH) {
    throw readTruncatedFileError(SMAP_HEADER_BYTE_LENGTH, buf.byteLength)
  }

  // --- Magic (offset 0) ---
  validateMagic(buf)

  // Header fields use DataView on the same underlying buffer as `buf` (handles subarray offset).
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // --- Version (offset 4) ---
  const version = view.getUint32(4, true)
  if (version !== SMAP_FILE_VERSION) {
    throw readUnsupportedVersionError(version)
  }

  // --- Flags (offset 8); audioLength (offset 20) declared before slicing JSON ---
  const flags = view.getUint32(8, true)
  const jsonLenBI = view.getBigUint64(12, true)
  const audioLenBI = view.getBigUint64(20, true)

  const jsonLen = bigintToSafeNumber(jsonLenBI, 'jsonLength')
  const audioLen = bigintToSafeNumber(audioLenBI, 'audioLength')

  const hasAudioFlag = (flags & SMAP_FLAG_HAS_AUDIO) !== 0

  if (hasAudioFlag && audioLen === 0) {
    throw readHasAudioButZeroLengthError()
  }
  if (!hasAudioFlag && audioLen > 0) {
    throw readFlagAudioMismatchError()
  }

  // --- Total file size must exactly match header + chunks (detect truncation or garbage) ---
  const expectedTotal = SMAP_HEADER_BYTE_LENGTH + jsonLen + audioLen
  if (buf.byteLength < expectedTotal) {
    throw readFileShorterThanDeclaredError(expectedTotal, buf.byteLength)
  }
  if (buf.byteLength > expectedTotal) {
    throw readTrailingGarbageError(buf.byteLength - expectedTotal)
  }

  // --- Slice JSON UTF-8 bytes ---
  const jsonStart = SMAP_HEADER_BYTE_LENGTH
  const jsonEnd = jsonStart + jsonLen
  const jsonBytes = buf.subarray(jsonStart, jsonEnd)

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

  const project: SongProject = {
    projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
    songMap,
  }

  // --- Project-only vs project + audio ---
  if (!hasAudioFlag) {
    return { project }
  }

  const audioStart = jsonEnd
  const audioEnd = audioStart + audioLen
  const rawAudio = buf.subarray(audioStart, audioEnd)
  const mime = project.songMap.audio?.mimeType ?? 'application/octet-stream'
  const audioBlob = new Blob([new Uint8Array(rawAudio)], { type: mime })
  return { project, audioBlob }
}

export function looksLikeSmapFile(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3]
}
