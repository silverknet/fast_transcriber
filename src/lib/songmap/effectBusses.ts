/**
 * Effect busses — user-created aux channels, the way a DAW does them.
 *
 * The model, deliberately:
 *
 *   1. You CREATE a bus (reverb, delay). Nothing exists until you make it, and
 *      you can have several — two reverbs with different sizes is normal.
 *   2. You HOOK UP the channels you want. A channel that isn't hooked up isn't
 *      in the bus's world at all — it has no level, no entry, nothing.
 *   3. Each hooked-up channel has its own SEND AMOUNT, edited from the BUS,
 *      not from a slider bolted onto every lane. Routing lives with the thing
 *      being routed to.
 *
 * `sends` is a sparse map: a key's PRESENCE means "hooked up". That's what
 * makes (2) and (3) different states rather than "amount happens to be 0".
 *
 * Pure `SongMap`-free helpers so the routing rules are testable on their own.
 */
import type { ReverbSettings } from '$lib/audio/reverbBus'
import type { DelaySettings } from '$lib/audio/delayBus'
import type { WidenerSettings } from '$lib/audio/widenerBus'

export type EffectBusKind = 'reverb' | 'delay' | 'widener'

export type EffectBus = {
  id: string
  kind: EffectBusKind
  label: string
  /** Return level into the master (0..1.5). */
  level: number
  muted?: boolean
  /** Present only for the matching `kind`. */
  reverb?: ReverbSettings
  delay?: DelaySettings
  widener?: WidenerSettings
  /**
   * laneKey → send amount (0..1.5). PRESENCE = hooked up. An unhooked channel
   * has no entry, so "connected at zero" and "not connected" stay distinct.
   */
  sends: Record<string, number>
}

export const EFFECT_BUS_KINDS: { kind: EffectBusKind; label: string }[] = [
  { kind: 'reverb', label: 'Reverb' },
  { kind: 'delay', label: 'Delay' },
  { kind: 'widener', label: 'Stereo' },
]

const DEFAULT_SEND = 0.35

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** A stable id without RNG — renders and collab merges must be reproducible. */
export function nextBusId(existing: EffectBus[], kind: EffectBusKind): string {
  let n = 1
  while (existing.some((b) => b.id === `${kind}-${n}`)) n++
  return `${kind}-${n}`
}

/** A fresh bus with nothing hooked up yet. */
export function createEffectBus(existing: EffectBus[], kind: EffectBusKind): EffectBus {
  const sameKind = existing.filter((b) => b.kind === kind).length
  const base = EFFECT_BUS_KINDS.find((k) => k.kind === kind)?.label ?? kind
  return {
    id: nextBusId(existing, kind),
    kind,
    label: sameKind === 0 ? base : `${base} ${sameKind + 1}`,
    level: 1,
    sends: {},
  }
}

export function isHookedUp(bus: EffectBus, laneKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(bus.sends, laneKey)
}

/** Hook a channel up at a sensible default, or unhook it entirely. */
export function setHookedUp(bus: EffectBus, laneKey: string, on: boolean): EffectBus {
  if (on === isHookedUp(bus, laneKey)) return bus
  const sends = { ...bus.sends }
  if (on) sends[laneKey] = DEFAULT_SEND
  else delete sends[laneKey]
  return { ...bus, sends }
}

/** Change how much of a hooked-up channel feeds the bus. */
export function setSendAmount(bus: EffectBus, laneKey: string, amount: number): EffectBus {
  if (!isHookedUp(bus, laneKey)) return bus
  return { ...bus, sends: { ...bus.sends, [laneKey]: clamp(amount, 0, 1.5) } }
}

export function renameBus(bus: EffectBus, label: string): EffectBus {
  const trimmed = label.trim()
  return trimmed ? { ...bus, label: trimmed } : bus
}

/** Drop a lane from every bus — used when a track disappears. */
export function forgetLane(busses: EffectBus[], laneKey: string): EffectBus[] {
  return busses.map((b) => (isHookedUp(b, laneKey) ? setHookedUp(b, laneKey, false) : b))
}

/** Repair anything unreadable rather than dropping the user's routing. */
export function normalizeEffectBus(raw: unknown): EffectBus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id ? o.id : null
  if (!id) return null
  const kind: EffectBusKind =
    o.kind === 'delay' ? 'delay' : o.kind === 'widener' ? 'widener' : 'reverb'
  const sends: Record<string, number> = {}
  if (o.sends && typeof o.sends === 'object' && !Array.isArray(o.sends)) {
    for (const [k, v] of Object.entries(o.sends as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) sends[k] = clamp(v, 0, 1.5)
    }
  }
  const out: EffectBus = {
    id,
    kind,
    label: typeof o.label === 'string' && o.label.trim() ? o.label : kind,
    level: typeof o.level === 'number' && Number.isFinite(o.level) ? clamp(o.level, 0, 1.5) : 1,
    sends,
  }
  if (o.muted === true) out.muted = true
  if (kind === 'reverb' && o.reverb && typeof o.reverb === 'object') {
    out.reverb = o.reverb as ReverbSettings
  }
  if (kind === 'delay' && o.delay && typeof o.delay === 'object') {
    out.delay = o.delay as DelaySettings
  }
  if (kind === 'widener' && o.widener && typeof o.widener === 'object') {
    out.widener = o.widener as WidenerSettings
  }
  return out
}

export function normalizeEffectBusses(raw: unknown): EffectBus[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.map(normalizeEffectBus).filter((b): b is EffectBus => b !== null)
  return out.length > 0 ? out : undefined
}
