import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import {
  decodeSmapBytes,
  encodeSmapFile,
  looksLikeSmapFile,
  SMAP_FILE_VERSION,
  SMAP_FILE_VERSION_V1,
  SMAP_FLAG_HAS_AUDIO,
  SMAP_HEADER_BYTE_LENGTH,
  SMAP_HEADER_BYTE_LENGTH_V1,
  songProjectFromRestorableState,
  SONG_PROJECT_FORMAT_VERSION,
} from './smapFile'
import { restorableSongState } from './session'

/* ──────────────────────────────────────────────────────────────────────── */
/* v2 — current encoder/decoder. JSON-only, 16-byte header.                 */
/* ──────────────────────────────────────────────────────────────────────── */

describe('smapFile · v2 (current)', () => {
  it('encodes a JSON-only file with a 16-byte header', async () => {
    const map = createEmptySongMap()
    const state = restorableSongState(map, null)
    const project = songProjectFromRestorableState(state)
    const blob = await encodeSmapFile({ project })
    const raw = new Uint8Array(await blob.arrayBuffer())
    expect(looksLikeSmapFile(raw)).toBe(true)
    const view = new DataView(raw.buffer)
    expect(view.getUint32(4, true)).toBe(SMAP_FILE_VERSION)
    expect(raw.byteLength).toBeGreaterThanOrEqual(SMAP_HEADER_BYTE_LENGTH)
  })

  it('round-trips project (JSON only — no audio in v2)', async () => {
    const map = createEmptySongMap()
    const project = songProjectFromRestorableState(restorableSongState(map, null))
    const blob = await encodeSmapFile({ project })
    const back = decodeSmapBytes(new Uint8Array(await blob.arrayBuffer()))
    expect(back.audioBlob).toBeUndefined()
    expect(back.project.songMap.metadata.title).toBe(map.metadata.title)
    expect(back.project.projectFormatVersion).toBe(SONG_PROJECT_FORMAT_VERSION)
  })

  it('save → load → save yields identical file bytes', async () => {
    const map = createEmptySongMap()
    const project = songProjectFromRestorableState(restorableSongState(map, null))
    const a = await encodeSmapFile({ project })
    const once = decodeSmapBytes(new Uint8Array(await a.arrayBuffer()))
    const b = await encodeSmapFile(once)
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array(await b.arrayBuffer()))
  })

  it('rejects truncated v2 file (smaller than header)', () => {
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH - 1)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    const view = new DataView(buf.buffer)
    view.setUint32(4, SMAP_FILE_VERSION, true)
    expect(() => decodeSmapBytes(buf)).toThrow(/truncated/)
  })

  it('rejects v2 file shorter than declared jsonLength', () => {
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH + 5)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    const view = new DataView(buf.buffer)
    view.setUint32(4, SMAP_FILE_VERSION, true)
    view.setBigUint64(8, 100n, true) // claims 100 bytes but only 5 follow
    expect(() => decodeSmapBytes(buf)).toThrow(/shorter than declared/)
  })

  it('rejects invalid JSON in v2 chunk', () => {
    const jsonPart = new TextEncoder().encode('not json {{{')
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH + jsonPart.byteLength)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    const view = new DataView(buf.buffer)
    view.setUint32(4, SMAP_FILE_VERSION, true)
    view.setBigUint64(8, BigInt(jsonPart.byteLength), true)
    buf.set(jsonPart, SMAP_HEADER_BYTE_LENGTH)
    expect(() => decodeSmapBytes(buf)).toThrow(/valid JSON/)
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* v1 — legacy decode (read-only support so old `.smap` files still open). */
/* ──────────────────────────────────────────────────────────────────────── */

describe('smapFile · v1 (legacy decode)', () => {
  /** Hand-craft a minimal valid v1 `.smap` (no audio chunk). */
  function v1Bytes(opts: {
    audioBlob?: Uint8Array
  }): Uint8Array {
    const audio = opts.audioBlob ?? new Uint8Array(0)
    const map = createEmptySongMap()
    const json = JSON.stringify({
      projectFormatVersion: SONG_PROJECT_FORMAT_VERSION,
      songMap: map,
    })
    const jsonBytes = new TextEncoder().encode(json)
    const total = SMAP_HEADER_BYTE_LENGTH_V1 + jsonBytes.byteLength + audio.byteLength
    const buf = new Uint8Array(total)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    const view = new DataView(buf.buffer)
    view.setUint32(4, SMAP_FILE_VERSION_V1, true)
    view.setUint32(8, audio.byteLength > 0 ? SMAP_FLAG_HAS_AUDIO : 0, true)
    view.setBigUint64(12, BigInt(jsonBytes.byteLength), true)
    view.setBigUint64(20, BigInt(audio.byteLength), true)
    buf.set(jsonBytes, SMAP_HEADER_BYTE_LENGTH_V1)
    if (audio.byteLength > 0) {
      buf.set(audio, SMAP_HEADER_BYTE_LENGTH_V1 + jsonBytes.byteLength)
    }
    return buf
  }

  it('decodes a v1 project-only file (no audio)', () => {
    const buf = v1Bytes({})
    const back = decodeSmapBytes(buf)
    expect(back.audioBlob).toBeUndefined()
    expect(back.project.projectFormatVersion).toBe(SONG_PROJECT_FORMAT_VERSION)
  })

  it('decodes a v1 file with embedded audio chunk', () => {
    const audio = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const buf = v1Bytes({ audioBlob: audio })
    const back = decodeSmapBytes(buf)
    expect(back.audioBlob).toBeDefined()
    expect(back.audioBlob?.size).toBe(4)
  })

  it('re-encoding a decoded v1 file emits v2 (drops the audio chunk)', async () => {
    const audio = new Uint8Array([1, 2, 3, 4])
    const v1 = v1Bytes({ audioBlob: audio })
    const decoded = decodeSmapBytes(v1)
    expect(decoded.audioBlob).toBeDefined() // legacy still carries it through decode
    const out = await encodeSmapFile({ project: decoded.project })
    const reencoded = new Uint8Array(await out.arrayBuffer())
    const view = new DataView(reencoded.buffer)
    expect(view.getUint32(4, true)).toBe(SMAP_FILE_VERSION) // = 2
    // Re-decoded v2 file has no audio — the bytes are gone.
    const back = decodeSmapBytes(reencoded)
    expect(back.audioBlob).toBeUndefined()
  })
})

/* ──────────────────────────────────────────────────────────────────────── */
/* Shared format checks                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

describe('smapFile · format', () => {
  it('rejects wrong magic bytes', () => {
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH + 2)
    buf.set([0x00, 0x00, 0x00, 0x00], 0)
    expect(() => decodeSmapBytes(buf)).toThrow(/magic/)
  })

  it('rejects unsupported version', () => {
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    const view = new DataView(buf.buffer)
    view.setUint32(4, 999, true)
    view.setBigUint64(8, 0n, true)
    expect(() => decodeSmapBytes(buf)).toThrow(/unsupported container version/)
  })

  it('rejects file shorter than the smallest header probe (< 8 bytes)', () => {
    const buf = new Uint8Array(4)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    expect(() => decodeSmapBytes(buf)).toThrow(/truncated/)
  })
})
