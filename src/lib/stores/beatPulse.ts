/**
 * Re-exports `uiAnimations` plus a derived `beatPulse` store for legacy imports.
 * Prefer importing from `$lib/stores/uiAnimations` in new code.
 */
import { derived } from 'svelte/store'
import { uiAnimations } from './uiAnimations'

export {
  uiAnimations,
  triggerUiAnimation,
  triggerBeatPulse,
  setAnalyzingSpin,
  type BeatPulseState,
  type UiAnimationKind,
  type UiAnimationsState,
} from './uiAnimations'

/** Same `{ n, accent }` shape as before — mirrors `uiAnimations.beatPulse`. */
export const beatPulse = derived(uiAnimations, ($u) => $u.beatPulse)
