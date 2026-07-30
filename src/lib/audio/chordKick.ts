/**
 * A punchy KICK voice for chord playback (chords view) — the pulse under the
 * keys/bass/arp jam, so a progression has somewhere to land.
 *
 * Synthesized per hit; nothing is sampled and NO song audio is read, decoded or
 * written. Three layers, which together read as a struck drum rather than a
 * synth tone:
 *
 *   1. BODY  — sine with a fast exponential pitch drop (~190 Hz → 50 Hz). The
 *      steepness of that drop in the first ~30 ms is what the ear hears as
 *      "punch"; a slow drop reads as a boom, no drop at all reads as a beep.
 *   2. KNOCK — a second, higher and much shorter sweep (~420 Hz → 90 Hz, ~40 ms).
 *      This is the batter head flexing. It is the difference between "808" and
 *      "someone hit a drum".
 *   3. CLICK — a few ms of band-passed noise around 2.6 kHz: the beater strike.
 *      The cue that carries "live kit" on laptop and phone speakers, which
 *      reproduce nothing near the fundamental.
 *
 * The sum runs through soft tanh saturation so the missing fundamental is
 * *implied* by its harmonics on small speakers, then a 32 Hz high-pass so no
 * headroom is spent below the drum.
 *
 * The rhythm GRID is a pure function ({@link buildKickHits}); the caller watches
 * the transport playhead and fires each hit via {@link playKick} — the same
 * shape as `chordBass.ts`, so kick and bass land together. The `AudioContext` is
 * created lazily on the first {@link resumeKick}, so importing is SSR-safe.
 */

export type KickPattern = 'downbeat' | '1+3' | 'four'
export const KICK_PATTERNS: KickPattern[] = ['downbeat', '1+3', 'four']
export const KICK_PATTERN_LABELS: Record<KickPattern, string> = {
  downbeat: 'Downbeat',
  '1+3': '1 & 3',
  four: 'Four on the floor',
}

/** Accent the bar's first beat — an even kick every time reads as a machine. */
const DOWNBEAT_VELOCITY = 1
const OFFBEAT_VELOCITY = 0.85

/**
 * The kick hit grid. `beats` are in time order and grouped by `barId`; the beat's
 * position INSIDE its bar decides whether it gets a hit:
 *   - `downbeat` → beat 1 of every bar
 *   - `1+3`      → beats 1 and 3 (the classic live-kit pulse)
 *   - `four`     → every beat
 * Meter-agnostic: a 3/4 or 5/4 bar simply has fewer/more beats to match against,
 * so `1+3` in 3/4 gives 1 and 3 and nothing else.
 */
export function buildKickHits(
  beats: readonly { timeSec: number; barId: string }[],
  pattern: KickPattern,
): { timeSec: number; velocity: number }[] {
  const hits: { timeSec: number; velocity: number }[] = []
  let beatInBar = 0
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!
    beatInBar = i > 0 && beats[i - 1]!.barId === b.barId ? beatInBar + 1 : 0

    const wanted =
      pattern === 'four' ? true : pattern === '1+3' ? beatInBar === 0 || beatInBar === 2 : beatInBar === 0
    if (!wanted) continue

    hits.push({ timeSec: b.timeSec, velocity: beatInBar === 0 ? DOWNBEAT_VELOCITY : OFFBEAT_VELOCITY })
  }
  return hits
}

// ── Voice shaping ───────────────────────────────────────────────────────────

/** Everything `punch` (0…1) moves, resolved once per hit. Pure — unit-testable. */
export interface KickShape {
  bodyStartHz: number
  bodyEndHz: number
  bodySweepSec: number
  bodyDecaySec: number
  knockStartHz: number
  knockLevel: number
  clickLevel: number
  drive: number
}

/**
 * Map the punch knob onto the voice. Turning it up starts the body sweep HIGHER,
 * drops it FASTER, shortens the decay, and brings up the knock + beater click —
 * i.e. it moves energy out of the tail and into the first 30 ms, which is what
 * "punchy" means. Turning it down leaves a rounder, longer, softer drum.
 */
export function kickShapeFor(punch: number): KickShape {
  const p = Math.max(0, Math.min(1, punch))
  return {
    bodyStartHz: 150 + 95 * p, // 150 … 245
    bodyEndHz: 50, // fixed: the drum keeps its tuning as punch moves
    bodySweepSec: 0.046 - 0.023 * p, // 46 … 23 ms drop
    bodyDecaySec: 0.32 - 0.16 * p, // 320 … 160 ms (damped, like a gigging kick)
    knockStartHz: 320 + 180 * p, // 320 … 500
    knockLevel: 0.16 + 0.3 * p,
    clickLevel: 0.05 + 0.3 * p,
    // Saturation is for HARMONICS (small speakers imply the fundamental), NOT
    // for punch — tanh is also a compressor, so a wide drive range squashes the
    // very transient punch is meant to add. Keep it narrow and gentle.
    drive: 1.15 + 0.55 * p,
  }
}

const CLICK_SEC = 0.007
const CLICK_FREQ_HZ = 2600
const CLICK_Q = 0.8
const HIGHPASS_HZ = 32
/** Headroom for the saturator's oversampling overshoot — see `createKickBus`. */
const BUS_TRIM = 0.92

/** mulberry32 — the beater noise is seeded so every hit is identical. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** tanh transfer curve for the saturation stage. */
function tanhCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2048
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT))
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * drive) / norm
  }
  return curve
}

/** Velocity → gain. Mirrors the drum renderer's curve: quiet hits stay audible. */
export function kickVelocityGain(v: number): number {
  const c = Math.max(0, Math.min(1, v))
  return 0.35 + 0.65 * c * c
}

// ── Live engine ────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** Bus INPUT (the high-pass). Voices connect here, not to `master`. */
let busInput: AudioNode | null = null
let volume = 0.6
let punch = 0.6
/** Voices still ringing — tracked only so `stopKick` can duck them on pause. */
const live = new Set<GainNode>()

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  const Ctor: typeof AudioContext | undefined =
    (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()

  master = ctx.createGain()
  master.gain.value = volume
  master.connect(ctx.destination)
  busInput = createKickBus(ctx, master)
  return ctx
}

/** The beater noise, built once per context (seeded → every hit identical). */
const noiseByContext = new WeakMap<BaseAudioContext, AudioBuffer>()
function beaterNoise(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseByContext.get(ctx)
  if (cached) return cached
  const len = Math.max(1, Math.ceil(CLICK_SEC * ctx.sampleRate))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  const rand = mulberry32(0x6b1c)
  for (let i = 0; i < len; i++) data[i] = rand() * 2 - 1
  noiseByContext.set(ctx, buf)
  return buf
}

/**
 * Build ONE kick and schedule it at `at` on any context — live `AudioContext`
 * for playback, `OfflineAudioContext` for tests/rendering. Returns the voice's
 * input gain (so a caller can duck it), its last node (to tear the chain down)
 * and when it has fully decayed.
 *
 * Works in both context kinds on purpose: it is the only way to assert the
 * shape of the sound against real rendered samples rather than by ear.
 */
export function scheduleKick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  at: number,
  velocity: number,
  shape: KickShape,
): { out: GainNode; tail: AudioNode; endAt: number } {
  const s = shape
  const t0 = at
  const g = kickVelocityGain(velocity)

  const out = ctx.createGain()
  out.gain.value = 1
  const shaper = ctx.createWaveShaper()
  shaper.curve = tanhCurve(s.drive)
  shaper.oversample = '2x'
  out.connect(shaper)
  shaper.connect(destination)

  // 1. Body — the thump. Exponential ramps need strictly positive endpoints.
  const body = ctx.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(s.bodyStartHz, t0)
  body.frequency.exponentialRampToValueAtTime(s.bodyEndHz, t0 + s.bodySweepSec)
  const bodyEnv = ctx.createGain()
  bodyEnv.gain.setValueAtTime(0.0001, t0)
  bodyEnv.gain.exponentialRampToValueAtTime(0.95 * g, t0 + 0.0015) // near-instant attack
  bodyEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + s.bodyDecaySec)
  body.connect(bodyEnv)
  bodyEnv.connect(out)

  // 2. Knock — the head flexing under the beater. Short and higher.
  const knock = ctx.createOscillator()
  knock.type = 'sine'
  knock.frequency.setValueAtTime(s.knockStartHz, t0)
  knock.frequency.exponentialRampToValueAtTime(90, t0 + 0.03)
  const knockEnv = ctx.createGain()
  knockEnv.gain.setValueAtTime(0.0001, t0)
  knockEnv.gain.exponentialRampToValueAtTime(s.knockLevel * g, t0 + 0.001)
  knockEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04)
  knock.connect(knockEnv)
  knockEnv.connect(out)

  // 3. Click — the beater itself. Band-passed noise, gone in ~7 ms.
  const click = ctx.createBufferSource()
  click.buffer = beaterNoise(ctx)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = CLICK_FREQ_HZ
  bp.Q.value = CLICK_Q
  const clickEnv = ctx.createGain()
  clickEnv.gain.setValueAtTime(s.clickLevel * g, t0)
  clickEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + CLICK_SEC)
  click.connect(bp)
  bp.connect(clickEnv)
  clickEnv.connect(out)
  click.start(t0)
  click.stop(t0 + CLICK_SEC)

  const endAt = t0 + s.bodyDecaySec + 0.02
  body.start(t0)
  body.stop(endAt)
  knock.start(t0)
  knock.stop(t0 + 0.05)
  return { out, tail: shaper, endAt }
}

/**
 * The kick's fixed post-voice bus: a high-pass so no headroom is spent below the
 * drum, then a small trim. The trim is not cosmetic — the saturator's 2x
 * oversampling rings slightly past full scale on the transient, which clips the
 * output device when the level is up.
 */
export function createKickBus(ctx: BaseAudioContext, destination: AudioNode): AudioNode {
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = HIGHPASS_HZ
  const trim = ctx.createGain()
  trim.gain.value = BUS_TRIM
  hp.connect(trim)
  trim.connect(destination)
  return hp
}

export async function resumeKick(): Promise<void> {
  try {
    const c = ensureContext()
    if (c && c.state !== 'running') await c.resume()
  } catch {
    /* audio unavailable — the kick is optional */
  }
}

export function setKickVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v))
  if (master) master.gain.value = volume
}

export function setKickPunch(p: number): void {
  punch = Math.max(0, Math.min(1, p))
}

/** Fire one kick, now. One-shot: every node is created, started and stopped. */
export function playKick(velocity = 1): void {
  const c = ensureContext()
  const bus = busInput
  if (!c || !bus || c.state === 'closed') return

  const { out, tail, endAt } = scheduleKick(c, bus, c.currentTime, velocity, kickShapeFor(punch))
  live.add(out)
  // One-shot: tear the voice's chain down once its tail has run out, so a long
  // set doesn't accumulate a waveshaper per hit.
  setTimeout(
    () => {
      live.delete(out)
      try {
        out.disconnect()
        tail.disconnect()
      } catch {
        /* already torn down */
      }
    },
    Math.ceil((endAt - c.currentTime + 0.1) * 1000),
  )
}

/** Duck anything still ringing — used when playback stops mid-tail. */
export function stopKick(): void {
  const c = ctx
  if (!c) return
  const t = c.currentTime
  for (const out of live) {
    try {
      out.gain.cancelScheduledValues(t)
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t)
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.02)
    } catch {
      /* node already gone */
    }
  }
}
