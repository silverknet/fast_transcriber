/**
 * STAGE INPUTS → IN-EAR MIXES.
 *
 * The band plugs in (mics, keys, guitar) and hears nothing in their ears,
 * because a desk channel does not reach a monitor bus until someone raises the
 * send. BarBro's own channels already have theirs — which is exactly why the
 * click is audible while the instruments are not.
 *
 * This turns the roster's inputs into the list of sends that fixes that: every
 * stage input into every performer's bus. Pure — the panel performs the writes
 * and reads them back.
 *
 * LEVELS ARE DELIBERATELY MODEST. These go into in-ear packs, where the XR18's
 * unity (0.75) is full line level and genuinely painful. The starting point is
 * meant to be audible and then raised BY EAR, never the other way round.
 */
import type { Performer } from '$lib/project/types'

/** Below unity, always: 0.75 is unity on an X-Air fader and far too hot to hand someone. */
export const MAX_MONITOR_SEND = 0.7
/** Audible without being a shock when the first note lands. */
export const DEFAULT_STAGE_SEND = 0.55

export type StageInputRow = {
  /** Desk channels this source occupies (1 = mono, 2 = a stereo pair). */
  channels: number[]
  /** "Keys", "Mic — Emma". */
  label: string
  /** Who it belongs to, for the mix labels. */
  ownerId: string
  ownerName: string
}

/** Every input on the roster, in performer order then input order. */
export function stageInputRows(performers: readonly Performer[]): StageInputRow[] {
  const out: StageInputRow[] = []
  for (const p of performers) {
    for (const input of p.inputs ?? []) {
      if (!Array.isArray(input.channels) || input.channels.length === 0) continue
      out.push({
        channels: [...input.channels],
        label: input.label?.trim() || 'Input',
        ownerId: p.id,
        ownerName: p.name,
      })
    }
  }
  return out
}

/** The monitor buses actually in use, ascending. */
export function monitorBuses(performers: readonly Performer[]): number[] {
  const seen = new Set<number>()
  for (const p of performers) {
    if (typeof p.monitorBus === 'number' && p.monitorBus >= 1 && p.monitorBus <= 6) {
      seen.add(p.monitorBus)
    }
  }
  return [...seen].sort((a, b) => a - b)
}

export type StageSendWrite = {
  channel: number
  bus: number
  value: number
  /** Plain words for the applied-writes report. */
  why: string
}

/**
 * One send per (stage input channel × monitor bus).
 *
 * Every input goes to every mix. Starting with a full band in everyone's ears
 * is what a performer expects on plugging in; taking something OUT afterwards
 * is an obvious, safe move, whereas hunting for why you cannot hear the singer
 * is what happens at soundcheck when sends default to zero.
 */
export function buildStageInputSends(
  performers: readonly Performer[],
  level: number = DEFAULT_STAGE_SEND,
): StageSendWrite[] {
  const value = Math.max(0, Math.min(MAX_MONITOR_SEND, level))
  const buses = monitorBuses(performers)
  const rows = stageInputRows(performers)
  const out: StageSendWrite[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const channel of row.channels) {
      if (!Number.isInteger(channel) || channel < 1 || channel > 16) continue
      for (const bus of buses) {
        const key = `${channel}:${bus}`
        if (seen.has(key)) continue // a channel listed twice must not be written twice
        seen.add(key)
        out.push({
          channel,
          bus,
          value,
          why: `${row.ownerName}’s ${row.label} (ch ${channel}) → bus ${bus}`,
        })
      }
    }
  }
  return out
}

/** `/ch/NN/mix/BB/level` — zero-padded both sides, which the desk requires. */
export function busSendPath(channel: number, bus: number): string {
  return `/ch/${String(channel).padStart(2, '0')}/mix/${String(bus).padStart(2, '0')}/level`
}

/** What to read back to prove the sends took. */
export function stageSendVerifyPlan(
  writes: readonly StageSendWrite[],
): { address: string; expect: number }[] {
  return writes.map((w) => ({ address: busSendPath(w.channel, w.bus), expect: w.value }))
}
