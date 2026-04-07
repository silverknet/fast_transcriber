import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import {
  exportRestorableStateAsSmapBlob,
  exportSongMapJson,
  parseImportedProjectFile,
  parseSongMapJsonString,
  parseSongProjectFromUtf8Text,
  restorableStateFromJsonAndBlob,
} from './persist'
import { decodeSmapBytes } from './smapFile'
import { restorableSongState } from './session'

describe('persist', () => {
  it('round-trips SongMap JSON', () => {
    const map = createEmptySongMap()
    const json = exportSongMapJson(map)
    const parsed = parseSongMapJsonString(json)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.map.formatVersion).toBe(map.formatVersion)
      expect(parsed.map.metadata.title).toBe(map.metadata.title)
    }
  })

  it('restorableStateFromJsonAndBlob attaches blob', () => {
    const map = createEmptySongMap()
    const json = exportSongMapJson(map)
    const blob = new Blob([new Uint8Array([1, 2, 3])])
    const r = restorableStateFromJsonAndBlob(json, blob, 'test-id')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state.songId).toBe('test-id')
      expect(r.state.audioBlob).toBe(blob)
    }
  })

  it('round-trips .smap binary without audio', async () => {
    const map = createEmptySongMap()
    const state = restorableSongState(map, null)
    const blob = await exportRestorableStateAsSmapBlob(state)
    const back = decodeSmapBytes(new Uint8Array(await blob.arrayBuffer()))
    expect(back.audioBlob).toBeUndefined()
    expect(back.project.songMap.metadata.title).toBe(map.metadata.title)
  })

  it('parseSongProjectFromUtf8Text accepts legacy SongMap root', () => {
    const map = createEmptySongMap()
    const json = exportSongMapJson(map)
    const p = parseSongProjectFromUtf8Text(json)
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.project.songMap.metadata.title).toBe(map.metadata.title)
    }
  })
})

describe('parseImportedProjectFile', () => {
  it('loads binary .smap', async () => {
    const map = createEmptySongMap()
    const state = restorableSongState(map, null)
    const bytes = await exportRestorableStateAsSmapBlob(state)
    const file = new File([bytes], 'x.smap', { type: 'application/octet-stream' })
    const r = await parseImportedProjectFile(file)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state.songMap.metadata.title).toBe(map.metadata.title)
      expect(r.state.audioBlob).toBeNull()
    }
  })

  it('loads plain JSON without audio', async () => {
    const map = createEmptySongMap()
    const json = exportSongMapJson(map)
    const file = new File([json], 'x.json', { type: 'application/json' })
    const r = await parseImportedProjectFile(file)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state.audioBlob).toBeNull()
    }
  })
})
