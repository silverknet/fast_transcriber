import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { ProjectAudioScanResult } from '$lib/client/desktopProjectFs'
import type { SongMap } from '$lib/songmap'

// Mock the sidecar fetch so the reconciler runs purely against the
// fake scan results we feed it. The mock is hoisted so dynamic
// imports below see it.
vi.mock('$lib/client/desktopProjectFs', () => ({
  scanProjectSongAudio: vi.fn(),
}))

const { scanProjectSongAudio } = await import('$lib/client/desktopProjectFs')
const { applyReconcileMatch, expectedIdentityForSong, reconcileSongAudio } =
  await import('./audioReconcile')

function setScan(result: ProjectAudioScanResult) {
  vi.mocked(scanProjectSongAudio).mockResolvedValue(result)
}

function songWithAudio(overrides: Partial<SongMap['audio']> = {}): SongMap {
  const sm = createEmptySongMap()
  return {
    ...sm,
    audio: {
      fileName: 'master.wav',
      trim: { startSec: 0, endSec: 234.5 },
      source: 'upload',
      sha256: 'aaa',
      originalSha256: 'bbb',
      durationSec: 234.5,
      sampleRate: 44100,
      channels: 2,
      fileSize: 100,
      originalPath: 'audio/master.wav',
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.mocked(scanProjectSongAudio).mockReset()
})

describe('audioReconcile · expectedIdentityForSong', () => {
  it('prefers expectedAudio when present', () => {
    const sm = songWithAudio({ sha256: 'local-sha' })
    const withExpected: SongMap = {
      ...sm,
      expectedAudio: { fileName: 'master.wav', sha256: 'cloud-sha' },
    }
    expect(expectedIdentityForSong(withExpected).sha256).toBe('cloud-sha')
  })

  it('falls back to audio when expectedAudio is absent', () => {
    const sm = songWithAudio({ sha256: 'local-sha' })
    expect(expectedIdentityForSong(sm).sha256).toBe('local-sha')
  })
})

describe('audioReconcile · reconcileSongAudio', () => {
  it('reports strict-match when scan finds a file with the same sha as audio.sha256', () => {
    setScan({
      ok: true,
      items: [{ fileName: 'master.wav', sha256: 'aaa', fileSize: 100 }],
    })
    return reconcileSongAudio(songWithAudio(), '/project', 'songs/foo').then(
      (outcome) => {
        expect(outcome.kind).toBe('strict-match')
        if (outcome.kind === 'strict-match') {
          expect(outcome.fileName).toBe('master.wav')
        }
      },
    )
  })

  it('cross-kind match: scanned file matches audio.originalSha256 even when filename differs', async () => {
    setScan({
      ok: true,
      items: [
        { fileName: 'renamed-by-collaborator.wav', sha256: 'bbb', fileSize: 100 },
      ],
    })
    const outcome = await reconcileSongAudio(songWithAudio(), '/project', 'songs/foo')
    expect(outcome.kind).toBe('strict-match')
    if (outcome.kind === 'strict-match') {
      expect(outcome.fileName).toBe('renamed-by-collaborator.wav')
    }
  })

  it('loose-match when no sha lines up but duration / sr / channels / fileSize all agree', async () => {
    // Local audio has shas but the song's expected has only identity fields.
    const sm = createEmptySongMap()
    const withExpected: SongMap = {
      ...sm,
      audio: {
        fileName: 'unknown.wav',
        trim: { startSec: 0, endSec: 234.5 },
        source: 'upload',
        durationSec: 234.5,
        sampleRate: 44100,
        channels: 2,
        fileSize: 100,
      },
    }
    setScan({
      ok: true,
      items: [
        {
          fileName: 'master.wav',
          sha256: 'whatever',
          durationSec: 234.5,
          sampleRate: 44100,
          channels: 2,
          fileSize: 100,
        },
      ],
    })
    const outcome = await reconcileSongAudio(withExpected, '/project', 'songs/foo')
    expect(outcome.kind).toBe('loose-match')
  })

  it('returns no-match when nothing on disk matches', async () => {
    setScan({
      ok: true,
      items: [{ fileName: 'unrelated.mp3', sha256: 'zzz', fileSize: 50 }],
    })
    const outcome = await reconcileSongAudio(songWithAudio(), '/project', 'songs/foo')
    expect(outcome.kind).toBe('no-match')
  })

  it('returns no-expected when SongMap carries neither shas nor identity fields', async () => {
    const sm = createEmptySongMap()
    const withBareAudio: SongMap = {
      ...sm,
      audio: {
        fileName: 'master.wav',
        trim: { startSec: 0, endSec: 0 },
        source: 'upload',
      },
    }
    setScan({ ok: true, items: [{ fileName: 'master.wav', sha256: 'aaa', fileSize: 100 }] })
    const outcome = await reconcileSongAudio(withBareAudio, '/project', 'songs/foo')
    expect(outcome.kind).toBe('no-expected')
  })

  it('returns scan-failed when the sidecar errors', async () => {
    setScan({ ok: false, error: 'boom' })
    const outcome = await reconcileSongAudio(songWithAudio(), '/project', 'songs/foo')
    expect(outcome.kind).toBe('scan-failed')
  })

  it('does not return loose-match if any compared field disagrees', async () => {
    setScan({
      ok: true,
      items: [
        {
          fileName: 'wrong-channels.wav',
          // No sha provided, so strict is undecided. Channels differ → loose fails.
          durationSec: 234.5,
          sampleRate: 44100,
          channels: 1, // expected 2
          fileSize: 100,
        },
      ],
    })
    const outcome = await reconcileSongAudio(songWithAudio(), '/project', 'songs/foo')
    expect(outcome.kind).toBe('no-match')
  })
})

describe('audioReconcile · applyReconcileMatch', () => {
  it('stamps the new originalPath without clobbering pre-existing identity fields', () => {
    const base = {
      fileName: 'master.wav',
      trim: { startSec: 0, endSec: 234.5 },
      source: 'upload' as const,
      sha256: 'aaa',
      durationSec: 234.5,
    }
    const stamped = applyReconcileMatch(base, {
      fileName: 'renamed.wav',
      identity: { sha256: 'bbb', durationSec: 100, sampleRate: 44100, fileSize: 999 },
    })
    // originalPath always replaced.
    expect(stamped.originalPath).toBe('audio/renamed.wav')
    // Existing identity fields preserved.
    expect(stamped.sha256).toBe('aaa')
    expect(stamped.durationSec).toBe(234.5)
    // Missing fields backfilled from the match.
    expect(stamped.sampleRate).toBe(44100)
    expect(stamped.fileSize).toBe(999)
    // fileName kept stable when base had one.
    expect(stamped.fileName).toBe('master.wav')
  })

  it('synthesises a default AudioReference when none exists', () => {
    const stamped = applyReconcileMatch(undefined, {
      fileName: 'fresh.wav',
      identity: { sha256: 'ccc' },
    })
    expect(stamped.fileName).toBe('fresh.wav')
    expect(stamped.originalPath).toBe('audio/fresh.wav')
    expect(stamped.source).toBe('import')
  })
})
