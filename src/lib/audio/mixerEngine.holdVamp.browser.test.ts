import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'

/**
 * The HOLD bed: the loop that covers the gap while the band changes presets.
 *
 * Its defining property is the one that makes it different from everything
 * else in the engine — it must OUTLIVE the transport. The song ends, every
 * track is torn down, the next song loads, and the bed is still playing,
 * because a person is still reaching for a patch.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function clickBuf(ctx: AudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, 2048, 44100)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 6) * Math.exp(-i / 400)
  return b
}

function vampOn(engine: MixerEngine, onBar?: () => void) {
  const buf = clickBuf(engine.ac)
  return engine.startHoldVamp({
    beatDurationSec: 0.25,
    loopBeats: 4,
    scheduleBar: (at, out) => {
      onBar?.()
      const made: AudioScheduledSourceNode[] = []
      for (let b = 0; b < 4; b++) {
        const src = engine.ac.createBufferSource()
        src.buffer = buf
        src.connect(out)
        src.start(at + b * 0.25)
        made.push(src)
      }
      return made
    },
  })
}

describe('MixerEngine hold vamp', () => {
  it('starts and reports that it is running', async () => {
    const engine = new MixerEngine()
    expect(vampOn(engine)).toBe(true)
    expect(engine.holdVampActive()).toBe(true)
    engine.dispose()
  })

  it('KEEPS PLAYING while the transport is stopped — the whole point', async () => {
    const engine = new MixerEngine()
    vampOn(engine)
    engine.stop()
    await wait(300)
    expect(engine.holdVampActive()).toBe(true)
    engine.dispose()
  })

  it('keeps looping — it schedules more bars over time', async () => {
    // A hold has no known length; it ends when a person decides it does. So the
    // loop must re-arm itself rather than being one finite schedule.
    const engine = new MixerEngine()
    let bars = 0
    vampOn(engine, () => bars++)
    const first = bars
    await wait(1400)
    expect(bars).toBeGreaterThan(first)
    engine.dispose()
  })

  it('survives every track being removed under it (the next song loading)', async () => {
    const engine = new MixerEngine()
    const b = engine.ac.createBuffer(2, 44100 * 2, 44100)
    engine.setTrack({ key: 'original', label: 'o', buffer: b, volume: 1, muted: false, soloed: false })
    await engine.play(0)
    vampOn(engine)
    for (const t of engine.listTracks()) engine.removeTrack(t.key)
    await wait(300)
    expect(engine.holdVampActive()).toBe(true)
    engine.dispose()
  })

  it('stops when told, and reports that it has', async () => {
    const engine = new MixerEngine()
    vampOn(engine)
    engine.stopHoldVamp()
    expect(engine.holdVampActive()).toBe(false)
    await wait(250)
    expect(engine.holdVampActive()).toBe(false)
    engine.dispose()
  })

  it('starting a second bed replaces the first rather than stacking', async () => {
    // Two beds at once would be a mess nobody could stop.
    const engine = new MixerEngine()
    vampOn(engine)
    vampOn(engine)
    engine.stopHoldVamp()
    await wait(200)
    expect(engine.holdVampActive()).toBe(false)
    engine.dispose()
  })

  it('dispose ends it — closing the page must not leave a kick looping', async () => {
    const engine = new MixerEngine()
    vampOn(engine)
    await engine.dispose()
    expect(engine.holdVampActive()).toBe(false)
  })

  it('does not disturb any track gain', async () => {
    const engine = new MixerEngine()
    const b = engine.ac.createBuffer(2, 44100 * 2, 44100)
    engine.setTrack({ key: 'original', label: 'o', buffer: b, volume: 0.7, muted: false, soloed: false })
    await engine.play(0)
    const before = engine.trackGainValueForTest('original')
    vampOn(engine)
    await wait(200)
    expect(engine.trackGainValueForTest('original')).toBeCloseTo(before, 5)
    engine.dispose()
  })

  it('a bed that schedules nothing still stops cleanly', async () => {
    const engine = new MixerEngine()
    engine.startHoldVamp({ beatDurationSec: 0.25, loopBeats: 4, scheduleBar: () => [] })
    engine.stopHoldVamp()
    expect(engine.holdVampActive()).toBe(false)
    engine.dispose()
  })
})
