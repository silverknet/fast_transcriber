/**
 * The offline session marker's rules.
 *
 * These decide whether a night's work at a venue is OFFERED for sync when you
 * get home. Getting them wrong is silent in the worst direction: a dropped
 * touched-song id means those edits are never mentioned again, and the next
 * cloud pull overwrites them.
 */
import { describe, expect, it } from 'vitest'
import {
  OFFLINE_SESSION_VERSION,
  hasOfflineEdits,
  mergeOfflineSessions,
  newOfflineSession,
  parseOfflineSession,
  serializeOfflineSession,
  withTouchedSong,
} from './offlineSession'

const T0 = '2026-08-01T18:00:00.000Z'
const T1 = '2026-08-02T18:00:00.000Z'

describe('round trip', () => {
  it('survives serialize → parse unchanged', () => {
    const s = withTouchedSong(newOfflineSession(T0, { a: 4, b: 7 }), 'a')
    expect(parseOfflineSession(serializeOfflineSession(s))).toEqual(s)
  })
})

describe('parsing', () => {
  it('treats absence as no session', () => {
    expect(parseOfflineSession(null)).toBeNull()
    expect(parseOfflineSession(undefined)).toBeNull()
    expect(parseOfflineSession('')).toBeNull()
    expect(parseOfflineSession('   ')).toBeNull()
  })

  it('degrades a corrupt marker to no session rather than throwing', () => {
    // A half-written file must not stop the project from opening. Losing the
    // marker costs you a manual push; a thrown parse error costs you the app.
    expect(parseOfflineSession('{ not json')).toBeNull()
    expect(parseOfflineSession('null')).toBeNull()
    expect(parseOfflineSession('[]')).toBeNull()
    expect(parseOfflineSession('42')).toBeNull()
  })

  it('ignores a marker from a version it does not understand', () => {
    const future = JSON.stringify({ version: 99, startedAt: T0, touchedSongIds: ['a'] })
    expect(parseOfflineSession(future)).toBeNull()
  })

  it('requires a startedAt', () => {
    expect(
      parseOfflineSession(JSON.stringify({ version: OFFLINE_SESSION_VERSION, touchedSongIds: [] })),
    ).toBeNull()
  })

  it('drops junk entries instead of rejecting the whole marker', () => {
    // One bad id must not cost the other songs their review.
    const raw = JSON.stringify({
      version: OFFLINE_SESSION_VERSION,
      startedAt: T0,
      baseRevisions: { a: 3, b: 'nope', c: null, '': 9 },
      touchedSongIds: ['a', 42, null, 'b', 'a'],
    })
    const s = parseOfflineSession(raw)
    expect(s?.baseRevisions).toEqual({ a: 3 })
    expect(s?.touchedSongIds).toEqual(['a', 'b'])
  })

  it('tolerates missing optional fields', () => {
    const s = parseOfflineSession(JSON.stringify({ version: OFFLINE_SESSION_VERSION, startedAt: T0 }))
    expect(s).toEqual({ version: OFFLINE_SESSION_VERSION, startedAt: T0, baseRevisions: {}, touchedSongIds: [] })
  })
})

describe('recording a touched song', () => {
  it('adds the song', () => {
    const s = withTouchedSong(newOfflineSession(T0), 'song-1')
    expect(s.touchedSongIds).toEqual(['song-1'])
  })

  it('returns the SAME object when nothing changed', () => {
    // The identity check is what lets autosave skip a disk write. Every 1.5s
    // for a whole set, rewriting an identical file would be pure churn.
    const s = withTouchedSong(newOfflineSession(T0), 'song-1')
    expect(withTouchedSong(s, 'song-1')).toBe(s)
  })

  it('ignores an empty id', () => {
    const s = newOfflineSession(T0)
    expect(withTouchedSong(s, '')).toBe(s)
  })

  it('does not mutate the input', () => {
    const s = newOfflineSession(T0)
    withTouchedSong(s, 'song-1')
    expect(s.touchedSongIds).toEqual([])
  })
})

describe('merging two sessions', () => {
  it('keeps every touched song from both', () => {
    // Two gigs, no reconcile in between. Dropping the first night's list means
    // those edits are never offered again.
    const first = withTouchedSong(withTouchedSong(newOfflineSession(T0), 'a'), 'b')
    const second = withTouchedSong(newOfflineSession(T1), 'c')
    const merged = mergeOfflineSessions(first, second)
    expect(merged.touchedSongIds.sort()).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates songs touched in both sessions', () => {
    const first = withTouchedSong(newOfflineSession(T0), 'a')
    const second = withTouchedSong(newOfflineSession(T1), 'a')
    expect(mergeOfflineSessions(first, second).touchedSongIds).toEqual(['a'])
  })

  it('keeps the EARLIER base revision, not the newer one', () => {
    // The older revision is the last one known to match the cloud. Re-basing to
    // a revision the cloud never saw would make a genuine conflict look like a
    // clean fast-forward, and the other side's edit would be silently replaced.
    const first = newOfflineSession(T0, { a: 4 })
    const second = newOfflineSession(T1, { a: 9 })
    expect(mergeOfflineSessions(first, second).baseRevisions.a).toBe(4)
  })

  it('takes a base revision from the new session for a song the old one lacked', () => {
    const first = newOfflineSession(T0, { a: 4 })
    const second = newOfflineSession(T1, { a: 9, b: 2 })
    expect(mergeOfflineSessions(first, second).baseRevisions).toEqual({ a: 4, b: 2 })
  })

  it('keeps the earlier startedAt', () => {
    const merged = mergeOfflineSessions(newOfflineSession(T0), newOfflineSession(T1))
    expect(merged.startedAt).toBe(T0)
  })

  it('with nothing on disk, the fresh session wins outright', () => {
    const fresh = newOfflineSession(T1, { a: 1 })
    expect(mergeOfflineSessions(null, fresh)).toBe(fresh)
  })
})

describe('hasOfflineEdits', () => {
  it('is false for no session and for a session nothing was saved in', () => {
    // Preparing for offline and then not editing anything must not raise a
    // dialog — that is how people learn to dismiss it without reading.
    expect(hasOfflineEdits(null)).toBe(false)
    expect(hasOfflineEdits(newOfflineSession(T0, { a: 1 }))).toBe(false)
  })

  it('is true once a song has been saved', () => {
    expect(hasOfflineEdits(withTouchedSong(newOfflineSession(T0), 'a'))).toBe(true)
  })
})
