/**
 * "Put the stem faders back to unity."
 *
 * Before loudness matching existed, the only way to stop one song's drums
 * burying its bass was to ride the faders per song — so a project accumulates
 * hand-compensation (drums at 1.50 here, bass at 1.14 there) for material that
 * was simply mastered at different levels.
 *
 * Turning matching on fixes the cause, which makes that old compensation
 * DOUBLE: matching pulls the loud stem down, then the fader pulls it down
 * again. This finds exactly those faders so they can be cleared in one move.
 *
 * TWO THINGS IT REFUSES TO TOUCH, both because they are decisions rather than
 * compensation:
 *
 *   - lanes that are not programme material (the full mix, click, cues);
 *   - any role built from SEVERAL audible lanes. When drums are the separated
 *     stem plus a drum machine, the balance between them is a mix the user
 *     made on purpose, and flattening both to unity would both change that
 *     blend and make the role ~3 dB louder. Those are reported instead.
 */
import type { AutoStemName } from '$lib/project/types'
import { lanesByRole, roleForLaneKey, stackedRoles, type RoleLane } from './stemRoles'

export type FaderLane = RoleLane

/** Unity: the fader is doing nothing, which is what matching wants underneath it. */
export const UNITY = 1

/** How far from unity still counts as "the user meant that". */
const EPS = 0.005

export type FaderResetPlan = {
  /** Lane keys to set back to unity. */
  reset: string[]
  /** Roles left alone because several audible lanes build them. */
  skippedRoles: AutoStemName[]
  /** One sentence for the button/report. */
  summary: string
}

/**
 * What a reset would do, without doing it. The UI shows `summary` before the
 * press and the same function performs it, so the promise and the act cannot
 * describe different things.
 */
export function planFaderReset(lanes: readonly FaderLane[]): FaderResetPlan {
  const skippedRoles = stackedRoles(lanes)
  const skipped = new Set<AutoStemName>(skippedRoles)
  const byRole = lanesByRole(lanes)

  const reset: string[] = []
  for (const [role, list] of byRole) {
    if (skipped.has(role)) continue
    for (const lane of list) {
      if (Math.abs(lane.volume - UNITY) > EPS) reset.push(lane.key)
    }
  }
  // Muted stem lanes still carry old compensation; clear those too, as long as
  // their role is not one of the stacked ones.
  for (const lane of lanes) {
    if (reset.includes(lane.key)) continue
    const role = roleForLaneKey(lane.key)
    if (!role || skipped.has(role)) continue
    if (Math.abs(lane.volume - UNITY) > EPS) reset.push(lane.key)
  }

  const parts: string[] = []
  if (reset.length > 0) {
    parts.push(`Reset ${reset.length} stem fader${reset.length === 1 ? '' : 's'} to unity`)
  } else {
    parts.push('Stem faders are already at unity')
  }
  if (skippedRoles.length > 0) {
    parts.push(
      `leaving ${skippedRoles.join(' and ')} alone — you have blended more than one lane there, and that balance is yours`,
    )
  }
  return { reset, skippedRoles, summary: parts.join(', ') }
}
