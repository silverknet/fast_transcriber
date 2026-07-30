/**
 * A delay effect for a `MixerBus`.
 *
 * Send effect, so like the reverb it is 100% WET — the dry signal already
 * reaches the master through the channel's own fader.
 *
 *     input → delay → feedback loop (through a damping lowpass) → output
 *
 * The feedback path is filtered rather than raw: undamped repeats stay just as
 * bright as the source and quickly turn to hash, while each repeat losing a
 * little top end is what makes an echo sit behind the band.
 */
import type { MixerInsert } from './mixerEngine'

export type DelaySettings = {
  /** Delay time in seconds. */
  timeSec: number
  /** 0..0.9 — how much of the output feeds back in. */
  feedback: number
  /** Lowpass in the feedback path; each repeat gets darker. */
  dampHz: number
}

export const DEFAULT_DELAY: DelaySettings = {
  timeSec: 0.3,
  feedback: 0.35,
  dampHz: 3200,
}

export const DELAY_PRESETS: { id: string; label: string; settings: DelaySettings }[] = [
  { id: 'slap', label: 'Slap', settings: { timeSec: 0.11, feedback: 0.12, dampHz: 4000 } },
  { id: 'eighth', label: 'Echo', settings: DEFAULT_DELAY },
  { id: 'long', label: 'Long', settings: { timeSec: 0.6, feedback: 0.55, dampHz: 2400 } },
]

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function normalizeDelay(s: Partial<DelaySettings> | undefined): DelaySettings {
  return {
    timeSec: clamp(s?.timeSec ?? DEFAULT_DELAY.timeSec, 0.02, 2),
    // Capped below 1 — at or above unity the loop never decays and the bus
    // runs away into feedback howl.
    feedback: clamp(s?.feedback ?? DEFAULT_DELAY.feedback, 0, 0.9),
    dampHz: clamp(s?.dampHz ?? DEFAULT_DELAY.dampHz, 500, 16000),
  }
}

export function createDelayInsert(
  ctx: BaseAudioContext,
  settings: DelaySettings = DEFAULT_DELAY,
): MixerInsert & { update: (s: DelaySettings) => void } {
  const s = normalizeDelay(settings)
  const input = ctx.createGain()
  const delay = ctx.createDelay(2.5)
  delay.delayTime.value = s.timeSec
  const feedback = ctx.createGain()
  feedback.gain.value = s.feedback
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = s.dampHz
  const output = ctx.createGain()

  input.connect(delay)
  delay.connect(damp)
  damp.connect(feedback)
  feedback.connect(delay) // the loop
  delay.connect(output)

  return {
    input,
    output,
    update(next: DelaySettings) {
      const n = normalizeDelay(next)
      delay.delayTime.value = n.timeSec
      feedback.gain.value = n.feedback
      damp.frequency.value = n.dampHz
    },
  }
}
