/**
 * A reverb effect for a `MixerBus`.
 *
 * Built as a SEND effect, which means one thing that matters: the chain is
 * 100% WET. The dry signal already reaches the master through the track's own
 * fader — mixing dry back in here would double it and make every track sound
 * louder the moment you send it anywhere.
 *
 *     input → pre-delay → damping lowpass → convolver → output
 *
 * The impulse is synthesized (decaying noise, stereo-decorrelated) rather than
 * loaded — no sample assets, no network, and it works offline. Same approach
 * `KeysSynth` uses for its own reverb, so the app has one idea of what a
 * reverb is.
 */
import type { MixerInsert } from './mixerEngine'

export type ReverbSettings = {
  /** Tail length in seconds. */
  sizeSec: number
  /** Lowpass on the way in — a dark tail sits behind the band, a bright one
   *  fights it. */
  dampHz: number
  /** Seconds before the tail starts; keeps transients clear. */
  preDelaySec: number
}

export const DEFAULT_REVERB: ReverbSettings = {
  sizeSec: 1.8,
  dampHz: 4200,
  preDelaySec: 0.02,
}

export const REVERB_PRESETS: { id: string; label: string; settings: ReverbSettings }[] = [
  { id: 'room', label: 'Room', settings: { sizeSec: 0.8, dampHz: 3600, preDelaySec: 0.008 } },
  { id: 'plate', label: 'Plate', settings: DEFAULT_REVERB },
  { id: 'hall', label: 'Hall', settings: { sizeSec: 3.4, dampHz: 5200, preDelaySec: 0.035 } },
]

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function normalizeReverb(s: Partial<ReverbSettings> | undefined): ReverbSettings {
  return {
    sizeSec: clamp(s?.sizeSec ?? DEFAULT_REVERB.sizeSec, 0.15, 8),
    dampHz: clamp(s?.dampHz ?? DEFAULT_REVERB.dampHz, 500, 16000),
    preDelaySec: clamp(s?.preDelaySec ?? DEFAULT_REVERB.preDelaySec, 0, 0.25),
  }
}

/**
 * Decaying-noise impulse. The two channels use independent noise so the tail
 * is wide rather than a mono blob pinned to the centre.
 */
export function buildImpulse(ctx: BaseAudioContext, sizeSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * sizeSec))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    // Deterministic per channel — renders and reloads must not drift.
    let seed = 0x9e3779b9 ^ (ch * 0x85ebca6b)
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < len; i++) {
      // Exponential decay; ^2.2 keeps the tail from sounding like a gated blast.
      data[i] = (rnd() * 2 - 1) * (1 - i / len) ** 2.2
    }
  }
  return buf
}

/**
 * Build the reverb chain. Returns the `MixerInsert` a `MixerBus` wants, plus an
 * `update` so the settings can be changed without rebuilding the graph (and
 * without the clicks that re-patching a live node causes).
 */
export function createReverbInsert(
  ctx: BaseAudioContext,
  settings: ReverbSettings = DEFAULT_REVERB,
): MixerInsert & { update: (s: ReverbSettings) => void } {
  const s = normalizeReverb(settings)
  const input = ctx.createGain()
  const preDelay = ctx.createDelay(0.5)
  preDelay.delayTime.value = s.preDelaySec
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = s.dampHz
  const convolver = ctx.createConvolver()
  convolver.normalize = true
  convolver.buffer = buildImpulse(ctx, s.sizeSec)
  const output = ctx.createGain()
  output.gain.value = 1

  input.connect(preDelay)
  preDelay.connect(damp)
  damp.connect(convolver)
  convolver.connect(output)

  let builtSize = s.sizeSec
  return {
    input,
    output,
    update(next: ReverbSettings) {
      const n = normalizeReverb(next)
      preDelay.delayTime.value = n.preDelaySec
      damp.frequency.value = n.dampHz
      // Rebuilding the impulse is the expensive part — only when size changed.
      if (n.sizeSec !== builtSize) {
        convolver.buffer = buildImpulse(ctx, n.sizeSec)
        builtSize = n.sizeSec
      }
    },
  }
}
