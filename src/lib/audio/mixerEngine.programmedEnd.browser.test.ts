import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'

/**
 * THE PROGRAMMED ENDING — a song that stops where you said, not where the file
 * runs out.
 *
 * The stage waveform has drawn an orange END bar at the programmed ending for
 * some time, and nothing stopped there: `programmedEndMixerSec` had two
 * consumers and both of them were drawing code. On a stage, a marker that
 * implies a behaviour which does not exist is worse than no marker — you plan
 * around it and it lies to you.
 *
 * These drive the real engine in a real browser, because the whole point is the
 * transport actually stopping on the audio clock.
 */

const SR = 44100

function toneBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(SR * seconds)
  const buf = ctx.createBuffer(2, len, SR)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * 0.5
  }
  return buf
}

function addSong(engine: MixerEngine, seconds = 6): void {
  engine.setTrack({
    key: 'original',
    label: 'original',
    buffer: toneBuffer(engine.ac, seconds),
    volume: 1,
    muted: false,
    soloed: false,
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('MixerEngine programmed ending', () => {
  it('stops at the programmed end instead of the end of the audio', async () => {
    const engine = new MixerEngine()
    addSong(engine, 6)
    engine.setProgrammedEnd(0.6)
    await engine.play(0)
    expect(engine.snapshot().state).toBe('playing')

    await wait(1100) // well past 0.6 s, nowhere near the 6 s file end
    expect(engine.snapshot().state).toBe('stopped')
    engine.dispose()
  })

  it('plays to the end of the file when no ending is programmed', async () => {
    // The default must not change: a song with no recipe just ends normally.
    const engine = new MixerEngine()
    addSong(engine, 6)
    await engine.play(0)
    await wait(1100)
    expect(engine.snapshot().state).toBe('playing')
    engine.dispose()
  })

  it('clearing the ending restores the full song', async () => {
    const engine = new MixerEngine()
    addSong(engine, 6)
    engine.setProgrammedEnd(0.6)
    engine.setProgrammedEnd(null)
    await engine.play(0)
    await wait(1100)
    expect(engine.snapshot().state).toBe('playing')
    engine.dispose()
  })

  it('moving the anchor mid-song takes effect on this pass', async () => {
    const engine = new MixerEngine()
    addSong(engine, 6)
    await engine.play(0)
    engine.setProgrammedEnd(0.7) // set AFTER play started
    await wait(1200)
    expect(engine.snapshot().state).toBe('stopped')
    engine.dispose()
  })

  it('does NOT apply to a pass that started past the anchor', async () => {
    // Seeking beyond a programmed ending is how you rehearse an outro you have
    // chosen to cut. An anchor that stopped the transport the moment you landed
    // there would make that impossible.
    const engine = new MixerEngine()
    addSong(engine, 6)
    engine.setProgrammedEnd(1.0)
    await engine.play(2.0)
    await wait(700)
    expect(engine.snapshot().state).toBe('playing')
    engine.dispose()
  })

  it('an anchor at or past the end of the audio changes nothing', async () => {
    const engine = new MixerEngine()
    addSong(engine, 2)
    engine.setProgrammedEnd(10)
    await engine.play(0)
    expect(engine.effectiveEndPositionSec()).toBeCloseTo(engine.durationSec(), 3)
    engine.dispose()
  })

  it('rejects junk anchors rather than wedging the transport', async () => {
    const engine = new MixerEngine()
    addSong(engine, 4)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      engine.setProgrammedEnd(bad)
      expect(engine.effectiveEndPositionSec()).toBeCloseTo(engine.durationSec(), 3)
    }
    await engine.play(0)
    await wait(400)
    expect(engine.snapshot().state).toBe('playing')
    engine.dispose()
  })

  it('reports where this pass will actually stop', async () => {
    const engine = new MixerEngine()
    addSong(engine, 6)
    engine.setProgrammedEnd(2.5)
    expect(engine.effectiveEndPositionSec()).toBeCloseTo(2.5, 3)
    engine.dispose()
  })
})
