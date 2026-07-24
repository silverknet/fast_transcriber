import { describe, expect, it } from 'vitest'
import {
  buildCloudAudioManifest,
  cloudAudioCacheKey,
  cloudAudioMixPath,
  cloudAudioStemPath,
  fetchCloudAudioBlob,
  slugStem,
} from './cloudAudio'

describe('slugStem', () => {
  it('lowercases and strips unsafe chars', () => {
    expect(slugStem('Bass')).toBe('bass')
    expect(slugStem('BarBro Drums')).toBe('barbrodrums')
    expect(slugStem('FX/extra')).toBe('fxextra')
  })
  it('never returns empty', () => {
    expect(slugStem('---')).toBe('stem')
    expect(slugStem('')).toBe('stem')
  })
})

describe('cloud audio paths', () => {
  it('mix path is {project}/{song}/mix.m4a', () => {
    expect(cloudAudioMixPath('p1', 's1')).toBe('p1/s1/mix.m4a')
  })
  it('stem path is {project}/{song}/stems/{slug}.m4a', () => {
    expect(cloudAudioStemPath('p1', 's1', 'Bass')).toBe('p1/s1/stems/bass.m4a')
  })
  it('RLS INVARIANT: the first path segment is always the project id', () => {
    // The bucket policy authorises on (storage.foldername(name))[1] — if the
    // project id ever stopped being the first segment, every object would leak
    // or 403. Pin it across mix + stems.
    for (const project of ['abc', 'proj-123', '11111111-2222-3333-4444-555555555555']) {
      expect(cloudAudioMixPath(project, 'song').split('/')[0]).toBe(project)
      expect(cloudAudioStemPath(project, 'song', 'Vocals').split('/')[0]).toBe(project)
    }
  })
})

describe('cloudAudioCacheKey', () => {
  it('is content-keyed: a new source sha invalidates the old cache', () => {
    const a = cloudAudioCacheKey({ songId: 's', sourceSha256: 'aaa', kind: 'mix' })
    const b = cloudAudioCacheKey({ songId: 's', sourceSha256: 'bbb', kind: 'mix' })
    expect(a).not.toBe(b)
  })
  it('is stable for the same content', () => {
    expect(cloudAudioCacheKey({ songId: 's', sourceSha256: 'aaa', kind: 'mix' })).toBe(
      cloudAudioCacheKey({ songId: 's', sourceSha256: 'aaa', kind: 'mix' }),
    )
  })
  it('distinguishes mix from stems', () => {
    expect(cloudAudioCacheKey({ songId: 's', sourceSha256: 'x', kind: 'mix' })).not.toBe(
      cloudAudioCacheKey({ songId: 's', sourceSha256: 'x', kind: 'stem:Bass' }),
    )
  })
})

describe('buildCloudAudioManifest', () => {
  it('builds the mix + stem manifest with RLS-correct paths', () => {
    const m = buildCloudAudioManifest({
      projectId: 'p',
      songId: 's',
      sourceSha256: 'sha123',
      mix: { bytes: 5_000_000, durationSec: 240 },
      stems: { Bass: { bytes: 4_000_000 }, Vocals: { bytes: 4_200_000 } },
      now: () => '2026-07-23T00:00:00.000Z',
    })
    expect(m.codec).toBe('aac')
    expect(m.bitrateKbps).toBe(128)
    expect(m.sourceSha256).toBe('sha123')
    expect(m.mix.path).toBe('p/s/mix.m4a')
    expect(m.stems?.Bass.path).toBe('p/s/stems/bass.m4a')
    expect(m.stems?.Vocals.path).toBe('p/s/stems/vocals.m4a')
    expect(m.updatedAt).toBe('2026-07-23T00:00:00.000Z')
  })
  it('omits stems entirely when there are none', () => {
    const m = buildCloudAudioManifest({ projectId: 'p', songId: 's', mix: {} })
    expect(m.stems).toBeUndefined()
  })
})

describe('fetchCloudAudioBlob — fidelity failsafe at the I/O boundary', () => {
  it('THROWS for a DISK project when the desktop client is connected (never fetch the lossy copy)', async () => {
    await expect(
      fetchCloudAudioBlob({ sidecarReachable: true, localProjectPresent: true, path: 'p/s/mix.m4a', cacheKey: 's@x#mix' }),
    ).rejects.toThrow(/desktop client is connected/i)
  })

  it('does NOT throw for a browser-cloud song even with the desktop client connected', async () => {
    // No local folder → no HD master to protect → the cloud copy is legitimate.
    // (It will fail later on the actual network/storage call, not the failsafe.)
    await expect(
      fetchCloudAudioBlob({ sidecarReachable: true, localProjectPresent: false, path: 'p/s/mix.m4a', cacheKey: 's@x#mix' }),
    ).rejects.not.toThrow(/desktop client is connected/i)
  })
})
