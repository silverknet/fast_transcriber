/**
 * "Can I play this set with no internet?"
 *
 * The rules that matter: a song is playable from EITHER the original file or
 * stems, regenerable files never block a show, and a song with no audio is
 * called out plainly rather than buried in a list of warnings.
 */
import { describe, expect, it } from 'vitest'
import {
  requiredAssetsForSong,
  setReadiness,
  songReadiness,
  type RequiredAsset,
} from './offlineReadiness'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { SongMap } from '$lib/songmap/types'

function song(over: Partial<SongMap> = {}): SongMap {
  const base = createEmptySongMap()
  return {
    ...base,
    metadata: { ...base.metadata, title: 'Norrtälje' },
    audio: { fileName: 'original.wav' } as SongMap['audio'],
    ...over,
  }
}

const allPresent = () => true
const nonePresent = () => false
const presentExcept = (paths: string[]) => (a: RequiredAsset) => !paths.includes(a.subpath)

describe('what a song needs', () => {
  it('lists the original audio', () => {
    const assets = requiredAssetsForSong(song())
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ subpath: 'original.wav', kind: 'original', required: true })
  })

  it('lists every stem by name', () => {
    const assets = requiredAssetsForSong(
      song({ stemRefs: { Drums: 'stems/drums.wav', Bass: 'stems/bass.wav' } }),
    )
    const stems = assets.filter((a) => a.kind === 'stem')
    expect(stems.map((s) => s.subpath)).toEqual(['stems/drums.wav', 'stems/bass.wav'])
    expect(stems[0]!.label).toBe('Drums stem')
  })

  it('marks regenerable files as NOT required', () => {
    // Clicks, cue speech and the generated band are all rendered locally, so
    // their absence must never read as "this song cannot be played".
    const assets = requiredAssetsForSong(
      song({
        clickExport: { relativePath: 'click.wav' } as never,
        cueTracks: [{ name: 'Main', renderExport: { relativePath: 'cue/main.wav' } }] as never,
      }),
    )
    for (const a of assets.filter((x) => x.kind !== 'original' && x.kind !== 'stem')) {
      expect(a.required, a.label).toBe(false)
    }
  })

  it('ignores empty or missing paths rather than listing blanks', () => {
    const assets = requiredAssetsForSong(
      song({ audio: undefined, stemRefs: { Drums: '', Bass: 'stems/bass.wav' } }),
    )
    expect(assets.map((a) => a.subpath)).toEqual(['stems/bass.wav'])
  })
})

describe('is this song playable', () => {
  it('yes with the original present', () => {
    const r = songReadiness('s1', song(), allPresent)
    expect(r.playable).toBe(true)
    expect(r.complete).toBe(true)
    expect(r.summary).toBe('Ready.')
  })

  it('yes from stems alone, with the original missing', () => {
    // The mixer prefers stems anyway; this must not be reported as a blocker.
    const sm = song({ stemRefs: { Drums: 'stems/drums.wav' } })
    const r = songReadiness('s1', sm, presentExcept(['original.wav']))
    expect(r.playable).toBe(true)
  })

  it('NO when nothing audio-bearing is on disk — the case this exists to catch', () => {
    const r = songReadiness('s1', song(), nonePresent)
    expect(r.playable).toBe(false)
    expect(r.summary).toMatch(/silent/i)
  })

  it('a missing click does not make a song unplayable', () => {
    const sm = song({ clickExport: { relativePath: 'click.wav' } as never })
    const r = songReadiness('s1', sm, presentExcept(['click.wav']))
    expect(r.playable).toBe(true)
    expect(r.complete).toBe(false)
    expect(r.summary).toMatch(/regenerated/i)
  })

  it('says so when a song has no audio linked at all', () => {
    const r = songReadiness('s1', song({ audio: undefined }), allPresent)
    expect(r.playable).toBe(false)
    expect(r.summary).toMatch(/no audio linked/i)
  })

  it('reports partial stems without crying wolf', () => {
    const sm = song({
      audio: undefined,
      stemRefs: { Drums: 'stems/drums.wav', Bass: 'stems/bass.wav' },
    })
    const r = songReadiness('s1', sm, presentExcept(['stems/bass.wav']))
    expect(r.playable).toBe(true)
    expect(r.summary).toMatch(/1 stem is missing/i)
  })

  it('carries the title so the report names the song', () => {
    expect(songReadiness('s1', song(), allPresent).title).toBe('Norrtälje')
  })
})

describe('the set as a whole', () => {
  const ok = () => songReadiness('a', song(), allPresent)
  const bad = () => songReadiness('b', song(), nonePresent)

  it('is ready only when every song can make sound', () => {
    expect(setReadiness([ok(), ok()]).ready).toBe(true)
    expect(setReadiness([ok(), bad()]).ready).toBe(false)
  })

  it('names how many would be silent — the number you act on', () => {
    const r = setReadiness([ok(), bad(), bad()])
    expect(r.blockers).toHaveLength(2)
    expect(r.summary).toMatch(/2 of 3/)
  })

  it('an empty project is not "ready" — there is nothing to play', () => {
    const r = setReadiness([])
    expect(r.ready).toBe(false)
    expect(r.summary).toMatch(/no songs/i)
  })

  it('distinguishes "all fine" from "fine but will regenerate"', () => {
    const partial = songReadiness(
      'c',
      song({ clickExport: { relativePath: 'click.wav' } as never }),
      presentExcept(['click.wav']),
    )
    expect(setReadiness([ok(), partial]).ready).toBe(true)
    expect(setReadiness([ok(), partial]).summary).toMatch(/regenerate/i)
    expect(setReadiness([ok(), ok()]).summary).toMatch(/ready offline/i)
  })
})
