/**
 * Minimum sidecar version the web app expects.
 *
 * Bump this value when the web app starts depending on a feature
 * shipped in a newer sidecar release. The version BarBro Desktop
 * reports via `/ping` must be >= this — if it's lower, the layout
 * polling flags `versionStatus: 'outdated'` and redirects the user
 * to `/download` to install the newer build.
 *
 * Release ordering matters:
 *   1. Push the `desktop-v<X.Y.Z>` git tag FIRST. Wait for the
 *      release workflow to finish and confirm the DMGs are attached
 *      to that GitHub release.
 *   2. Then bump this constant to `<X.Y.Z>` and deploy the web app.
 *
 * If you bump this before the new release publishes successfully,
 * every existing user gets redirected to `/download` and the
 * download URL 404s because the release with assets doesn't exist
 * yet — bad day for everyone.
 *
 * Format must match `desktop/package.json#version` (semver
 * `<major>.<minor>.<patch>`).
 *
 * ── MANDATORY bump for SongMap / sidecar feature releases ──
 * If the web app writes a newer `.smap` format or calls a newer sidecar
 * endpoint, bump this to the matching desktop release.
 */
export const MIN_SIDECAR_VERSION = '0.1.14'

export type SidecarVersionStatus = 'ok' | 'outdated' | 'unknown'

function parse(v: string): [number, number, number] {
  const parts = v.split('.').map((p) => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** Negative if a < b, zero if equal, positive if a > b. */
export function compareSidecarVersion(a: string, b: string): number {
  const [a1, a2, a3] = parse(a)
  const [b1, b2, b3] = parse(b)
  if (a1 !== b1) return a1 - b1
  if (a2 !== b2) return a2 - b2
  return a3 - b3
}

/**
 * `null` reported version → `'unknown'` (the sidecar didn't tell us
 * what it is; don't force-redirect on guesswork — the broader
 * `reachable` check already covers "no sidecar at all"). A parseable
 * version below `MIN_SIDECAR_VERSION` → `'outdated'`; otherwise `'ok'`.
 *
 * Dev mode bypass: when running `npm run dev`, the local sidecar's
 * `desktop/package.json#version` lags the deployed `MIN_SIDECAR_VERSION`
 * routinely (we bump the web constant ahead of cutting the desktop
 * release). Force-redirecting to `/download` mid-development is just
 * noise — the dev sidecar is the right one to talk to. Production
 * gating is untouched.
 */
export function classifySidecarVersion(
  reported: string | null,
  // `dev` is injectable ONLY so this is testable. Under vitest
  // `import.meta.env.DEV` is true, which returns 'ok' for everything and makes
  // every assertion here pass for the wrong reason — including the ones meant to
  // prove the `servedBySidecar` bypass works.
  opts: { servedBySidecar?: boolean; dev?: boolean } = {},
): SidecarVersionStatus {
  // The offline app is SERVED BY the sidecar: same process, same build, shipped
  // in one artifact. They cannot be mismatched, so asking whether the sidecar is
  // new enough for the app is a question with no meaning.
  //
  // Answering it anyway is not harmless. `desktop/package.json` sits at 0.1.7
  // while this constant is 0.1.14 (the constant is deliberately bumped ahead of
  // cutting a desktop release), so the offline app declared its own sidecar
  // outdated and redirected to `/download` — at a venue, with no internet, in
  // the middle of a set.
  if (opts.servedBySidecar) return 'ok'
  if (opts.dev ?? import.meta.env.DEV) return 'ok'
  if (!reported) return 'unknown'
  return compareSidecarVersion(reported, MIN_SIDECAR_VERSION) >= 0 ? 'ok' : 'outdated'
}
