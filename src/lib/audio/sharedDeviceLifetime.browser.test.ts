/**
 * NOTHING MAY CLOSE THE SHARED AUDIO DEVICE.
 *
 * `audioDevice()` hands out one process-wide `AudioContext`. Every surface —
 * the mixer, the editor transport, the machines, the rig test tone — runs on it,
 * because one clock is what keeps them sample-accurate against each other.
 *
 * Closing it is uniquely catastrophic, and uniquely INVISIBLE. A closed
 * AudioContext accepts `createGain`, `connect`, `start` and every automation
 * call without throwing; `currentTime` freezes at 0; `resume()` rejects with an
 * error that was being swallowed. So the app looked fine and made no sound.
 *
 * The real bug: `MixerEngine.dispose()` closed it. Open a project (MixerView
 * mounts an engine), navigate away, and every sound in the app was dead until
 * reload — including the rig test tone at a venue. The class doc had promised
 * "the engine never closes it" the whole time.
 *
 * These tests exist so that promise is enforced rather than written down.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'
import { __setAudioDeviceForTest, audioDevice, resumeAudioDevice } from './audioDevice'

let restore: (() => void) | null = null
const spawned: AudioContext[] = []

/** Install a real context as the shared device, and hand it back. */
function installSharedDevice(): AudioContext {
  const ctx = new AudioContext()
  spawned.push(ctx)
  restore = __setAudioDeviceForTest(ctx)
  return ctx
}

afterEach(async () => {
  restore?.()
  restore = null
  while (spawned.length) {
    const ctx = spawned.pop()!
    if (ctx.state !== 'closed') await ctx.close().catch(() => {})
  }
})

describe('MixerEngine', () => {
  it('does NOT close the shared device on dispose', async () => {
    // The exact regression. Before the fix this returned 'closed' and every
    // other surface in the app went silent with no error raised anywhere.
    const shared = installSharedDevice()
    const engine = new MixerEngine()
    expect(engine.ac).toBe(shared)
    await engine.dispose()
    expect(shared.state).not.toBe('closed')
  })

  it('still closes a context it was GIVEN, because that one is its own', async () => {
    // Offline renders and tests inject a context and expect it cleaned up.
    const own = new AudioContext()
    const engine = new MixerEngine(own)
    await engine.dispose()
    expect(own.state).toBe('closed')
  })

  it('leaves the shared device usable for the NEXT surface', async () => {
    // The symptom as the user met it: play something, leave, then try the rig
    // tone. What matters is not the state flag but that audio still flows.
    const shared = installSharedDevice()
    await new MixerEngine().dispose()

    const osc = shared.createOscillator()
    const gain = shared.createGain()
    const analyser = shared.createAnalyser()
    osc.connect(gain)
    gain.connect(analyser)
    gain.connect(shared.destination)
    osc.start()
    await resumeAudioDevice()

    // A closed context freezes currentTime at 0 forever; a live one advances.
    // POLLED rather than measured after a fixed sleep: a real hardware context
    // shares the machine with whatever else the suite is doing, and a fixed
    // 120 ms window turned this into an intermittent failure — a flaky guard on
    // a bug this severe is worse than none.
    const before = shared.currentTime
    const deadline = performance.now() + 2000
    while (shared.currentTime <= before && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    osc.stop()
    expect(shared.state).not.toBe('closed')
    expect(shared.currentTime).toBeGreaterThan(before)
  })
})

// PlaybackController has the same rule, guarded in `playbackController.test.ts`
// ("does NOT close the AudioContext"). It is tested THERE rather than here
// because the controller only adopts a context inside `play()`, which needs a
// SongMap and a decoded buffer — that file already has the harness. A version
// of it here that merely constructed the controller passed without ever
// adopting the device, i.e. it proved nothing.

describe('audioDevice() heals rather than handing out a corpse', () => {
  it('replaces a closed context instead of returning it forever', async () => {
    // Defence in depth. Even if some future caller closes it, the next surface
    // must get a working device rather than silence with no diagnosis.
    const dead = installSharedDevice()
    await dead.close()
    expect(dead.state).toBe('closed')

    const fresh = audioDevice()
    spawned.push(fresh)
    expect(fresh).not.toBe(dead)
    expect(fresh.state).not.toBe('closed')
  })

  it('returns the same instance while it is alive', async () => {
    const shared = installSharedDevice()
    expect(audioDevice()).toBe(shared)
    expect(audioDevice()).toBe(shared)
  })
})
