/**
 * Detect whether a "vocals" stem actually contains singing, or is effectively
 * empty — which is what stem separation produces for an instrumental / backing
 * track. When it's empty, "Fit to song" has nothing to transcribe, so the
 * lyrics section offers to import a with-vocals source instead.
 *
 * Calibrated against 16 real separations + one true instrumental:
 *   - real vocal stems:  RMS −16…−32 dBFS, active-frame ratio 0.43…0.90
 *   - instrumental's "vocals": RMS −76.7 dBFS, active ratio 0.00
 * An 18 dB / 40× margin, so the thresholds below are deliberately generous.
 */

/** Below this whole-file RMS (dBFS) the stem carries no usable vocal energy. */
export const EMPTY_VOCAL_RMS_DBFS = -50
/** …and fewer than this fraction of 50 ms frames rise above the noise floor. */
export const EMPTY_VOCAL_ACTIVE_RATIO = 0.05
/** A 50 ms frame counts as "active" above this level (dBFS). */
const ACTIVE_FRAME_FLOOR_DBFS = -50
const FRAME_SEC = 0.05

export type VocalPresence = {
  /** Whole-signal RMS in dBFS (−∞ clamped to a large negative). */
  rmsDb: number
  /** Peak absolute sample in dBFS. */
  peakDb: number
  /** Fraction of 50 ms frames whose RMS exceeds the active floor (0..1). */
  activeRatio: number
  /** False when the stem is confidently empty (both RMS and activity are low). */
  hasVocals: boolean
}

function toDb(amp: number): number {
  return 20 * Math.log10(amp + 1e-12)
}

/**
 * Analyze a mono signal for vocal presence. Pure — no Web Audio, no I/O — so it
 * is unit-testable and runs in the Node test project.
 */
export function analyzeVocalPresence(mono: Float32Array, sampleRate: number): VocalPresence {
  const n = mono.length
  if (n === 0 || sampleRate <= 0) {
    return { rmsDb: -Infinity, peakDb: -Infinity, activeRatio: 0, hasVocals: false }
  }
  let sumSq = 0
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = mono[i]!
    sumSq += v * v
    const a = Math.abs(v)
    if (a > peak) peak = a
  }
  const rmsDb = toDb(Math.sqrt(sumSq / n))
  const peakDb = toDb(peak)

  const w = Math.max(1, Math.floor(FRAME_SEC * sampleRate))
  const frames = Math.floor(n / w)
  let active = 0
  for (let f = 0; f < frames; f++) {
    let s = 0
    const base = f * w
    for (let i = 0; i < w; i++) {
      const v = mono[base + i]!
      s += v * v
    }
    if (toDb(Math.sqrt(s / w)) > ACTIVE_FRAME_FLOOR_DBFS) active++
  }
  const activeRatio = frames > 0 ? active / frames : 0

  // Empty only when BOTH signals agree it's silent — avoids a false "empty" on
  // a genuinely quiet or sparse vocal.
  const isEmpty = rmsDb < EMPTY_VOCAL_RMS_DBFS && activeRatio < EMPTY_VOCAL_ACTIVE_RATIO
  return { rmsDb, peakDb, activeRatio, hasVocals: !isEmpty }
}

/** Downmix an AudioBuffer to a single Float32Array (average of channels). */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels
  const len = buffer.length
  const out = new Float32Array(len)
  if (ch === 0) return out
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += data[i]!
  }
  if (ch > 1) for (let i = 0; i < len; i++) out[i] /= ch
  return out
}

/** Convenience: analyze a decoded AudioBuffer for vocal presence. */
export function vocalPresenceFromBuffer(buffer: AudioBuffer): VocalPresence {
  return analyzeVocalPresence(downmixToMono(buffer), buffer.sampleRate)
}
