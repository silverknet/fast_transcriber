/**
 * The timer's sound: a closing-in tick, and a bell when it lands.
 *
 * Standalone by design — its own `AudioContext`, no shared audio device, no
 * `$lib` imports. Nothing here touches the app's playback engine, so this route
 * can run (or be deleted) without any effect on the mixer.
 *
 * Everything is scheduled AHEAD on the audio clock rather than fired from a
 * `setInterval`: the last five seconds tick four times a second, which is
 * exactly where timer drift would be audible.
 */
import { tickIntensity, tickTimes, TIMER_SECONDS } from './timerModel'

export type TimerSound = {
  /** Context time the run started — the visual clock reads from this too. */
  startedAt: number
  ctx: AudioContext
  stop: () => void
}

/**
 * One clock tick: a very short filtered noise blip.
 *
 * `intensity` opens the filter and lifts the level together, so a late tick is
 * not just louder but brighter and harder — the difference between a build and
 * a volume knob.
 */
export function scheduleTick(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  intensity: number,
): void {
  const dur = 0.035
  const frames = Math.max(1, Math.ceil(dur * ctx.sampleRate))
  const noise = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = noise.getChannelData(0)
  // Seeded so every run of the timer sounds identical.
  let seed = 0x9e3779b9 ^ Math.round(at * 1000)
  for (let i = 0; i < frames; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    data[i] = (seed / 0xffffffff) * 2 - 1
  }

  const src = ctx.createBufferSource()
  src.buffer = noise

  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1600 + 2600 * intensity
  band.Q.value = 1.6

  const env = ctx.createGain()
  const peak = 0.12 + 0.5 * intensity
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(peak, at + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur)

  src.connect(band)
  band.connect(env)
  env.connect(out)
  src.start(at)
  src.stop(at + dur)
}

/**
 * The bell. Inharmonic partials, because that is what makes a bell a bell
 * rather than an organ — a harmonic stack reads as a note, not a strike.
 */
const BELL_FUNDAMENTAL_HZ = 660
/**
 * Classic bell-ish ratios — hum, prime, tierce, quint, nominal and two above.
 * The long decays are the point: a timer bell has to still be ringing a second
 * or two after it lands, or it reads as a blip and you miss it.
 */
const BELL_PARTIALS: { ratio: number; level: number; decay: number }[] = [
  { ratio: 0.5, level: 0.35, decay: 5.5 },
  { ratio: 1, level: 1, decay: 5.0 },
  { ratio: 1.2, level: 0.6, decay: 4.0 },
  { ratio: 1.5, level: 0.45, decay: 3.2 },
  { ratio: 2, level: 0.35, decay: 2.4 },
  { ratio: 2.67, level: 0.2, decay: 1.6 },
  { ratio: 3.4, level: 0.12, decay: 1.1 },
]
const BELL_LEVEL = 0.26

/** Total time the bell needs before its context can be released. */
export const BELL_TAIL_SEC = Math.max(...BELL_PARTIALS.map((p) => p.decay)) + 0.1

export function scheduleBell(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  for (const p of BELL_PARTIALS) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = BELL_FUNDAMENTAL_HZ * p.ratio
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(p.level * BELL_LEVEL, at + 0.004)
    env.gain.exponentialRampToValueAtTime(0.0001, at + p.decay)
    osc.connect(env)
    env.connect(out)
    osc.start(at)
    osc.stop(at + p.decay + 0.05)
  }

  // The strike: a click of noise so the bell has an attack, not just a swell.
  scheduleTick(ctx, out, at, 1)
}

/**
 * Start the run: pre-schedule every tick and the closing bell.
 *
 * Must be called from a user gesture — the `AudioContext` is created here, and
 * a browser will keep it suspended otherwise.
 */
export function startTimerSound(): TimerSound {
  const Ctor: typeof AudioContext =
    (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
    (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctor()
  void ctx.resume().catch(() => {})

  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)

  // A little ahead of `currentTime`, so the first tick is not already late.
  const startedAt = ctx.currentTime + 0.06

  for (const t of tickTimes()) scheduleTick(ctx, master, startedAt + t, tickIntensity(t))
  scheduleBell(ctx, master, startedAt + TIMER_SECONDS)

  return {
    startedAt,
    ctx,
    stop: () => {
      // Cutting a scheduled run means dropping the context: individual sources
      // are already committed to the clock and cannot be un-scheduled cleanly.
      try {
        master.gain.cancelScheduledValues(ctx.currentTime)
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
        master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.05)
      } catch {
        /* already gone */
      }
      setTimeout(() => void ctx.close().catch(() => {}), 120)
    },
  }
}
