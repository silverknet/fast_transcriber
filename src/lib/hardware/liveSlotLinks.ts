/**
 * Which mixer tracks a live button toggles.
 *
 * The 8 live buttons (bottom APC pad row + the 8 track buttons + keys 1–8) are
 * FIXED canonical slots — button 0 is Drums in every song, whether or not that
 * song has drums. Historically the lane→slot mapping was a filename guess
 * (`laneSlotIndex`): `stem:drums.wav` → Drums, and anything the regex didn't
 * recognise (`stem:percussion.wav`) was not live-toggleable at all.
 *
 * This module makes the link EXPLICIT and MANY-TO-ONE:
 *
 *   - a track can be pinned to any slot, whatever it is called
 *   - SEVERAL tracks can share one slot — link percussion AND drums to the
 *     Drums button and one press moves both
 *   - a track can be pinned to `'none'` so a name that merely looks like a stem
 *     is kept off the buttons
 *   - a track with no setting keeps the old filename guess, so every existing
 *     song behaves exactly as before until someone changes something
 *
 * Pure decision layer: no audio, no engine, no Svelte. `MixerView` owns the
 * lanes and applies the results.
 */
import { CANONICAL_LIVE_SLOTS, laneSlotIndex } from './liveMidiMap'

export { CANONICAL_LIVE_SLOTS }

/** A canonical live-button slot, by name (order-independent — safe to persist). */
export type LiveSlotName = (typeof CANONICAL_LIVE_SLOTS)[number]

/** What a track's `liveSlot` may say: a slot name, or explicitly nothing. */
export type LiveSlotLink = LiveSlotName | 'none'

export const LIVE_SLOT_COUNT = CANONICAL_LIVE_SLOTS.length

/** Human labels for the slot picker. */
export const LIVE_SLOT_LABELS: Record<LiveSlotName, string> = {
  drums: 'Drums',
  bass: 'Bass',
  vocals: 'Vocals',
  other: 'Other',
  guitar: 'Guitar',
  fx: 'FX',
  click: 'Click',
  cue: 'Cue',
}

/** Is this a slot name we know? Narrows unknown persisted strings. */
export function isLiveSlotName(v: unknown): v is LiveSlotName {
  return typeof v === 'string' && (CANONICAL_LIVE_SLOTS as readonly string[]).includes(v)
}

/** Is this a valid persisted link value (`'none'` included)? */
export function isLiveSlotLink(v: unknown): v is LiveSlotLink {
  return v === 'none' || isLiveSlotName(v)
}

/** Slot index (0…7) for a slot name, or null if unknown. */
export function slotIndexByName(name: LiveSlotName): number {
  return (CANONICAL_LIVE_SLOTS as readonly string[]).indexOf(name)
}

/** Slot name at an index, or null when out of range. */
export function slotNameByIndex(index: number): LiveSlotName | null {
  return CANONICAL_LIVE_SLOTS[index] ?? null
}

/**
 * The slot a lane belongs to. An explicit `liveSlot` always wins — including
 * `'none'`, which removes a lane the filename guess would otherwise have
 * claimed. No setting falls back to the guess, so untouched songs are unchanged.
 */
export function resolveLaneSlot(key: string, liveSlot?: LiveSlotLink): number | null {
  if (liveSlot === 'none') return null
  if (liveSlot !== undefined && isLiveSlotName(liveSlot)) return slotIndexByName(liveSlot)
  return laneSlotIndex(key)
}

/**
 * What a lane's picker should SHOW: its explicit setting, or the slot the
 * filename guess landed on (so the UI reflects what is actually happening
 * rather than an empty box).
 */
export function effectiveSlotLink(key: string, liveSlot?: LiveSlotLink): LiveSlotLink {
  if (liveSlot !== undefined && isLiveSlotLink(liveSlot)) return liveSlot
  const guessed = laneSlotIndex(key)
  return guessed === null ? 'none' : (slotNameByIndex(guessed) ?? 'none')
}

/**
 * Group lanes into the 8 fixed slots. Each slot gets EVERY lane linked to it, in
 * the order given, so one button can move several tracks. Slots with no lanes
 * come back empty (the button stays dark).
 */
export function resolveLiveSlotLanes(
  lanes: readonly { key: string; liveSlot?: LiveSlotLink }[],
): string[][] {
  const slots: string[][] = Array.from({ length: LIVE_SLOT_COUNT }, () => [])
  for (const lane of lanes) {
    const slot = resolveLaneSlot(lane.key, lane.liveSlot)
    if (slot === null || slot < 0 || slot >= LIVE_SLOT_COUNT) continue
    slots[slot]!.push(lane.key)
  }
  return slots
}

/**
 * Pressing a button that drives several tracks: if ANY of them is currently
 * audible, the press turns them ALL off; otherwise it turns them ALL on. That
 * keeps a multi-track button behaving like the single toggle it looks like —
 * one press always changes something, and the group never splits.
 *
 * Returns the muted value to write to every lane in the group.
 */
export function nextGroupMuted(keys: readonly string[], isMuted: (key: string) => boolean): boolean {
  const anyAudible = keys.some((k) => !isMuted(k))
  return anyAudible
}

/** Is a slot's group considered ON for the LEDs? Yes when anything in it sounds. */
export function isGroupOn(keys: readonly string[], isMuted: (key: string) => boolean): boolean {
  return keys.some((k) => !isMuted(k))
}
