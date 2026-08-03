/**
 * Test signals for wiring up a desk.
 *
 * This exists to answer one question at a time with your ears and the desk's
 * own meters: *is signal arriving, and on which side?* So the generator is
 * deliberately boring — a steady tone, or slow pulses, on a chosen side, at a
 * level you can trust.
 *
 * ## Safety is the whole design
 *
 * This runs into in-ear monitors and headphone outputs, sometimes on someone
 * else's head. Three rules follow from that:
 *
 * 1. **Conservative by default.** −20 dBFS is plenty to move a meter and to
 *    hear clearly; it is nowhere near enough to hurt anyone.
 * 2. **A hard ceiling.** {@link MAX_TEST_LEVEL_DB} is enforced here, not in the
 *    UI, so no caller can ask for more by passing a bad number.
 * 3. **Ramped, never switched.** A tone that starts or stops instantly is a
 *    click through the whole PA. Every start and stop is ramped.
 *
 * Pulses are the better default for wiring: a continuous tone quickly stops
 * registering as "sound arriving now", and it fatigues the listener.
 */

/** Where the signal is sent. Identifying L vs R is most of the job. */
export type TestSide = 'left' | 'right' | 'both'

/** −20 dBFS: clearly audible, clearly safe. */
export const DEFAULT_TEST_LEVEL_DB = -20
/** Nothing may exceed this, whatever a caller passes. */
export const MAX_TEST_LEVEL_DB = -6
export const MIN_TEST_LEVEL_DB = -60

/** 1 kHz — where meters are calibrated and hearing is most sensitive. */
export const DEFAULT_TEST_FREQ_HZ = 1000

const RAMP_SEC = 0.02
const PULSE_ON_SEC = 0.25
const PULSE_PERIOD_SEC = 1

export type TestSignalOptions = {
  side?: TestSide
  levelDb?: number
  freqHz?: number
  /** Slow pulses (default) read as "arriving now"; a steady tone can be ignored. */
  pulsed?: boolean
}

export type RigTestSignal = {
  /** Change side/level/frequency without restarting — no click, no gap. */
  update: (opts: TestSignalOptions) => void
  /** Ramp down and release the nodes. Safe to call twice. */
  stop: () => void
  readonly running: boolean
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

/** Clamp into the safe window. Exported so the UI can show the real bounds. */
export function clampTestLevelDb(db: number): number {
  if (!Number.isFinite(db)) return DEFAULT_TEST_LEVEL_DB
  return Math.max(MIN_TEST_LEVEL_DB, Math.min(MAX_TEST_LEVEL_DB, db))
}

/** Per-side gains for a side choice. */
export function sideGains(side: TestSide): { left: number; right: number } {
  if (side === 'left') return { left: 1, right: 0 }
  if (side === 'right') return { left: 0, right: 1 }
  return { left: 1, right: 1 }
}

/**
 * Start a test signal on `ctx`, landing on `destination`.
 *
 * The caller owns the context — on the live path that is the app's shared
 * device, so this cannot add to the browser's hardware-context budget.
 */
export function startRigTestSignal(
  ctx: BaseAudioContext,
  destination: AudioNode,
  opts: TestSignalOptions = {},
): RigTestSignal {
  const now = ctx.currentTime
  let stopped = false

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = opts.freqHz ?? DEFAULT_TEST_FREQ_HZ

  /** Master level, ramped so nothing ever clicks. */
  const level = ctx.createGain()
  level.gain.value = 0

  /** Pulse envelope — held open when not pulsing. */
  const pulse = ctx.createGain()
  pulse.gain.value = 1

  // Seeded from the requested side rather than defaulting to 1 and ramping:
  // `setTargetAtTime` only APPROACHES its target, so a right gain starting at 1
  // leaks audibly while it decays — which defeats the whole point of a
  // left-only test.
  const initial = sideGains(opts.side ?? 'both')
  const leftGain = ctx.createGain()
  leftGain.gain.value = initial.left
  const rightGain = ctx.createGain()
  rightGain.gain.value = initial.right
  const merger = ctx.createChannelMerger(2)

  //   osc -> pulse (envelope) -> level (master) -> L/R gains -> merger -> out
  osc.connect(pulse)
  pulse.connect(level)
  level.connect(leftGain)
  level.connect(rightGain)
  leftGain.connect(merger, 0, 0)
  rightGain.connect(merger, 0, 1)
  merger.connect(destination)

  function applySide(side: TestSide, at: number): void {
    const { left, right } = sideGains(side)
    leftGain.gain.setTargetAtTime(left, at, 0.01)
    rightGain.gain.setTargetAtTime(right, at, 0.01)
  }

  /** Re-arm the pulse train from `from`, or hold open for a steady tone. */
  function applyPulse(pulsed: boolean, from: number): void {
    const g = pulse.gain
    try {
      g.cancelScheduledValues(from)
    } catch {
      /* nothing scheduled */
    }
    if (!pulsed) {
      g.setTargetAtTime(1, from, 0.01)
      return
    }
    // Schedule a finite train and let `update`/restart extend it. Long enough
    // that nobody notices it ending mid-check.
    g.setValueAtTime(0, from)
    for (let i = 0; i < 600; i++) {
      const t = from + i * PULSE_PERIOD_SEC
      g.setTargetAtTime(1, t, 0.005)
      g.setTargetAtTime(0, t + PULSE_ON_SEC, 0.02)
    }
  }

  applyPulse(opts.pulsed ?? true, now)
  osc.start(now)
  level.gain.setValueAtTime(0, now)
  level.gain.linearRampToValueAtTime(
    dbToGain(clampTestLevelDb(opts.levelDb ?? DEFAULT_TEST_LEVEL_DB)),
    now + RAMP_SEC,
  )

  return {
    get running() {
      return !stopped
    },
    update(next: TestSignalOptions) {
      if (stopped) return
      const at = ctx.currentTime
      if (next.side) applySide(next.side, at)
      if (next.freqHz !== undefined) {
        osc.frequency.setTargetAtTime(Math.max(20, Math.min(18000, next.freqHz)), at, 0.02)
      }
      if (next.levelDb !== undefined) {
        level.gain.setTargetAtTime(dbToGain(clampTestLevelDb(next.levelDb)), at, 0.02)
      }
      if (next.pulsed !== undefined) applyPulse(next.pulsed, at)
    },
    stop() {
      if (stopped) return
      stopped = true
      const at = ctx.currentTime
      try {
        level.gain.cancelScheduledValues(at)
        level.gain.setValueAtTime(level.gain.value, at)
        level.gain.linearRampToValueAtTime(0.0001, at + RAMP_SEC)
        osc.stop(at + RAMP_SEC * 2)
      } catch {
        /* already gone */
      }
      osc.addEventListener('ended', () => {
        for (const n of [osc, pulse, level, leftGain, rightGain, merger]) {
          try {
            n.disconnect()
          } catch {
            /* already disconnected */
          }
        }
      })
    },
  }
}
