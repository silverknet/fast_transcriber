import { describe, expect, it, vi } from 'vitest'
import { normalizeCloudSongMap } from './cloudSync'
import { collabContentFingerprint, toCollabSongMap } from '$lib/songmap/collab'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'

/**
 * Regression tests for the "old projects won't sync" bug.
 *
 * Root cause (confirmed against a real on-disk file): a legacy
 * `formatVersion: 1` song map predates the `cueTracks` model — it carries
 * a `cues` settings dict and NO `cueTracks`. Cloud rows store `song_map`
 * raw, so a v1 project pushed long ago sits in the DB as v1. Every join /
 * pull that cast it to `SongMap` and read `.cueTracks` crashed with
 * "cannot read properties of undefined", permanently, for everyone.
 *
 * The fixture below mirrors the exact shape of that real file.
 */
function legacyV1SongMap(): Record<string, unknown> {
  return {
    formatVersion: 1,
    app: { name: 'BarBro' },
    metadata: {
      title: 'Legacy song',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 10 }, source: 'upload' },
    timeline: { bars: [], beats: [] },
    sections: [],
    harmony: [],
    // The legacy cue settings — no `cueTracks` anywhere.
    cues: { countInBeats: 4, mode: 'off', useSectionLabels: true },
  }
}

describe('normalizeCloudSongMap (legacy-v1 cloud rows)', () => {
  it('migrates a raw v1 cloud payload to the current format with a valid cueTracks array', () => {
    const norm = normalizeCloudSongMap(legacyV1SongMap())
    expect(norm).not.toBeNull()
    expect(norm!.formatVersion).toBe(SONGMAP_FORMAT_VERSION)
    expect(Array.isArray(norm!.cueTracks)).toBe(true)
  })

  it('keeps fingerprints CONSISTENT between an owner (migrated) and a joiner (normalized raw)', () => {
    // The owner edits in memory (already migrated); the joiner receives the
    // raw v1 row and normalizes it. If these fingerprints disagreed, the
    // autosave dirty-check would mistake a freshly-pulled song for a local
    // edit and push-loop (409 churn). They must be identical.
    const ownerSide = collabContentFingerprint(normalizeCloudSongMap(legacyV1SongMap())!)
    const joinerSide = collabContentFingerprint(normalizeCloudSongMap(legacyV1SongMap())!)
    expect(ownerSide).toBe(joinerSide)

    // And the OLD buggy path (raw v1 straight into collab, empty cueTracks
    // via the defensive backstop) hashes DIFFERENTLY — the exact mismatch
    // the migration removes.
    const rawHash = collabContentFingerprint(legacyV1SongMap() as never)
    expect(rawHash).not.toBe(ownerSide)
  })

  it('returns null (song skipped, not a crash) for unmigratable payloads', () => {
    // The graceful-skip path logs a warning by design — silence it so the
    // expected failures don't clutter the suite output.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(normalizeCloudSongMap(null)).toBeNull()
      expect(normalizeCloudSongMap({ nope: true })).toBeNull()
      expect(normalizeCloudSongMap('not an object')).toBeNull()
      expect(normalizeCloudSongMap({ formatVersion: 999 })).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('toCollabSongMap defensive backstop', () => {
  it('does not crash on a raw v1 map that never went through normalization', () => {
    // Even if some future path reaches toCollabSongMap without normalizing,
    // a missing cueTracks must degrade to [] rather than throw.
    expect(() => toCollabSongMap(legacyV1SongMap() as never)).not.toThrow()
    expect(toCollabSongMap(legacyV1SongMap() as never).cueTracks).toEqual([])
  })
})
