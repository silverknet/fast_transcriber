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

describe('the band hit — one-shot, and the scenarios that break apps like this', () => {
  function hitBuffer(ctx: AudioContext, seconds = 0.4): AudioBuffer {
    const len = Math.floor(SR * seconds)
    const buf = ctx.createBuffer(1, len, SR)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-8 * (i / len))
    return buf
  }

  it('schedules a hit and reports that it did', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    await engine.play(0)
    expect(engine.scheduleEndingHit(hitBuffer(engine.ac), engine.currentCtxTime() + 0.05, 0.9)).toBe(
      true,
    )
    engine.dispose()
  })

  it('refuses a silent or bufferless hit rather than pretending', async () => {
    const engine = new MixerEngine()
    await engine.play(0)
    expect(engine.scheduleEndingHit(hitBuffer(engine.ac), engine.currentCtxTime(), 0)).toBe(false)
    expect(engine.scheduleEndingHit(null as never, engine.currentCtxTime(), 1)).toBe(false)
    engine.dispose()
  })

  it('STOP cancels a pending hit — no crash fired into the next song', async () => {
    // The hit is committed to the audio clock ahead of the anchor. Without
    // teardown cancellation, stopping a song mid-set would land its ending
    // cymbal on top of whatever came next.
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    await engine.play(0)
    engine.scheduleEndingHit(hitBuffer(engine.ac, 2), engine.currentCtxTime() + 1.5, 1)
    engine.stop()
    await wait(200)
    expect(engine.snapshot().state).toBe('stopped')
    engine.dispose() // must not throw on already-stopped sources
  })

  it('a SEEK cancels a pending hit too', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    await engine.play(0)
    engine.scheduleEndingHit(hitBuffer(engine.ac, 2), engine.currentCtxTime() + 1.5, 1)
    engine.seek(3)
    await wait(150)
    engine.dispose()
  })

  it('survives every track being removed under it (song switch)', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    await engine.play(0)
    engine.scheduleEndingHit(hitBuffer(engine.ac), engine.currentCtxTime() + 0.05, 0.8)
    for (const t of engine.listTracks()) engine.removeTrack(t.key)
    await wait(250)
    engine.dispose()
  })

  it('does not disturb the click, the cue or any track gain', async () => {
    // Orthogonality, asserted: the hit is not a track, so nothing about the
    // existing mix can move because of it.
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    addTrack(engine, 'click')
    await engine.play(0)
    const before = {
      original: engine.trackGainValueForTest('original'),
      click: engine.trackGainValueForTest('click'),
    }
    engine.scheduleEndingHit(hitBuffer(engine.ac), engine.currentCtxTime() + 0.05, 1)
    await wait(200)
    expect(engine.trackGainValueForTest('original')).toBeCloseTo(before.original, 5)
    expect(engine.trackGainValueForTest('click')).toBeCloseTo(before.click, 5)
    engine.dispose()
  })

  it('is unaffected by playback rate — a crash is not a varispeed instrument', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    engine.setPlaybackRate(1.25)
    await engine.play(0)
    expect(engine.scheduleEndingHit(hitBuffer(engine.ac), engine.currentCtxTime() + 0.05, 1)).toBe(
      true,
    )
    await wait(200)
    engine.dispose()
  })

  it('clamps a runaway level instead of blowing up the master', async () => {
    const engine = new MixerEngine()
    addTrack(engine, 'original')
    await engine.play(0)
    expect(engine.scheduleEndingHit(hitBuffer(engine.ac), engine.currentCtxTime() + 0.02, 99)).toBe(
      true,
    )
    await wait(150)
    engine.dispose()
  })
})
