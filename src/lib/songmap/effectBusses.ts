/**
 * Effect busses — user-created aux channels, the way a DAW does them.
 *
 * The model, deliberately:
 *
 *   1. You CREATE a bus. Nothing exists until you make it, and you can have
 *      several — two reverbs with different sizes is normal.
 *   2. A bus hosts an ordered CHAIN of effects, like a DAW's device rack:
 *      reverb AND stereo on one bus, in the order you put them. Order is
 *      audible — widening a reverb tail is not the same as reverbing a widened
 *      signal — so the chain is a list, not a set.
 *   3. You HOOK UP the channels you want. A channel that isn't hooked up isn't
 *      in the bus's world at all — it has no level, no entry, nothing.
 *   4. Each hooked-up channel has its own SEND AMOUNT, edited from the BUS,
 *      not from a slider bolted onto every lane. Routing lives with the thing
 *      being routed to.
 *
 * `sends` is a sparse map: a key's PRESENCE means "hooked up". That's what
 * makes (3) and (4) different states rather than "amount happens to be 0".
 *
 * LEGACY: busses used to BE one effect — a `kind` plus one settings object on
 * the bus itself. Those files still load: `normalizeEffectBus` folds the old
 * shape into a one-effect chain, so nothing a user saved is lost and nothing
 * downstream has to know two shapes exist.
 *
 * Pure `SongMap`-free helpers so the routing rules are testable on their own.
 */
import type { ReverbSettings } from '$lib/audio/reverbBus'
import type { DelaySettings } from '$lib/audio/delayBus'
import type { WidenerSettings } from '$lib/audio/widenerBus'

export type EffectKind = 'reverb' | 'delay' | 'widener'
/** @deprecated Kept so older imports keep resolving; use {@link EffectKind}. */
export type EffectBusKind = EffectKind

/**
 * One effect in a bus's chain. Settings are absent until edited — the audio
 * layer's `normalize*` fills defaults, so this module needs no audio imports
 * and a freshly added effect stores nothing but its identity.
 */
export type EffectUnit = {
  /** Unique WITHIN its bus. Stable across edits so the graph can diff. */
  id: string
  kind: EffectKind
  /** Skipped in the chain, but kept with its settings. */
  bypassed?: boolean
  reverb?: ReverbSettings
  delay?: DelaySettings
  widener?: WidenerSettings
}

export type EffectBus = {
  id: string
  label: string
  /** Return level into the master (0..1.5). */
  level: number
  muted?: boolean
  /** Ordered: send → chain[0] → chain[1] → … → return. May be empty. */
  chain: EffectUnit[]
  /**
   * laneKey → send amount (0..1.5). PRESENCE = hooked up. An unhooked channel
   * has no entry, so "connected at zero" and "not connected" stay distinct.
   */
  sends: Record<string, number>
}

export const EFFECT_KINDS: { kind: EffectKind; label: string }[] = [
  { kind: 'reverb', label: 'Reverb' },
  { kind: 'delay', label: 'Delay' },
  { kind: 'widener', label: 'Stereo' },
]
/** @deprecated Use {@link EFFECT_KINDS}. */
export const EFFECT_BUS_KINDS = EFFECT_KINDS

export function effectKindLabel(kind: EffectKind): string {
  return EFFECT_KINDS.find((k) => k.kind === kind)?.label ?? kind
}

const DEFAULT_SEND = 0.35

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function asKind(v: unknown): EffectKind | null {
  return v === 'reverb' || v === 'delay' || v === 'widener' ? v : null
}

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * A stable id without RNG — renders and collab merges must be reproducible.
 * Busses are no longer named after one effect, so new ids are `bus-N`; legacy
 * `reverb-1`-style ids are left exactly as they are and merely avoided.
 */
export function nextBusId(existing: readonly EffectBus[]): string {
  let n = 1
  while (existing.some((b) => b.id === `bus-${n}`)) n++
  return `bus-${n}`
}

/** Unique within one bus, and likewise RNG-free. */
export function nextUnitId(chain: readonly EffectUnit[], kind: EffectKind): string {
  let n = 1
  while (chain.some((u) => u.id === `${kind}-${n}`)) n++
  return `${kind}-${n}`
}

/**
 * A fresh bus. Passing a `firstKind` seeds the chain with that effect, which is
 * what "Add effect bus → Reverb" means; omitting it makes an empty rack.
 */
export function createEffectBus(existing: readonly EffectBus[], firstKind?: EffectKind): EffectBus {
  const chain: EffectUnit[] = firstKind ? [{ id: `${firstKind}-1`, kind: firstKind }] : []
  const label = firstKind ? effectKindLabel(firstKind) : 'Bus'
  const taken = new Set(existing.map((b) => b.label))
  let name = label
  let n = 2
  while (taken.has(name)) name = `${label} ${n++}`
  return { id: nextBusId(existing), label: name, level: 1, chain, sends: {} }
}

// ── The chain ───────────────────────────────────────────────────────────────

/** Append an effect to the end of the rack. */
export function addEffect(bus: EffectBus, kind: EffectKind): EffectBus {
  return { ...bus, chain: [...bus.chain, { id: nextUnitId(bus.chain, kind), kind }] }
}

export function removeEffect(bus: EffectBus, unitId: string): EffectBus {
  const chain = bus.chain.filter((u) => u.id !== unitId)
  return chain.length === bus.chain.length ? bus : { ...bus, chain }
}

/**
 * Move an effect `delta` places along the chain. Clamped at both ends, so
 * pressing "up" on the first effect is a no-op rather than a wrap-around.
 */
export function moveEffect(bus: EffectBus, unitId: string, delta: number): EffectBus {
  const from = bus.chain.findIndex((u) => u.id === unitId)
  if (from < 0 || delta === 0) return bus
  const to = clamp(from + delta, 0, bus.chain.length - 1)
  if (to === from) return bus
  const chain = [...bus.chain]
  const [moved] = chain.splice(from, 1)
  chain.splice(to, 0, moved!)
  return { ...bus, chain }
}

export function setEffectBypassed(bus: EffectBus, unitId: string, bypassed: boolean): EffectBus {
  let changed = false
  const chain = bus.chain.map((u) => {
    if (u.id !== unitId || !!u.bypassed === bypassed) return u
    changed = true
    const next = { ...u }
    if (bypassed) next.bypassed = true
    else delete next.bypassed
    return next
  })
  return changed ? { ...bus, chain } : bus
}

/** Replace one effect's settings. The caller passes the already-normalized value. */
export function setEffectSettings(
  bus: EffectBus,
  unitId: string,
  settings: ReverbSettings | DelaySettings | WidenerSettings,
): EffectBus {
  let changed = false
  const chain = bus.chain.map((u) => {
    if (u.id !== unitId) return u
    changed = true
    return { ...u, [u.kind]: settings } as EffectUnit
  })
  return changed ? { ...bus, chain } : bus
}

/** The effects that actually make audio, in order (bypassed ones removed). */
export function activeChain(bus: EffectBus): EffectUnit[] {
  return bus.chain.filter((u) => !u.bypassed)
}

/**
 * Identity of the bus's audio GRAPH — which effects, in which order. Settings
 * are deliberately excluded: changing a reverb's size retunes the existing
 * nodes, while adding/removing/reordering/bypassing has to rebuild them. The
 * caller compares this to decide which of the two it is.
 */
export function chainShapeKey(bus: EffectBus): string {
  return activeChain(bus)
    .map((u) => `${u.id}:${u.kind}`)
    .join('>')
}

// ── Routing ─────────────────────────────────────────────────────────────────

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

// ── Persistence ─────────────────────────────────────────────────────────────

function normalizeUnit(raw: unknown, chainSoFar: EffectUnit[]): EffectUnit | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const kind = asKind(o.kind)
  if (!kind) return null // an effect this build doesn't have is dropped, not guessed
  const id =
    typeof o.id === 'string' && o.id && !chainSoFar.some((u) => u.id === o.id)
      ? o.id
      : nextUnitId(chainSoFar, kind)
  const unit: EffectUnit = { id, kind }
  if (o.bypassed === true) unit.bypassed = true
  // Settings ride along only for the matching kind, so a leftover `reverb`
  // block on a delay can't smuggle itself through.
  const settings = o[kind]
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    ;(unit as Record<string, unknown>)[kind] = settings
  }
  return unit
}

/**
 * Read one stored bus, repairing rather than discarding the user's routing.
 *
 * Accepts BOTH shapes: the current `chain: EffectUnit[]`, and the legacy
 * one-effect-per-bus `{ kind, reverb|delay|widener }`, which becomes a
 * single-effect chain. A legacy bus therefore keeps its id, its label, its
 * level and every send — it simply gains the ability to hold more effects.
 */
export function normalizeEffectBus(raw: unknown): EffectBus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id ? o.id : null
  if (!id) return null

  const sends: Record<string, number> = {}
  if (o.sends && typeof o.sends === 'object' && !Array.isArray(o.sends)) {
    for (const [k, v] of Object.entries(o.sends as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) sends[k] = clamp(v, 0, 1.5)
    }
  }

  const chain: EffectUnit[] = []
  if (Array.isArray(o.chain)) {
    for (const r of o.chain) {
      const unit = normalizeUnit(r, chain)
      if (unit) chain.push(unit)
    }
  } else {
    // ── Legacy: the bus WAS the effect. Fold it into a one-effect chain. ──
    const legacyKind = asKind(o.kind)
    if (legacyKind) {
      const unit: EffectUnit = { id: `${legacyKind}-1`, kind: legacyKind }
      const settings = o[legacyKind]
      if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
        ;(unit as Record<string, unknown>)[legacyKind] = settings
      }
      chain.push(unit)
    }
  }

  const fallbackLabel = chain[0] ? effectKindLabel(chain[0].kind) : 'Bus'
  const out: EffectBus = {
    id,
    label: typeof o.label === 'string' && o.label.trim() ? o.label : fallbackLabel,
    level: typeof o.level === 'number' && Number.isFinite(o.level) ? clamp(o.level, 0, 1.5) : 1,
    chain,
    sends,
  }
  if (o.muted === true) out.muted = true
  return out
}

export function normalizeEffectBusses(raw: unknown): EffectBus[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.map(normalizeEffectBus).filter((b): b is EffectBus => b !== null)
  return out.length > 0 ? out : undefined
}
