/**
 * Behavioural tests for the auto-stems daemon SHELL, driven through its
 * dependency-injection seams (no real filesystem / demucs). These cover the
 * decision flow that can't be runtime-verified without the live sidecar:
 * what gets enqueued, what's skipped, the attempt cap, corruption re-render,
 * and watch-list hygiene.
 *
 * Run: node --test desktop/electron/autoStems.daemon.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createAutoStemsDaemon } from './autoStems.mjs'

/**
 * Build a daemon over a tiny in-memory project spec.
 * spec: { path, autoStems, songs: [{ id, folder, hidden?, analyzed?, audioPath?, stemsByPreset?, health? }] }
 * `health[stem]` = false marks an existing stem corrupt; default healthy.
 */
function makeDaemon(projects, opts = {}) {
  const enqueued = []
  const saved = []
  const inflight = new Set(opts.inflight ?? [])
  const missing = new Set(opts.missingPaths ?? [])

  const findSong = (abs) => {
    for (const proj of projects) {
      for (const s of proj.songs) {
        if (abs.includes(`/${s.folder}/`) || abs.endsWith(`/${s.folder}`)) return s
      }
    }
    return null
  }

  const daemon = createAutoStemsDaemon({
    readManifest: async (projectPath) => {
      const proj = projects.find((p) => p.path === projectPath)
      if (!proj) throw new Error('no manifest')
      return {
        formatVersion: 1,
        songs: proj.songs.map((s) => ({ id: s.id, folder: s.folder, ...(s.hidden ? { hidden: true } : {}) })),
        autoStems: proj.autoStems,
      }
    },
    readSmapHeader: async (smapPath) => {
      const s = findSong(smapPath)
      if (!s) return null
      return {
        songMap: {
          metadata: { analyzed: s.analyzed === true },
          audio: s.audioPath ? { originalPath: s.audioPath } : undefined,
          timeline: { bars: [] },
        },
      }
    },
    listStemSets: async (folderAbs) => {
      const s = findSong(folderAbs + '/')
      return s?.stemsByPreset ?? {}
    },
    wavInfo: async (abs) => {
      const s = findSong(abs)
      if (!s) return null
      const stem = path.basename(abs).replace(/\.[^.]+$/, '')
      if (s.health && s.health[stem] === false) return null // corrupt
      return { durationSec: 180, sampleRate: 44100, channels: 2, fileSize: 180 * 44100 * 2 * 2 }
    },
    enqueueJob: async (args) => {
      enqueued.push(args)
      return `job-${enqueued.length}`
    },
    hasInflightJobForSong: (songId) => inflight.has(songId),
    loadWatched: () => projects.map((p) => p.path),
    saveWatched: (paths) => saved.push(paths),
    existsSync: (p) => !missing.has(p),
    log: () => {},
  })
  // Seed the watch set directly (avoids start()'s timer in tests).
  for (const p of projects) daemon._watched.add(p.path)
  return { daemon, enqueued, saved }
}

const CFG = { enabled: true, stems: ['drums', 'bass'], quality: 'balanced' }

test('enqueues needed stems for an analyzed song with audio', async () => {
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/proj',
      autoStems: CFG,
      songs: [{ id: 's1', folder: 'songs/a', analyzed: true, audioPath: 'audio/a.wav', stemsByPreset: {} }],
    },
  ])
  await daemon.runOnce()
  assert.equal(enqueued.length, 1)
  assert.deepEqual(enqueued[0].stems, ['drums', 'bass'])
  assert.equal(enqueued[0].quality, 'balanced')
  assert.equal(enqueued[0].songId, 's1')
  assert.ok(enqueued[0].inputPath.endsWith('/proj/songs/a/audio/a.wav'))
  assert.ok(enqueued[0].outputDir.endsWith('/proj/songs/a/stems/balanced'))
})

test('disabled policy → nothing enqueued', async () => {
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/proj',
      autoStems: { ...CFG, enabled: false },
      songs: [{ id: 's1', folder: 'songs/a', analyzed: true, audioPath: 'audio/a.wav', stemsByPreset: {} }],
    },
  ])
  await daemon.runOnce()
  assert.equal(enqueued.length, 0)
})

test('skips un-analyzed songs and songs without audio', async () => {
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/proj',
      autoStems: CFG,
      songs: [
        { id: 's1', folder: 'songs/a', analyzed: false, audioPath: 'audio/a.wav', stemsByPreset: {} },
        { id: 's2', folder: 'songs/b', analyzed: true, audioPath: undefined, stemsByPreset: {} },
      ],
    },
  ])
  await daemon.runOnce()
  assert.equal(enqueued.length, 0)
})

test('skips hidden songs', async () => {
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/proj',
      autoStems: CFG,
      songs: [{ id: 's1', folder: 'songs/a', hidden: true, analyzed: true, audioPath: 'audio/a.wav', stemsByPreset: {} }],
    },
  ])
  await daemon.runOnce()
  assert.equal(enqueued.length, 0)
})

test('skips songs that already have an in-flight job', async () => {
  const { daemon, enqueued } = makeDaemon(
    [
      {
        path: '/proj',
        autoStems: CFG,
        songs: [{ id: 's1', folder: 'songs/a', analyzed: true, audioPath: 'audio/a.wav', stemsByPreset: {} }],
      },
    ],
    { inflight: ['s1'] },
  )
  await daemon.runOnce()
  assert.equal(enqueued.length, 0)
})

test('satisfied song (all stems present + healthy) → nothing enqueued', async () => {
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/proj',
      autoStems: CFG,
      songs: [
        {
          id: 's1',
          folder: 'songs/a',
          analyzed: true,
          audioPath: 'audio/a.wav',
          stemsByPreset: { balanced: ['drums.wav', 'bass.wav'] },
        },
      ],
    },
  ])
  await daemon.runOnce()
  assert.equal(enqueued.length, 0)
})

test('corrupt existing stem is re-rendered', async () => {
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/proj',
      autoStems: CFG,
      songs: [
        {
          id: 's1',
          folder: 'songs/a',
          analyzed: true,
          audioPath: 'audio/a.wav',
          stemsByPreset: { balanced: ['drums.wav', 'bass.wav'] },
          health: { drums: false }, // truncated/corrupt
        },
      ],
    },
  ])
  await daemon.runOnce()
  assert.equal(enqueued.length, 1)
  assert.deepEqual(enqueued[0].stems, ['drums'])
})

test('attempt cap stops after 3 unproductive enqueues', async () => {
  // stemsByPreset never updates (fake disk), so each pass would re-enqueue
  // forever without the cap.
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/proj',
      autoStems: CFG,
      songs: [{ id: 's1', folder: 'songs/a', analyzed: true, audioPath: 'audio/a.wav', stemsByPreset: {} }],
    },
  ])
  for (let i = 0; i < 5; i++) await daemon.runOnce()
  assert.equal(enqueued.length, 3)
})

test('drops a watched project whose folder no longer exists', async () => {
  const { daemon, saved } = makeDaemon(
    [
      {
        path: '/gone',
        autoStems: CFG,
        songs: [{ id: 's1', folder: 'songs/a', analyzed: true, audioPath: 'audio/a.wav', stemsByPreset: {} }],
      },
    ],
    { missingPaths: ['/gone'] },
  )
  daemon.watchProject('/gone')
  await daemon.runOnce()
  // Last persisted list must no longer contain the missing path.
  assert.ok(saved.length > 0)
  assert.deepEqual(saved[saved.length - 1], [])
})

test('processes multiple watched projects in one pass', async () => {
  const { daemon, enqueued } = makeDaemon([
    {
      path: '/p1',
      autoStems: CFG,
      songs: [{ id: 'a', folder: 'songs/a', analyzed: true, audioPath: 'audio/a.wav', stemsByPreset: {} }],
    },
    {
      path: '/p2',
      autoStems: { enabled: true, stems: ['vocals'], quality: 'best' },
      songs: [{ id: 'b', folder: 'songs/b', analyzed: true, audioPath: 'audio/b.wav', stemsByPreset: {} }],
    },
  ])
  await daemon.runOnce()
  assert.equal(enqueued.length, 2)
  const byProject = Object.fromEntries(enqueued.map((e) => [e.songId, e]))
  assert.deepEqual(byProject.a.stems, ['drums', 'bass'])
  assert.deepEqual(byProject.b.stems, ['vocals'])
  assert.equal(byProject.b.quality, 'best')
})
