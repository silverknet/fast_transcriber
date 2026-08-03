/**
 * Browser-mode live RECEIVE (`pullCloudChangesBrowser`). Proves a remote delta
 * lands in the in-memory registry + the live `songMap` for the open song, that a
 * self-echo of our own push is skipped, and that a non-active song refreshes
 * WITHOUT touching the open song's `songMap`.
 *
 * Unit (node) test: shims localStorage, mocks the two network calls, keeps the
 * real `normalizeCloudSongMap` so fingerprints/merges are faithful, and drives
 * the active song by `setSongMap` + `setActiveSong` (bypassing the audio load).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

vi.mock('./cloudSync', async (importActual) => {
  const actual = await importActual<typeof import('./cloudSync')>()
  return { ...actual, getCloudProjectManifest: vi.fn(), fetchCloudSongs: vi.fn() }
})

import { openCloudProjectInBrowser, getBrowserCloudSongMap } from './browserCloudProject'
import { pullCloudChangesBrowser } from './browserCloudPull'
import { getCloudProjectManifest, fetchCloudSongs, normalizeCloudSongMap } from './cloudSync'
import { collabContentFingerprint } from '$lib/songmap/collab'
import { project, setActiveSong, closeProject } from '$lib/stores/project'
import { songMap, setSongMap, clearSongMap } from '$lib/stores/songMap'

const ID1 = '11111111-1111-1111-1111-111111111111'
const ID2 = '22222222-2222-2222-2222-222222222222'
const FOLDER1 = `songs/${ID1.slice(0, 8)}`

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

function songRow(id: string, title: string, revision: number) {
  return { id, song_map: rawSongMap(title), revision, hidden: false, expected_audio: null, cloud_audio: null }
}

/** Open a 2-song project at project revision 5, S1+S2 at song revision 5. */
async function openTwoSongProject() {
  vi.mocked(getCloudProjectManifest).mockResolvedValue({ project: { name: 'Set', revision: 5 } } as never)
  vi.mocked(fetchCloudSongs).mockResolvedValue([
    songRow(ID1, 'S1', 5),
    songRow(ID2, 'S2', 5),
  ] as never)
  const res = await openCloudProjectInBrowser('proj-1')
  expect(res.ok).toBe(true)
}

/** Make S1 the open song, with the store holding exactly the registry's S1 map. */
function openS1InEditor() {
  setSongMap(getBrowserCloudSongMap(ID1)!)
  setActiveSong(FOLDER1, ID1)
}

describe('pullCloudChangesBrowser', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    })
    closeProject()
    clearSongMap()
    vi.clearAllMocks()
  })

  it('applies a remote edit to the OPEN song — live in songMap + registry + watermark', async () => {
    await openTwoSongProject()
    openS1InEditor()
    expect(get(songMap)!.metadata.title).toBe('S1')

    // A collaborator renamed S1 (revision bumps to 6, project to 6).
    vi.mocked(getCloudProjectManifest).mockResolvedValue({ project: { name: 'Set', revision: 6 } } as never)
    vi.mocked(fetchCloudSongs).mockResolvedValue([songRow(ID1, 'S1 EDITED', 6)] as never)

    const r = await pullCloudChangesBrowser()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.changedTitles).toContain('S1 EDITED')

    expect(get(songMap)!.metadata.title).toBe('S1 EDITED') // live in the editor
    expect(getBrowserCloudSongMap(ID1)!.metadata.title).toBe('S1 EDITED') // registry fresh
    const entry = get(project).data!.songs.find((s) => s.id === ID1)!
    expect(entry.lastSyncedRevision).toBe(6)
    expect(entry.lastSyncedContentHash).toBe(
      collabContentFingerprint(normalizeCloudSongMap(rawSongMap('S1 EDITED'))!),
    )
    expect(get(project).data!.cloud!.lastSyncedRevision).toBe(6)
  })

  it('skips a self-echo (incoming content matches the last synced hash)', async () => {
    await openTwoSongProject()
    openS1InEditor()

    // Same content as already synced, only the revision moved — our own push
    // coming back. Nothing should change; no toast.
    vi.mocked(getCloudProjectManifest).mockResolvedValue({ project: { name: 'Set', revision: 6 } } as never)
    vi.mocked(fetchCloudSongs).mockResolvedValue([songRow(ID1, 'S1', 6)] as never)

    const r = await pullCloudChangesBrowser()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.changedTitles).toEqual([]) // self-echo is not announced
    expect(get(songMap)!.metadata.title).toBe('S1')
    // Watermark still advances to the echoed revision (no re-push loop).
    expect(get(project).data!.songs.find((s) => s.id === ID1)!.lastSyncedRevision).toBe(6)
  })

  it('materializes a NEW song a collaborator added — live in the list + registry', async () => {
    await openTwoSongProject()
    openS1InEditor()
    expect(get(project).data!.songs).toHaveLength(2)

    const ID3 = '33333333-3333-3333-3333-333333333333'
    vi.mocked(getCloudProjectManifest).mockResolvedValue({ project: { name: 'Set', revision: 6 } } as never)
    vi.mocked(fetchCloudSongs).mockResolvedValue([songRow(ID3, 'Brand New', 6)] as never)

    const r = await pullCloudChangesBrowser()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.changedTitles).toContain('Brand New')

    const songs = get(project).data!.songs
    expect(songs).toHaveLength(3)
    const added = songs.find((s) => s.id === ID3)!
    expect(added.cloudSongId).toBe(ID3)
    expect(added.lastSyncedRevision).toBe(6)
    expect(getBrowserCloudSongMap(ID3)!.metadata.title).toBe('Brand New') // openable
    expect(get(project).metadataByFolder[`songs/${ID3.slice(0, 8)}`]?.title).toBe('Brand New')
    // The open song is untouched.
    expect(get(songMap)!.metadata.title).toBe('S1')
  })

  it('refreshes a NON-active song without touching the open song', async () => {
    await openTwoSongProject()
    openS1InEditor() // S1 open; S2 is not active

    vi.mocked(getCloudProjectManifest).mockResolvedValue({ project: { name: 'Set', revision: 6 } } as never)
    vi.mocked(fetchCloudSongs).mockResolvedValue([songRow(ID2, 'S2 EDITED', 6)] as never)

    const r = await pullCloudChangesBrowser()
    expect(r.ok).toBe(true)

    // S2's registry snapshot + list card refreshed for the next time it opens.
    expect(getBrowserCloudSongMap(ID2)!.metadata.title).toBe('S2 EDITED')
    expect(get(project).metadataByFolder[`songs/${ID2.slice(0, 8)}`]?.title).toBe('S2 EDITED')
    // The OPEN song (S1) in the editor is untouched.
    expect(get(songMap)!.metadata.title).toBe('S1')
  })

  it('CHARACTERIZATION: a skipped (unmigratable) song does NOT hold back the project watermark', async () => {
    // A song whose payload can't be parsed/migrated is skipped (returns null),
    // but the PROJECT watermark still advances to the manifest revision. This is
    // deliberate: the delta fetch is gated by `lastSyncedRevision`, so pinning it
    // to the bad song's revision would re-fetch the ENTIRE project on every pull,
    // forever, because the song can never migrate. The accepted cost is that a
    // *permanently* unreadable song is not retried. (A song with an in-flight
    // conflict is different — it self-heals through the push-409 path — and a
    // transient read failure is the one narrow gap, noted in TESTING_AUDIT.md.)
    await openTwoSongProject() // S1, S2 @ song rev 5, project @ 5
    openS1InEditor()

    // Project jumps to 8. S1 has a clean rev-8 edit; S2's rev-7 payload is
    // corrupt (parseSongMap throws → normalizeCloudSongMap → null → skipped).
    const badRow = { id: ID2, song_map: { not: 'a song map' }, revision: 7, hidden: false, expected_audio: null, cloud_audio: null }
    vi.mocked(getCloudProjectManifest).mockResolvedValue({ project: { name: 'Set', revision: 8 } } as never)
    vi.mocked(fetchCloudSongs).mockResolvedValue([songRow(ID1, 'S1 EDITED', 8), badRow] as never)

    const r = await pullCloudChangesBrowser()
    expect(r.ok).toBe(true)

    const songs = get(project).data!.songs
    // S1 applied + stamped at 8.
    const s1 = songs.find((s) => s.id === ID1)!
    expect(getBrowserCloudSongMap(ID1)!.metadata.title).toBe('S1 EDITED')
    expect(s1.lastSyncedRevision).toBe(8)
    // S2 skipped: its per-song watermark stays at 5, content unchanged.
    const s2 = songs.find((s) => s.id === ID2)!
    expect(getBrowserCloudSongMap(ID2)!.metadata.title).toBe('S2')
    expect(s2.lastSyncedRevision).toBe(5)
    // …yet the PROJECT watermark advanced past S2's rev-7 to the manifest's 8.
    expect(get(project).data!.cloud!.lastSyncedRevision).toBe(8)
  })
})
