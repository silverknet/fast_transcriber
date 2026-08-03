import { describe, expect, it } from 'vitest'
import { buildEffectRack, retuneEffectRack } from './effectRack'
import {
  addEffect,
  createEffectBus,
  moveEffect,
  setEffectBypassed,
  setEffectSettings,
  type EffectBus,
  type EffectKind,
} from '$lib/songmap/effectBusses'

/**
 * A bus now hosts a CHAIN of effects. These drive the REAL `buildEffectRack`
 * from real `EffectBus` values — not a copy of the wiring — so breaking the
 * builder (dropping the series connections, ignoring bypass) fails them.
 *
 * The claims worth pinning are the ones a user would notice:
 *   - a chain applies EVERY effect, not just the first or last
 *   - the ORDER is audible, which is why the chain is a list, not a set
 *   - bypass really removes an effect from the audio
 *   - an empty rack passes sound through rather than swallowing it
 */

const SR = 44100
const SECONDS = 1.5

/** A bus with the given effects, in order. */
function busWith(...kinds: EffectKind[]): EffectBus {
  let bus = createEffectBus([])
  for (const k of kinds) bus = addEffect(bus, k)
  // Settings chosen so each effect is unmistakable in the rendered signal.
  for (const u of bus.chain) {
    if (u.kind === 'reverb') bus = setEffectSettings(bus, u.id, { sizeSec: 2.5 } as never)
    if (u.kind === 'widener') {
      bus = setEffectSettings(bus, u.id, { width: 1.8, monoBelowHz: 60 } as never)
    }
    if (u.kind === 'delay') {
      bus = setEffectSettings(bus, u.id, { timeSec: 0.25, feedback: 0.4 } as never)
    }
  }
  return bus
}

/** Render a burst through the bus's real rack; returns both channels. */
async function renderBus(
  bus: EffectBus,
  tweak?: (rack: ReturnType<typeof buildEffectRack>) => void,
): Promise<{ l: Float32Array; r: Float32Array }> {
  const ctx = new OfflineAudioContext(2, SR * SECONDS, SR)
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = 440
  const env = ctx.createGain()
  env.gain.setValueAtTime(0.5, 0)
  env.gain.setValueAtTime(0.5, 0.2)
  env.gain.linearRampToValueAtTime(0, 0.22) // a burst, so tails are visible after it
  osc.connect(env)

  const rack = buildEffectRack(ctx, bus)
  tweak?.(rack)
  env.connect(rack.chain.input)
  rack.chain.output.connect(ctx.destination)
  osc.start(0)
  osc.stop(SECONDS)

  const out = await ctx.startRendering()
  return { l: out.getChannelData(0), r: out.getChannelData(1) }
}

function energy(d: Float32Array, fromSec: number, toSec: number): number {
  let sum = 0
  const a = Math.max(0, Math.floor(fromSec * SR))
  const b = Math.min(d.length, Math.floor(toSec * SR))
  for (let i = a; i < b; i++) sum += d[i]! * d[i]!
  return sum
}

/** Stereo content: RMS of (L-R)/2. Zero means it is really mono. */
function sideRms(l: Float32Array, r: Float32Array, fromSec = 0, toSec = SECONDS): number {
  let sum = 0
  const a = Math.floor(fromSec * SR)
  const b = Math.min(l.length, Math.floor(toSec * SR))
  for (let i = a; i < b; i++) {
    const s = (l[i]! - r[i]!) / 2
    sum += s * s
  }
  return Math.sqrt(sum / Math.max(1, b - a))
}

function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i]! - b[i]!))
  return m
}

describe('effect rack — a bus hosting several effects (real browser)', () => {
  it('an empty rack is SILENT, not a pass-through', async () => {
    // This is a send/return: the dry signal already reaches the master through
    // the channel fader, so returning the send unprocessed would sum a second,
    // phase-coherent copy of it and make the mix louder. A rack with nothing in
    // it contributes nothing.
    const { l } = await renderBus(createEffectBus([]))
    expect(energy(l, 0, SECONDS)).toBe(0)
  }, 30_000)

  it('reverb alone leaves a tail after the burst', async () => {
    const { l } = await renderBus(busWith('reverb'))
    expect(energy(l, 0.4, SECONDS)).toBeGreaterThan(0.001)
  }, 30_000)

  it('reverb THEN stereo applies BOTH — a tail that is also wide', async () => {
    const both = await renderBus(busWith('reverb', 'widener'))
    const justReverb = await renderBus(busWith('reverb'))

    // The reverb is still doing its job…
    expect(energy(both.l, 0.4, SECONDS)).toBeGreaterThan(0.0005)
    // …and the widener is too, which one-effect-per-bus could never give you.
    expect(sideRms(both.l, both.r)).toBeGreaterThan(sideRms(justReverb.l, justReverb.r) * 2)
  }, 60_000)

  it('adding a second effect changes the sound — the chain is not just the first effect', async () => {
    const one = await renderBus(busWith('reverb'))
    const two = await renderBus(busWith('reverb', 'delay'))
    expect(maxDiff(one.l, two.l)).toBeGreaterThan(0.001)
  }, 60_000)

  it('every effect in a three-deep chain is audible', async () => {
    const all = await renderBus(busWith('reverb', 'delay', 'widener'))
    // Delay repeats put energy well after the reverb-only tail would have died.
    expect(energy(all.l, 0.6, SECONDS)).toBeGreaterThan(0.0005)
    expect(sideRms(all.l, all.r)).toBeGreaterThan(0.0005)
  }, 60_000)

  it('ORDER is audible — reverb→stereo differs from stereo→reverb', async () => {
    const forward = busWith('reverb', 'widener')
    const backward = moveEffect(forward, forward.chain[1]!.id, -1)
    expect(backward.chain.map((u) => u.kind)).toEqual(['widener', 'reverb'])

    const a = await renderBus(forward)
    const b = await renderBus(backward)
    // If order were ignored these would be identical; this is what makes the
    // chain a LIST rather than a set.
    expect(maxDiff(a.l, b.l)).toBeGreaterThan(0.001)
  }, 60_000)

  it('widening a reverb tail is wider than reverbing a widened signal', async () => {
    // Ordering guidance a user can act on: put the widener LAST to spread the
    // tail; put it first and the reverb largely re-centres it.
    const wideLast = busWith('reverb', 'widener')
    const wideFirst = moveEffect(wideLast, wideLast.chain[1]!.id, -1)
    const a = await renderBus(wideLast)
    const b = await renderBus(wideFirst)
    expect(sideRms(a.l, a.r, 0.4, SECONDS)).toBeGreaterThan(sideRms(b.l, b.r, 0.4, SECONDS))
  }, 60_000)

  it('BYPASS takes an effect out of the audio entirely', async () => {
    const bus = busWith('reverb', 'widener')
    const widenerId = bus.chain[1]!.id
    const bypassed = setEffectBypassed(bus, widenerId, true)

    const withWidener = await renderBus(bus)
    const without = await renderBus(bypassed)
    const reverbOnly = await renderBus(busWith('reverb'))

    // Bypassing the widener must land on reverb-only, not somewhere in between.
    expect(sideRms(without.l, without.r)).toBeLessThan(sideRms(withWidener.l, withWidener.r) * 0.6)
    expect(maxDiff(without.l, reverbOnly.l)).toBe(0)
  }, 60_000)

  it('bypassing the LAST effect quietens the bus — it must never get louder', async () => {
    // The failure this guards: an empty rack that passes the send through would
    // return a copy of the dry channel, so pressing Bypass on the only effect
    // would ADD about +2.6 dB of dry signal instead of removing the effect.
    const bus = busWith('reverb')
    const active = await renderBus(bus)
    const bypassed = await renderBus(setEffectBypassed(bus, bus.chain[0]!.id, true))
    expect(energy(bypassed.l, 0, SECONDS)).toBeLessThan(energy(active.l, 0, SECONDS))
    expect(energy(bypassed.l, 0, SECONDS)).toBe(0)
  }, 30_000)

  it('a rack with every effect bypassed is silent', async () => {
    let bus = busWith('reverb', 'widener')
    for (const u of bus.chain) bus = setEffectBypassed(bus, u.id, true)
    const { l } = await renderBus(bus)
    expect(energy(l, 0, SECONDS)).toBe(0)
  }, 30_000)

  it('two effects of the SAME kind both apply', async () => {
    const one = await renderBus(busWith('delay'))
    const two = await renderBus(busWith('delay', 'delay'))
    // A delay into a delay smears further than one alone.
    expect(energy(two.l, 0.9, SECONDS)).toBeGreaterThan(energy(one.l, 0.9, SECONDS))
  }, 60_000)

  it('retuning in place changes the sound without rebuilding the rack', async () => {
    const bus = busWith('widener')
    const narrow = setEffectSettings(bus, bus.chain[0]!.id, {
      width: 0.1,
      monoBelowHz: 60,
    } as never)
    const wide = setEffectSettings(bus, bus.chain[0]!.id, { width: 1.9, monoBelowHz: 60 } as never)

    // Build from `narrow`, then retune the SAME nodes to `wide`.
    const retuned = await renderBus(narrow, (rack) => retuneEffectRack(rack, wide))
    const builtNarrow = await renderBus(narrow)
    expect(sideRms(retuned.l, retuned.r)).toBeGreaterThan(sideRms(builtNarrow.l, builtNarrow.r) * 2)
  }, 60_000)
})
