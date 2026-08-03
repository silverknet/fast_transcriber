/**
 * Reanalyse-all-lyrics — the project-wide batch that re-fits every song's
 * imported lyrics and writes them to disk (+ best-effort cloud). Because it
 * mutates lyrics.words across disk AND cloud in several project modes, it's
 * tested against the full scenario matrix: disk-only, disk+cloud, cloud
 * conflict, browser-cloud (gated out), sidecar down, missing lyrics/stems,
 * transcription failure, the open song, cancel, hidden songs, and I/O failures.
 *
 * All I/O boundaries are mocked; the real `project` / `desktopCompanionStatus`
 * stores are driven directly, and alignment + language detection run for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

vi.mock('$lib/client/desktopProjectFs', () => ({
  readProjectSong: vi.fn(),
  writeProjectSong: vi.fn(),
  writeProjectManifest: vi.fn(),
}))
vi.mock('$lib/songmap/smapFile', () => ({
  decodeSmapFile: vi.fn(),
  encodeSmapFile: vi.fn(),
}))
vi.mock('$lib/client/desktopBridge', () => ({
  getLyricsSetupStatus: vi.fn(),
  setupLyricsDeps: vi.fn(),
  enqueueLyricsTranscription: vi.fn(),
  subscribeToJobEvents: vi.fn(),
}))
vi.mock('$lib/client/cloudSync', () => ({ pushCloudSong: vi.fn() }))
vi.mock('$lib/project/commit', () => ({
  metadataLiteFromSongMap: vi.fn(() => ({})),
  refreshProjectInfo: vi.fn(async () => ({ updatedSongs: 0, errors: [] })),
  selectBestStemSet: vi.fn(),
}))
vi.mock('$lib/songmap/collab', () => ({
  collabContentFingerprint: (m: { metadata?: { title?: string } }) => 'fp:' + (m?.metadata?.title ?? ''),
}))

import { reanalyseAllLyrics } from './reanalyseLyrics'
import { readProjectSong, writeProjectSong, writeProjectManifest } from './desktopProjectFs'
import { decodeSmapFile, encodeSmapFile } from '$lib/songmap/smapFile'
import {
  getLyricsSetupStatus,
  setupLyricsDeps,
  enqueueLyricsTranscription,
  subscribeToJobEvents,
} from './desktopBridge'
import { pushCloudSong } from './cloudSync'
import { selectBestStemSet } from '$lib/project/commit'
import { project } from '$lib/stores/project'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import type { SongMap } from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'

// ── fixtures ────────────────────────────────────────────────────────────────
// Has enough English function words that detectLyricsLanguage confidently → 'en'.
const SOURCE = 'you are the one that i know\nand you have all that we need'

function makeSongMap(title: string, opts: { sourceText?: string | null; originalPath?: string | null } = {}): SongMap {
  const sourceText = opts.sourceText === undefined ? SOURCE : opts.sourceText
  // A valid decoded map: in production `sm` comes from decodeSmapFile →
  // parseSongMap, which validates, so the batch's own validate guard only ever
  // rejects a map the NEW lyrics made invalid — never the fixture itself.
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    ...(sourceText ? { lyrics: { words: [], sourceText } } : {}),
    ...(opts.originalPath === null ? {} : { audio: { originalPath: opts.originalPath ?? 'audio/mix.wav' } }),
    timeline: { bars: [], beats: [] },
    sections: [],
    harmony: [],
    cueTracks: [],
  } as unknown as SongMap
}

/** ASR words that align cleanly to SOURCE (exact matches → anchors). */
function asrFromText(text: string) {
  let t = 5
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const word = { text: w, startSec: t, endSec: t + 0.4 }
      t += 0.5
      return word
    })
}

// folder → the SongMap that decode returns for that folder's bytes
let SONGMAPS: Record<string, SongMap> = {}

function setProjectStore(opts: {
  osPath?: string | null
  cloud?: { projectId: string; lastSyncedRevision: number }
  songs?: { id: string; folder: string; hidden?: boolean; cloudSongId?: string; lastSyncedRevision?: number }[]
  editingMode?: string
  activeSongId?: string | null
}) {
  const songs = opts.songs ?? [
    { id: 's1', folder: 'songs/a' },
    { id: 's2', folder: 'songs/b' },
  ]
  project.set({
    osPath: opts.osPath === undefined ? '/proj' : opts.osPath,
    data: { id: 'p1', name: 'Set', songs, ...(opts.cloud ? { cloud: opts.cloud } : {}) },
    metadataByFolder: Object.fromEntries(songs.map((s) => [s.folder, {}])),
    activeSongFolder: null,
    activeSongId: opts.activeSongId ?? null,
    editingMode: opts.editingMode ?? 'idle',
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  SONGMAPS = { 'songs/a': makeSongMap('Song A'), 'songs/b': makeSongMap('Song B') }

  desktopCompanionStatus.set({ reachable: true } as never)
  setProjectStore({})

  // Happy-path I/O defaults.
  vi.mocked(getLyricsSetupStatus).mockResolvedValue({ ready: true } as never)
  vi.mocked(setupLyricsDeps).mockResolvedValue({ ok: true } as never)
  vi.mocked(readProjectSong).mockImplementation(
    async (_p: string, folder: string) => ({ ok: true, bytes: new TextEncoder().encode(folder) }) as never,
  )
  vi.mocked(decodeSmapFile).mockImplementation(async (blob: Blob) => {
    const folder = await blob.text()
    return { project: { projectFormatVersion: 1, songMap: SONGMAPS[folder] } } as never
  })
  vi.mocked(encodeSmapFile).mockImplementation(async () => new Blob(['smap']) as never)
  vi.mocked(writeProjectSong).mockResolvedValue({ ok: true } as never)
  vi.mocked(writeProjectManifest).mockResolvedValue({ ok: true } as never)
  vi.mocked(selectBestStemSet).mockReturnValue({ preset: 'best', files: ['vocals.wav'], pathPrefix: 'stems/best/' } as never)
  vi.mocked(enqueueLyricsTranscription).mockImplementation(
    async (_abs: string) => ({ ok: true, jobId: 'job' }) as never,
  )
  vi.mocked(subscribeToJobEvents).mockImplementation((_jobId: string, onEvent: (e: never) => void) => {
    onEvent({ type: 'done', words: asrFromText(SOURCE) } as never)
    return () => {}
  })
  vi.mocked(pushCloudSong).mockResolvedValue({ ok: true, revision: 10 } as never)
})

const noop = () => {}

// ── scenarios ───────────────────────────────────────────────────────────────
describe('reanalyseAllLyrics — gating', () => {
  it('refuses browser-cloud mode (no local disk)', async () => {
    setProjectStore({ osPath: null })
    const r = await reanalyseAllLyrics(noop)
    expect(r.phase).toBe('error')
    expect(r.error).toMatch(/disk|Studio/i)
    expect(readProjectSong).not.toHaveBeenCalled()
  })

  it('refuses when the sidecar is unreachable', async () => {
    desktopCompanionStatus.set({ reachable: false } as never)
    const r = await reanalyseAllLyrics(noop)
    expect(r.phase).toBe('error')
    expect(readProjectSong).not.toHaveBeenCalled()
  })

  it('errors when the lyrics engine cannot be prepared', async () => {
    vi.mocked(getLyricsSetupStatus).mockResolvedValue({ ready: false } as never)
    vi.mocked(setupLyricsDeps).mockResolvedValue({ ok: false, error: 'no engine' } as never)
    const r = await reanalyseAllLyrics(noop)
    expect(r.phase).toBe('error')
    expect(r.error).toBe('no engine')
  })
})

describe('reanalyseAllLyrics — disk (no cloud)', () => {
  it('re-fits every song and writes lyrics.words to disk, sourceText untouched', async () => {
    const r = await reanalyseAllLyrics(noop)
    expect(r.phase).toBe('done')
    expect(r.results.filter((x) => x.status === 'ok')).toHaveLength(2)
    expect(writeProjectSong).toHaveBeenCalledTimes(2)

    // The map handed to encode has fresh words, v4, and the ORIGINAL sourceText.
    const written = vi.mocked(encodeSmapFile).mock.calls.map((c) => (c[0] as { project: { songMap: SongMap } }).project.songMap)
    for (const m of written) {
      expect(m.lyrics!.words.length).toBeGreaterThan(0)
      expect(m.lyrics!.transcriberVersion).toBe(4)
      expect(m.lyrics!.sourceText).toBe(SOURCE)
      expect(m.lyrics!.alignedAt).toBeTruthy()
    }
    // No cloud project → no push, no manifest write.
    expect(pushCloudSong).not.toHaveBeenCalled()
    expect(writeProjectManifest).not.toHaveBeenCalled()
  })

  it('passes a language hint derived from the lyrics', async () => {
    await reanalyseAllLyrics(noop)
    const opts = vi.mocked(enqueueLyricsTranscription).mock.calls[0]![1]
    expect(opts).toEqual({ language: 'en' }) // "hello world here…" → English
  })

  it('uses the vocals stem path, falling back to the mix when no stem', async () => {
    vi.mocked(selectBestStemSet).mockReturnValueOnce({ preset: 'best', files: ['vocals.wav'], pathPrefix: 'stems/best/' } as never)
    vi.mocked(selectBestStemSet).mockReturnValueOnce(null as never) // song B: no stems
    await reanalyseAllLyrics(noop)
    const paths = vi.mocked(enqueueLyricsTranscription).mock.calls.map((c) => c[0])
    expect(paths[0]).toBe('/proj/songs/a/stems/best/vocals.wav')
    expect(paths[1]).toBe('/proj/songs/b/audio/mix.wav')
  })
})

describe('reanalyseAllLyrics — cloud', () => {
  it('pushes each song and advances the per-song watermark + manifest once', async () => {
    setProjectStore({ cloud: { projectId: 'cp', lastSyncedRevision: 3 } })
    const r = await reanalyseAllLyrics(noop)
    expect(r.results.every((x) => x.status === 'ok' && x.synced)).toBe(true)
    expect(pushCloudSong).toHaveBeenCalledTimes(2)

    // baseRev = entry.lastSyncedRevision ?? cloud.lastSyncedRevision (3), sortOrder = index.
    const [projId, songId, , sortOrder, hidden, baseRev] = vi.mocked(pushCloudSong).mock.calls[0]!
    expect(projId).toBe('cp')
    expect(songId).toBe('s1') // cloudSongId ?? id
    expect(sortOrder).toBe(0)
    expect(hidden).toBe(false)
    expect(baseRev).toBe(3)

    // Watermarks advanced in the store + persisted to the manifest exactly once.
    expect(writeProjectManifest).toHaveBeenCalledTimes(1)
    const songs = get(project).data!.songs
    expect(songs[0]!.lastSyncedRevision).toBe(10)
    expect(songs[0]!.lastSyncedContentHash).toBe('fp:Song A')
  })

  it('on a cloud conflict, keeps the disk write and leaves the song un-synced', async () => {
    setProjectStore({ cloud: { projectId: 'cp', lastSyncedRevision: 3 } })
    vi.mocked(pushCloudSong).mockResolvedValue({ ok: false, conflict: true, remote: null } as never)
    const r = await reanalyseAllLyrics(noop)
    expect(r.results.every((x) => x.status === 'ok')).toBe(true)
    expect(r.results.every((x) => x.synced === false)).toBe(true)
    expect(writeProjectSong).toHaveBeenCalledTimes(2) // disk still written
    expect(writeProjectManifest).not.toHaveBeenCalled() // no successful push → no watermark persist
    // The store watermark is NOT advanced (stays undefined) so a later open reconciles.
    expect(get(project).data!.songs[0]!.lastSyncedRevision).toBeUndefined()
  })
})

describe('reanalyseAllLyrics — per-song skips & failures', () => {
  it('skips songs with no imported lyrics', async () => {
    SONGMAPS['songs/b'] = makeSongMap('Song B', { sourceText: null })
    const r = await reanalyseAllLyrics(noop)
    const b = r.results.find((x) => x.folder === 'songs/b')!
    expect(b.status).toBe('skipped')
    expect(b.detail).toMatch(/no imported lyrics/i)
    expect(writeProjectSong).toHaveBeenCalledTimes(1) // only song A
  })

  it('skips songs with no audio on disk (no stem, no mix)', async () => {
    SONGMAPS['songs/b'] = makeSongMap('Song B', { originalPath: null })
    vi.mocked(selectBestStemSet).mockReturnValue(null as never)
    const r = await reanalyseAllLyrics(noop)
    const b = r.results.find((x) => x.folder === 'songs/b')!
    expect(b.status).toBe('skipped')
    expect(b.detail).toMatch(/no audio/i)
  })

  it('marks a song failed when transcription errors', async () => {
    vi.mocked(subscribeToJobEvents).mockImplementationOnce((_id: string, onEvent: (e: never) => void) => {
      onEvent({ type: 'error', msg: 'whisper blew up' } as never)
      return () => {}
    })
    const r = await reanalyseAllLyrics(noop)
    expect(r.results[0]!.status).toBe('failed')
    expect(r.results[0]!.detail).toMatch(/whisper blew up/)
    expect(r.results[1]!.status).toBe('ok') // the batch keeps going
  })

  it('marks a song failed when it cannot be read from disk', async () => {
    vi.mocked(readProjectSong).mockImplementationOnce(async () => ({ ok: false, error: 'gone' }) as never)
    const r = await reanalyseAllLyrics(noop)
    expect(r.results[0]!.status).toBe('failed')
    expect(r.results[0]!.detail).toMatch(/could not read/i)
  })

  it('marks a song failed (and never persists) when the fit is invalid', async () => {
    // A recognizer that returns a non-finite word time flows through alignment
    // into a word with a non-finite endSec. Validation must catch it BEFORE any
    // disk OR cloud write, so one bad transcription can't corrupt a `.smap`
    // (which would then fail to reopen and break collaborators' pulls).
    setProjectStore({ cloud: { projectId: 'cp', lastSyncedRevision: 3 } })
    vi.mocked(subscribeToJobEvents).mockImplementationOnce((_id: string, onEvent: (e: never) => void) => {
      const words = asrFromText(SOURCE).map((w) =>
        w.text === 'know' ? { ...w, endSec: Number.POSITIVE_INFINITY } : w,
      )
      onEvent({ type: 'done', words } as never)
      return () => {}
    })
    const r = await reanalyseAllLyrics(noop)
    expect(r.results[0]!.status).toBe('failed')
    expect(r.results[0]!.detail).toMatch(/invalid/i)
    // The bad song is never written to disk or pushed to the cloud; the clean
    // second song is still processed normally.
    expect(writeProjectSong).toHaveBeenCalledTimes(1)
    expect(pushCloudSong).toHaveBeenCalledTimes(1)
    expect(r.results[1]!.status).toBe('ok')
  })

  it('marks a song failed when the disk write fails', async () => {
    vi.mocked(writeProjectSong).mockImplementationOnce(async () => ({ ok: false, error: 'disk full' }) as never)
    const r = await reanalyseAllLyrics(noop)
    expect(r.results[0]!.status).toBe('failed')
    expect(r.results[0]!.detail).toMatch(/could not save/i)
  })

  it('skips the song currently open in the editor', async () => {
    setProjectStore({ editingMode: 'project-song', activeSongId: 's1' })
    const r = await reanalyseAllLyrics(noop)
    const a = r.results.find((x) => x.folder === 'songs/a')!
    expect(a.status).toBe('skipped')
    expect(a.detail).toMatch(/editor/i)
    expect(writeProjectSong).toHaveBeenCalledTimes(1) // only song B
  })

  it('ignores hidden songs entirely', async () => {
    setProjectStore({ songs: [{ id: 's1', folder: 'songs/a' }, { id: 's2', folder: 'songs/b', hidden: true }] })
    const r = await reanalyseAllLyrics(noop)
    expect(r.results).toHaveLength(1)
    expect(r.results[0]!.folder).toBe('songs/a')
  })
})

describe('reanalyseAllLyrics — cancel', () => {
  it('stops after the current song and reports cancelled', async () => {
    let calls = 0
    const isCancelled = () => calls++ >= 1 // cancel before the 2nd song
    const r = await reanalyseAllLyrics(noop, isCancelled)
    expect(r.phase).toBe('cancelled')
    expect(writeProjectSong).toHaveBeenCalledTimes(1)
  })
})
