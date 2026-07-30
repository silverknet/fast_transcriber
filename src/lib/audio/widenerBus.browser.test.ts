import { describe, expect, it } from 'vitest'
import { createWidenerInsert, normalizeWidener, WIDENER_PRESETS, type WidenerSettings } from './widenerBus'

/**
 * The widener makes two claims, and both are measurable on rendered samples:
 *
 *   1. it produces a genuine STEREO image (L and R differ)
 *   2. it leaves the LOW END alone, so kick and bass stay mono and punchy
 *
 * (2) is the one that matters for BarBro's bass and drums, and the one a naive
 * chorus gets wrong. Real Chromium delay/oscillator/panner nodes — none of this
 * exists under a mocked context.
 */

const SR = 44100
const SECONDS = 1

/** Render a mono sine through the widener; returns both output channels. */
async function renderWidener(
  freqHz: number,
  settings: Partial<WidenerSettings> = {},
): Promise<{ l: Float32Array; r: Float32Array }> {
  const ctx = new OfflineAudioContext(2, SR * SECONDS, SR)
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freqHz

  const fx = createWidenerInsert(ctx, normalizeWidener(settings))
  osc.connect(fx.input)
  fx.output.connect(ctx.destination)
  osc.start(0)
  osc.stop(SECONDS)

  const out = await ctx.startRendering()
  return { l: out.getChannelData(0), r: out.getChannelData(1) }
}

/** RMS over the settled portion (skip filter/LFO start-up). */
function rms(d: Float32Array): number {
  const from = Math.floor(0.2 * SR)
  let sum = 0
  for (let i = from; i < d.length; i++) sum += d[i]! * d[i]!
  return Math.sqrt(sum / (d.length - from))
}

/** RMS of the SIDE signal (L-R)/2 — literally "how much stereo is there". */
function sideRms(l: Float32Array, r: Float32Array): number {
  const from = Math.floor(0.2 * SR)
  let sum = 0
  for (let i = from; i < l.length; i++) {
    const s = (l[i]! - r[i]!) / 2
    sum += s * s
  }
  return Math.sqrt(sum / (l.length - from))
}

/** How much the stereo image MOVES: spread of side-RMS across 100 ms windows. */
function sideVariation(l: Float32Array, r: Float32Array): number {
  const win = Math.floor(0.1 * SR)
  const from = Math.floor(0.2 * SR)
  const levels: number[] = []
  for (let start = from; start + win < l.length; start += win) {
    let sum = 0
    for (let i = start; i < start + win; i++) {
      const s = (l[i]! - r[i]!) / 2
      sum += s * s
    }
    levels.push(Math.sqrt(sum / win))
  }
  if (levels.length === 0) return 0
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length
  const varSum = levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length
  return Math.sqrt(varSum)
}

describe('stereo widener (real browser)', () => {
  it('turns a mono input into a genuinely stereo output', async () => {
    const { l, r } = await renderWidener(1000)
    expect(rms(l)).toBeGreaterThan(0.01)
    expect(rms(r)).toBeGreaterThan(0.01)
    // If the sides were the same signal this would be ~0 — that is the failure
    // mode where "stereo" is really just a louder centre.
    expect(sideRms(l, r)).toBeGreaterThan(0.01)
  }, 30_000)

  it('leaves the low end out of the wet path — bass stays mono and punchy', async () => {
    const low = await renderWidener(50, { monoBelowHz: 140 })
    const high = await renderWidener(1000, { monoBelowHz: 140 })
    // The kick/bass fundamental reaches the master only via the dry channel.
    expect(rms(low.l)).toBeLessThan(rms(high.l) * 0.1)
  }, 30_000)

  it('the low guard is movable — raising it protects more of the bottom', async () => {
    const guarded = await renderWidener(300, { monoBelowHz: 800 })
    const open = await renderWidener(300, { monoBelowHz: 60 })
    expect(rms(guarded.l)).toBeLessThan(rms(open.l) * 0.5)
  }, 30_000)

  it('width controls how wide it actually is', async () => {
    const narrow = await renderWidener(1000, { width: 0.4 })
    const wide = await renderWidener(1000, { width: 1.8 })
    expect(sideRms(wide.l, wide.r)).toBeGreaterThan(sideRms(narrow.l, narrow.r) * 1.5)
  }, 30_000)

  it('width 0 collapses to mono — the two sides become identical', async () => {
    const { l, r } = await renderWidener(1000, { width: 0 })
    expect(sideRms(l, r)).toBeLessThan(rms(l) * 0.02)
  }, 30_000)

  it('depth is what MOVES the image — at 0 the width sits still', async () => {
    // With the LFOs stopped the delay difference is fixed, so the sides hold one
    // constant phase relationship. Sweeping them makes that relationship change,
    // which is heard as the image breathing. Measure the movement, not the width:
    // at a frequency where the fixed offset happens to land in phase, a static
    // widener reads as near-mono, so "is it wide" is the wrong question for depth.
    const still = await renderWidener(1000, { depth: 0 })
    const moving = await renderWidener(1000, { depth: 0.9, rateHz: 2 })
    expect(sideVariation(moving.l, moving.r)).toBeGreaterThan(sideVariation(still.l, still.r) * 3)
  }, 30_000)

  it('every preset is stereo above its guard and quiet below it', async () => {
    for (const p of WIDENER_PRESETS) {
      const above = await renderWidener(p.settings.monoBelowHz * 6, p.settings)
      const below = await renderWidener(p.settings.monoBelowHz / 4, p.settings)
      expect(sideRms(above.l, above.r)).toBeGreaterThan(0.005)
      expect(rms(below.l)).toBeLessThan(rms(above.l) * 0.25)
    }
  }, 60_000)

  it('update() retunes live without rebuilding the graph', async () => {
    const ctx = new OfflineAudioContext(2, SR * SECONDS, SR)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 1000
    const fx = createWidenerInsert(ctx, normalizeWidener({ width: 0 }))
    osc.connect(fx.input)
    fx.output.connect(ctx.destination)
    osc.start(0)
    fx.update(normalizeWidener({ width: 1.8 })) // same nodes, new settings
    osc.stop(SECONDS)
    const out = await ctx.startRendering()
    expect(sideRms(out.getChannelData(0), out.getChannelData(1))).toBeGreaterThan(0.01)
  }, 30_000)
})

describe('normalizeWidener', () => {
  it('always keeps a low guard — a widener with none is the bug it prevents', () => {
    expect(normalizeWidener({ monoBelowHz: 0 }).monoBelowHz).toBeGreaterThanOrEqual(20)
    expect(normalizeWidener({ monoBelowHz: -500 }).monoBelowHz).toBeGreaterThanOrEqual(20)
  })

  it('clamps every field into a usable range', () => {
    const n = normalizeWidener({ rateHz: 999, depth: 9, width: 9, monoBelowHz: 99999 })
    expect(n.rateHz).toBeLessThanOrEqual(8)
    expect(n.depth).toBeLessThanOrEqual(1)
    expect(n.width).toBeLessThanOrEqual(2)
    expect(n.monoBelowHz).toBeLessThanOrEqual(2000)
  })

  it('fills defaults for anything absent', () => {
    expect(normalizeWidener(undefined)).toEqual(normalizeWidener({}))
  })
})
