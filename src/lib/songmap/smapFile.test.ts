import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import {
  decodeSmapBytes,
  encodeSmapFile,
  looksLikeSmapFile,
  SMAP_HEADER_BYTE_LENGTH,
  songProjectFromRestorableState,
  SONG_PROJECT_FORMAT_VERSION,
} from './smapFile'
import { restorableSongState } from './session'

describe('smapFile', () => {
  it('round-trips project without audio (project only)', async () => {
    const map = createEmptySongMap()
    const state = restorableSongState(map, null)
    const project = songProjectFromRestorableState(state)
    const blob = await encodeSmapFile({ project })
    const back = decodeSmapBytes(new Uint8Array(await blob.arrayBuffer()))
    expect(back.audioBlob).toBeUndefined()
    expect(back.project.songMap.metadata.title).toBe(map.metadata.title)
    expect(back.project.projectFormatVersion).toBe(SONG_PROJECT_FORMAT_VERSION)
  })

  it('round-trips project with audio bytes', async () => {
    const map = createEmptySongMap()
    const audio = new Blob([new Uint8Array([0xde, 0xad])], { type: 'audio/wav' })
    const state = restorableSongState(map, audio)
    const blob = await encodeSmapFile({
      project: songProjectFromRestorableState(state),
      audioBlob: audio,
    })
    const raw = new Uint8Array(await blob.arrayBuffer())
    expect(looksLikeSmapFile(raw)).toBe(true)
    const back = decodeSmapBytes(raw)
    expect(back.audioBlob).toBeDefined()
    expect(back.audioBlob?.size).toBe(2)
    const ab = await back.audioBlob!.arrayBuffer()
    expect(new Uint8Array(ab)).toEqual(new Uint8Array([0xde, 0xad]))
  })

  it('save → load → save yields identical file bytes (no audio)', async () => {
    const map = createEmptySongMap()
    const project = songProjectFromRestorableState(restorableSongState(map, null))
    const a = await encodeSmapFile({ project })
    const once = decodeSmapBytes(new Uint8Array(await a.arrayBuffer()))
    const b = await encodeSmapFile(once)
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array(await b.arrayBuffer()))
  })

  it('save → load → save yields identical file bytes (with audio)', async () => {
    const map = createEmptySongMap()
    const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' })
    const project = songProjectFromRestorableState(restorableSongState(map, audio))
    const a = await encodeSmapFile({ project, audioBlob: audio })
    const once = decodeSmapBytes(new Uint8Array(await a.arrayBuffer()))
    const b = await encodeSmapFile(once)
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array(await b.arrayBuffer()))
  })

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
    view.setUint32(8, 0, true)
    view.setBigUint64(12, 0n, true)
    view.setBigUint64(20, 0n, true)
    expect(() => decodeSmapBytes(buf)).toThrow(/unsupported container version/)
  })

  it('rejects truncated file (smaller than header)', () => {
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH - 1)
    expect(() => decodeSmapBytes(buf)).toThrow(/truncated/)
  })

  it('rejects hasAudio flag with audioLength 0', () => {
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    const view = new DataView(buf.buffer)
    view.setUint32(4, 1, true)
    view.setUint32(8, 1, true) // hasAudio
    view.setBigUint64(12, 0n, true)
    view.setBigUint64(20, 0n, true) // audio length 0
    expect(() => decodeSmapBytes(buf)).toThrow(/hasAudio flag/)
  })

  it('rejects invalid JSON in chunk', () => {
    const jsonPart = new TextEncoder().encode('not json {{{')
    const total = SMAP_HEADER_BYTE_LENGTH + jsonPart.byteLength
    const buf = new Uint8Array(total)
    const view = new DataView(buf.buffer)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    view.setUint32(4, 1, true)
    view.setUint32(8, 0, true)
    view.setBigUint64(12, BigInt(jsonPart.byteLength), true)
    view.setBigUint64(20, 0n, true)
    buf.set(jsonPart, SMAP_HEADER_BYTE_LENGTH)
    expect(() => decodeSmapBytes(buf)).toThrow(/valid JSON/)
  })

  it('rejects file shorter than declared lengths', () => {
    const buf = new Uint8Array(SMAP_HEADER_BYTE_LENGTH + 5)
    buf.set([0x53, 0x4d, 0x41, 0x50], 0)
    const view = new DataView(buf.buffer)
    view.setUint32(4, 1, true)
    view.setUint32(8, 0, true)
    view.setBigUint64(12, 100n, true) // claims 100 bytes JSON but file is shorter
    view.setBigUint64(20, 0n, true)
    expect(() => decodeSmapBytes(buf)).toThrow(/shorter than declared/)
  })
})
