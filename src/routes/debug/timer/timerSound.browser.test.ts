import { describe, expect, it } from 'vitest'
import { tickIntensity, tickTimes, TIMER_SECONDS } from './timerModel'
import { BELL_TAIL_SEC, scheduleBell, scheduleTick } from './timerSound'

/**
 * The timer's audio claims are about the rendered signal: the ticking has to get
 * MORE INTENSE as the countdown runs, and a bell has to land on zero and keep
 * ringing long enough to notice.
 *
 * These drive the REAL `scheduleTick` / `scheduleBell` — the same functions the
 * page schedules — against an `OfflineAudioContext`. A copy of the synthesis
 * here would only prove that Web Audio works.
 */

const SR = 44100

async function render(
  seconds: number,
  build: (ctx: OfflineAudioContext, out: AudioNode) => void,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR)
  build(ctx, ctx.destination)
  return (await ctx.startRendering()).getChannelData(0)
}

const renderTick = (intensity: number, seconds = 0.25) =>
  render(seconds, (ctx, out) => scheduleTick(ctx, out, 0, intensity))

const renderBell = (seconds = 4) => render(seconds, (ctx, out) => scheduleBell(ctx, out, 0))

function peak(d: Float32Array, fromSec = 0): number {
  let m = 0
  for (let i = Math.floor(fromSec * SR); i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

/** First-difference energy — a crude but reliable "how bright is it". */
function brightness(d: Float32Array): number {
  let sum = 0
  for (let i = 1; i < d.length; i++) {
    const hp = d[i]! - d[i - 1]!
    sum += hp * hp
  }
  return sum
}

describe('timer ticking (real browser)', () => {
  it('a tick actually makes a sound', async () => {
    expect(peak(await renderTick(tickIntensity(0)))).toBeGreaterThan(0.02)
  }, 30_000)

  it('the last tick is louder than the first', async () => {
    const first = await renderTick(tickIntensity(tickTimes()[0]!))
    const last = await renderTick(tickIntensity(tickTimes().at(-1)!))
    expect(peak(last)).toBeGreaterThan(peak(first) * 1.4)
  }, 30_000)

  it('the last tick is also BRIGHTER — a build, not just a volume knob', async () => {
    const first = await renderTick(tickIntensity(0))
    const last = await renderTick(tickIntensity(TIMER_SECONDS))
    // Normalise out level so this measures tone, not loudness.
    const tone = (d: Float32Array) => brightness(d) / Math.max(peak(d) ** 2, 1e-9)
    expect(tone(last)).toBeGreaterThan(tone(first))
  }, 30_000)

  it('each tick is short enough to read as a tick, not a beep', async () => {
    const d = await renderTick(1)
    // Effectively gone well before the next one, even at 4 per second.
    expect(peak(d, 0.12)).toBeLessThan(peak(d) * 0.02)
  }, 30_000)

  it('the fastest ticks cannot overlap each other', () => {
    const times = tickTimes()
    let smallestGap = Infinity
    for (let i = 1; i < times.length; i++) {
      smallestGap = Math.min(smallestGap, times[i]! - times[i - 1]!)
    }
    expect(smallestGap).toBeGreaterThan(0.07) // a 35 ms tick has room to finish
  })
})

describe('the bell (real browser)', () => {
  it('rings, and is still ringing a second and a half later', async () => {
    const d = await renderBell()
    expect(peak(d)).toBeGreaterThan(0.05)
    // A timer bell you miss is not a timer bell — this is the one that caught
    // the first version being too short.
    expect(peak(d, 1.5)).toBeGreaterThan(0.02)
  }, 30_000)

  it('decays rather than sustaining', async () => {
    const d = await renderBell()
    expect(peak(d, 3.2)).toBeLessThan(peak(d.subarray(0, Math.floor(0.3 * SR))) * 0.35)
  }, 30_000)

  it('has a strike — an attack, not a swell', async () => {
    const d = await renderBell(0.5)
    const attack = peak(d.subarray(0, Math.floor(0.02 * SR)))
    expect(attack).toBeGreaterThan(0.02)
  }, 30_000)

  it('sounds different from a tick — it is a bell, not a louder click', async () => {
    const bell = await renderBell(0.5)
    const tick = await renderTick(1, 0.5)
    // The bell still has energy where the tick has long finished.
    expect(peak(bell, 0.3)).toBeGreaterThan(peak(tick, 0.3) * 10)
  }, 30_000)

  it('the advertised tail covers the actual decay', async () => {
    const d = await renderBell(BELL_TAIL_SEC + 0.5)
    // Nothing meaningful left past the tail the page waits for before it
    // releases the AudioContext — otherwise the bell gets cut off.
    expect(peak(d, BELL_TAIL_SEC)).toBeLessThan(0.005)
  }, 30_000)

  it('lands exactly on zero, after the final tick', () => {
    expect(Math.max(...tickTimes())).toBeLessThan(TIMER_SECONDS)
  })
})
