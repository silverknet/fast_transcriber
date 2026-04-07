import { writable } from 'svelte/store'

/** One-shot transport / grid hit flash (see `barbro-beat-pulse-*` in app.css). */
export type BeatPulseState = {
  n: number
  accent: boolean
}

/** Kinds of global layout animations (CSS keyed by `{#key}` remounts). */
export type UiAnimationKind = 'beatPulse' | 'blobOrbit'

export type UiAnimationsState = {
  beatPulse: BeatPulseState
  /** Remounts the gradient blob orbits (`barbro-blob-orbit` in app.css). */
  blobOrbit: { n: number }
  /** Slow continuous rotation of the blob cluster (e.g. while `/api/analyze` runs). */
  analyzingSpin: boolean
}

const initial: UiAnimationsState = {
  beatPulse: { n: 0, accent: false },
  blobOrbit: { n: 0 },
  analyzingSpin: false,
}

export const uiAnimations = writable<UiAnimationsState>(initial)

/**
 * Fire a global layout animation. Each call bumps the kind’s counter so `{#key}` blocks remount
 * and CSS animations run again.
 */
export function triggerUiAnimation(kind: 'beatPulse', opts: { accent: boolean }): void
export function triggerUiAnimation(kind: 'blobOrbit'): void
export function triggerUiAnimation(kind: UiAnimationKind, opts?: { accent?: boolean }): void {
  uiAnimations.update((s) => {
    if (kind === 'beatPulse') {
      return {
        ...s,
        beatPulse: { n: s.beatPulse.n + 1, accent: opts?.accent ?? false },
      }
    }
    return {
      ...s,
      blobOrbit: { n: s.blobOrbit.n + 1 },
    }
  })
}

/** Same as `triggerUiAnimation('beatPulse', { accent })` — used from the editor transport. */
export function triggerBeatPulse(accent: boolean) {
  triggerUiAnimation('beatPulse', { accent })
}

export function setAnalyzingSpin(active: boolean) {
  uiAnimations.update((s) => ({ ...s, analyzingSpin: active }))
}
