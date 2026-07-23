import { describe, expect, it } from 'vitest'
import { planAudioLoad, planStemLoad } from './planAudioLoad'
import type { CloudAudioManifest } from './cloudAudio'

const manifest: CloudAudioManifest = {
  codec: 'aac',
  bitrateKbps: 128,
  sourceSha256: 'sha-master',
  mix: { path: 'proj/song/mix.m4a' },
  stems: { Bass: { path: 'proj/song/stems/bass.m4a' } },
  updatedAt: '2026-07-23T00:00:00.000Z',
}

describe('planAudioLoad', () => {
  it('desktop + local master → local, and NEVER a cloud fetch plan', () => {
    const plan = planAudioLoad({
      sidecarReachable: true,
      localAudioAvailable: true,
      songId: 'song',
      cloudAudio: manifest, // present, but must be ignored on desktop
    })
    expect(plan.resolution.source).toBe('local')
    expect(plan.cloud).toBeUndefined()
  })

  it('desktop + local missing (cloud exists) → missing, still no cloud plan (failsafe)', () => {
    const plan = planAudioLoad({
      sidecarReachable: true,
      localAudioAvailable: false,
      songId: 'song',
      cloudAudio: manifest,
    })
    expect(plan.resolution.source).toBe('missing')
    expect(plan.cloud).toBeUndefined()
  })

  it('browser + cloud → cloud plan with the manifest path + content cache key', () => {
    const plan = planAudioLoad({
      sidecarReachable: false,
      localAudioAvailable: false,
      songId: 'song',
      cloudAudio: manifest,
    })
    expect(plan.resolution.source).toBe('cloud')
    expect(plan.cloud?.path).toBe('proj/song/mix.m4a')
    expect(plan.cloud?.cacheKey).toContain('sha-master')
  })

  it('browser + no cloud audio → missing', () => {
    const plan = planAudioLoad({
      sidecarReachable: false,
      localAudioAvailable: false,
      songId: 'song',
      cloudAudio: null,
    })
    expect(plan.resolution.source).toBe('missing')
    expect(plan.cloud).toBeUndefined()
  })
})

describe('planStemLoad', () => {
  it('browser + cloud stem present → cloud plan for that stem', () => {
    const plan = planStemLoad({
      sidecarReachable: false,
      localStemAvailable: false,
      songId: 'song',
      stemName: 'Bass',
      cloudAudio: manifest,
    })
    expect(plan.resolution.source).toBe('cloud')
    expect(plan.cloud?.path).toBe('proj/song/stems/bass.m4a')
    expect(plan.cloud?.cacheKey).toContain('stem:Bass')
  })

  it('desktop → local stem, never cloud', () => {
    const plan = planStemLoad({
      sidecarReachable: true,
      localStemAvailable: true,
      songId: 'song',
      stemName: 'Bass',
      cloudAudio: manifest,
    })
    expect(plan.resolution.source).toBe('local')
    expect(plan.cloud).toBeUndefined()
  })

  it('browser + that stem not uploaded → missing', () => {
    const plan = planStemLoad({
      sidecarReachable: false,
      localStemAvailable: false,
      songId: 'song',
      stemName: 'Vocals', // not in manifest.stems
      cloudAudio: manifest,
    })
    expect(plan.resolution.source).toBe('missing')
  })
})
