/**
 * TDD harness for the DISK song-open path — `loadProjectSongIntoEditor`
 * (commit.ts). This is Scenario A: sidecar ON + a local disk project
 * (`osPath !== null`), song opened from disk, audio should be the local HD
 * master read through the sidecar FS.
 *
 * The loader reads via the sidecar (`readProjectSong` / `readProjectSongAsset`)
 * and decodes the `.smap` (`decodeSmapFile` / `smapFileDataToRestorableState`).
 * All of those are mocked here so we can drive:
 *   - happy path (smap + audio present → songMap + audioSession.file set),
 *   - smap unreadable → throws (and leaves songMap untouched),
 *   - audio file missing on disk (originalPath named) → songMap set + a
 *     `file-not-found` missing reason (the relink path),
 *   - audio referenced but NOT path-stamped and NOT loadable → DESIRED: still a
 *     missing reason (probes the reported gap).
 *
 * Contract asserted: the loader NEVER leaves songMap null on a successful open,
 * and sets a distinguishable missing reason whenever the referenced audio is
 * absent — so the editor shows a real relink message, not a silent no-audio.
 *
 * Unit (node) test: shims localStorage, mocks the sidecar FS + persist + the
 * Phase-5 reconciler; no real disk, no real network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

vi.mock('$lib/client/desktopProjectFs', async (importActual) => {
  const actual = await importActual<typeof import('$lib/client/desktopProjectFs')>()
  return { ...actual, readProjectSong: vi.fn(), readProjectSongAsset: vi.fn() }
})
vi.mock('$lib/songmap/persist', async (importActual) => {
  const actual = await importActual<typeof import('$lib/songmap/persist')>()
  return { ...actual, decodeSmapFile: vi.fn(), smapFileDataToRestorableState: vi.fn() }
})
// Keep the Phase-5 reconciler inert (no disk scan) so the missing-audio paths
// deterministically fall through to the loader's own missing-reason handling.
vi.mock('$lib/project/audioReconcile', async (importActual) => {
  const actual = await importActual<typeof import('$lib/project/audioReconcile')>()
  return {
    ...actual,
    reconcileSongAudio: vi.fn(async () => ({ kind: 'no-match', expected: {}, scanned: [] })),
  }
})

import { loadProjectSongIntoEditor } from './commit'
import { readProjectSong, readProjectSongAsset } from '$lib/client/desktopProjectFs'
import { decodeSmapFile, smapFileDataToRestorableState } from '$lib/songmap/persist'
import { createEmptySongMap } from '$lib/songmap/factory'
import { project, setActiveProject, closeProject } from '$lib/stores/project'
import { songMap, clearSongMap } from '$lib/stores/songMap'
import { audioSession } from '$lib/stores/audioSession'
import { PROJECT_FILE_VERSION, type ProjectFile } from '$lib/project/types'
import type { SongMap } from '$lib/songmap'

const SID = 'song-1'
const FOLDER = 'songs/abcd1234'
const OSPATH = '/Users/x/Barbro projects/disk-set'

function pf(): ProjectFile {
  return {
    formatVersion: PROJECT_FILE_VERSION,
    id: 'p1',
    name: 'Disk Set',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    songs: [{ id: SID, folder: FOLDER }],
  }
}

/** A normalized runtime SongMap with an `audio` block (optionally path-stamped). */
function diskMap(opts: { withOriginalPath?: boolean } = {}): SongMap {
  const m = createEmptySongMap()
  m.metadata = { ...m.metadata, title: 'Disk Song' }
  m.audio = {
    fileName: 'master.wav',
    mimeType: 'audio/wav',
    trim: { startSec: 0, endSec: 12 },
    source: 'upload',
    ...(opts.withOriginalPath === false ? {} : { originalPath: 'audio/master.wav' }),
  } as NonNullable<SongMap['audio']>
  return m
}

describe('loadProjectSongIntoEditor — disk song open (Scenario A)', () => {
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
    audioSession.set({ file: null, name: '', startSec: 0, endSec: 0 })
    vi.clearAllMocks()
  })

  it('happy path: smap + audio present → songMap + audioSession.file set, no missing reason', async () => {
    setActiveProject(OSPATH, pf(), {})
    vi.mocked(readProjectSong).mockResolvedValue({ ok: true, bytes: new Uint8Array([1, 2, 3]) })
    vi.mocked(decodeSmapFile).mockResolvedValue({} as never)
    vi.mocked(smapFileDataToRestorableState).mockReturnValue({ songMap: diskMap(), audioBlob: null })
    vi.mocked(readProjectSongAsset).mockResolvedValue({ ok: true, blob: new Blob(['AUDIO']) })

    await loadProjectSongIntoEditor(SID)

    expect(get(songMap)?.metadata.title).toBe('Disk Song') // never null on success
    expect(get(audioSession).file).not.toBeNull() // local HD master hydrated
    expect(get(audioSession).missingReason).toBeUndefined() // nothing missing
    expect(get(project).activeSongId).toBe(SID)
    // Read the named audio off disk via the sidecar.
    expect(vi.mocked(readProjectSongAsset)).toHaveBeenCalledWith(OSPATH, FOLDER, 'audio/master.wav')
  })

  it('no active project → throws', async () => {
    await expect(loadProjectSongIntoEditor(SID)).rejects.toThrow('No active project')
  })

  it('song not in the project → throws', async () => {
    setActiveProject(OSPATH, pf(), {})
    await expect(loadProjectSongIntoEditor('nope')).rejects.toThrow('Song not found in project')
  })

  it('smap unreadable → throws and leaves songMap untouched (no partial hydrate)', async () => {
    setActiveProject(OSPATH, pf(), {})
    vi.mocked(readProjectSong).mockResolvedValue({ ok: false, error: 'ENOENT: song.smap' })

    await expect(loadProjectSongIntoEditor(SID)).rejects.toThrow('Could not read song.smap')
    expect(get(songMap)).toBeNull() // never set on a failed read
    expect(get(project).activeSongId).toBeNull()
  })

  it('audio missing on disk (originalPath named) → songMap set + missingReason=file-not-found', async () => {
    setActiveProject(OSPATH, pf(), {})
    vi.mocked(readProjectSong).mockResolvedValue({ ok: true, bytes: new Uint8Array([1, 2, 3]) })
    vi.mocked(decodeSmapFile).mockResolvedValue({} as never)
    vi.mocked(smapFileDataToRestorableState).mockReturnValue({ songMap: diskMap(), audioBlob: null })
    // The referenced file is gone from disk.
    vi.mocked(readProjectSongAsset).mockResolvedValue({ ok: false, error: 'not found' })

    await loadProjectSongIntoEditor(SID)

    expect(get(songMap)?.metadata.title).toBe('Disk Song') // song still opens
    expect(get(audioSession).file).toBeNull() // no audio
    expect(get(audioSession).missingReason).toBe('file-not-found') // relink banner
    expect(get(project).activeSongId).toBe(SID)
  })

  it('DESIRED (probes the gap): audio referenced but NOT path-stamped and NOT loadable → still a missing reason', async () => {
    setActiveProject(OSPATH, pf(), {})
    vi.mocked(readProjectSong).mockResolvedValue({ ok: true, bytes: new Uint8Array([1, 2, 3]) })
    vi.mocked(decodeSmapFile).mockResolvedValue({} as never)
    // audio block present (fileName) but no originalPath and no embedded blob.
    vi.mocked(smapFileDataToRestorableState).mockReturnValue({
      songMap: diskMap({ withOriginalPath: false }),
      audioBlob: null,
    })

    await loadProjectSongIntoEditor(SID)

    expect(get(songMap)?.metadata.title).toBe('Disk Song') // opened
    expect(get(audioSession).file).toBeNull() // no audio loaded
    // Path A needs originalPath, so no disk read is even attempted.
    expect(vi.mocked(readProjectSongAsset)).not.toHaveBeenCalled()
    // DESIRED CONTRACT: the song references audio (hasAudio) it couldn't load, so
    // the editor should offer a relink rather than show the generic "no clip"
    // state. Today the loader only sets a reason when `audio.originalPath` is
    // present, so this reference-without-path case is a silent no-audio.
    expect(get(audioSession).missingReason).toBeDefined()
  })
})
