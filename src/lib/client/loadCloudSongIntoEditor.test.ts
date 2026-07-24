/**
 * TDD harness for the BROWSER-CLOUD song-open path — `loadCloudSongIntoEditor`.
 * Covers the real-use scenarios where a consumer/collaborator opens a shared
 * cloud project (no disk folder, `osPath === null`) and loads a song whose audio
 * comes from the compressed cloud copy through the single audio boundary.
 *
 * Scenario map (see task):
 *   C. sidecar ON  + NO disk folder + from cloud → browser-cloud, cloud audio
 *      loads; the fidelity failsafe must NOT block (localProjectPresent:false).
 *   D. sidecar OFF + from cloud                  → browser-cloud, cloud audio.
 *   + the AUDIO-MISSING contract: a caller must be able to distinguish
 *     "opened with audio" from "opened but audio unavailable", and the session
 *     must carry a missing reason so the editor shows a real message rather than
 *     the generic "No analyzed clip in session".
 *
 * Unit (node) test, mirroring browserCloudPull.test.ts: shim localStorage, keep
 * the real `normalizeCloudSongMap`, stub the two network calls, and MOCK the
 * audio boundary (`loadMixAudio`) so the `cloud` / `missing` outcome is driven
 * without any real network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Keep the real normalizeCloudSongMap (faithful maps); stub only the network.
vi.mock('./cloudSync', async (importActual) => {
  const actual = await importActual<typeof import('./cloudSync')>()
  return { ...actual, getCloudProjectManifest: vi.fn(), fetchCloudSongs: vi.fn() }
})

// Drive the audio-source boundary directly: the `cloud`/`missing` outcome is the
// thing under test, and we must not touch a real network or Supabase.
vi.mock('$lib/audio/loadAudio', async (importActual) => {
  const actual = await importActual<typeof import('$lib/audio/loadAudio')>()
  return { ...actual, loadMixAudio: vi.fn() }
})

import { openCloudProjectInBrowser, loadCloudSongIntoEditor } from './browserCloudProject'
import { getCloudProjectManifest, fetchCloudSongs } from './cloudSync'
import { loadMixAudio } from '$lib/audio/loadAudio'
import { project, closeProject } from '$lib/stores/project'
import { songMap, clearSongMap } from '$lib/stores/songMap'
import { audioSession } from '$lib/stores/audioSession'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'

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

function songRow(id: string, title: string, cloud_audio: unknown = null) {
  return { id, song_map: rawSongMap(title), revision: 3, hidden: false, expected_audio: null, cloud_audio }
}

const CLOUD_AUDIO = {
  codec: 'aac',
  bitrateKbps: 128,
  sourceSha256: 'sha-master',
  mix: { path: 'proj/song/mix.m4a' },
  updatedAt: '2026-07-23T00:00:00.000Z',
}

async function openProjectWith(rows: ReturnType<typeof songRow>[]) {
  vi.mocked(getCloudProjectManifest).mockResolvedValue({ project: { name: 'Set', revision: 5 } } as never)
  vi.mocked(fetchCloudSongs).mockResolvedValue(rows as never)
  const res = await openCloudProjectInBrowser('proj-1')
  expect(res.ok).toBe(true)
}

function setSidecar(reachable: boolean) {
  desktopCompanionStatus.update((s) => ({ ...s, reachable }))
}

describe('loadCloudSongIntoEditor — browser-cloud song open', () => {
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
    setSidecar(false)
    vi.clearAllMocks()
  })

  it('song not in the open project → { ok: false }', async () => {
    await openProjectWith([songRow(ID1, 'S1', CLOUD_AUDIO)])
    const res = await loadCloudSongIntoEditor('does-not-exist')
    expect(res.ok).toBe(false)
    // The editor must not have been hydrated with anything.
    expect(get(songMap)).toBeNull()
    expect(get(audioSession).file).toBeNull()
  })

  it('D: sidecar OFF + cloud audio present → { ok:true, source:cloud }, songMap + audioSession.file set', async () => {
    await openProjectWith([songRow(ID1, 'S1', CLOUD_AUDIO)])
    setSidecar(false)
    vi.mocked(loadMixAudio).mockResolvedValue({ source: 'cloud', blob: new Blob(['AUDIO']), reason: 'cloud' })

    const res = await loadCloudSongIntoEditor(ID1)

    expect(res).toEqual({ ok: true, source: 'cloud' })
    expect(get(songMap)?.metadata.title).toBe('S1') // never left null on success
    expect(get(audioSession).file).not.toBeNull() // playable audio in the session
    // Active song wired up so autosave + the editor know which song is open.
    expect(get(project).activeSongId).toBe(ID1)
  })

  it('C: sidecar ON + no disk folder → failsafe must NOT block; boundary gets localProjectPresent:false', async () => {
    await openProjectWith([songRow(ID2, 'S2', CLOUD_AUDIO)])
    setSidecar(true) // desktop client is running…
    vi.mocked(loadMixAudio).mockResolvedValue({ source: 'cloud', blob: new Blob(['AUDIO']), reason: 'cloud' })

    const res = await loadCloudSongIntoEditor(ID2)

    expect(res).toEqual({ ok: true, source: 'cloud' })
    // The load-bearing bit: a browser-cloud song has no local master to protect,
    // so it must call the boundary with localProjectPresent:false — otherwise the
    // fidelity failsafe would refuse the cloud copy while the sidecar is up.
    const inputs = vi.mocked(loadMixAudio).mock.calls[0]![0]
    expect(inputs.localProjectPresent).toBe(false)
    expect(inputs.sidecarReachable).toBe(true)
    expect(inputs.localAudioAvailable).toBe(false)
    expect(get(audioSession).file).not.toBeNull()
  })

  it('audio-missing: the song still OPENS (songMap set, session file null)', async () => {
    await openProjectWith([songRow(ID1, 'S1', null)]) // no cloud audio uploaded yet
    vi.mocked(loadMixAudio).mockResolvedValue({ source: 'missing', blob: null, reason: 'no cloud audio uploaded' })

    const res = await loadCloudSongIntoEditor(ID1)

    expect(res.ok).toBe(true) // opening succeeds even without audio
    expect(get(songMap)?.metadata.title).toBe('S1') // NEVER null on a successful open
    expect(get(audioSession).file).toBeNull() // no playable audio
  })

  it('DESIRED CONTRACT (expected to FAIL): audio-missing is distinguishable AND flags the session', async () => {
    await openProjectWith([songRow(ID1, 'S1', null)])
    vi.mocked(loadMixAudio).mockResolvedValue({ source: 'missing', blob: null, reason: 'no cloud audio uploaded' })

    const res = await loadCloudSongIntoEditor(ID1)

    // The return value carries the source (this part already holds today)…
    expect(res).toMatchObject({ ok: true, source: 'missing' })
    // …but the editor keys off the audioSession, which MUST carry a missing
    // reason so it can show a real "audio unavailable / relink" message instead
    // of the generic "No analyzed clip in session". This is the silent-success
    // bug: today `loadCloudSongIntoEditor` sets no reason on the session, so a
    // missing-audio open looks identical to a fresh session with no clip.
    expect(get(audioSession).file).toBeNull()
    expect(get(audioSession).missingReason).toBeDefined()
  })
})
