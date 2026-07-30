import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Regression for the browser-mode data-loss the user hit: edit a song field
 * (e.g. add an artist) in /edit, click back to the project within the 7s cloud
 * debounce, and the edit vanished. In browser mode there is NO disk fallback —
 * persistence rides entirely on the debounced cloud push — and SPA navigation
 * fires none of the tab-hide events that used to flush it. When the timer
 * finally fired the route was `/project`, so the `/edit` push guard aborted it
 * and the edit was gone forever.
 *
 * The fix: `flushProjectAutosave()` (called from `beforeNavigate`) force-flushes
 * the pending push past the route guard. These tests drive the real autosave
 * module with a controllable `page` route + a mocked `pushCloudSong`.
 */

vi.mock('$app/environment', () => ({ browser: true }))

// A minimal `page` store whose route we can flip, matching `get(page).route.id`.
vi.mock('$app/stores', () => {
  let value: { route: { id: string | null } } = { route: { id: '/edit' } }
  const subs = new Set<(v: unknown) => void>()
  return {
    page: {
      subscribe(fn: (v: unknown) => void) {
        fn(value)
        subs.add(fn)
        return () => subs.delete(fn)
      },
    },
    __setRoute(id: string | null) {
      value = { route: { id } }
      for (const fn of subs) fn(value)
    },
  }
})

vi.mock('$lib/client/cloudSync', () => ({ pushCloudSong: vi.fn() }))
vi.mock('$lib/client/desktopProjectFs', () => ({
  writeProjectSong: vi.fn(async () => ({ ok: true })),
  writeProjectManifest: vi.fn(async () => ({ ok: true })),
}))

import * as appStores from '$app/stores'
import { pushCloudSong } from '$lib/client/cloudSync'
import { startProjectAutosave, stopProjectAutosave, flushProjectAutosave } from './projectAutosave'
import { project } from '$lib/stores/project'
import { songMap, setSongMap, patchSongMap, clearSongMap } from '$lib/stores/songMap'
import { createEmptySongMap } from '$lib/songmap/factory'
import { collabContentFingerprint } from '$lib/songmap/collab'
import { PROJECT_FILE_VERSION, type ProjectFile } from '$lib/project/types'
import type { SongMap } from '$lib/songmap/types'

const setRoute = (id: string | null) => (appStores as unknown as { __setRoute: (id: string | null) => void }).__setRoute(id)
const pushSpy = vi.mocked(pushCloudSong)

const SONG_ID = 'song-1'
const FOLDER = 'songs/song-1'
const ARTIST = 'Markus Krungeård'

function baseSong(): SongMap {
  const sm = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  sm.metadata.title = 'Tur att vi lever samtidigt'
  return sm
}

/** Open a linked cloud project in BROWSER mode (osPath === null → no disk). */
function openBrowserCloudProject(initialHash: string) {
  const data: ProjectFile = {
    formatVersion: PROJECT_FILE_VERSION,
    id: 'proj-1',
    name: 'Set',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    songs: [
      { id: SONG_ID, folder: FOLDER, cloudSongId: SONG_ID, lastSyncedRevision: 5, lastSyncedContentHash: initialHash },
    ],
    cloud: { projectId: 'cloud-proj', lastSyncedRevision: 5 },
  }
  project.set({
    osPath: null,
    data,
    metadataByFolder: {},
    activeSongFolder: FOLDER,
    activeSongId: SONG_ID,
    editingMode: 'project-song',
  })
}

function editArtist(name: string) {
  patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, artist: name || undefined } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // The autosave wires window/document hide listeners on start; the Node unit
  // env has neither, so stub the minimal surface it touches.
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    visibilityState: 'visible',
  })
  pushSpy.mockResolvedValue({ ok: true, revision: 6 } as never)
  setRoute('/edit')
  clearSongMap()
  const initial = baseSong()
  // Seed lastSyncedContentHash to the initial fingerprint so simply LOADING the
  // song is not mistaken for a dirty edit (the dirty-check must skip it).
  openBrowserCloudProject(collabContentFingerprint(initial))
  setSongMap(initial)
})

afterEach(() => {
  stopProjectAutosave()
  clearSongMap()
  project.set({
    osPath: null,
    data: null,
    metadataByFolder: {},
    activeSongFolder: null,
    activeSongId: null,
    editingMode: null,
  })
  vi.unstubAllGlobals()
})

describe('projectAutosave — browser-mode edit survives navigation', () => {
  it('flushes the pending cloud push when leaving /edit, so the artist edit is not lost', async () => {
    startProjectAutosave()
    editArtist(ARTIST)

    // User clicks back to the project — route has moved off /edit.
    setRoute('/project')
    // beforeNavigate fires this. Without the force-flush fix, the debounced push
    // would abort here on the route guard and the edit would be gone.
    flushProjectAutosave()

    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1))

    const [projectId, cloudSongId, pushedMap, , , baseRev] = pushSpy.mock.calls[0]!
    expect(projectId).toBe('cloud-proj')
    expect(cloudSongId).toBe(SONG_ID)
    expect((pushedMap as SongMap).metadata.artist).toBe(ARTIST)
    expect(baseRev).toBe(5)
  })

  it('CHARACTERIZATION: without a flush, navigating away before the 7s debounce loses the edit', async () => {
    vi.useFakeTimers()
    try {
      startProjectAutosave()
      editArtist(ARTIST)
      // Navigate away, then let the whole 7s debounce elapse with NO flush.
      setRoute('/project')
      await vi.advanceTimersByTimeAsync(7000)
      // The push guard aborts on the now-/project route → nothing was sent.
      // This is exactly the data-loss the flush fix prevents.
      expect(pushSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not push when nothing changed (dirty-check still holds under a forced flush)', async () => {
    startProjectAutosave()
    // No edit — just navigate away.
    setRoute('/project')
    flushProjectAutosave()
    // Give any async push a chance to (not) happen.
    await Promise.resolve()
    await Promise.resolve()
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('still flushes on the normal path while the route is briefly still /edit', async () => {
    startProjectAutosave()
    editArtist(ARTIST)
    // beforeNavigate runs while $page is still /edit (SvelteKit updates it after).
    flushProjectAutosave()
    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1))
    expect((pushSpy.mock.calls[0]![2] as SongMap).metadata.artist).toBe(ARTIST)
  })
})
