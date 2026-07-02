/**
 * Desktop update detection + one-click install.
 *
 * The sidecar is headless (no window), so ALL update UI lives in the web app.
 * Two tiers:
 *
 *  1. **Detection (pure web, works with ANY installed sidecar).** We already
 *     know the RUNNING version from `/ping` (`desktopCompanionStatus.version`);
 *     here we fetch the LATEST released version from the GitHub API (CORS-
 *     enabled) and compare. This works retroactively — a user on an old
 *     sidecar still gets nudged, no rebuild required.
 *  2. **One-click install (needs the newer sidecar).** `installDesktopUpdate`
 *     asks the sidecar to download the correct-arch DMG and open it. Old
 *     sidecars 404 that endpoint, so callers fall back to the `/download`
 *     page.
 *
 * The GitHub owner/repo is derived from the same-origin download manifest so
 * nothing is hard-coded to one fork.
 */
import { BARBRO_DESKTOP_BEACON_PORT } from './desktopBeacon'
import { compareSidecarVersion } from '$lib/desktop/minSidecarVersion'

const BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

type DownloadsManifest = {
  artifacts?: Record<string, { label?: string; url?: string }>
}

let manifestCache: DownloadsManifest | null = null

async function loadDownloadsManifest(): Promise<DownloadsManifest | null> {
  if (manifestCache) return manifestCache
  try {
    const res = await fetch('/desktop-downloads.json', { cache: 'no-store' })
    if (!res.ok) return null
    manifestCache = (await res.json()) as DownloadsManifest
    return manifestCache
  } catch {
    return null
  }
}

/** `owner/repo` parsed from a GitHub release asset URL in the manifest. */
function repoFromManifest(man: DownloadsManifest | null): string | null {
  const arts = man?.artifacts ?? {}
  for (const key of ['darwin-arm64', 'darwin-x64', 'win-x64']) {
    const url = arts[key]?.url ?? ''
    const m = url.match(/github\.com\/([^/]+\/[^/]+)\/releases/)
    if (m) return m[1]
  }
  return null
}

let latestCache: { version: string | null; at: number } = { version: null, at: 0 }
const LATEST_TTL_MS = 60 * 60 * 1000 // GitHub API is rate-limited (60/hr) — cache 1h.

/**
 * Latest released desktop version (from the `desktop-vX.Y.Z` release tag), or
 * null if it can't be determined. Cached for an hour.
 */
export async function fetchLatestDesktopVersion(): Promise<string | null> {
  if (latestCache.version && Date.now() - latestCache.at < LATEST_TTL_MS) {
    return latestCache.version
  }
  const man = await loadDownloadsManifest()
  const repo = repoFromManifest(man)
  if (!repo) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string }
    const tag = typeof data.tag_name === 'string' ? data.tag_name : ''
    const version = tag.replace(/^desktop-v/i, '').replace(/^v/i, '').trim()
    if (!/^\d+\.\d+\.\d+/.test(version)) return null
    latestCache = { version, at: Date.now() }
    return version
  } catch {
    return null
  }
}

/** True when `latest` is strictly newer than the running sidecar `running`. */
export function isDesktopUpdateAvailable(running: string | null, latest: string | null): boolean {
  if (!running || !latest) return false
  return compareSidecarVersion(latest, running) > 0
}

export type InstallUpdateResult =
  | { ok: true; opened: true }
  | { ok: false; unsupported?: true; error: string }

/**
 * Ask the sidecar to download the correct-arch DMG and open it (the user then
 * drags to Applications + relaunches). Returns `unsupported: true` when the
 * running sidecar is too old to have the endpoint — callers should fall back
 * to opening the `/download` page.
 */
export async function installDesktopUpdate(): Promise<InstallUpdateResult> {
  const man = await loadDownloadsManifest()
  const artifacts = man?.artifacts ?? {}
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/update/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifacts }),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: `Desktop unreachable: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (res.status === 404) return { ok: false, unsupported: true, error: 'Old sidecar' }
  let data: { ok?: boolean; error?: string }
  try {
    data = (await res.json()) as { ok?: boolean; error?: string }
  } catch {
    return { ok: false, error: `Unexpected response (HTTP ${res.status})` }
  }
  if (!res.ok || data.ok !== true) {
    return { ok: false, error: data.error ?? `Update failed (HTTP ${res.status})` }
  }
  return { ok: true, opened: true }
}
