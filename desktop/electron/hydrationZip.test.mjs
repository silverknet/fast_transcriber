/**
 * Round-trip proof for the hydration-pack "closed" fix, using the REAL
 * archiver + yauzl (same libs/versions the sidecar uses). Mirrors the
 * export/import pattern in main.mjs (handleHydrationExport / openHydrationPack
 * / extractZipEntryToFile).
 *
 * Run: node --test desktop/electron/hydrationZip.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import archiver from 'archiver'
import yauzl from 'yauzl'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const AUDIO_BYTES = 'FAKE-AUDIO-BYTES-'.repeat(100)

/** Build a hydration-like pack the way handleHydrationExport does. */
function buildPack(packPath) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(packPath)
    const archive = archiver('zip', { zlib: { level: 0 } })
    out.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(out)
    archive.append(JSON.stringify({ kind: 'barbro-hydration-pack', formatVersion: 1 }), {
      name: 'hydration-manifest.json',
    })
    archive.append(Buffer.from(AUDIO_BYTES), { name: 'songs/song-1/audio/a.wav' })
    archive.append(Buffer.from('STEM'), { name: 'songs/song-1/stems/best/drums.wav' })
    void archive.finalize()
  })
}

/** Mirror of openHydrationPack — read every entry, then hand back the open zip. */
function openPack(packPath, autoClose) {
  return new Promise((resolve, reject) => {
    yauzl.open(packPath, { lazyEntries: true, autoClose }, (err, zipFile) => {
      if (err || !zipFile) return reject(err ?? new Error('open failed'))
      const entries = []
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry()
          return
        }
        entries.push(entry)
        zipFile.readEntry()
      })
      zipFile.on('end', () => resolve({ zipFile, entries }))
      zipFile.on('error', reject)
      zipFile.readEntry()
    })
  })
}

/** Mirror of extractZipEntryToFile. */
function extract(zipFile, entry, target) {
  return new Promise((resolve, reject) => {
    let threw = false
    try {
      zipFile.openReadStream(entry, async (err, stream) => {
        if (err || !stream) return reject(err ?? new Error('no stream'))
        try {
          await mkdir(path.dirname(target), { recursive: true })
          const out = createWriteStream(target)
          stream.pipe(out)
          out.on('finish', () => resolve())
          out.on('error', reject)
          stream.on('error', reject)
        } catch (e) {
          reject(e)
        }
      })
    } catch (e) {
      // yauzl throws synchronously ("closed") when the zip is already closed.
      threw = true
      reject(e)
    }
    if (threw) return
  })
}

test('FIX: with autoClose:false, entries extract after the read pass', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyd-fix-'))
  try {
    const packPath = path.join(dir, 'pack.zip')
    await buildPack(packPath)
    const { zipFile, entries } = await openPack(packPath, false)
    const audio = entries.find((e) => e.fileName === 'songs/song-1/audio/a.wav')
    assert.ok(audio, 'audio entry present')
    const target = path.join(dir, 'out.wav')
    await extract(zipFile, audio, target) // must NOT throw "closed"
    zipFile.close()
    assert.equal((await readFile(target)).toString(), AUDIO_BYTES)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('REGRESSION: autoClose:true (the old default) fails extraction with "closed"', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyd-reg-'))
  try {
    const packPath = path.join(dir, 'pack.zip')
    await buildPack(packPath)
    const { zipFile, entries } = await openPack(packPath, true)
    const audio = entries.find((e) => e.fileName === 'songs/song-1/audio/a.wav')
    let error = null
    try {
      await extract(zipFile, audio, path.join(dir, 'out.wav'))
    } catch (e) {
      error = e
    }
    assert.ok(error, 'expected extraction to fail on the auto-closed zip')
    assert.match(String(error?.message ?? error), /closed/i)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
