/**
 * Project-wide "sound" (mastering) — the ONE implementation used by both the
 * live Overview mixer and the offline backing-track export, so what you hear
 * is what you export.
 *
 * Two mechanisms, per the project config (`ProjectFile.mastering`):
 *
 *  1. **Loudness matching** — every stem is pulled toward a FIXED per-type
 *     loudness target (RMS dBFS). Because the target is an absolute constant,
 *     song A's drums land at the same level as song B's with zero cross-song
 *     bookkeeping.
 *  2. **Envelope evening** — a per-stem `DynamicsCompressorNode` preset
 *     (light/firm) evens note-to-note dynamics within a song, plus an optional
 *     master-bus glue compressor + safety limiter on the summed mix.
 *
 * Everything is native Web Audio (works in `AudioContext` and
 * `OfflineAudioContext`), zero dependencies. Cue/click lanes are never
 * processed — spoken cues and clicks must stay untouched.
 */
import type { AutoStemName, MasteringIntensity, ProjectMastering, StemSound } from '$lib/project/types'

// ── Lane classification ────────────────────────────────────────────────────

/**
 * Which mastering stem type a mixer lane key belongs to, or null for lanes
 * that must never be processed per-lane (original mix, cue, click). The
 * original still passes through the master bus.
 */
export function stemKindForLaneKey(key: string): AutoStemName | null {
  if (!key.startsWith('stem:')) return null
  const file = key.slice('stem:'.length).toLowerCase()
  for (const name of ['vocals', 'drums', 'bass', 'other'] as const) {
    if (file.includes(name)) return name
  }
  return 'other'
}

// ── Loudness ───────────────────────────────────────────────────────────────

/** Fixed per-type RMS targets (dBFS). Absolute → consistent across songs. */
const LOUDNESS_TARGET_DB: Record<AutoStemName, number> = {
  vocals: -18,
  drums: -16,
  bass: -18,
  other: -19,
}

/** Below this measured RMS a stem is treated as "basically silent" — boosting
 * it would only amplify bleed/noise, so loudness matching skips the boost. */
const SILENCE_FLOOR_DB = -45

/** Loudness-match gain is clamped to ±this many dB. */
const MATCH_CLAMP_DB = 12

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/** RMS in dBFS across all channels (pure math — unit-testable). */
export function channelsRmsDb(channels: readonly Float32Array[]): number {
  let sum = 0
  let n = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]!
      sum += v * v
    }
    n += ch.length
  }
  if (n === 0 || sum === 0) return -Infinity
  return 20 * Math.log10(Math.sqrt(sum / n))
}

export function bufferRmsDb(buf: AudioBuffer): number {
  const chans: Float32Array[] = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  return channelsRmsDb(chans)
}

/**
 * Static make-up gain (dB) that brings a stem's measured RMS toward its fixed
 * target. Clamped to ±12 dB; near-silent stems are never boosted.
 */
export function loudnessMatchGainDb(kind: AutoStemName, measuredRmsDb: number): number {
  if (!Number.isFinite(measuredRmsDb)) return 0
  const delta = LOUDNESS_TARGET_DB[kind] - measuredRmsDb
  if (delta > 0 && measuredRmsDb < SILENCE_FLOOR_DB) return 0
  return Math.max(-MATCH_CLAMP_DB, Math.min(MATCH_CLAMP_DB, delta))
}

// ── Compressor presets ─────────────────────────────────────────────────────

export interface CompressorPreset {
  thresholdDb: number
  ratio: number
  attackSec: number
  releaseSec: number
  kneeDb: number
  /** Static make-up applied after the compressor. */
  makeupDb: number
}

const STEM_PRESETS: Record<AutoStemName, Record<Exclude<MasteringIntensity, 'off'>, CompressorPreset>> = {
  bass: {
    light: { thresholdDb: -24, ratio: 3, attackSec: 0.01, releaseSec: 0.25, kneeDb: 6, makeupDb: 2 },
    firm: { thresholdDb: -28, ratio: 5, attackSec: 0.008, releaseSec: 0.2, kneeDb: 4, makeupDb: 4 },
  },
  drums: {
    // Slower attack keeps the transient (punch); the tail gets evened.
    light: { thresholdDb: -20, ratio: 2.5, attackSec: 0.02, releaseSec: 0.15, kneeDb: 6, makeupDb: 1.5 },
    firm: { thresholdDb: -24, ratio: 4, attackSec: 0.012, releaseSec: 0.12, kneeDb: 4, makeupDb: 3 },
  },
  vocals: {
    light: { thresholdDb: -22, ratio: 2.5, attackSec: 0.008, releaseSec: 0.2, kneeDb: 8, makeupDb: 2 },
    firm: { thresholdDb: -26, ratio: 4, attackSec: 0.006, releaseSec: 0.18, kneeDb: 6, makeupDb: 3.5 },
  },
  other: {
    light: { thresholdDb: -22, ratio: 2, attackSec: 0.015, releaseSec: 0.2, kneeDb: 8, makeupDb: 1.5 },
    firm: { thresholdDb: -26, ratio: 3.5, attackSec: 0.01, releaseSec: 0.18, kneeDb: 6, makeupDb: 3 },
  },
}

/** Gentle bus glue — evens the summed mix without pumping. */
const MASTER_GLUE: CompressorPreset = {
  thresholdDb: -16,
  ratio: 1.8,
  attackSec: 0.03,
  releaseSec: 0.25,
  kneeDb: 8,
  makeupDb: 1,
}

/** Safety limiter — hard knee, fast attack, high ratio; catches inter-stem sums. */
const MASTER_LIMITER: CompressorPreset = {
  thresholdDb: -3,
  ratio: 20,
  attackSec: 0.001,
  releaseSec: 0.08,
  kneeDb: 0,
  makeupDb: 0,
}

export function stemCompressorPreset(
  kind: AutoStemName,
  intensity: MasteringIntensity | undefined,
): CompressorPreset | null {
  if (!intensity || intensity === 'off') return null
  return STEM_PRESETS[kind][intensity]
}

// ── Tone shaping (EQ presets) ──────────────────────────────────────────────

/** One biquad stage in a tone preset. */
interface EqStage {
  type: BiquadFilterType
  freqHz: number
  gainDb?: number
  q?: number
}

/**
 * "Live ready" tone per stem — bass gets a rich low end plus definition so it
 * carries on small speakers; drums get kick weight, less mud, and snap; vocals
 * and other get cleanup + presence. Deliberately modest values: character, not
 * a re-mix.
 */
const TONE_PRESETS: Record<AutoStemName, EqStage[]> = {
  bass: [
    { type: 'lowshelf', freqHz: 85, gainDb: 3.5 }, // rich fundament
    { type: 'peaking', freqHz: 750, gainDb: 1.5, q: 1 }, // definition/growl
    { type: 'highshelf', freqHz: 6000, gainDb: -1.5 }, // tuck string fizz
  ],
  drums: [
    { type: 'lowshelf', freqHz: 95, gainDb: 2 }, // kick weight
    { type: 'peaking', freqHz: 400, gainDb: -1.5, q: 1 }, // cut boxy mud
    { type: 'highshelf', freqHz: 4500, gainDb: 2.5 }, // snap + clarity
  ],
  vocals: [
    { type: 'highpass', freqHz: 100 }, // rumble/plosive cleanup
    { type: 'peaking', freqHz: 3000, gainDb: 2, q: 0.9 }, // presence
  ],
  other: [
    { type: 'highpass', freqHz: 70 }, // keep lows for the bass stem
    { type: 'highshelf', freqHz: 5000, gainDb: 1.5 }, // air
  ],
}

/** Build the tone-EQ biquad chain for a stem, or null when not shaped. */
function buildToneEq(ctx: BaseAudioContext, kind: AutoStemName): AudioChain | null {
  const stages = TONE_PRESETS[kind]
  if (stages.length === 0) return null
  let input: AudioNode | null = null
  let prev: AudioNode | null = null
  for (const s of stages) {
    const f = ctx.createBiquadFilter()
    f.type = s.type
    f.frequency.value = s.freqHz
    if (s.gainDb !== undefined) f.gain.value = s.gainDb
    if (s.q !== undefined) f.Q.value = s.q
    if (prev) prev.connect(f)
    if (!input) input = f
    prev = f
  }
  return input && prev ? { input, output: prev } : null
}

// ── Kick punch (drums lane only) ───────────────────────────────────────────

/**
 * Make the KICK inside the separated drums stem hit harder — without a separate
 * kick track and without touching the stem file, which is never rewritten.
 *
 * In a drums stem the kick is effectively the only thing with real energy below
 * ~110 Hz, so that band IS the kick. We split it off, compress it with a
 * DELIBERATELY SLOW attack, and blend it back in parallel with the untouched
 * lane:
 *
 *   in ─┬────────────────────────────────────────────► sum
 *       └─► hp 35 → lp 110 (×2) → comp (slow attack) → wet ─┘
 *
 * The slow attack is the whole trick. For the first ~25 ms the compressor has
 * not clamped down yet, so the kick's transient passes at full level; only the
 * body that follows gets squashed. Summed back against the dry lane, that lifts
 * the attack relative to the sustain — which is what "punch" is. A FAST attack
 * would do the exact opposite (clamp the transient, pass the body) and make the
 * kick rounder and more sustained.
 *
 * Because it is a parallel band, the snare, hats and cymbals are untouched: it
 * gets louder where the kick is, not everywhere.
 *
 * The band is then SATURATED, which is what makes the punch audible at all on
 * the speakers people actually use. A 50 Hz kick fundamental is reproduced by
 * essentially no laptop or phone speaker, so adding more energy down there is
 * inaudible on anything but a PA. tanh saturation generates harmonics at 100,
 * 150, 200 Hz — which small speakers DO reproduce, and from which the ear
 * reconstructs the missing fundamental. Without this stage the effect measures
 * correctly and still sounds like almost nothing on a laptop.
 */
const KICK_BAND_HZ = 110
/** Nothing below this is drum — just rumble and separation artefacts. */
const KICK_SUBSONIC_HZ = 35
const KICK_COMP: CompressorPreset = {
  thresholdDb: -30,
  ratio: 4,
  attackSec: 0.025, // slow ON PURPOSE — see above
  releaseSec: 0.12,
  kneeDb: 3,
  makeupDb: 0,
}
/** Wet blend at amount = 1. */
const KICK_MAX_WET = 1.1
/** Saturation drive on the kick band — harmonics, not distortion. */
const KICK_DRIVE = 2.2

/** tanh transfer curve: soft clipping that adds low-order harmonics. */
function tanhCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT))
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * drive) / norm
  }
  return curve
}

/** The configured kick-punch amount (0…1). Absent/invalid = 0 = not built. */
export function kickPunchAmount(cfg: ProjectMastering): number {
  const v = cfg.kickPunch
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/**
 * Dry lane + a compressed, saturated low band in parallel. `amount` must be > 0.
 *
 * Exported because the EDITOR needs this stage on its own: the edit-page
 * transport plays stems without the full per-stem mastering chain, so it wires
 * just this one insert onto the drums lane.
 */
export function buildKickPunchChain(ctx: BaseAudioContext, amount: number): AudioChain {
  const input = ctx.createGain()
  const sum = ctx.createGain()
  input.connect(sum) // dry, unchanged

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = KICK_SUBSONIC_HZ
  const lp1 = ctx.createBiquadFilter()
  lp1.type = 'lowpass'
  lp1.frequency.value = KICK_BAND_HZ
  const lp2 = ctx.createBiquadFilter()
  lp2.type = 'lowpass'
  lp2.frequency.value = KICK_BAND_HZ // second pass = steeper skirt, less snare bleed
  const comp = compressorNode(ctx, KICK_COMP)
  // Harmonics so the kick reads on speakers that cannot reproduce 50 Hz.
  const sat = ctx.createWaveShaper()
  sat.curve = tanhCurve(KICK_DRIVE)
  sat.oversample = '2x'
  const wet = ctx.createGain()
  wet.gain.value = amount * KICK_MAX_WET

  input.connect(hp)
  hp.connect(lp1)
  lp1.connect(lp2)
  lp2.connect(comp)
  comp.connect(sat)
  sat.connect(wet)
  wet.connect(sum)

  return { input, output: sum }
}

/** Per-stem trim clamp (dB). */
const TRIM_CLAMP_DB = 9

/**
 * Total static gain (dB) a stem's chain applies: loudness match + user trim +
 * compressor make-up. Pure — unit-testable.
 */
export function stemTotalGainDb(
  kind: AutoStemName,
  cfg: ProjectMastering,
  measuredRmsDb: number,
): number {
  const sound: StemSound = cfg.stems?.[kind] ?? {}
  const matchDb = cfg.matchLoudness ? loudnessMatchGainDb(kind, measuredRmsDb) : 0
  const trimDb = Math.max(-TRIM_CLAMP_DB, Math.min(TRIM_CLAMP_DB, sound.trimDb ?? 0))
  const preset = stemCompressorPreset(kind, sound.intensity)
  return matchDb + trimDb + (preset?.makeupDb ?? 0)
}

// ── Chain builders (work in AudioContext AND OfflineAudioContext) ──────────

export interface AudioChain {
  input: AudioNode
  output: AudioNode
}

function compressorNode(ctx: BaseAudioContext, p: CompressorPreset): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor()
  c.threshold.value = p.thresholdDb
  c.ratio.value = p.ratio
  c.attack.value = p.attackSec
  c.release.value = p.releaseSec
  c.knee.value = p.kneeDb
  return c
}

/**
 * Per-lane insert for one stem: [tone EQ →] [compressor →] [gain] — or null
 * when the config gives this lane nothing to do (caller wires source → gain
 * directly). `measuredRmsDb` comes from the DECODED buffer (pre-chain), so
 * loudness matching is deterministic regardless of live playback.
 */
export function buildStemChain(
  ctx: BaseAudioContext,
  kind: AutoStemName,
  cfg: ProjectMastering,
  measuredRmsDb: number,
): AudioChain | null {
  if (!cfg.enabled) return null
  const sound: StemSound = cfg.stems?.[kind] ?? {}
  const preset = stemCompressorPreset(kind, sound.intensity)
  const eq = sound.tone === 'shaped' ? buildToneEq(ctx, kind) : null
  const totalGainDb = stemTotalGainDb(kind, cfg, measuredRmsDb)
  // Kick punch is a drums-only stage — no other stem has a kick in it.
  const kick = kind === 'drums' ? kickPunchAmount(cfg) : 0
  if (!preset && !eq && totalGainDb === 0 && kick === 0) return null

  const gain = ctx.createGain()
  gain.gain.value = dbToGain(totalGainDb)

  // Wire back-to-front: … → comp? → gain, then eq? in front of that, then the
  // kick stage at the very front so the tone EQ and the glue both see it.
  let input: AudioNode = gain
  if (preset) {
    const comp = compressorNode(ctx, preset)
    comp.connect(input)
    input = comp
  }
  if (eq) {
    eq.output.connect(input)
    input = eq.input
  }
  if (kick > 0) {
    const punch = buildKickPunchChain(ctx, kick)
    punch.output.connect(input)
    input = punch.input
  }
  return { input, output: gain }
}

/** Master bus: glue compressor → safety limiter (both only when enabled). */
export function buildMasterChain(ctx: BaseAudioContext, cfg: ProjectMastering): AudioChain | null {
  if (!cfg.enabled || !cfg.masterGlue) return null
  const glue = compressorNode(ctx, MASTER_GLUE)
  const makeup = ctx.createGain()
  makeup.gain.value = dbToGain(MASTER_GLUE.makeupDb)
  const limiter = compressorNode(ctx, MASTER_LIMITER)
  glue.connect(makeup)
  makeup.connect(limiter)
  return { input: glue, output: limiter }
}

/**
 * Offline helper: render `input` through a stem chain and return the processed
 * buffer. Used by the backing-track export so the WAV matches the mixer.
 * Returns the input unchanged when the chain is a no-op.
 */
export async function renderBufferThroughStemChain(
  input: AudioBuffer,
  kind: AutoStemName,
  cfg: ProjectMastering,
): Promise<AudioBuffer> {
  if (!cfg.enabled) return input
  const ctx = new OfflineAudioContext(input.numberOfChannels, input.length, input.sampleRate)
  const chain = buildStemChain(ctx, kind, cfg, cfg.matchLoudness ? bufferRmsDb(input) : -20)
  if (!chain) return input
  const src = ctx.createBufferSource()
  src.buffer = input
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start(0)
  return await ctx.startRendering()
}

/** Offline helper: render a summed mix through the master chain. */
export async function renderBufferThroughMasterChain(
  input: AudioBuffer,
  cfg: ProjectMastering,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(input.numberOfChannels, input.length, input.sampleRate)
  const chain = buildMasterChain(ctx, cfg)
  if (!chain) return input
  const src = ctx.createBufferSource()
  src.buffer = input
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start(0)
  return await ctx.startRendering()
}
