/**
 * HOW A SONG ENDS, decided once.
 *
 * The Transition Lab has had five endings — clean cut, band hit, fill + hit,
 * filter dive, fade — implemented against its own private audio graph, where
 * they could be auditioned but never saved or played live. Live had only the
 * echo throw. Two implementations of "the ending" is how a preview and the real
 * thing drift apart, which on a stage means the rehearsal lied to you.
 *
 * So the DECISION lives here, as pure data: a recipe plus the song's timing in,
 * a list of timed actions out. Two thin executors run it — the lab's preview
 * graph and the live `MixerEngine` — and neither owns any musical judgement.
 * Same shape as `songPlaybackPlan`: one derivation, several consumers.
 *
 * Everything in and out is in MIXER-TIMELINE seconds. Converting to the
 * AudioContext clock is the executor's job, because only it knows when the
 * transport actually started.
 */
import type { ProjectTransitionEffect } from '$lib/project/types'
import type { DrumClass } from '$lib/songmap/types'

export type EndingAction =
  /**
   * Ramp the programme (every musical lane) to silence between two times.
   * A `cut` uses a few milliseconds of this purely to avoid a click; a `fade`
   * uses bars of it as the ending itself. Same action, different lengths —
   * there is no separate "de-click" concept to get out of step.
   */
  | { kind: 'programme-fade'; fromSec: number; toSec: number }
  /** One drum voice, at one time. The band hit is two of these. */
  | { kind: 'drum-hit'; cls: DrumClass; atSec: number; level: number }

export type EndingSchedule = {
  /** Mixer-timeline second the transport stops. */
  endSec: number
  /** Empty for `echo`, which is scheduled by its own effect-graph path. */
  actions: EndingAction[]
  /**
   * True when the engine's programmed-end stop is the whole ending. `echo`
   * hands off under its own tail instead and must not be stopped early.
   */
  stopsAtEnd: boolean
}

export type EndingTiming = {
  /** Where the song ends, in mixer-timeline seconds. */
  endMixerSec: number
  /** Local beat length near the ending — NOT the nominal BPM. */
  beatDurationSec: number
  /** Local bar length near the ending. */
  barDurationSec: number
}

const MIN_FADE_SEC = 0.008
const MAX_DECLICK_SEC = 0.5

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Turn an authored ending into timed actions.
 *
 * Never returns an action before 0 or after the ending: a fade longer than the
 * song simply starts at 0. Clamping here rather than in each executor means the
 * preview and the stage cannot disagree about the edge cases, which are exactly
 * the cases nobody rehearses.
 */
export function planEnding(
  effect: ProjectTransitionEffect,
  timing: EndingTiming,
): EndingSchedule {
  const endSec = Math.max(0, timing.endMixerSec)
  const beat = timing.beatDurationSec > 0 ? timing.beatDurationSec : 0.5
  const bar = timing.barDurationSec > 0 ? timing.barDurationSec : beat * 4

  if (effect.type === 'echo') {
    // The echo owns its own schedule (throw, capture, dry cut, tail) and hands
    // off under the tail. Stopping the transport at the anchor would cut the
    // very thing the ending is made of.
    return { endSec, actions: [], stopsAtEnd: false }
  }

  if (effect.type === 'cut') {
    const fadeSec = clamp(effect.cut.softnessMs / 1000, MIN_FADE_SEC, MAX_DECLICK_SEC)
    return {
      endSec,
      actions: [{ kind: 'programme-fade', fromSec: Math.max(0, endSec - fadeSec), toSec: endSec }],
      stopsAtEnd: true,
    }
  }

  if (effect.type === 'fade') {
    const fadeSec = Math.max(MIN_FADE_SEC, effect.fade.bars * bar)
    return {
      endSec,
      actions: [{ kind: 'programme-fade', fromSec: Math.max(0, endSec - fadeSec), toSec: endSec }],
      stopsAtEnd: true,
    }
  }

  // Band hit: the backing stops dead under the hit, and kick + crash land
  // together ON the anchor. The hit is the ending, so it is not faded with the
  // programme — it rings out past `endSec` on its own lane.
  const fadeSec = clamp(effect.hit.softnessMs / 1000, MIN_FADE_SEC, MAX_DECLICK_SEC)
  const actions: EndingAction[] = [
    { kind: 'programme-fade', fromSec: Math.max(0, endSec - fadeSec), toSec: endSec },
  ]
  if (effect.hit.kickLevel > 0) {
    actions.push({ kind: 'drum-hit', cls: 'kick', atSec: endSec, level: effect.hit.kickLevel })
  }
  if (effect.hit.crashLevel > 0) {
    actions.push({ kind: 'drum-hit', cls: 'cymbal', atSec: endSec, level: effect.hit.crashLevel })
  }
  return { endSec, actions, stopsAtEnd: true }
}

/** Sensible starting parameters for a newly chosen ending type. */
export function defaultEndingEffect(type: ProjectTransitionEffect['type']): ProjectTransitionEffect | null {
  if (type === 'cut') return { type: 'cut', cut: { softnessMs: 18 } }
  if (type === 'hit') return { type: 'hit', hit: { kickLevel: 0.9, crashLevel: 0.7, softnessMs: 24 } }
  if (type === 'fade') return { type: 'fade', fade: { bars: 2 } }
  return null // echo has too many parameters to guess; the lab owns its defaults
}
