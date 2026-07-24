/**
 * The audio-fidelity failsafe. Corrected invariant:
 *
 *  - For a LOCAL DISK project (`localProjectPresent`), the local HD master must
 *    ALWAYS win while the desktop client is connected, and the compressed cloud
 *    copy must be unreachable — a missing local file means RELINK, never a silent
 *    downgrade.
 *  - For a BROWSER-CLOUD song (no local folder), there is no local master to
 *    protect, so the cloud copy is its legitimate source EVEN WHILE the sidecar
 *    happens to be running. (The bug this pins: with the sidecar on, a
 *    browser-cloud song used to resolve to `missing` → no audio → the editor's
 *    "No analyzed clip in session".)
 */
import { describe, expect, it } from 'vitest'
import {
  assertCloudAudioAccessAllowed,
  resolveAudioSource,
  type AudioSourceInput,
} from './resolveAudioSource'

const bools = [false, true]
/** All 16 input combinations. */
const allInputs: AudioSourceInput[] = bools.flatMap((sidecarReachable) =>
  bools.flatMap((localProjectPresent) =>
    bools.flatMap((localAudioAvailable) =>
      bools.map((cloudAudioAvailable) => ({
        sidecarReachable,
        localProjectPresent,
        localAudioAvailable,
        cloudAudioAvailable,
      })),
    ),
  ),
)

describe('resolveAudioSource', () => {
  it('THE FAILSAFE: never returns cloud for a DISK project while the sidecar is reachable', () => {
    for (const input of allInputs) {
      const r = resolveAudioSource(input)
      if (input.sidecarReachable && input.localProjectPresent) {
        expect(r.source).not.toBe('cloud')
        expect(r.mode).toBe('desktop')
      }
    }
  })

  it('THE FIX: a browser-cloud song streams cloud EVEN when the sidecar is reachable', () => {
    // This exact combination (sidecar on, no local folder, cloud audio present)
    // is what left bröllops with no audio. It must resolve to cloud.
    const r = resolveAudioSource({
      sidecarReachable: true,
      localProjectPresent: false,
      localAudioAvailable: false,
      cloudAudioAvailable: true,
    })
    expect(r.source).toBe('cloud')
  })

  it('desktop + disk project + local master present → local HD', () => {
    const r = resolveAudioSource({
      sidecarReachable: true,
      localProjectPresent: true,
      localAudioAvailable: true,
      cloudAudioAvailable: true, // present, but must be ignored
    })
    expect(r.source).toBe('local')
  })

  it('desktop + disk project + local missing → relink (missing), NOT cloud — even when a cloud copy exists', () => {
    const r = resolveAudioSource({
      sidecarReachable: true,
      localProjectPresent: true,
      localAudioAvailable: false,
      cloudAudioAvailable: true,
    })
    expect(r.source).toBe('missing')
    expect(r.source).not.toBe('cloud')
  })

  it('browser mode (no sidecar) + cloud copy → cloud', () => {
    const r = resolveAudioSource({
      sidecarReachable: false,
      localProjectPresent: false,
      localAudioAvailable: false,
      cloudAudioAvailable: true,
    })
    expect(r.source).toBe('cloud')
    expect(r.mode).toBe('browser')
  })

  it('browser-cloud + no cloud copy → missing', () => {
    const r = resolveAudioSource({
      sidecarReachable: true,
      localProjectPresent: false,
      localAudioAvailable: false,
      cloudAudioAvailable: false,
    })
    expect(r.source).toBe('missing')
  })

  it('every resolution carries a reason', () => {
    for (const input of allInputs) {
      expect(resolveAudioSource(input).reason.length).toBeGreaterThan(0)
    }
  })
})

describe('assertCloudAudioAccessAllowed', () => {
  it('throws for a DISK project while the sidecar is reachable (cloud forbidden on desktop)', () => {
    expect(() => assertCloudAudioAccessAllowed(true, true)).toThrow()
  })

  it('does NOT throw for a browser-cloud song even with the sidecar reachable', () => {
    expect(() => assertCloudAudioAccessAllowed(true, false)).not.toThrow()
  })

  it('does not throw in browser mode (no sidecar)', () => {
    expect(() => assertCloudAudioAccessAllowed(false, false)).not.toThrow()
    expect(() => assertCloudAudioAccessAllowed(false, true)).not.toThrow()
  })
})
