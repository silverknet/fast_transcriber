/**
 * WHICH LIVE BUTTONS START SWITCHED ON — project-wide.
 *
 * The stage has ten buttons: Drums, Bass, Vocals, Other, Guitar, FX, Click,
 * Cue, Custom 1, Custom 2. You link a mixer channel to one and that button is
 * what you press. This decides which of them a song opens with, for every song
 * in the project, so a whole set starts from one configuration rather than from
 * twenty songs' editing histories.
 *
 * ## Why this replaces the stem list
 *
 * `ProjectDefaults.liveStems` could only name the four Demucs stems. But the
 * things you actually switch on stage include a chord machine on Custom 1 and a
 * generated bass on Bass — neither of which is a stem — and the stem list had
 * no way to say "the chord machine starts off" or "no click in this set".
 *
 * ## Migration is a no-op, on purpose
 *
 * `liveSlots: undefined` reproduces the old behaviour EXACTLY: the stem slots
 * follow `liveStems` (or its legacy fallback), and every other button keeps the
 * hard-coded start it had. A project that never opens the new setting behaves
 * identically — which matters when the next gig is on Saturday.
 *
 * Setting `liveSlots` takes over completely. An EMPTY array means every button
 * starts off, which is a real choice and is preserved as one.
 *
 * ## What this does NOT decide
 *
 * Whether a song is silent. A song with nothing audible on a musical button
 * falls back to its full original mix — see `hasMusicalSlotLane`. And the
 * click's fail-closed gate still governs whether it can sound at all; this only
 * decides whether its button starts pressed.
 */
import { LIVE_SLOT_NAMES, type AutoStemName, type LiveSlotName } from '$lib/project/types'
import { audibleStemSet } from '$lib/audio/liveStemDefaults'

export { LIVE_SLOT_NAMES }
export type { LiveSlotName }

/** The four buttons that correspond to separated stems. */
const STEM_SLOTS: readonly LiveSlotName[] = ['drums', 'bass', 'vocals', 'other']

export function isStemSlot(name: LiveSlotName | null): name is AutoStemName {
  return name !== null && (STEM_SLOTS as readonly string[]).includes(name)
}

/**
 * Buttons that started ON before this setting existed, and still do when it is
 * unset.
 *
 * Click is here deliberately. It starts on for EVERY analysed song, never
 * inherited — the fix for "some songs have clicks, some don't", which tracked
 * nothing but each song's editing history and read as data corruption on a
 * stage. Guitar, FX and the two Custom buttons started audible because a lane
 * only reaches them by being LINKED, and linking is the admission.
 */
const NON_STEM_DEFAULT_ON: readonly LiveSlotName[] = [
  'guitar',
  'fx',
  'click',
  'cue',
  'custom1',
  'custom2',
]

/**
 * The set of buttons that start on.
 *
 * @param liveSlots the project's explicit choice, or `undefined`
 * @param liveStems the older stem-only setting, used only when `liveSlots` is
 *        unset so existing projects are unchanged
 */
export function audibleSlotSet(
  liveSlots: readonly LiveSlotName[] | undefined,
  liveStems: readonly AutoStemName[] | undefined,
): ReadonlySet<LiveSlotName> {
  if (liveSlots) return new Set(liveSlots)
  const stems = audibleStemSet(liveStems)
  return new Set<LiveSlotName>([
    ...STEM_SLOTS.filter((s) => (stems as readonly string[]).includes(s)),
    ...NON_STEM_DEFAULT_ON,
  ])
}

/** Does this button start switched on? */
export function slotStartsOn(
  name: LiveSlotName | null,
  liveSlots: readonly LiveSlotName[] | undefined,
  liveStems: readonly AutoStemName[] | undefined,
): boolean {
  if (name === null) return false
  return audibleSlotSet(liveSlots, liveStems).has(name)
}

/** Keep only real slot names, in canonical order, without duplicates. */
export function normalizeLiveSlots(raw: unknown): LiveSlotName[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  for (const v of raw) if (typeof v === 'string') seen.add(v)
  return LIVE_SLOT_NAMES.filter((n) => seen.has(n))
}
