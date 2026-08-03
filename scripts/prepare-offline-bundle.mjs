/**
 * Stage the offline build for packaging.
 *
 * The desktop app serves the web app itself so it works with no internet, which
 * means the `adapter-node` bundle has to be inside the shipped `.app`.
 *
 * ## What this script is FOR
 *
 * The offline build has no login because it has no cloud, and that is a
 * capability guarantee rather than a policy: with no `PUBLIC_SUPABASE_URL` and
 * no anon key there is no client to construct, so nothing can present a sign-in
 * that cannot be completed inside an app window.
 *
 * A guarantee stated in prose is worth very little, so this script CHECKS it,
 * and does the two things that could quietly break it:
 *
 *  1. **Deletes any staged `build-node/.env`.** Earlier builds wrote one
 *     containing `PUBLIC_SUPABASE_*`. Left behind, it is loaded at runtime and
 *     the sign-in screen comes back — with no code change and no warning.
 *  2. **Scans the built output for real secret VALUES**, read from the repo's
 *     `.env`. By value, not by key name, so a renamed variable cannot slip past.
 *
 * The dangerous one is `SUPABASE_SERVICE_ROLE_KEY`: it bypasses row-level
 * security entirely, and a `.dmg` handed to a bandmate is trivially unpacked.
 *
 * Usage: node scripts/prepare-offline-bundle.mjs
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const buildDir = join(root, 'build-node')

/**
 * Keys whose VALUES must never appear anywhere inside the shipped build.
 *
 * The `PUBLIC_SUPABASE_*` pair is on this list even though both are public on
 * the hosted site. Here they are not a secret being protected; they are a
 * capability being withheld.
 */
export const FORBIDDEN_VALUE_PATTERNS = [
  /SERVICE_ROLE/i,
  /DATABASE_URL/i,
  /SECRET/i,
  /PRIVATE_KEY/i,
  /^ADMIN_/i,
  /PASSWORD/i,
  /_TOKEN$/i,
  /^PUBLIC_SUPABASE_/i,
]

/** Short values produce false positives ("1", "true"), so they are not scanned. */
export const MIN_SCANNED_VALUE_LENGTH = 12

export function isForbiddenEnvKey(key) {
  return FORBIDDEN_VALUE_PATTERNS.some((re) => re.test(key))
}

/** Parse a `.env` into a plain object. Deliberately small — no dependency. */
export function parseEnv(text) {
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** The (key, value) pairs worth scanning a build for. */
export function scannableSecrets(sourceEnv) {
  return Object.entries(sourceEnv).filter(
    ([key, value]) =>
      isForbiddenEnvKey(key) && typeof value === 'string' && value.length >= MIN_SCANNED_VALUE_LENGTH,
  )
}

/**
 * Client-build paths that must never travel inside the desktop app.
 *
 * SvelteKit copies `static/` verbatim into every client build. `static/releases`
 * holds the PREVIOUS desktop DMG so the website can offer it for download — so
 * without this the app ships a 109 MB copy of an older version of itself, and
 * the offline DMG comes out at 241 MB instead of ~130 MB.
 *
 * Nothing offline needs them: the download page is a website concern, and a
 * laptop at a venue is not installing anything. Sample assets under
 * `static/bass` and `static/drums` ARE needed and are deliberately not listed.
 */
export const UNSHIPPABLE_CLIENT_PATHS = ['releases']

function dirSize(dir) {
  let total = 0
  for (const file of walk(dir)) {
    try {
      total += statSync(file).size
    } catch {
      /* vanished mid-walk — not worth failing a build over */
    }
  }
  return total
}

/**
 * Remove the website-only payload from a staged client build.
 *
 * Returns what went and how many bytes, so the build log can say so rather than
 * silently shrinking the artifact.
 */
export function pruneUnshippableAssets(buildDir) {
  const removed = []
  for (const rel of UNSHIPPABLE_CLIENT_PATHS) {
    const target = join(buildDir, 'client', rel)
    if (!existsSync(target)) continue
    const bytes = dirSize(target)
    rmSync(target, { recursive: true, force: true })
    removed.push({ path: `client/${rel}`, bytes })
  }
  return removed
}

/** Every file under `dir`, recursively. */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else yield p
  }
}

/**
 * Find any forbidden value inside `dir`.
 *
 * Returns `[{ key, file }]` — the key so the message names what leaked, the
 * file so it can be found. The VALUE is never printed: this output ends up in
 * a build log.
 */
export function scanForSecrets(dir, sourceEnv) {
  const secrets = scannableSecrets(sourceEnv)
  if (secrets.length === 0) return []
  const hits = []
  for (const file of walk(dir)) {
    let text
    try {
      text = readFileSync(file, 'latin1') // byte-preserving; never throws on binary
    } catch {
      continue
    }
    for (const [key, value] of secrets) {
      if (text.includes(value)) hits.push({ key, file: relative(dir, file) })
    }
  }
  return hits
}

/**
 * The stamp that makes staleness detectable.
 *
 * The offline app is a COMPILED bundle. Edit `src/`, forget to rebuild, and the
 * app happily serves yesterday's UI with nothing to say so — which reads as
 * "the feature you just added does not work" rather than "you are running an old
 * build". That cost an afternoon.
 *
 * Two things are recorded, and both are load-bearing:
 *  - `builtAt`, so the app can compare itself against `src/` and say when it has
 *    fallen behind.
 *  - the fact that this script RAN AT ALL. A bundle produced by a bare
 *    `vite build` has no stamp, which also means the leak scan and the
 *    `client/releases` prune never happened. Absence is the signal.
 */
export const BUILD_STAMP_FILENAME = '.barbro-build.json'

export function buildStamp(now, version) {
  return {
    builtAt: now.toISOString(),
    version,
    stagedBy: 'prepare-offline-bundle',
  }
}

export function parseBuildStamp(raw) {
  try {
    const o = JSON.parse(raw)
    if (typeof o?.builtAt !== 'string' || !Number.isFinite(Date.parse(o.builtAt))) return null
    return { builtAt: o.builtAt, version: typeof o.version === 'string' ? o.version : null }
  } catch {
    return null
  }
}

function main() {
  if (!existsSync(join(buildDir, 'handler.js'))) {
    console.error('No offline build found. Run `npm run build:offline` first.')
    process.exit(1)
  }

  // A leftover from the previous design. Loaded at runtime, it restores a
  // working cloud client — and with it a sign-in screen at a venue.
  const staleEnv = join(buildDir, '.env')
  if (existsSync(staleEnv)) {
    rmSync(staleEnv)
    console.log('Removed a stale build-node/.env (the offline build ships no cloud config).')
  }

  // Before the leak scan, so it does not spend time reading a 109 MB disk image.
  for (const r of pruneUnshippableAssets(buildDir)) {
    console.log(`Removed ${r.path} from the bundle (${(r.bytes / 1e6).toFixed(0)} MB — website-only).`)
  }

  const repoEnv = join(root, '.env')
  const source = existsSync(repoEnv) ? parseEnv(readFileSync(repoEnv, 'utf8')) : {}
  const hits = scanForSecrets(buildDir, source)

  if (hits.length > 0) {
    console.error('REFUSING TO STAGE — these would ship inside the app:')
    for (const h of hits) console.error(`  ${h.key} appears in ${h.file}`)
    process.exit(1)
  }

  // Written LAST, so a stamp can only exist on a bundle that got all the way
  // through the prune and the leak scan.
  const pkgPath = join(root, 'desktop', 'package.json')
  const version = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? null)
    : null
  const stamp = buildStamp(new Date(), version)
  writeFileSync(join(buildDir, BUILD_STAMP_FILENAME), JSON.stringify(stamp, null, 2), 'utf8')

  const scanned = scannableSecrets(source).map(([k]) => k)
  console.log(`Offline bundle staged at ${buildDir}`)
  console.log(`  stamped ${stamp.builtAt}${version ? ` (v${version})` : ''}`)
  console.log(`  ships no env file; ${scanned.length} sensitive value(s) checked for and absent`)
  if (scanned.length === 0) {
    // Not a failure — a checkout with no `.env` has nothing to leak. But the
    // scan proved nothing either, and saying so beats a green tick that means
    // "we looked for zero things".
    console.warn('  NOTE: no .env in the repo, so the leak scan had nothing to look for.')
  }
}

if (process.argv[1] && process.argv[1].endsWith('prepare-offline-bundle.mjs')) main()
