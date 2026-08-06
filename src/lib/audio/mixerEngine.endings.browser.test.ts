import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'

/**
 * The simple endings, at the engine. `cut` and `fade` are both a programme
 * fade — one a few milliseconds long, one bars long — so this is the mechanism
 * behind every ending that is not the echo throw.
 *
 * The property that matters most is the one that is easiest to get wrong:
 * the CLICK must not be faded out under an ending. Taking the metronome away
 * at the exact moment the band is trying to land together would be the worst
 * possible time for it.
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

function addTrack(engine: MixerEngine, key: string): void {
  engine.setTrack({
    key,
    label: key,
    buffer: toneBuffer(engine.ac, 8),
    volume: 1,
    muted: false,
    soloed: false,
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('MixerEngine programme fade (cut / fade endings)', () => {
  it('takes the programme to silence by the end time', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    await engine.play(0)
    const now = engine.currentCtxTime()

    expect(engine.scheduleProgrammeFade(now, now + 0.15)).toBe(true)
    await wait(400)
    expect(engine.trackGainValueForTest('original')).toBeCloseTo(0, 3)
    engine.dispose()
  })

  it('NEVER fades the click — the band needs it most at the ending', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    addTrack(engine, 'click')
    addTrack(engine, 'cue')
    await engine.play(0)
    const now = engine.currentCtxTime()

    engine.scheduleProgrammeFade(now, now + 0.15)
    await wait(400)
    expect(engine.trackGainValueForTest('original')).toBeCloseTo(0, 3)
    expect(engine.trackGainValueForTest('click')).toBeGreaterThan(0.5)
    expect(engine.trackGainValueForTest('cue')).toBeGreaterThan(0.5)
    engine.dispose()
  })

  it('refuses rather than pretending when the transport is stopped', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    const now = engine.currentCtxTime()
    expect(engine.scheduleProgrammeFade(now, now + 0.2)).toBe(false)
    engine.dispose()
  })

  it('refuses when there is no musical lane to fade', async () => {
    // A song whose only lanes are click and cue has no programme to end.
    const engine = new MixerEngine()
    addTrack(engine, 'click')
    await engine.play(0)
    const now = engine.currentCtxTime()
    expect(engine.scheduleProgrammeFade(now, now + 0.2)).toBe(false)
    engine.dispose()
  })

  it('a fade already in the past still lands, it does not throw', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    await engine.play(0)
    const now = engine.currentCtxTime()
    expect(engine.scheduleProgrammeFade(now - 5, now - 4)).toBe(true)
    await wait(200)
    expect(engine.trackGainValueForTest('original')).toBeCloseTo(0, 2)
    engine.dispose()
  })
})
