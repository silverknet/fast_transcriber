/**
 * Which mixer tracks a live button toggles.
 *
 * The 10 live pads (bottom APC row plus the first two pads above it) are FIXED
 * canonical slots — button 0 is Drums in every song, whether or not that song
 * has drums. The 8 track buttons mirror the bottom 8 pads. Historically the
 * lane→slot mapping was a filename guess
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
import { audibleStemSet } from '$lib/audio/liveStemDefaults'
import type { AutoStemName } from '$lib/project/types'
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
  custom1: 'Custom 1',
  custom2: 'Custom 2',
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
 * Group lanes into the 10 fixed slots. Each slot gets EVERY lane linked to it, in
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

// ── What a lane starts muted as, on stage ──────────────────────────────────

/** The Demucs slots — the only ones the project's standard-stem set can name. */
const DEMUCS_SLOTS = ['drums', 'bass', 'vocals', 'other'] as const
function isDemucsSlot(name: LiveSlotName | null): name is AutoStemName {
  return name !== null && (DEMUCS_SLOTS as readonly string[]).includes(name)
}

/**
 * Should this lane start MUTED when a song opens in live / playback mode?
 *
 * Decided by the lane's SLOT, never by its filename and never by the arranging
 * mixer's mute. Linking a channel to a live button is a statement that the
 * button owns it on stage; inheriting the arranging mute meant a linked track
 * stayed silent with its button lit — the screen and the sound disagreeing.
 *
 *   - linked to a Demucs slot → audible iff the project calls that stem standard
 *   - linked to guitar / FX / Custom → audible; the only way a lane lands there
 *                                      is that someone linked it deliberately
 *   - linked to cue           → audible (spoken cues are on by default live)
 *   - linked to click         → left alone; the transport's Click control owns it
 *   - not linked at all       → left alone (machines, the full mix, extra takes)
 *
 * `original` (the full mix) is the one special case, and the rule is about what
 * the song HAS, not about what is currently switched on: if any musical slot
 * holds a lane, the buttons own the sound and the full mix stays muted for the
 * whole song. Turning every button off then means SILENCE, which is what a
 * mute button has to mean — previously `original` was left audible whenever the
 * project's standard stems happened not to match this song, so it played
 * underneath the stems and kept playing with everything switched off.
 *
 * A song with no musical slot lanes at all still plays its full mix, otherwise
 * it would be unusable on stage.
 */
export function liveInitialMuted(opts: {
  key: string
  liveSlot?: LiveSlotLink
  savedMuted: boolean
  liveStems: readonly AutoStemName[] | undefined
  /** Does this song have ANY lane on a musical button? See above. */
  hasMusicalSlotLane: boolean
}): boolean {
  const { key, liveSlot, savedMuted, liveStems, hasMusicalSlotLane } = opts
  const slot = resolveLaneSlot(key, liveSlot)
  if (slot !== null) {
    const name = slotNameByIndex(slot)
    if (name === 'cue') return false
    // The click starts ON for EVERY analysed song in live — deterministic,
    // never inherited. It used to return `savedMuted`, the click state left
    // over from EDITING that song — so across a set, some songs clicked and
    // some didn't, tracking nothing but each song's editing history. On a
    // stage that reads as data corruption ("some songs have clicks, some
    // don't"). Whether the click SOUNDS is governed live by the fail-closed
    // gate and the click pill — a per-show decision, not twenty saved ones.
    if (name === 'click') return false
    if (isDemucsSlot(name)) return !audibleStemSet(liveStems).includes(name)
    return false // guitar / fx / custom — linked on purpose
  }
  if (key === 'original') return hasMusicalSlotLane
  // NOT LINKED TO ANY BUTTON → NOT IN THE SHOW. Fail closed.
  //
  // This used to return `savedMuted` — the lane's mute from the ARRANGING
  // mixer — which is mute-as-admission, the exact failure the live-audio
  // architecture names first: a detected-bass render or machine lane that was
  // audible while editing kept sounding on stage, with all live buttons
  // OFF and nothing anywhere to silence it. "All stems off" must mean silence;
  // a lane nobody linked to a button has no control surface in live, and a
  // sound with no control on a stage is a fault, not a feature. Anyone who
  // wants a machine in the show links it to a button — that IS the admission.
  return true
}

/** The slots that carry the SONG. Click and cue are not substitutes for it. */
const MUSICAL_SLOTS: readonly LiveSlotName[] = [
  'drums',
  'bass',
  'vocals',
  'other',
  'guitar',
  'fx',
  'custom1',
  'custom2',
]

/**
 * Does this song have at least one lane on a musical button? When true the
 * buttons own the sound and the full mix stands down — so switching every
 * button off is silence rather than the whole song coming back.
 */
export function hasMusicalSlotLane(slotLanes: readonly (readonly string[])[]): boolean {
  return MUSICAL_SLOTS.some((name) => (slotLanes[slotIndexByName(name)] ?? []).length > 0)
}

// ── The one live view: on-screen pills, APC LEDs and pad presses ────────────

/** What the caller knows about a lane. `muted`/`active` come from the engine. */
export interface LiveLaneState {
  key: string
  muted: boolean
  /** Currently sounding (playing, unmuted, not solo-excluded). Drives the glow. */
  active: boolean
  color: string
}

/** One canonical slot, resolved. Index in the array IS the button number. */
export interface LiveSlotView {
  slot: number
  name: LiveSlotName | null
  label: string
  /** Every lane linked to this slot that exists in this song. */
  keys: string[]
  /** False when nothing in this song is linked here — the button stays dark. */
  present: boolean
  on: boolean
  active: boolean
  color: string
  /** >1 when one button drives a group (e.g. drums + percussion). */
  count: number
  kind: 'stem' | 'cue' | 'click'
}

/**
 * Resolve the 10 canonical slots ONCE, for every consumer.
 *
 * The screen's stem pills, the APC's LEDs and the pad/track-button presses all
 * read this. They used to derive their own lists — the stage row rendered every
 * mixer lane in mixer order while the buttons drove the slots — so the screen
 * showed machine lanes the controller had no button for, in a different order.
 * Sharing one resolution makes that class of drift impossible rather than
 * merely fixed.
 *
 * Always returns exactly {@link LIVE_SLOT_COUNT} entries, present or not, so a
 * given instrument is always the same button number: slot 2 is Vocals whether
 * or not this song has vocals.
 */
export function buildLiveSlotViews(
  slotLanes: readonly (readonly string[])[],
  laneState: readonly LiveLaneState[],
): LiveSlotView[] {
  const byKey = new Map(laneState.map((l) => [l.key, l]))
  const views: LiveSlotView[] = []
  for (let slot = 0; slot < LIVE_SLOT_COUNT; slot++) {
    const name = slotNameByIndex(slot)
    // Only lanes that actually exist in this song can light a button.
    const keys = (slotLanes[slot] ?? []).filter((k) => byKey.has(k))
    const lead = keys.length > 0 ? byKey.get(keys[0]!) : undefined
    views.push({
      slot,
      name,
      label: name ? LIVE_SLOT_LABELS[name] : String(slot + 1),
      keys,
      present: keys.length > 0,
      on: keys.some((k) => !byKey.get(k)!.muted),
      active: keys.some((k) => byKey.get(k)!.active),
      color: lead?.color ?? 'transparent',
      count: keys.length,
      kind: name === 'click' ? 'click' : name === 'cue' ? 'cue' : 'stem',
    })
  }
  return views
}
