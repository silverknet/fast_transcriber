/**
 * Tests for the sidecar's project-filesystem safety core. Run with:
 *   node --test desktop/electron/projectPaths.test.mjs
 *
 * Covers the two things that actually bite:
 *  - PATH TRAVERSAL: the loopback API takes projectPath/songFolder/subpath from
 *    the browser; a validation gap lets it read/overwrite/delete files OUTSIDE
 *    the project. These assert the guards hold.
 *  - REPLACE-AUDIO round-trip: the atomic write + remove flow that "Replace
 *    audio" runs, exercised end-to-end against a real temp project on disk.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  slugifyName,
  ensureAbsolutePath,
  validateRelSongFolder,
  validateAssetSubpath,
  resolveSongAssetPath,
  atomicWriteFile,
} from './projectPaths.mjs'

// ── validators: accept the good, reject the dangerous ────────────────────────
test('validateRelSongFolder accepts songs/<leaf>, rejects traversal + malformed', () => {
  assert.equal(validateRelSongFolder('songs/my-song-abc123'), 'songs/my-song-abc123')
  assert.equal(validateRelSongFolder('songs/Åäö_Song.1'), 'songs/Åäö_Song.1')
  for (const bad of [
    '',
    'my-song', // missing songs/ prefix
    '/songs/x', // absolute
    'songs/../secret', // parent traversal
    'songs/../../etc/passwd',
    '../songs/x',
    'songs\\x', // backslash
    'songs/x/', // trailing slash
    'songs//x', // empty segment
    'songs/.', // dot segment
    'songs/x/..', // trailing parent
  ]) {
    assert.throws(() => validateRelSongFolder(bad), `should reject ${JSON.stringify(bad)}`)
  }
})

test('validateAssetSubpath accepts nested files, rejects traversal', () => {
  assert.equal(validateAssetSubpath('audio/song.wav'), 'audio/song.wav')
  assert.equal(validateAssetSubpath('cue/tracks/main/cue-track.wav'), 'cue/tracks/main/cue-track.wav')
  for (const bad of ['', '/etc/passwd', '../x', 'audio/../../x', 'a\\b', 'audio/', 'audio//x', 'audio/./x']) {
    assert.throws(() => validateAssetSubpath(bad), `should reject ${JSON.stringify(bad)}`)
  }
})

test('ensureAbsolutePath requires an absolute path', () => {
  assert.doesNotThrow(() => ensureAbsolutePath('/Users/x/proj', 'projectPath'))
  assert.throws(() => ensureAbsolutePath('relative/path', 'projectPath'))
  assert.throws(() => ensureAbsolutePath('', 'projectPath'))
})

test('slugifyName mirrors the web-side export basename', () => {
  assert.equal(slugifyName('Dum av Dig'), 'Dum-av-Dig')
  assert.equal(slugifyName('  '), 'project')
  assert.equal(slugifyName('a/b:c*d'), 'abcd')
})

// ── resolveSongAssetPath: the single choke-point stays inside the project ─────
test('resolveSongAssetPath joins correctly and never escapes the project', () => {
  const proj = '/Users/x/Barbro projects/p'
  const good = resolveSongAssetPath(proj, 'songs/my-song', 'audio/new.wav')
  assert.equal(good, path.join(proj, 'songs/my-song', 'audio/new.wav'))
  // containment invariant
  assert.ok(good.startsWith(proj + path.sep))
  assert.ok(!path.relative(proj, good).startsWith('..'))
  // any traversal attempt throws before a path is produced
  assert.throws(() => resolveSongAssetPath(proj, 'songs/../..', 'audio/x.wav'))
  assert.throws(() => resolveSongAssetPath(proj, 'songs/s', '../../../etc/passwd'))
  assert.throws(() => resolveSongAssetPath('relative', 'songs/s', 'audio/x.wav'))
})

// ── atomic write + REPLACE round-trip against a real temp project ─────────────
function tempProject() {
  const root = mkdtempSync(path.join(tmpdir(), 'barbro-proj-'))
  const projectPath = path.join(root, 'MyProject')
  mkdirSync(projectPath, { recursive: true })
  return { root, projectPath, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('atomicWriteFile writes, creates parent dirs, leaves no .tmp litter', async () => {
  const fx = tempProject()
  try {
    const target = path.join(fx.projectPath, 'songs/s/audio/new.wav')
    await atomicWriteFile(target, Buffer.alloc(1000, 0x11))
    assert.ok(existsSync(target))
    assert.equal(readFileSync(target).length, 1000)
    // no leftover temp files in the target dir
    const litter = readdirSync(path.dirname(target)).filter((f) => f.includes('.tmp'))
    assert.deepEqual(litter, [])
  } finally {
    fx.cleanup()
  }
})

test('REPLACE AUDIO end-to-end: write new master, atomically overwrite, wipe old derived files', async () => {
  const fx = tempProject()
  try {
    const proj = fx.projectPath
    const songFolder = 'songs/dum-av-dig-abc'
    // Pre-existing state: an old audio file + stale derived artifacts.
    const oldAudio = resolveSongAssetPath(proj, songFolder, 'audio/old-master.wav')
    await atomicWriteFile(oldAudio, Buffer.alloc(500, 0x01))
    const staleStem = resolveSongAssetPath(proj, songFolder, 'stems/best/vocals.wav')
    await atomicWriteFile(staleStem, Buffer.alloc(300, 0x02))
    assert.ok(existsSync(oldAudio) && existsSync(staleStem))

    // 1) Write the replacement master (what asset/write does).
    const newAudio = resolveSongAssetPath(proj, songFolder, 'audio/new-master.wav')
    await atomicWriteFile(newAudio, Buffer.alloc(800, 0x03))

    // 2) Atomic overwrite of the SAME path must fully replace, not append.
    await atomicWriteFile(newAudio, Buffer.alloc(1200, 0x04))
    assert.equal(readFileSync(newAudio).length, 1200)
    assert.equal(readFileSync(newAudio)[0], 0x04)

    // 3) Replace-audio cleanup: remove old audio + the whole stale stems dir
    //    (what asset/remove does), confined to the song folder.
    await rm(resolveSongAssetPath(proj, songFolder, 'audio/old-master.wav'), { recursive: true, force: true })
    await rm(resolveSongAssetPath(proj, songFolder, 'stems'), { recursive: true, force: true })

    assert.ok(!existsSync(oldAudio), 'old master gone')
    assert.ok(!existsSync(path.dirname(staleStem)), 'stale stems gone')
    assert.ok(existsSync(newAudio), 'new master present')

    // 4) A traversal-laced remove target is rejected before touching disk.
    assert.throws(() => resolveSongAssetPath(proj, songFolder, '../../../MyProject'))
  } finally {
    fx.cleanup()
  }
})
