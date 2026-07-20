import { describe, expect, it } from 'vitest'
import { metadataLiteFromSongMap } from './commit'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { SongMap } from '$lib/songmap/types'

describe('metadataLiteFromSongMap', () => {
  it('extracts title/artist/key from a well-formed SongMap', () => {
    const sm = createEmptySongMap()
    sm.metadata.title = 'Dum av dig'
    sm.metadata.artist = 'Daniel Adams-Ray'
    const lite = metadataLiteFromSongMap(sm)
    expect(lite.title).toBe('Dum av dig')
    expect(lite.artist).toBe('Daniel Adams-Ray')
  })

  it('tolerates a missing metadata object instead of crashing', () => {
    // Cloud-sourced song maps come from an untyped jsonb column — a row
    // written before server-side validation existed can lack `metadata`
    // entirely even though the type declares it required. This used to
    // throw "Cannot read properties of undefined (reading 'title')" and
    // break every future join/pull that touched the row.
    const sm = createEmptySongMap()
    delete (sm as { metadata?: unknown }).metadata
    expect(() => metadataLiteFromSongMap(sm)).not.toThrow()
    expect(metadataLiteFromSongMap(sm).title).toBe('Untitled song')
  })

  it('tolerates a missing timeline when computing the analyzed flag', () => {
    const sm = createEmptySongMap()
    sm.metadata.title = 'Song'
    delete (sm.metadata as { analyzed?: boolean }).analyzed
    delete (sm as { timeline?: unknown }).timeline
    expect(() => metadataLiteFromSongMap(sm)).not.toThrow()
    expect(metadataLiteFromSongMap(sm).analyzed).toBe(false)
  })

  it('falls back to "Untitled song" for an empty-string title', () => {
    const sm = createEmptySongMap()
    sm.metadata.title = ''
    expect(metadataLiteFromSongMap(sm).title).toBe('Untitled song')
  })
})
