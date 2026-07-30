import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  liveReadySongs,
  liveFetchedSongs,
  getPreloadedStems,
  putPreloadedStems,
  evictPreloaded,
  markFetched,
  decodedSongIds,
  clearLiveAudioCache,
} from './liveAudioCache'

// The cache treats buffers as opaque map values (it never touches AudioBuffer
// internals), so a plain sentinel object stands in fine here.
const buf = (tag: string) => ({ tag }) as unknown as AudioBuffer

describe('liveAudioCache', () => {
  beforeEach(() => clearLiveAudioCache())

  it('stores decoded stems and flags the song ready', () => {
    const stems = new Map([
      ['stem:drums.wav', buf('d')],
      ['stem:bass.wav', buf('b')],
    ])
    putPreloadedStems('song-1', stems)

    expect(getPreloadedStems('song-1')).toBe(stems)
    expect(get(liveReadySongs).has('song-1')).toBe(true)
    expect(decodedSongIds()).toEqual(new Set(['song-1']))
  })

  it('an empty stem map is a no-op (never marks ready)', () => {
    putPreloadedStems('song-1', new Map())
    expect(getPreloadedStems('song-1')).toBeUndefined()
    expect(get(liveReadySongs).has('song-1')).toBe(false)
  })

  it('eviction drops the buffers and clears the ready flag', () => {
    putPreloadedStems('song-1', new Map([['stem:drums.wav', buf('d')]]))
    evictPreloaded('song-1')
    expect(getPreloadedStems('song-1')).toBeUndefined()
    expect(get(liveReadySongs).has('song-1')).toBe(false)
    expect(decodedSongIds().size).toBe(0)
  })

  it('evicting an absent song is harmless', () => {
    expect(() => evictPreloaded('nope')).not.toThrow()
    expect(get(liveReadySongs).size).toBe(0)
  })

  it('markFetched flags warmed bytes and is idempotent', () => {
    markFetched('song-2')
    markFetched('song-2')
    expect(get(liveFetchedSongs)).toEqual(new Set(['song-2']))
  })

  it('ready and fetched are independent sets', () => {
    putPreloadedStems('song-1', new Map([['stem:drums.wav', buf('d')]]))
    markFetched('song-1')
    markFetched('song-2')
    expect(get(liveReadySongs)).toEqual(new Set(['song-1']))
    expect(get(liveFetchedSongs)).toEqual(new Set(['song-1', 'song-2']))
  })

  it('clear wipes buffers and both reactive sets', () => {
    putPreloadedStems('song-1', new Map([['stem:drums.wav', buf('d')]]))
    markFetched('song-2')
    clearLiveAudioCache()
    expect(decodedSongIds().size).toBe(0)
    expect(get(liveReadySongs).size).toBe(0)
    expect(get(liveFetchedSongs).size).toBe(0)
  })

  it('the ready Set updates by identity (reactive stores see a new Set)', () => {
    const before = get(liveReadySongs)
    putPreloadedStems('song-1', new Map([['stem:drums.wav', buf('d')]]))
    const after = get(liveReadySongs)
    expect(after).not.toBe(before) // new reference → Svelte re-renders
    expect(after.has('song-1')).toBe(true)
  })
})
