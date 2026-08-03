/**
 * What the rig indicator in the navbar is showing.
 *
 * Written ONLY by the XR18 panel, which is the one place that talks to the desk
 * and therefore the one place that knows anything first-hand. Everything here
 * is evidence the desk actually provided — see `rigHealth.ts` for why nothing
 * may be inferred.
 *
 * Reset on disconnect rather than left stale: a green light describing a desk
 * that is no longer there is worse than no light.
 */
import { writable } from 'svelte/store'
import type { RigHealthInput } from '$lib/hardware/rigHealth'

export const UNKNOWN_RIG: RigHealthInput = {
  deskIdentified: false,
  deskLabel: null,
  usbInputOk: null,
  fohSafe: null,
  monitorsConfigured: 0,
}

export const rigStatus = writable<RigHealthInput>({ ...UNKNOWN_RIG })

/** Merge in whatever was just learned, leaving the rest untouched. */
export function reportRigStatus(patch: Partial<RigHealthInput>): void {
  rigStatus.update((s) => ({ ...s, ...patch }))
}

/** The desk is gone — forget everything, do not leave a stale verdict up. */
export function clearRigStatus(): void {
  rigStatus.set({ ...UNKNOWN_RIG })
}
