import { describe, expect, it, vi } from 'vitest'
import { loadMixAudio, loadStemAudio } from './loadAudio'
import type { CloudAudioManifest } from '$lib/client/cloudAudio'

const manifest: CloudAudioManifest = {
  codec: 'aac',
  bitrateKbps: 128,
  sourceSha256: 'sha-master',
  mix: { path: 'proj/song/mix.m4a' },
  stems: { Bass: { path: 'proj/song/stems/bass.m4a' } },
  updatedAt: '2026-07-23T00:00:00.000Z',
}
const localBlob = new Blob(['LOCAL'])
const cloudBlob = new Blob(['CLOUD'])

function loaders() {
  const loadLocal = vi.fn(async () => localBlob)
  const fetchCloud = vi.fn(
    async (_args: { sidecarReachable: boolean; path: string; cacheKey: string }) => cloudBlob,
  )
  return { loadLocal, fetchCloud }
}

describe('loadMixAudio — the audio-source boundary', () => {
  it('desktop + local → local bytes; cloud fetch NEVER called (failsafe at the seam)', async () => {
    const l = loaders()
    const r = await loadMixAudio(
      { sidecarReachable: true, songId: 'song', localAudioAvailable: true, cloudAudio: manifest },
      l,
    )
    expect(r.source).toBe('local')
    expect(r.blob).toBe(localBlob)
    expect(l.loadLocal).toHaveBeenCalledOnce()
    expect(l.fetchCloud).not.toHaveBeenCalled()
  })

  it('desktop + local missing (cloud exists) → missing; neither loader touched', async () => {
    const l = loaders()
    const r = await loadMixAudio(
      { sidecarReachable: true, songId: 'song', localAudioAvailable: false, cloudAudio: manifest },
      l,
    )
    expect(r.source).toBe('missing')
    expect(r.blob).toBeNull()
    expect(l.loadLocal).not.toHaveBeenCalled()
    expect(l.fetchCloud).not.toHaveBeenCalled()
  })

  it('browser + cloud → cloud bytes via fetchCloud(correct path); local NOT called', async () => {
    const l = loaders()
    const r = await loadMixAudio(
      { sidecarReachable: false, songId: 'song', localAudioAvailable: false, cloudAudio: manifest },
      l,
    )
    expect(r.source).toBe('cloud')
    expect(r.blob).toBe(cloudBlob)
    expect(l.loadLocal).not.toHaveBeenCalled()
    expect(l.fetchCloud).toHaveBeenCalledOnce()
    expect(l.fetchCloud.mock.calls[0]![0]).toMatchObject({
      sidecarReachable: false,
      path: 'proj/song/mix.m4a',
    })
  })

  it('browser + no cloud audio → missing', async () => {
    const l = loaders()
    const r = await loadMixAudio(
      { sidecarReachable: false, songId: 'song', localAudioAvailable: false, cloudAudio: null },
      l,
    )
    expect(r.source).toBe('missing')
    expect(l.fetchCloud).not.toHaveBeenCalled()
  })
})

describe('loadStemAudio — same boundary per stem', () => {
  it('browser + cloud stem → fetchCloud(stem path)', async () => {
    const l = loaders()
    const r = await loadStemAudio(
      { sidecarReachable: false, songId: 'song', localStemAvailable: false, cloudAudio: manifest },
      'Bass',
      l,
    )
    expect(r.source).toBe('cloud')
    expect(l.fetchCloud.mock.calls[0]![0]!.path).toBe('proj/song/stems/bass.m4a')
  })

  it('desktop + local stem → local; never cloud', async () => {
    const l = loaders()
    const r = await loadStemAudio(
      { sidecarReachable: true, songId: 'song', localStemAvailable: true, cloudAudio: manifest },
      'Bass',
      l,
    )
    expect(r.source).toBe('local')
    expect(l.fetchCloud).not.toHaveBeenCalled()
  })
})
