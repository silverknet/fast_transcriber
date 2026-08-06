/**
 * "i dont want to prepare all songs, i just want to prepare the one that is
 * not there" — reported after adding one song to a 17-song set and finding the
 * only available action re-transcoded and re-uploaded all of them.
 */
import { describe, expect, it } from 'vitest'
import { cloudAudioNeed, needsCloudAudio, summariseCloudAudioNeeds } from './cloudAudioNeeds'
import type { CloudAudioManifest } from './cloudAudio'

const manifest = (patch: Partial<CloudAudioManifest> = {}): CloudAudioManifest => ({
  codec: 'aac',
  bitrateKbps: 128,
  sourceSha256: 'abc123',
  mix: { path: 'p/mix.m4a', bytes: 1 } as never,
  stems: { Bass: {} as never, Drums: {} as never },
  updatedAt: '2026-08-05T00:00:00.000Z',
  ...patch,
})

describe('what actually needs preparing', () => {
  it('THE CASE: a never-prepared song is the only work', () => {
    expect(cloudAudioNeed({ sha256: 'abc123', stemNames: [] }, null)).toBe('missing')
    expect(cloudAudioNeed({ sha256: 'abc123', stemNames: [] }, undefined)).toBe('missing')
  })

  it('a song already prepared from the same master is skipped', () => {
    const need = cloudAudioNeed({ sha256: 'abc123', stemNames: ['Bass', 'Drums'] }, manifest())
    expect(need).toBe('current')
    expect(needsCloudAudio({ sha256: 'abc123', stemNames: ['Bass'] }, manifest())).toBe(false)
  })

  it('edits that do not touch a byte of audio do NOT force a re-upload', () => {
    // Re-analysing the grid, renaming a section, editing chords — none of these
    // change the master, and re-uploading 85 files for them is why nobody
    // pressed the button.
    expect(cloudAudioNeed({ sha256: 'abc123', stemNames: ['Bass'] }, manifest())).toBe('current')
  })

  it('replacing the audio DOES force a re-upload', () => {
    expect(cloudAudioNeed({ sha256: 'DIFFERENT', stemNames: [] }, manifest())).toBe('stale')
  })

  it('a stem added since the upload makes it stale', () => {
    const need = cloudAudioNeed(
      { sha256: 'abc123', stemNames: ['Bass', 'Drums', 'Vocals'] },
      manifest(),
    )
    expect(need).toBe('stale')
  })

  it('a stem REMOVED locally is not a reason to redo the song', () => {
    expect(cloudAudioNeed({ sha256: 'abc123', stemNames: ['Bass'] }, manifest())).toBe('current')
  })

  it('matches stems by slug, so "Bass" and "bass" are the same stem', () => {
    expect(cloudAudioNeed({ sha256: 'abc123', stemNames: ['bass', 'DRUMS'] }, manifest())).toBe(
      'current',
    )
  })

  it('UNPROVABLE is stale, never current — the failure of guessing wrong is silent', () => {
    // No local hash, or none recorded in the cloud: we cannot show the copy is
    // up to date, and being wrong means the band hears the previous master with
    // nothing on screen to say so.
    expect(cloudAudioNeed({ stemNames: [] }, manifest())).toBe('stale')
    expect(
      cloudAudioNeed({ sha256: 'abc123', stemNames: [] }, manifest({ sourceSha256: undefined })),
    ).toBe('stale')
  })

  it('a manifest with no mix is as good as no manifest', () => {
    expect(
      cloudAudioNeed({ sha256: 'abc123', stemNames: [] }, manifest({ mix: undefined as never })),
    ).toBe('missing')
  })
})

describe('summary for the button', () => {
  it('counts what the press will actually do', () => {
    const s = summariseCloudAudioNeeds(['current', 'current', 'missing', 'stale', 'current'])
    expect(s).toEqual({ missing: 1, stale: 1, current: 3, todo: 2 })
  })

  it('nothing to do is a real answer', () => {
    expect(summariseCloudAudioNeeds(['current', 'current']).todo).toBe(0)
    expect(summariseCloudAudioNeeds([]).todo).toBe(0)
  })
})
