/**
 * OFFLINE UI — serve the BarBro web app from the desktop app itself.
 *
 * Normally the UI comes from the deployed site and this process is a headless
 * sidecar. At a venue there is frequently no usable network, so for the offline
 * build the SvelteKit server (an `adapter-node` bundle) is mounted on the
 * loopback server this process already runs, and a window is opened onto it.
 *
 * ## Why the same port, rather than a second one
 *
 * The app and the sidecar then share ONE origin. That is not a tidiness point:
 * the hardware endpoints check `Origin` before they will touch the XR18, and
 * Safari blocks a public HTTPS page from reaching loopback as mixed content at
 * all. Same-origin sidesteps both, and the sidecar's CORS/PNA headers stop
 * mattering because nothing is cross-origin any more.
 *
 * ## Why this build has no login
 *
 * Google refuses OAuth inside an app window, so a desktop client can never sign
 * in — which makes any cloud-backed session a dead end here rather than a
 * feature. So the offline build does not have a cloud at all: `prepareOfflineEnv`
 * DELETES `PUBLIC_SUPABASE_*` from the environment, and without a URL and an anon
 * key there is no client to construct, on the server or in the browser.
 *
 * That is deliberately a capability guarantee rather than a permission check. It
 * holds identically in a packaged app (which ships no env file) and in a source
 * checkout (whose `.env` is no longer read here) — one behaviour, not two.
 *
 * ## About importing the build output
 *
 * The repo rule is no imports between `src/` and `desktop/` in either
 * direction, and this respects it: nothing here imports app SOURCE. It loads a
 * BUILD ARTIFACT at runtime, by path, and does nothing if that artifact is
 * absent — which is exactly how the normal headless sidecar keeps behaving.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** The env flag `hooks.server.ts` reads. Set here and nowhere else. */
export const OFFLINE_ENV_FLAG = 'BARBRO_OFFLINE'

/**
 * The LAUNCHER's request to serve the app, as opposed to {@link OFFLINE_ENV_FLAG}
 * which is what the SvelteKit server reads once we have decided.
 *
 * Two names on purpose. `prepareOfflineEnv()` SETS `BARBRO_OFFLINE`, so if the
 * decision were read from the same variable it would answer "yes" for the rest
 * of the process no matter what was asked — a trap that only shows up when
 * someone later moves the call. Separate names make it impossible.
 */
export const OFFLINE_UI_REQUEST_FLAG = 'BARBRO_OFFLINE_UI'

/**
 * Should the offline app open BY ITSELF at launch?
 *
 * **No, by default, always.** BarBro Desktop is a sidecar — the thing people
 * download from barbro.app to sit behind the website — and it starts as one
 * every time. Offline mode is a MODE you switch into from the status window,
 * not something the app decides for you.
 *
 * That is deliberately a much smaller question than it used to be. This once
 * answered "am I the offline app?" by checking whether a `build-node/handler.js`
 * existed on disk, which is not a decision at all — it is an accident of the
 * working tree. Building the offline bundle once, for a gig, silently turned
 * every later `npm run dev --prefix desktop` into a windowed app. Nothing
 * announced it and there was no way to say otherwise.
 *
 * The only reason to auto-open now is convenience while developing offline
 * mode, hence one explicit env flag and no inference of any kind.
 */
export function shouldAutoOpenOfflineUi({ env = process.env } = {}) {
  return env[OFFLINE_UI_REQUEST_FLAG] === '1'
}

/**
 * Is an offline app bundled with this build at all?
 *
 * Decides whether the status window's toggle is available or explains its own
 * absence — a disabled button with a reason beats a button that does nothing.
 */
export function hasOfflineUiBundle(env = process.env) {
  return resolveOfflineBuildDir(env) !== null
}

// ── Staleness: the offline app is a COMPILED bundle ────────────────────────
//
// Edit `src/`, forget to rebuild, and the app serves yesterday's UI with nothing
// to say so. That does not read as "you are running an old build" — it reads as
// "the feature you just added is broken", and you go looking for a bug that
// isn't there. It cost an afternoon before this existed.
//
// So the bundle carries a stamp (written by `scripts/prepare-offline-bundle.mjs`)
// and the app compares it against the source it was built from.

export const BUILD_STAMP_FILENAME = '.barbro-build.json'

export function parseBuildStamp(raw) {
  try {
    const o = JSON.parse(raw)
    if (typeof o?.builtAt !== 'string' || !Number.isFinite(Date.parse(o.builtAt))) return null
    return { builtAt: o.builtAt, version: typeof o.version === 'string' ? o.version : null }
  } catch {
    return null
  }
}

/** The stamp on the bundle we would actually serve, or null if it has none. */
export function readOfflineBuildStamp(env = process.env) {
  const dir = resolveOfflineBuildDir(env)
  if (!dir) return null
  const p = join(dir, BUILD_STAMP_FILENAME)
  if (!existsSync(p)) return null
  return parseBuildStamp(readFileSync(p, 'utf8'))
}

/** Files that do not change what the app renders, so must not trigger a warning. */
const IGNORED_SOURCE_DIRS = new Set(['node_modules', '.svelte-kit', '.git', 'build-node'])

/**
 * The newest mtime under `dir`, or 0 if it cannot be read.
 *
 * Walks rather than stats the directory itself: a directory's mtime only moves
 * when entries are added or removed, so editing a file in place would not show.
 */
export function newestMtime(dir, depth = 0) {
  if (depth > 12 || !existsSync(dir)) return 0
  let newest = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORED_SOURCE_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    try {
      newest = Math.max(newest, e.isDirectory() ? newestMtime(p, depth + 1) : statSync(p).mtimeMs)
    } catch {
      /* vanished mid-walk */
    }
  }
  return newest
}

/**
 * Has `src/` moved on since the bundle was staged?
 *
 * Only meaningful in a SOURCE CHECKOUT. A packaged app has no `src/` beside it,
 * and its bundle was copied in at package time, so the two cannot drift.
 *
 * Exported with explicit arguments so the rule is testable without a repo.
 */
export function isBundleStale({ builtAt, newestSourceMtime }) {
  if (!builtAt) return false
  const stamped = Date.parse(builtAt)
  if (!Number.isFinite(stamped) || !newestSourceMtime) return false
  return newestSourceMtime > stamped
}

/** The whole staleness picture, for the status window. */
export function offlineBuildState(env = process.env) {
  const dir = resolveOfflineBuildDir(env)
  if (!dir) return { available: false, builtAt: null, unstamped: false, stale: false }
  const stamp = readOfflineBuildStamp(env)
  const srcDir = resolve(here, '..', '..', 'src')
  const newestSourceMtime = existsSync(srcDir) ? newestMtime(srcDir) : 0
  return {
    available: true,
    builtAt: stamp?.builtAt ?? null,
    // No stamp means the staging script never ran — so neither did the leak scan
    // nor the `client/releases` prune. Worth saying out loud.
    unstamped: stamp === null,
    stale: isBundleStale({ builtAt: stamp?.builtAt ?? null, newestSourceMtime }),
  }
}

/**
 * Env keys that must not exist in the offline build's environment.
 *
 * Not "should not be used" — must not EXIST. `$env/dynamic/public` reads
 * `process.env` at request time and hands the values to the browser, so leaving
 * these set in a source-checkout run would quietly restore a working cloud
 * client and, with it, a login screen at a venue.
 */
export const CLOUD_ENV_KEYS = ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY']

/**
 * Where the `adapter-node` build lives.
 *
 * Packaged, it is copied next to the app's resources; in development it is the
 * repo's `build-node/`. `BARBRO_OFFLINE_BUILD_DIR` overrides both.
 */
export function resolveOfflineBuildDir(env = process.env) {
  if (env.BARBRO_OFFLINE_BUILD_DIR) return env.BARBRO_OFFLINE_BUILD_DIR
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'build-node') : null,
    resolve(here, '..', '..', 'build-node'), // repo root, running from source
    resolve(here, '..', 'build-node'),
  ].filter(Boolean)
  return candidates.find((p) => existsSync(join(p, 'handler.js'))) ?? null
}

/**
 * Load the SvelteKit request handler, or null when this build has no UI bundled
 * (the ordinary headless sidecar).
 */
export async function loadOfflineUiHandler(opts = {}) {
  const dir = opts.buildDir ?? resolveOfflineBuildDir()
  if (!dir) return null
  const handlerPath = join(dir, 'handler.js')
  if (!existsSync(handlerPath)) return null
  try {
    const mod = await import(pathToFileURL(handlerPath).href)
    return mod.handler ?? null
  } catch (err) {
    console.warn('[offline] could not load the bundled UI:', err?.message ?? err)
    return null
  }
}

/**
 * Put the environment into its offline shape, and report what it looks like.
 *
 * Two jobs, and the second is the load-bearing one:
 *  1. Set `BARBRO_OFFLINE=1` so `hooks.server.ts` serves a local user.
 *  2. REMOVE every cloud key, so there is nothing to sign into even if the
 *     process inherited a fully-configured shell.
 *
 * Returns what it did, so the caller can log it and a test can assert it.
 */
export function prepareOfflineEnv({ env = process.env } = {}) {
  env[OFFLINE_ENV_FLAG] = '1'
  const removed = []
  for (const key of CLOUD_ENV_KEYS) {
    if (env[key] !== undefined) {
      delete env[key]
      removed.push(key)
    }
  }
  return {
    offline: env[OFFLINE_ENV_FLAG] === '1',
    removed,
    // Must be false. If this is ever true the build can sign in, which means it
    // can also be signed OUT at a venue.
    cloudConfigured: CLOUD_ENV_KEYS.some((k) => Boolean(env[k])),
  }
}

/**
 * True when this request belongs to the sidecar's own API rather than the UI.
 *
 * The sidecar's routes win; everything else falls through to SvelteKit. Kept as
 * a named predicate so the boundary is one obvious thing rather than a
 * condition buried in the dispatcher.
 */
export function isSidecarRoute(urlPath) {
  // Exactly what the dispatcher above answers today: the liveness ping and the
  // whole `/native` tree. Everything else is the app's. Kept narrow on purpose —
  // claiming a prefix the sidecar does not serve would make that part of the UI
  // unreachable, and it would look like a routing bug in SvelteKit.
  const path = urlPath.split('?')[0]
  return path === '/ping' || path.startsWith('/native/')
}
