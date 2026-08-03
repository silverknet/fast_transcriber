/**
 * What may travel inside a shipped .app.
 *
 * The repo `.env` holds a Supabase SERVICE-ROLE key, which bypasses row-level
 * security entirely, and a database URL. A `.dmg` handed to a bandmate is
 * trivially unpacked, so shipping either would be a full database compromise.
 *
 * The offline build additionally must ship no `PUBLIC_SUPABASE_*`. Those two
 * are not secrets — they are on the hosted site's own pages. Here they are a
 * CAPABILITY, and their absence is what makes "this build cannot be signed out
 * at a venue" a fact about the artifact rather than a hope about the code.
 *
 * These tests exist because both are a one-line mistake away at all times.
 * Run: node --test scripts/prepareOfflineBundle.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isForbiddenEnvKey,
  parseEnv,
  pruneUnshippableAssets,
  scanForSecrets,
  scannableSecrets,
} from './prepare-offline-bundle.mjs'

/** A realistic .env, secrets included. */
const REAL_ENV = parseEnv(`
PYTHON=/usr/bin/python3
DATABASE_URL=postgres://user:pw@host/db
PUBLIC_SUPABASE_URL=https://abc.supabase.co
PUBLIC_SUPABASE_ANON_KEY=anon-key-1234567890
MIGRATE_DATABASE_URL=postgres://user:pw@host/db
SUPABASE_SERVICE_ROLE_KEY=service-role-super-secret
ADMIN_USER_IDS=u1111111,u2222222
`)

function buildDirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'offlinebundle-'))
  for (const [name, contents] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, contents)
  }
  return dir
}

test('recognises the shapes of secrets, not just exact names', () => {
  for (const key of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'MY_SECRET',
    'SOME_PRIVATE_KEY',
    'ADMIN_USER_IDS',
    'DB_PASSWORD',
    'GITHUB_TOKEN',
  ]) {
    assert.equal(isForbiddenEnvKey(key), true, key)
  }
})

test('the public Supabase pair is forbidden TOO, in this build', () => {
  // The whole point of the no-login design: not "keep the key safe" but "do not
  // ship the ability to sign in".
  assert.equal(isForbiddenEnvKey('PUBLIC_SUPABASE_URL'), true)
  assert.equal(isForbiddenEnvKey('PUBLIC_SUPABASE_ANON_KEY'), true)
})

test('ordinary config is not treated as a secret', () => {
  assert.equal(isForbiddenEnvKey('PYTHON'), false)
  assert.equal(isForbiddenEnvKey('PORT'), false)
})

test('a clean build passes the scan', () => {
  const dir = buildDirWith({
    'handler.js': 'export const handler = () => {}\n',
    'client/app.js': 'console.log("hello")\n',
  })
  assert.deepEqual(scanForSecrets(dir, REAL_ENV), [])
})

test('a service-role key baked into any file is caught', () => {
  const dir = buildDirWith({
    'handler.js': 'export const handler = () => {}\n',
    'server/chunk-abc.js': 'const k = "service-role-super-secret"\n',
  })
  const hits = scanForSecrets(dir, REAL_ENV)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].key, 'SUPABASE_SERVICE_ROLE_KEY')
  assert.match(hits[0].file, /chunk-abc\.js$/)
})

test('a baked-in Supabase URL is caught — it would restore the sign-in', () => {
  const dir = buildDirWith({
    'handler.js': 'const u = "https://abc.supabase.co"\n',
  })
  const hits = scanForSecrets(dir, REAL_ENV)
  assert.deepEqual(hits.map((h) => h.key), ['PUBLIC_SUPABASE_URL'])
})

test('a stale .env inside the build is caught by the same scan', () => {
  // The exact regression the script's rm guards against: a leftover env file
  // from the previous design is loaded at runtime and the cloud comes back.
  const dir = buildDirWith({
    'handler.js': 'export const handler = () => {}\n',
    '.env': 'PUBLIC_SUPABASE_URL=https://abc.supabase.co\nPUBLIC_SUPABASE_ANON_KEY=anon-key-1234567890\n',
  })
  const hits = scanForSecrets(dir, REAL_ENV).map((h) => h.key).sort()
  assert.deepEqual(hits, ['PUBLIC_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_URL'])
})

test('short values are not scanned, so the check cannot cry wolf', () => {
  // "u1,u2" as a value would match half a bundle. The scan is by value, so it
  // must only consider values long enough to be distinctive.
  const shortEnv = parseEnv('ADMIN_USER_IDS=u1\nMY_SECRET=x\n')
  assert.deepEqual(scannableSecrets(shortEnv), [])
  const dir = buildDirWith({ 'handler.js': 'const x = "u1"; const y = "x"\n' })
  assert.deepEqual(scanForSecrets(dir, shortEnv), [])
})

test('a build is scanned recursively, not just at the top level', () => {
  const dir = buildDirWith({
    'a/b/c/deep.js': 'postgres://user:pw@host/db\n',
  })
  const hits = scanForSecrets(dir, REAL_ENV)
  assert.ok(hits.length >= 1, 'a nested file was not scanned')
  assert.match(hits[0].file, /deep\.js$/)
})

/**
 * THE APP MUST NOT CONTAIN A COPY OF ITSELF.
 *
 * SvelteKit copies `static/` verbatim into the client build, and `static/releases`
 * holds the previous desktop DMG so the website can offer it for download. Left
 * in, the packaged app ships a 109 MB copy of an older version of itself — the
 * offline DMG measured 241 MB instead of ~130 MB before this was caught.
 */
test('the previous release is stripped from the bundle', () => {
  const dir = buildDirWith({
    'handler.js': 'export const handler = () => {}\n',
    'client/releases/barbro-desktop-0.1.0-arm64.dmg': 'x'.repeat(4096),
    'client/releases/README.md': 'download me',
  })
  const removed = pruneUnshippableAssets(dir)
  assert.equal(removed.length, 1)
  assert.equal(removed[0].path, 'client/releases')
  assert.ok(removed[0].bytes > 4000, 'should report the bytes it reclaimed')
  assert.equal(existsSync(join(dir, 'client', 'releases')), false)
})

test('sample assets the offline app NEEDS are left alone', () => {
  // Bass and drum samples are how the machines make sound with no network.
  // Pruning them would produce a silent band at a venue.
  const dir = buildDirWith({
    'handler.js': 'export const handler = () => {}\n',
    'client/bass/finger-c2.wav': 'RIFF',
    'client/drums/acoustic/kick.wav': 'RIFF',
    'client/worklets/drumBusCompressor.js': 'registerProcessor',
  })
  pruneUnshippableAssets(dir)
  for (const p of ['client/bass/finger-c2.wav', 'client/drums/acoustic/kick.wav', 'client/worklets/drumBusCompressor.js']) {
    assert.equal(existsSync(join(dir, p)), true, `${p} was removed and must not be`)
  }
})

test('pruning a bundle that has nothing to prune is a no-op', () => {
  const dir = buildDirWith({ 'handler.js': 'export const handler = () => {}\n' })
  assert.deepEqual(pruneUnshippableAssets(dir), [])
})

test('with no .env there is nothing to scan for, and that is reported honestly', () => {
  // A green result here proves nothing; the script warns rather than claiming a
  // clean bill of health.
  assert.deepEqual(scannableSecrets({}), [])
  const dir = buildDirWith({ 'handler.js': 'anything at all\n' })
  assert.deepEqual(scanForSecrets(dir, {}), [])
})
