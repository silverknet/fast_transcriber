/**
 * Guards the browser-mode open path (`openCloudProjectInBrowser`), the client
 * half of the collab data-loss fix. The bug had two halves: the server RLS bug
 * (fixed in migration 017) AND the client never seeding a per-song sync
 * watermark, so the first push computed its conflict base from the coarse
 * project revision. This locks the client half:
 *   - each song entry is stamped with lastSyncedRevision (from the row) +
 *     lastSyncedContentHash (= collabContentFingerprint of the normalized map),
 *   - the project opens in BROWSER mode (osPath null), and
 *   - the session is persisted so a reload can restore it.
 *
 * Unit (node) test: openCloudProjectInBrowser touches only localStorage of the
 * browser APIs (shimmed below); the audio boundary it imports is never called
 * on this path and is already node-safe (see resolveAudioSource / cloudAudio
 * unit tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Keep the real normalizeCloudSongMap (faithful fingerprints); stub only network.
vi.mock('./cloudSync', async (importActual) => {
  const actual = await importActual<typeof import('./cloudSync')>()
  return { ...actual, getCloudProjectManifest: vi.fn(), fetchCloudSongs: vi.fn() }
})

import { openCloudProjectInBrowser } from './browserCloudProject'
import { getCloudProjectManifest, fetchCloudSongs, normalizeCloudSongMap } from './cloudSync'
import { collabContentFingerprint } from '$lib/songmap/collab'
import { project, closeProject } from '$lib/stores/project'
import { readLastCloudProjectId } from '$lib/project/commit'

const ID1 = '11111111-1111-1111-1111-111111111111'
const ID2 = '22222222-2222-2222-2222-222222222222'

function rawSongMap(title: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    app: { name: 'BarBro' },
    metadata: { title, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 10 }, source: 'upload' },
    timeline: { bars: [], beats: [] },
    sections: [],
    harmony: [],
    cues: { countInBeats: 4, mode: 'off', useSectionLabels: true },
  }
}

describe('openCloudProjectInBrowser (data-loss fix)', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    })
    closeProject()
    vi.clearAllMocks()
  })

  it('stamps per-song revision + content hash, opens browser mode, persists session', async () => {
    vi.mocked(getCloudProjectManifest).mockResolvedValue({
      project: { name: 'My Set', revision: 42 },
    } as never)
    vi.mocked(fetchCloudSongs).mockResolvedValue([
      { id: ID1, song_map: rawSongMap('Song One'), revision: 7, hidden: false, expected_audio: null, cloud_audio: null },
      { id: ID2, song_map: rawSongMap('Song Two'), revision: 9, hidden: true, expected_audio: null, cloud_audio: null },
    ] as never)

    const res = await openCloudProjectInBrowser('cloud-proj-xyz')
    expect(res).toEqual({ ok: true, songCount: 2, skipped: 0 })

    const snap = get(project)
    expect(snap.osPath).toBeNull() // browser mode — no disk folder
    const data = snap.data!
    expect(data.cloud?.projectId).toBe('cloud-proj-xyz')
    expect(data.songs).toHaveLength(2)

    const e1 = data.songs.find((s) => s.cloudSongId === ID1)!
    expect(e1.lastSyncedRevision).toBe(7)
    expect(e1.lastSyncedContentHash).toBe(
      collabContentFingerprint(normalizeCloudSongMap(rawSongMap('Song One'))!),
    )
    expect(e1.hidden).toBeUndefined()

    const e2 = data.songs.find((s) => s.cloudSongId === ID2)!
    expect(e2.lastSyncedRevision).toBe(9)
    expect(e2.hidden).toBe(true)

    // Persisted so a hard refresh can restore this sidecar-less session.
    expect(readLastCloudProjectId()).toBe('cloud-proj-xyz')
  })
})

describe('a song this build cannot read is REPORTED, never silently dropped', () => {
  /**
   * 2026-08-05. The desktop app bumped the .smap format 6 → 7 and pushed all 17
   * songs. barbro.app was still serving a build from before that, whose parser
   * throws "saved by a newer version of BarBro" on every one of them — and
   * `if (!sm) continue` threw the message away, returning success with zero
   * songs. The owner's reasonable conclusion, three days before a concert, was
   * that his gig data had been deleted. Nothing was: all 17 rows were healthy
   * in the database the whole time.
   *
   * A client that cannot read the data cannot fix itself. It can say so.
   */
  it('counts unreadable songs instead of returning a silent empty project', async () => {
    vi.mocked(getCloudProjectManifest).mockResolvedValue({
      project: { id: 'p1', name: 'Bröllopsgig', revision: 1139 },
    } as never)
    // Two rows the parser refuses (as a newer formatVersion would be), one good.
    vi.mocked(fetchCloudSongs).mockResolvedValue([
      { id: 'too-new-1', revision: 1, hidden: false, song_map: { formatVersion: 99 }, cloud_audio: null },
      { id: 'too-new-2', revision: 1, hidden: false, song_map: { formatVersion: 99 }, cloud_audio: null },
    ] as never)

    const r = await openCloudProjectInBrowser('p1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.songCount).toBe(0)
    // THE FIX: the caller can now tell "empty project" from "I am out of date".
    expect(r.skipped).toBe(2)
  })
})
