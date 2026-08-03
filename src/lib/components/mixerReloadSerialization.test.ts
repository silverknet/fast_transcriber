/**
 * Reloading the mixer must be serialized.
 *
 * `reload()` wipes EVERY track and then rebuilds asynchronously. Two overlapping
 * calls therefore wipe each other's freshly-added tracks, and the mixer can end
 * up empty — silence, with all the decode work still burning CPU. That is what
 * "no audio at all when starting a song" looked like.
 *
 * The component isn't mountable here without an AudioContext and a project, so
 * this pins the ALGORITHM the component uses. `mixerReloadSerialization.ts`
 * holds it, and MixerView calls it.
 */
import { describe, expect, it } from 'vitest'
import { createReloadSerializer } from './mixerReloadSerialization'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('reload serialization', () => {
  it('never runs two rebuilds at once', async () => {
    let live = 0
    let maxLive = 0
    const reload = createReloadSerializer(async () => {
      live++
      maxLive = Math.max(maxLive, live)
      await tick()
      live--
    })
    await Promise.all([reload(), reload(), reload(), reload()])
    expect(maxLive).toBe(1)
  })

  /** A rebuild that blocks until its pass is explicitly released. */
  function gated() {
    const releases: (() => void)[] = []
    let runs = 0
    const reload = createReloadSerializer(async () => {
      runs++
      await new Promise<void>((r) => releases.push(r))
    })
    return {
      reload,
      runs: () => runs,
      releaseAll: async () => {
        // Each pass may start another, so drain until nothing new appears.
        for (let i = 0; i < releases.length; i++) {
          releases[i]!()
          await tick()
        }
      },
    }
  }

  it('still runs once MORE for work that arrived mid-flight', async () => {
    // A settings change during a rebuild must not be dropped: the lane would
    // keep playing the old part.
    const g = gated()
    const first = g.reload()
    await tick()
    expect(g.runs()).toBe(1)
    void g.reload() // arrives while the first is still going
    await g.releaseAll()
    await first
    expect(g.runs()).toBe(2)
  })

  it('coalesces a burst into a single extra pass, not one per call', async () => {
    const g = gated()
    const first = g.reload()
    await tick()
    for (let i = 0; i < 10; i++) void g.reload()
    await g.releaseAll()
    await first
    expect(g.runs()).toBe(2)
  })

  it('a later call after everything settled runs normally', async () => {
    let runs = 0
    const reload = createReloadSerializer(async () => {
      runs++
      await tick()
    })
    await reload()
    await reload()
    expect(runs).toBe(2)
  })

  it('a throwing rebuild does not wedge the serializer forever', async () => {
    let runs = 0
    const reload = createReloadSerializer(async () => {
      runs++
      throw new Error('boom')
    })
    await expect(reload()).rejects.toThrow('boom')
    // RED without the `finally`: the in-flight promise is never cleared and
    // every later reload silently no-ops — the mixer would never rebuild again.
    await expect(reload()).rejects.toThrow('boom')
    expect(runs).toBe(2)
  })
})
