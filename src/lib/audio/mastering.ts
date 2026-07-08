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
import type { AutoStemName, MasteringIntensity, ProjectMastering } from '$lib/project/types'

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
 * Per-lane insert for one stem: [compressor →] [gain] — or null when the
 * config gives this lane nothing to do (caller wires source → gain directly).
 * `measuredRmsDb` comes from the DECODED buffer (pre-chain), so loudness
 * matching is deterministic regardless of live playback.
 */
export function buildStemChain(
  ctx: BaseAudioContext,
  kind: AutoStemName,
  cfg: ProjectMastering,
  measuredRmsDb: number,
): AudioChain | null {
  if (!cfg.enabled) return null
  const preset = stemCompressorPreset(kind, cfg.stems?.[kind])
  const matchDb = cfg.matchLoudness ? loudnessMatchGainDb(kind, measuredRmsDb) : 0
  const totalGainDb = matchDb + (preset?.makeupDb ?? 0)
  if (!preset && totalGainDb === 0) return null

  const gain = ctx.createGain()
  gain.gain.value = dbToGain(totalGainDb)
  if (!preset) return { input: gain, output: gain }

  const comp = compressorNode(ctx, preset)
  comp.connect(gain)
  return { input: comp, output: gain }
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
