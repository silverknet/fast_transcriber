import { describe, expect, it } from 'vitest'
import { createKickBus, kickShapeFor, scheduleKick } from './chordKick'

/**
 * "Punchy" is a claim about the RENDERED WAVEFORM, so assert it there: build the
 * real voice in an OfflineAudioContext (same code path `playKick` uses live) and
 * measure the samples. Mocks cannot see any of this.
 */

const SR = 44100
const SECONDS = 1

async function renderKick(punch: number, velocity = 1): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR * SECONDS, SR)
  const bus = createKickBus(ctx, ctx.destination)
  scheduleKick(ctx, bus, 0, velocity, kickShapeFor(punch))
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0)
}

function peak(d: Float32Array, fromSec = 0, toSec = SECONDS): number {
  let m = 0
  const a = Math.floor(fromSec * SR)
  const b = Math.min(d.length, Math.floor(toSec * SR))
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

function energy(d: Float32Array, fromSec: number, toSec: number): number {
  let sum = 0
  const a = Math.floor(fromSec * SR)
  const b = Math.min(d.length, Math.floor(toSec * SR))
  for (let i = a; i < b; i++) sum += d[i]! * d[i]!
  return sum
}

/** Seconds until the signal first reaches 90% of its peak. */
function timeToPeakSec(d: Float32Array): number {
  const target = peak(d) * 0.9
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]!) >= target) return i / SR
  return SECONDS
}

/** Crude high-band energy: first difference emphasises the top end. */
function highBandEnergy(d: Float32Array, fromSec: number, toSec: number): number {
  let sum = 0
  const a = Math.max(1, Math.floor(fromSec * SR))
  const b = Math.min(d.length, Math.floor(toSec * SR))
  for (let i = a; i < b; i++) {
    const hp = d[i]! - d[i - 1]!
    sum += hp * hp
  }
  return sum
}

describe('chordKick — rendered voice', () => {
  it('actually makes a sound', async () => {
    const d = await renderKick(0.6)
    expect(peak(d)).toBeGreaterThan(0.1)
  })

  it('hits immediately — full level inside the first 10 ms', async () => {
    const d = await renderKick(0.6)
    expect(timeToPeakSec(d)).toBeLessThan(0.01)
  })

  it('is a drum, not a tone: the tail is gone well inside half a second', async () => {
    const d = await renderKick(0.6)
    expect(peak(d, 0.5, SECONDS)).toBeLessThan(peak(d) * 0.02)
  })

  it('more punch puts more of the energy into the first 30 ms', async () => {
    const soft = await renderKick(0)
    const hard = await renderKick(1)
    const frontRatio = (d: Float32Array) => energy(d, 0, 0.03) / energy(d, 0, SECONDS)
    expect(frontRatio(hard)).toBeGreaterThan(frontRatio(soft))
  })

  it('more punch shortens the tail', async () => {
    const soft = await renderKick(0)
    const hard = await renderKick(1)
    const tail = (d: Float32Array) => energy(d, 0.15, SECONDS) / energy(d, 0, SECONDS)
    expect(tail(hard)).toBeLessThan(tail(soft))
  })

  it('more punch brings up the beater click (high-band attack energy)', async () => {
    const soft = await renderKick(0)
    const hard = await renderKick(1)
    // Normalise against overall level so this measures TONE, not just loudness.
    const clickRatio = (d: Float32Array) => highBandEnergy(d, 0, 0.012) / energy(d, 0, SECONDS)
    expect(clickRatio(hard)).toBeGreaterThan(clickRatio(soft))
  })

  it('velocity accents are audible — a softer hit renders quieter', async () => {
    const accented = await renderKick(0.6, 1)
    const ghost = await renderKick(0.6, 0.85)
    expect(peak(ghost)).toBeLessThan(peak(accented))
  })

  it('stays inside the headroom the saturation promises', async () => {
    for (const p of [0, 0.5, 1]) {
      expect(peak(await renderKick(p))).toBeLessThanOrEqual(1)
    }
  })

  it('spends no energy below the drum (32 Hz high-pass holds)', async () => {
    const d = await renderKick(1)
    // A 20 Hz probe of the rendered signal: near-zero correlation means the
    // subsonic region is empty, which is what the high-pass is for.
    let re = 0
    let im = 0
    const n = Math.floor(0.3 * SR)
    for (let i = 0; i < n; i++) {
      const w = (2 * Math.PI * 20 * i) / SR
      re += d[i]! * Math.cos(w)
      im += d[i]! * Math.sin(w)
    }
    const mag20 = Math.sqrt(re * re + im * im) / n
    expect(mag20).toBeLessThan(0.02)
  })
})
