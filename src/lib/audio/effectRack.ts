/**
 * A bus's EFFECT RACK — the live audio graph for its chain of effects.
 *
 * One bus can hold several effects in series (reverb AND stereo), and the order
 * is audible, so this builds them in the declared order and hands back the
 * first one's input and the last one's output as a single `MixerInsert` for
 * `MixerEngine.setBus`.
 *
 *     send → chain[0] → chain[1] → … → chain[n] → return
 *
 * Deliberately a MODULE rather than a private helper inside `MixerView.svelte`:
 * the wiring is the part that can silently break (a missing series connection
 * makes every multi-effect bus go quiet), and code that lives in a `.svelte`
 * file cannot be imported by a test. Everything here takes a `BaseAudioContext`
 * so the same builder runs live and in an `OfflineAudioContext` under test.
 */
import type { MixerInsert } from './mixerEngine'
import { activeChain, chainShapeKey, type EffectBus, type EffectUnit } from '$lib/songmap/effectBusses'
import { createReverbInsert, normalizeReverb } from './reverbBus'
import { createDelayInsert, normalizeDelay } from './delayBus'
import { createWidenerInsert, normalizeWidener } from './widenerBus'

/**
 * Every effect module exposes the same shape, which is what makes chaining work.
 * `dispose` is optional — only effects holding a started source node (the
 * widener's LFOs) need one; for the rest, disconnecting is enough.
 */
export type LiveInsert = MixerInsert & { update: (s: never) => void; dispose?: () => void }

export type EffectRack = {
  /** The chain shape this was built from — compare to decide rebuild vs retune. */
  shape: string
  units: { id: string; insert: LiveInsert }[]
  /** What the engine sees: the head's input and the tail's output. */
  chain: MixerInsert
}

/** The normalized settings for one effect, whatever kind it is. */
export function effectUnitSettings(unit: EffectUnit): unknown {
  if (unit.kind === 'delay') return normalizeDelay(unit.delay)
  if (unit.kind === 'widener') return normalizeWidener(unit.widener)
  return normalizeReverb(unit.reverb)
}

export function buildEffectUnit(ctx: BaseAudioContext, unit: EffectUnit): LiveInsert {
  if (unit.kind === 'delay') {
    return createDelayInsert(ctx, normalizeDelay(unit.delay)) as unknown as LiveInsert
  }
  if (unit.kind === 'widener') {
    return createWidenerInsert(ctx, normalizeWidener(unit.widener)) as unknown as LiveInsert
  }
  return createReverbInsert(ctx, normalizeReverb(unit.reverb)) as unknown as LiveInsert
}

/**
 * Build the whole rack: every non-bypassed effect, wired in series.
 *
 * An EMPTY rack (no effects, or all of them bypassed) returns SILENCE, not a
 * pass-through. This is a send/return: the dry signal already reaches the
 * master through the channel's own fader, so passing the send straight back
 * would sum a phase-coherent copy of it — at the default send that is about
 * +2.6 dB. Bypassing the last effect on a bus would then make the mix LOUDER
 * instead of removing the effect, which is the opposite of what bypass means.
 * A rack with nothing in it therefore contributes nothing.
 */
export function buildEffectRack(ctx: BaseAudioContext, bus: EffectBus): EffectRack {
  const shape = chainShapeKey(bus)
  const units = activeChain(bus).map((u) => ({ id: u.id, insert: buildEffectUnit(ctx, u) }))
  if (units.length === 0) {
    const silent = ctx.createGain()
    silent.gain.value = 0
    return { shape, units: [], chain: { input: silent, output: silent } }
  }
  for (let i = 0; i < units.length - 1; i++) {
    units[i]!.insert.output.connect(units[i + 1]!.insert.input)
  }
  return {
    shape,
    units,
    chain: { input: units[0]!.insert.input, output: units[units.length - 1]!.insert.output },
  }
}

/**
 * Retune a rack in place — used when the settings changed but the chain SHAPE
 * did not, so dragging a reverb's size is heard immediately instead of
 * rebuilding (and briefly dropping) the bus.
 */
export function retuneEffectRack(rack: EffectRack, bus: EffectBus): void {
  const active = activeChain(bus)
  for (const u of rack.units) {
    const declared = active.find((x) => x.id === u.id)
    if (declared) u.insert.update(effectUnitSettings(declared) as never)
  }
}

/**
 * Let go of a rack's nodes so a rebuilt bus doesn't leave the old one running.
 *
 * `dispose()` matters as much as the disconnect: an effect holding a started
 * source node (the widener's LFOs) is retained by the AudioContext even with
 * nothing connected to it, and racks are rebuilt on every add / remove /
 * reorder / bypass.
 */
export function teardownEffectRack(rack: EffectRack): void {
  for (const u of rack.units) {
    try {
      u.insert.dispose?.()
    } catch {
      /* already torn down */
    }
    try {
      u.insert.output.disconnect()
    } catch {
      /* already gone */
    }
  }
  try {
    rack.chain.output.disconnect()
  } catch {
    /* already gone */
  }
}
