/**
 * The offline UI mount points. Run with:
 *   node --test desktop/electron/offlineUi.test.mjs
 *
 * Two things are checked here, and they fail in different ways.
 *
 * The ROUTE BOUNDARY is the whole contract of sharing one port, and getting it
 * wrong is silent in both directions: claim too much and part of the app 404s;
 * claim too little and a sidecar call gets an HTML page where JSON was expected.
 *
 * The ENV SHAPE is the offline build's central safety property. If cloud config
 * survives into the environment, the app can sign in — and anything that can be
 * signed in can be signed OUT, at a venue, mid-set. That is the exact failure
 * this whole design exists to remove, so it is asserted rather than assumed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOUD_ENV_KEYS,
  isBundleStale,
  isSidecarRoute,
  parseBuildStamp,
  prepareOfflineEnv,
  shouldAutoOpenOfflineUi,
} from './offlineUi.mjs'

/**
 * BARBRO DESKTOP IS A SIDECAR. It starts as one, every time.
 *
 * This is the app people download from barbro.app so the website can analyse,
 * split stems and reach their files. Offline mode is a switch in the status
 * window — never something the app decides for itself.
 *
 * It regressed here once, and silently: the choice used to be "does a
 * `build-node/handler.js` exist on disk", so building the offline bundle once
 * for a gig turned every later `npm run dev --prefix desktop` into a windowed
 * app. Nobody asked for that and nothing announced it. These tests exist so
 * that inference cannot creep back in.
 */
test('nothing auto-opens the offline app by default', () => {
  assert.equal(shouldAutoOpenOfflineUi({ env: {} }), false)
})

test('a packaged app does NOT auto-open it either', () => {
  // The important one. This is what every barbro.app download does on launch,
  // and it must be exactly what it has always been.
  assert.equal(shouldAutoOpenOfflineUi({ env: { NODE_ENV: 'production' } }), false)
})

test('the presence of a build on disk is NOT a decision', () => {
  // The original bug, stated as a rule: no filesystem state may turn the
  // sidecar into a windowed app.
  assert.equal(shouldAutoOpenOfflineUi({ env: { BARBRO_OFFLINE_BUILD_DIR: '/somewhere/build-node' } }), false)
})

test('`npm run offline:desktop` is the one thing that auto-opens it', () => {
  assert.equal(shouldAutoOpenOfflineUi({ env: { BARBRO_OFFLINE_UI: '1' } }), true)
})

test('the SERVER flag is not mistaken for the LAUNCHER request', () => {
  // `prepareOfflineEnv()` sets BARBRO_OFFLINE. If the decision were read from
  // that same variable it would answer "yes" for the rest of the process no
  // matter what was asked — a trap that only appears when someone moves the
  // call. Two names exist precisely to make this impossible.
  assert.equal(shouldAutoOpenOfflineUi({ env: { BARBRO_OFFLINE: '1' } }), false)
})

test('deciding AFTER prepareOfflineEnv still gives the same answer', () => {
  // The ordering trap, executed rather than described.
  const env = {}
  prepareOfflineEnv({ env })
  assert.equal(env.BARBRO_OFFLINE, '1')
  assert.equal(shouldAutoOpenOfflineUi({ env }), false)
})

test('only exactly "1" counts', () => {
  for (const v of ['true', 'yes', '0', '', 'TRUE']) {
    assert.equal(shouldAutoOpenOfflineUi({ env: { BARBRO_OFFLINE_UI: v } }), false, v)
  }
})

test('the sidecar keeps its own API', () => {
  for (const p of [
    '/ping',
    '/ping?x=1',
    '/native/hardware/status',
    '/native/hardware/xair/connect',
    '/native/analyze-drums',
    '/native/auto-stems/status',
  ]) {
    assert.equal(isSidecarRoute(p), true, p)
  }
})

test('everything else belongs to the app', () => {
  for (const p of [
    '/',
    '/edit',
    '/rig',
    '/project/playback',
    '/_app/immutable/entry/app.js',
    '/favicon.png',
    '/worklets/drumBusCompressor.js',
    '/drums/acoustic/kick.wav',
  ]) {
    assert.equal(isSidecarRoute(p), false, p)
  }
})

test('does not claim a lookalike prefix', () => {
  // A sloppy startsWith would swallow these and break real app routes.
  assert.equal(isSidecarRoute('/nativity'), false)
  assert.equal(isSidecarRoute('/native'), false)
  assert.equal(isSidecarRoute('/pingpong'), false)
})

test('the offline flag is set', () => {
  const env = {}
  const info = prepareOfflineEnv({ env })
  assert.equal(env.BARBRO_OFFLINE, '1')
  assert.equal(info.offline, true)
})

test('cloud config is REMOVED, not merely ignored', () => {
  // The source-checkout case: a developer runs the offline build in a repo whose
  // .env is fully configured. Without this the app would present a Google
  // sign-in — the exact thing that cannot be completed in an app window.
  const env = {
    PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
    PUBLIC_SUPABASE_ANON_KEY: 'real-anon-key',
  }
  const info = prepareOfflineEnv({ env })
  for (const key of CLOUD_ENV_KEYS) {
    assert.equal(env[key], undefined, `${key} survived into the offline environment`)
    assert.ok(!(key in env), `${key} is still a key on the environment`)
  }
  assert.equal(info.cloudConfigured, false)
  assert.deepEqual(info.removed.sort(), [...CLOUD_ENV_KEYS].sort())
})

test('an already-clean environment is left alone', () => {
  const env = { SOMETHING_ELSE: 'kept' }
  const info = prepareOfflineEnv({ env })
  assert.equal(env.SOMETHING_ELSE, 'kept')
  assert.deepEqual(info.removed, [])
  assert.equal(info.cloudConfigured, false)
})

/**
 * STALENESS — the offline app is a COMPILED bundle.
 *
 * Edit `src/`, forget to rebuild, and the app serves yesterday's UI with nothing
 * to say so. That does not read as "you are running an old build"; it reads as
 * "the feature you just added is broken", and you go hunting for a bug that is
 * not there. It cost an afternoon.
 */
test('a bundle older than the source is stale', () => {
  const builtAt = '2026-08-01T13:58:00.000Z'
  const edited = Date.parse('2026-08-01T14:02:00.000Z')
  assert.equal(isBundleStale({ builtAt, newestSourceMtime: edited }), true)
})

test('a bundle newer than the source is not', () => {
  const builtAt = '2026-08-01T14:05:00.000Z'
  const edited = Date.parse('2026-08-01T14:02:00.000Z')
  assert.equal(isBundleStale({ builtAt, newestSourceMtime: edited }), false)
})

test('no stamp and no source both mean "cannot tell" — never a false alarm', () => {
  // A packaged app has no `src/` beside it and cannot drift, so warning there
  // would be noise that trains you to ignore the warning that matters.
  assert.equal(isBundleStale({ builtAt: null, newestSourceMtime: Date.now() }), false)
  assert.equal(isBundleStale({ builtAt: '2026-08-01T13:58:00.000Z', newestSourceMtime: 0 }), false)
  assert.equal(isBundleStale({ builtAt: 'not-a-date', newestSourceMtime: Date.now() }), false)
})

test('a stamp round-trips, and junk parses to null', () => {
  const stamp = { builtAt: '2026-08-01T14:05:00.000Z', version: '0.1.7', stagedBy: 'x' }
  assert.deepEqual(parseBuildStamp(JSON.stringify(stamp)), {
    builtAt: stamp.builtAt,
    version: '0.1.7',
  })
  assert.equal(parseBuildStamp('{ not json'), null)
  assert.equal(parseBuildStamp('{}'), null)
  assert.equal(parseBuildStamp(JSON.stringify({ builtAt: 'nope' })), null)
})

/**
 * THE SIDECAR MUST OUTLIVE ITS WINDOWS.
 *
 * Electron quits when the last window closes, by default. Now that this app has
 * windows, that default would mean: someone is working on barbro.app in their
 * browser, closes the little status window because it is in the way, and every
 * endpoint the website depends on disappears under them — reported as "BarBro
 * Desktop isn't running", with no clue why.
 *
 * Checked against the source because it is a one-line mistake with a silent,
 * remote symptom.
 */
test('closing a window does not quit the app', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8')

  const at = src.indexOf("app.on('window-all-closed'")
  assert.notEqual(at, -1, 'window-all-closed must be handled, or Electron quits by default')

  // The handler body: from the arrow to the closing `})` of the app.on call,
  // with COMMENTS STRIPPED. The comment in there says "Do not call app.quit()",
  // and a check that cannot tell prose from code would both fail on that and
  // miss a real call sitting after a comment on the same line.
  const raw = src.slice(at, src.indexOf('\n})', at))
  const body = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(
    !/app\.quit\s*\(|app\.exit\s*\(/.test(body),
    `window-all-closed must not quit the app, found:\n${raw}`,
  )
})

/**
 * DRIFT GUARD — the boundary must stay in step with the real dispatcher.
 *
 * `isSidecarRoute()` summarises which URLs `main.mjs` answers. That is a second
 * copy of knowledge whose original lives in the dispatcher, and the failure is
 * silent in both directions: add a sidecar route outside the summary and the
 * bundled app swallows it (returning HTML where JSON was expected); widen the
 * summary past what the sidecar serves and that part of the app 404s.
 *
 * So the summary is checked against the source rather than trusted.
 */
test('every route main.mjs answers is claimed by isSidecarRoute', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8')

  const routes = new Set()
  for (const m of src.matchAll(/req\.url(?:\?)?\s*===\s*'(\/[^']*)'/g)) routes.add(m[1])
  for (const m of src.matchAll(/req\.url(?:\?)?\.startsWith\('(\/[^']*)'\)/g)) routes.add(m[1])

  assert.ok(routes.size > 5, `expected to find the dispatcher's routes, found ${routes.size}`)

  const unclaimed = [...routes].filter((r) => !isSidecarRoute(r))
  assert.deepEqual(
    unclaimed,
    [],
    `main.mjs answers these, but isSidecarRoute() hands them to the app: ${unclaimed.join(', ')}`,
  )
})
