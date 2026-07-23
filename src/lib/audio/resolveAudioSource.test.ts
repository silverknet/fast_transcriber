/**
 * The audio-fidelity failsafe: the local HD master must ALWAYS win when the
 * desktop client is connected, and the compressed cloud copy must be unreachable
 * in that state. These tests pin that invariant exhaustively.
 */
import { describe, expect, it } from 'vitest'
import {
  assertCloudAudioAccessAllowed,
  resolveAudioSource,
  type AudioSourceInput,
} from './resolveAudioSource'

const bools = [false, true]
/** All 8 input combinations. */
const allInputs: AudioSourceInput[] = bools.flatMap((sidecarReachable) =>
  bools.flatMap((localAudioAvailable) =>
    bools.map((cloudAudioAvailable) => ({
      sidecarReachable,
      localAudioAvailable,
      cloudAudioAvailable,
    })),
  ),
)

describe('resolveAudioSource', () => {
  it('THE FAILSAFE: never returns cloud while the sidecar is reachable', () => {
    for (const input of allInputs) {
      const r = resolveAudioSource(input)
      if (input.sidecarReachable) {
        expect(r.source).not.toBe('cloud')
        expect(r.mode).toBe('desktop')
      }
    }
  })

  it('desktop connected + local master present → local HD', () => {
    const r = resolveAudioSource({
      sidecarReachable: true,
      localAudioAvailable: true,
      cloudAudioAvailable: true, // present, but must be ignored
    })
    expect(r.source).toBe('local')
  })

  it('desktop connected + local missing → relink (missing), NOT cloud — even when a cloud copy exists', () => {
    const r = resolveAudioSource({
      sidecarReachable: true,
      localAudioAvailable: false,
      cloudAudioAvailable: true,
    })
    expect(r.source).toBe('missing')
    expect(r.source).not.toBe('cloud')
  })

  it('browser mode + cloud copy → cloud', () => {
    const r = resolveAudioSource({
      sidecarReachable: false,
      localAudioAvailable: false,
      cloudAudioAvailable: true,
    })
    expect(r.source).toBe('cloud')
    expect(r.mode).toBe('browser')
  })

  it('browser mode + no cloud copy → missing', () => {
    const r = resolveAudioSource({
      sidecarReachable: false,
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
  it('throws when the sidecar is reachable (cloud audio is forbidden on desktop)', () => {
    expect(() => assertCloudAudioAccessAllowed(true)).toThrow()
  })

  it('does not throw in browser mode', () => {
    expect(() => assertCloudAudioAccessAllowed(false)).not.toThrow()
  })
})
