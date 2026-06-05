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
 */
export const MIN_SIDECAR_VERSION = '0.1.6'

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
 */
export function classifySidecarVersion(reported: string | null): SidecarVersionStatus {
  if (!reported) return 'unknown'
  return compareSidecarVersion(reported, MIN_SIDECAR_VERSION) >= 0 ? 'ok' : 'outdated'
}
