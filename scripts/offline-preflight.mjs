/**
 * Offline pre-flight — everything that can be checked WITHOUT a venue.
 *
 * Run this before building the app for a show. It answers the questions whose
 * answers are expensive to discover at load-in: does the offline build exist,
 * does it serve with no network, does it serve FAST, does it let you in without
 * a sign-in, and is anything secret about to be shipped inside it.
 *
 * What it deliberately does NOT do is claim the show will work. A project still
 * has to load and play from local files, on your machine, with the Wi-Fi off —
 * that is the dress rehearsal, and nothing here substitutes for it.
 *
 * Usage: node scripts/offline-preflight.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { parseEnv, scanForSecrets, scannableSecrets } from './prepare-offline-bundle.mjs'

const root = resolve(import.meta.dirname, '..')
const buildDir = join(root, 'build-node')
const PORT = 5196

const results = []
function record(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** The offline build exists and looks complete. */
function checkBuildPresent() {
  const handler = join(buildDir, 'handler.js')
  const client = join(buildDir, 'client')
  const ok = existsSync(handler) && existsSync(client)
  record(ok, 'offline build present', ok ? buildDir : 'run `npm run offline:bundle`')
  return ok
}

/**
 * Nothing secret ships, and — the distinctive one for this build — no cloud
 * config ships either.
 *
 * Checked by VALUE against the repo's `.env`, so a renamed variable cannot slip
 * past. Values are never printed; only the key that leaked and the file.
 */
function checkNoSecrets() {
  const staleEnv = join(buildDir, '.env')
  record(
    !existsSync(staleEnv),
    'no env file inside the build',
    existsSync(staleEnv) ? 'a stale build-node/.env would restore the sign-in' : '',
  )

  const repoEnv = join(root, '.env')
  const source = existsSync(repoEnv) ? parseEnv(readFileSync(repoEnv, 'utf8')) : {}
  const scanned = scannableSecrets(source)
  if (scanned.length === 0) {
    // A green tick here would mean "we looked for zero things".
    record(false, 'leak scan meaningful', 'no .env in the repo — nothing to scan for')
    return false
  }
  const hits = scanForSecrets(buildDir, source)
  record(
    hits.length === 0,
    `no secrets or cloud config in the build (${scanned.length} checked)`,
    hits.map((h) => `${h.key} in ${h.file}`).join(', '),
  )
  return hits.length === 0
}

/** Start the offline server with a hostile environment and probe it. */
async function checkServesOffline() {
  const child = spawn(process.execPath, [join(root, 'desktop', 'offlineServer.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      // Deliberately hostile: an unroutable auth host AND a configured-looking
      // environment. The offline server must strip both and let us in anyway —
      // this is the source-checkout case, where a developer's shell is fully
      // configured and the packaged behaviour must still be what you get.
      PUBLIC_SUPABASE_URL: 'https://offline-preflight.invalid',
      PUBLIC_SUPABASE_ANON_KEY: 'preflight',
    },
    stdio: 'ignore',
  })

  try {
    await new Promise((r) => setTimeout(r, 4000))
    let served = 0
    let slowest = 0
    const statuses = []
    const ROUTES = ['/', '/rig', '/edit', '/project', '/project/playback']
    // NO COOKIE is sent. That is the point: this build has no session, and a
    // first-time launch at a venue must land in the app.
    //
    // Redirects are FOLLOWED rather than rejected — `/` legitimately sends you
    // to `/project`. What must never happen is landing on a sign-in page, so
    // that is what is checked, not the status code of the first hop.
    for (const route of ROUTES) {
      const started = Date.now()
      let status = 0
      let landed = route
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
          signal: AbortSignal.timeout(20_000),
        })
        status = res.status
        landed = new URL(res.url).pathname
      } catch {
        status = 0
      }
      const took = Date.now() - started
      slowest = Math.max(slowest, took)
      const bounced = /^\/(welcome|login|pending)$/.test(landed)
      statuses.push(`${route}→${landed}:${status}`)
      if (status === 200 && !bounced) served++
    }
    record(
      served === ROUTES.length,
      'every route loads with NO sign-in',
      served === ROUTES.length ? '' : statuses.join(' '),
    )
    // The number that decides whether this is usable on stage. Unbounded, an
    // offline load once took 25 s.
    record(slowest < 5000, 'answers quickly offline', `slowest ${(slowest / 1000).toFixed(1)}s`)

    // A cloud call must fail with a sentence, immediately — not hang on DNS and
    // not 500 on a null client.
    let cloudStatus = 0
    let cloudBody = ''
    const cloudStarted = Date.now()
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/cloud/projects`, {
        signal: AbortSignal.timeout(10_000),
      })
      cloudStatus = res.status
      cloudBody = await res.text()
    } catch {
      cloudStatus = 0
    }
    const cloudTook = Date.now() - cloudStarted
    record(
      cloudStatus === 503 && cloudTook < 2000,
      'cloud calls fail fast and explain themselves',
      `${cloudStatus} in ${cloudTook}ms${cloudBody ? ` · ${cloudBody.slice(0, 60)}` : ''}`,
    )

    return served === 4 && slowest < 5000 && cloudStatus === 503
  } finally {
    child.kill()
  }
}

async function main() {
  console.log('Offline pre-flight\n')
  const built = checkBuildPresent()
  if (!built) {
    console.log('\nStopping: there is nothing to check until the build exists.')
    process.exit(1)
  }
  checkNoSecrets()
  await checkServesOffline()

  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (failed.length === 0) {
    console.log('All automated checks passed.')
    console.log('')
    console.log('STILL REQUIRED — none of the above proves a show will work:')
    console.log('  1. In the browser, open the project and run "Prepare for offline".')
    console.log('  2. Clear every blocker it lists.')
    console.log('  3. Turn Wi-Fi OFF, open the desktop app, and play a song end to end.')
  } else {
    console.log(`${failed.length} check(s) failed: ${failed.map((f) => f.name).join(', ')}`)
    process.exitCode = 1
  }
}

main()
