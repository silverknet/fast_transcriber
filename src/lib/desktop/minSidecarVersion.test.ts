/**
 * The sidecar version gate.
 *
 * `MIN_SIDECAR_VERSION` is deliberately bumped AHEAD of cutting a desktop
 * release, so `desktop/package.json` normally sits behind it. That is fine for
 * the website — it is how users get told to update — and it was catastrophic for
 * the offline app, which is SERVED BY the sidecar and therefore declared its own
 * process outdated and redirected to `/download`. At a venue. With no internet.
 * Mid-set.
 *
 * EVERY test here passes `dev: false`. Under vitest `import.meta.env.DEV` is
 * true, which short-circuits to 'ok' and makes the whole file pass no matter
 * what the code does — including the assertions meant to prove the bypass
 * works. Without that argument these tests are decoration.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_SIDECAR_VERSION,
  classifySidecarVersion,
  compareSidecarVersion,
} from './minSidecarVersion'

describe('the offline app never fails its own version check', () => {
  it('is ok even when the reported version is far below the minimum', () => {
    // The exact numbers that caused it: sidecar 0.1.7, minimum 0.1.14.
    expect(classifySidecarVersion('0.1.7', { servedBySidecar: true, dev: false })).toBe('ok')
  })

  it('is ok even with no version reported at all', () => {
    expect(classifySidecarVersion(null, { servedBySidecar: true, dev: false })).toBe('ok')
  })

  it('and the same input WITHOUT the bypass is outdated — so the bypass is what did it', () => {
    // The control. Without this pair, the test above would pass even if
    // `servedBySidecar` were ignored entirely.
    expect(classifySidecarVersion('0.1.7', { servedBySidecar: false, dev: false })).toBe('outdated')
  })

  it('the real repo values would otherwise fail — this is not a hypothetical', () => {
    // Guards against someone "tidying up" the bypass because the numbers look
    // fine today. If desktop/package.json ever catches up, this still holds.
    expect(compareSidecarVersion('0.1.7', MIN_SIDECAR_VERSION)).toBeLessThan(0)
  })
})

describe('the website keeps its gate', () => {
  it('an old sidecar is still outdated for a browser', () => {
    expect(classifySidecarVersion('0.1.7', { dev: false })).toBe('outdated')
  })

  it('a current sidecar is ok', () => {
    expect(classifySidecarVersion(MIN_SIDECAR_VERSION, { dev: false })).toBe('ok')
    expect(classifySidecarVersion('9.9.9', { dev: false })).toBe('ok')
  })

  it('an unreported version is unknown, not outdated', () => {
    // Don't force-redirect on guesswork; `reachable` already covers "no sidecar".
    expect(classifySidecarVersion(null, { dev: false })).toBe('unknown')
  })

  it('dev mode still bypasses, for the local sidecar that always lags', () => {
    expect(classifySidecarVersion('0.0.1', { dev: true })).toBe('ok')
  })
})

describe('version comparison', () => {
  it('compares numerically, not lexically', () => {
    // '0.1.7' > '0.1.14' as strings. This is the whole bug in one line.
    expect(compareSidecarVersion('0.1.7', '0.1.14')).toBeLessThan(0)
    expect(compareSidecarVersion('0.1.14', '0.1.7')).toBeGreaterThan(0)
    expect(compareSidecarVersion('0.2.0', '0.1.99')).toBeGreaterThan(0)
    expect(compareSidecarVersion('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('treats equal versions as equal', () => {
    expect(compareSidecarVersion('0.1.14', '0.1.14')).toBe(0)
  })

  it('tolerates junk without throwing', () => {
    expect(() => compareSidecarVersion('', 'x.y.z')).not.toThrow()
  })
})
