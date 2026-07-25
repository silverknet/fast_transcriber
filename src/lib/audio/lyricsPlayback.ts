/**
 * Lyrics playback display math — pick the active word and how far into it we
 * are, plus a per-word CONFIDENCE (heard vs interpolated) that the karaoke
 * highlight uses to tell the truth: crisp on words timed from real recognition,
 * soft across words whose timing was only interpolated between anchors.
 *
 * Pure module (no DOM, no reactivity) so it's unit-testable. Pixel geometry
 * lives in the component; this owns the time → (word, fraction, confidence) map.
 */

/** A lyric word with (at least) a start time; `aligned` marks real recognition. */
export type TimedWord = { startSec: number; endSec?: number; aligned?: boolean }

/** Look & feel of the confidence halo. Tuned live on `/debug/lyrics`. */
export type HaloTuning = {
  /** 0 = rectangle · 1 = oval/pill (border-radius as a % of height). */
  roundness: number
  /** Halo height, em. */
  heightEm: number
  /** Width beyond the word on a HEARD word, px. */
  basePad: number
  /** Extra width over a GUESSED word, px. */
  spread: number
  /** Softness of the halo's own edge, 0 (hard) … 1 (very soft). */
  edgeFeather: number
  /** Blur on heard words, px. */
  baseBlur: number
  /** Extra blur over guessed words, px. */
  maxBlur: number
  /** Opacity on heard words. */
  baseOpacity: number
  /** Position follow time constant, s — "drift laziness". */
  tauPos: number
  /** Size/opacity/blur morph time constant, s — "morph softness". */
  tauMorph: number
}

/** Default halo tuning — chosen by the user on the debug lab (2026-07-25). */
export const HALO_TUNING: HaloTuning = {
  roundness: 0,
  heightEm: 1.4,
  basePad: 18,
  spread: 90,
  edgeFeather: 1,
  baseBlur: 7,
  maxBlur: 15,
  baseOpacity: 0.94,
  tauPos: 0.36,
  tauMorph: 0.52,
}

const CONF_HEARD = 1
const CONF_GUESSED = 0.22

/** Confidence of a single word: 1 when timed from real recognition, low otherwise. */
export function wordConfidence(w: TimedWord): number {
  return w.aligned ? CONF_HEARD : CONF_GUESSED
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, f: number): number => a + (b - a) * f

/** Ken Perlin's smootherstep — C2-continuous ease used to shape the halo. */
export function smootherstep(x: number): number {
  const s = clamp01(x)
  return s * s * s * (s * (s * 6 - 15) + 10)
}

/**
 * Index of the last word that has started by time `t` (sticky active word),
 * or -1 before the first word. `words` must be start-sorted.
 */
export function activeWordIndexAt(words: readonly TimedWord[], t: number): number {
  let idx = -1
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.startSec <= t) idx = i
    else break
  }
  return idx
}

/**
 * The active word `i`, how far into its interval we are (`frac` 0..1), and the
 * confidence at `t` interpolated from word `i` toward word `i+1` — so the halo
 * eases between a heard and a guessed word instead of flipping. `null` before
 * the first word starts.
 */
export function lyricSegmentAt(
  words: readonly TimedWord[],
  t: number,
): { i: number; frac: number; confidence: number } | null {
  const i = activeWordIndexAt(words, t)
  if (i < 0) return null
  const cur = words[i]!
  const next = words[i + 1]
  const endT = next ? next.startSec : cur.endSec ?? cur.startSec + 0.4
  const frac = clamp01((t - cur.startSec) / Math.max(0.05, endT - cur.startSec))
  const c2 = next ? wordConfidence(next) : wordConfidence(cur)
  const confidence = lerp(wordConfidence(cur), c2, frac)
  return { i, frac, confidence }
}
