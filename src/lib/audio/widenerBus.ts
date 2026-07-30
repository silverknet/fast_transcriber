/**
 * A stereo WIDENER for a `MixerBus` — a chorus/ensemble that makes a flat,
 * centred backing track sound like a band spread across a stage.
 *
 * Send effect, so 100% WET: the dry channel already reaches the master through
 * its own fader, and what this bus returns is the extra width around it.
 *
 *     in → LOW GUARD (highpass) ─┬─► delayL (base + LFO) → pan L ─┐
 *                                └─► delayR (base + LFO) → pan R ─┴─► M/S width → out
 *
 * Two things make it work on BASS and DRUMS, where naive widening usually falls
 * apart:
 *
 * 1. **The low guard.** Everything below `monoBelowHz` is removed from the wet
 *    path entirely, so the kick and the bass fundamental reach the master only
 *    through the dry channel — mono, centred and exactly as punchy as before.
 *    Modulated delay on low frequencies is what makes a chorused bass sound
 *    flabby and lose the room; skipping the lows is the whole trick. Width lives
 *    in the harmonics above it, which is where the ear locates a sound anyway.
 *
 * 2. **Opposed modulation.** The two delay lines are swept by LFOs at different
 *    rates and in opposite directions, so the left and right sides are never the
 *    same signal. That difference IS the stereo image — matched delays would
 *    just sum back to the centre.
 *
 * A final mid/side stage scales the difference between the sides, so `width`
 * pushes the image out past the speakers or reins it back in.
 *
 * MONO COMPATIBILITY: pushing `width` well above 1 makes the sides increasingly
 * out-of-phase, and a mono PA sums them toward cancellation. The low guard means
 * the bass never cancels — but keep `width` near 1 if the room might be mono.
 */
import type { MixerInsert } from './mixerEngine'

export type WidenerSettings = {
  /** Sweep speed in Hz. Slow = lush ensemble, fast = vibrato/shimmer. */
  rateHz: number
  /** Sweep amount, 0..1. How far the delay lines move. */
  depth: number
  /** Nothing below this is widened — keeps kick and bass mono and punchy. */
  monoBelowHz: number
  /** Stereo spread, 0..2. 1 = natural, >1 pushes past the speakers. */
  width: number
}

export const DEFAULT_WIDENER: WidenerSettings = {
  rateHz: 0.5,
  depth: 0.45,
  monoBelowHz: 140,
  width: 1.2,
}

export const WIDENER_PRESETS: { id: string; label: string; settings: WidenerSettings }[] = [
  // Slow and deep — the classic "alive" chorus, best on a synth bass or a pad.
  { id: 'ensemble', label: 'Ensemble', settings: DEFAULT_WIDENER },
  // Barely moving, very wide: size without any audible warble. Safest on drums,
  // where a fast sweep smears the transients.
  { id: 'wide', label: 'Wide', settings: { rateHz: 0.15, depth: 0.28, monoBelowHz: 160, width: 1.6 } },
  // Fast and shallow — air and sparkle up top; the low guard sits higher so it
  // only touches cymbals and the top of the snare.
  { id: 'shimmer', label: 'Shimmer', settings: { rateHz: 1.6, depth: 0.22, monoBelowHz: 400, width: 1.3 } },
]

/** Base delay per side, seconds. Different lengths keep the sides uncorrelated. */
const BASE_DELAY_L = 0.013
const BASE_DELAY_R = 0.019
/** Sweep at depth = 1, seconds. Beyond this a chorus turns into seasickness. */
const MAX_SWEEP = 0.005
/** The right LFO runs slightly faster so the two never lock into one motion. */
const RATE_SKEW = 1.31

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function normalizeWidener(s: Partial<WidenerSettings> | undefined): WidenerSettings {
  return {
    rateHz: clamp(s?.rateHz ?? DEFAULT_WIDENER.rateHz, 0.02, 8),
    depth: clamp(s?.depth ?? DEFAULT_WIDENER.depth, 0, 1),
    // Floor at 20 Hz rather than 0: a widener with no low guard is the exact
    // failure mode this effect exists to avoid.
    monoBelowHz: clamp(s?.monoBelowHz ?? DEFAULT_WIDENER.monoBelowHz, 20, 2000),
    width: clamp(s?.width ?? DEFAULT_WIDENER.width, 0, 2),
  }
}

export function createWidenerInsert(
  ctx: BaseAudioContext,
  settings: WidenerSettings = DEFAULT_WIDENER,
): MixerInsert & { update: (s: WidenerSettings) => void } {
  const s = normalizeWidener(settings)

  const input = ctx.createGain()

  // ── Low guard: the wet path never carries the bottom end ──────────────────
  // TWO cascaded stages (24 dB/oct). One 12 dB/oct stage leaves roughly -18 dB
  // of the fundamental an octave and a half down — quiet, but still enough
  // modulated low end to smear the bass. Measured: a single stage let ~13% of a
  // 50 Hz tone through a 140 Hz guard; two stages drop that to ~2%.
  const guard = ctx.createBiquadFilter()
  guard.type = 'highpass'
  guard.frequency.value = s.monoBelowHz
  guard.Q.value = 0.707 // Butterworth — flat above the corner, no resonant bump
  const guard2 = ctx.createBiquadFilter()
  guard2.type = 'highpass'
  guard2.frequency.value = s.monoBelowHz
  guard2.Q.value = 0.707
  input.connect(guard)
  guard.connect(guard2)

  // ── Two modulated delay lines, swept in opposite directions ───────────────
  const delayL = ctx.createDelay(0.1)
  delayL.delayTime.value = BASE_DELAY_L
  const delayR = ctx.createDelay(0.1)
  delayR.delayTime.value = BASE_DELAY_R
  guard2.connect(delayL)
  guard2.connect(delayR)

  const lfoL = ctx.createOscillator()
  lfoL.type = 'sine'
  lfoL.frequency.value = s.rateHz
  const lfoR = ctx.createOscillator()
  lfoR.type = 'sine'
  lfoR.frequency.value = s.rateHz * RATE_SKEW

  const lfoGainL = ctx.createGain()
  lfoGainL.gain.value = s.depth * MAX_SWEEP
  // Negative depth on the right = opposite sweep. When one side lengthens the
  // other shortens, which is what pushes the image apart.
  const lfoGainR = ctx.createGain()
  lfoGainR.gain.value = -s.depth * MAX_SWEEP

  lfoL.connect(lfoGainL)
  lfoGainL.connect(delayL.delayTime)
  lfoR.connect(lfoGainR)
  lfoGainR.connect(delayR.delayTime)
  lfoL.start(0)
  lfoR.start(0)

  const panL = ctx.createStereoPanner()
  panL.pan.value = -1
  const panR = ctx.createStereoPanner()
  panR.pan.value = 1
  delayL.connect(panL)
  delayR.connect(panR)

  const spread = ctx.createGain()
  panL.connect(spread)
  panR.connect(spread)

  // ── Mid/side width ────────────────────────────────────────────────────────
  // M = (L+R)/2, S = (L-R)/2; out = M ± S*width. Scaling S alone changes how
  // different the two sides are — i.e. how wide it sounds — without touching
  // what they share.
  const splitter = ctx.createChannelSplitter(2)
  spread.connect(splitter)

  const mid = ctx.createGain()
  mid.gain.value = 1
  const side = ctx.createGain()
  side.gain.value = s.width

  const lToMid = ctx.createGain()
  lToMid.gain.value = 0.5
  const rToMid = ctx.createGain()
  rToMid.gain.value = 0.5
  const lToSide = ctx.createGain()
  lToSide.gain.value = 0.5
  const rToSide = ctx.createGain()
  rToSide.gain.value = -0.5

  splitter.connect(lToMid, 0)
  splitter.connect(rToMid, 1)
  splitter.connect(lToSide, 0)
  splitter.connect(rToSide, 1)
  lToMid.connect(mid)
  rToMid.connect(mid)
  lToSide.connect(side)
  rToSide.connect(side)

  const sideToL = ctx.createGain()
  sideToL.gain.value = 1
  const sideToR = ctx.createGain()
  sideToR.gain.value = -1
  side.connect(sideToL)
  side.connect(sideToR)

  const merger = ctx.createChannelMerger(2)
  mid.connect(merger, 0, 0)
  sideToL.connect(merger, 0, 0)
  mid.connect(merger, 0, 1)
  sideToR.connect(merger, 0, 1)

  const output = ctx.createGain()
  merger.connect(output)

  return {
    input,
    output,
    update(next: WidenerSettings) {
      const n = normalizeWidener(next)
      guard.frequency.value = n.monoBelowHz
      guard2.frequency.value = n.monoBelowHz
      lfoL.frequency.value = n.rateHz
      lfoR.frequency.value = n.rateHz * RATE_SKEW
      lfoGainL.gain.value = n.depth * MAX_SWEEP
      lfoGainR.gain.value = -n.depth * MAX_SWEEP
      side.gain.value = n.width
    },
  }
}
