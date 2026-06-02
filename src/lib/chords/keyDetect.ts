/**
 * Krumhansl–Kessler key fitting from a chroma vector.
 *
 * Pure-TS twin of the Python implementation in
 * `desktop/native/python/sections/chord_chroma.py`. Same templates, same
 * confidence formula — so client-side re-fits (e.g. after future per-section
 * chroma slicing) produce results consistent with what the sidecar cached.
 */

import type { Accidental, NoteName, SongKeyMode } from '$lib/songmap/types'

/** Krumhansl–Kessler major-key probe-tone profile (Kostka–Payne corrected). */
export const KK_MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
] as const

/** Krumhansl–Kessler minor-key probe-tone profile. */
export const KK_MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
] as const

export type DetectedKeyResult = {
  /** 0–11, semitones above C (C=0, C#=1, …, B=11). */
  tonic: number
  mode: SongKeyMode
  /** Top score vs. runner-up margin, clipped to [0, 1]. */
  confidence: number
}

/**
 * Pearson correlation between two equal-length vectors — the similarity
 * metric used in the original Krumhansl–Schmuckler key-finding formulation.
 * Centers each vector by its mean, so it scores the SHAPE of the match
 * rather than overall magnitude. Much sharper than cosine on K-K templates,
 * which all have similar L2 norms and overlapping support.
 */
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length
  if (n === 0 || n !== b.length) return 0
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= n
  meanB /= n
  let num = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return 0
  return num / Math.sqrt(varA * varB)
}

/** Rotate `profile` right by `n` (so index 0 lands at index n). */
function rotate(profile: readonly number[], n: number): number[] {
  const len = profile.length
  const out = new Array<number>(len)
  for (let i = 0; i < len; i++) {
    out[(i + n) % len] = profile[i]
  }
  return out
}

/**
 * Fit a 12-d chroma vector to the 24 Krumhansl–Kessler key templates.
 * Returns `null` if confidence is below the floor (chroma is too flat to
 * say anything useful — atonal sections, silence, etc.).
 */
export function fitKeyFromChroma(
  chroma: readonly number[],
  confidenceFloor = 0.02,
): DetectedKeyResult | null {
  if (chroma.length !== 12) return null
  const sum = chroma.reduce((s, v) => s + v, 0)
  if (sum <= 0) return null

  let bestScore = -Infinity
  let bestSecond = -Infinity
  let best: DetectedKeyResult | null = null

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const template = rotate(
        mode === 'major' ? KK_MAJOR_PROFILE : KK_MINOR_PROFILE,
        tonic,
      )
      const score = pearson(chroma, template)
      if (score > bestScore) {
        bestSecond = bestScore
        bestScore = score
        best = { tonic, mode, confidence: 0 }
      } else if (score > bestSecond) {
        bestSecond = score
      }
    }
  }

  if (!best) return null
  // Raw margin in correlation space; clipped to [0,1]. Real songs typically
  // produce margins of 0.05–0.20.
  const margin = bestScore - bestSecond
  const confidence = Math.max(0, Math.min(1, margin))
  if (confidence < confidenceFloor) return null
  return { ...best, confidence }
}

/** Semitone (0–11) → human-readable note name, biased by surrounding key. */
const SHARP_NAMES: readonly { root: NoteName; accidental?: Accidental }[] = [
  { root: 'C' },
  { root: 'C', accidental: 'sharp' },
  { root: 'D' },
  { root: 'D', accidental: 'sharp' },
  { root: 'E' },
  { root: 'F' },
  { root: 'F', accidental: 'sharp' },
  { root: 'G' },
  { root: 'G', accidental: 'sharp' },
  { root: 'A' },
  { root: 'A', accidental: 'sharp' },
  { root: 'B' },
] as const

const FLAT_NAMES: readonly { root: NoteName; accidental?: Accidental }[] = [
  { root: 'C' },
  { root: 'D', accidental: 'flat' },
  { root: 'D' },
  { root: 'E', accidental: 'flat' },
  { root: 'E' },
  { root: 'F' },
  { root: 'G', accidental: 'flat' },
  { root: 'G' },
  { root: 'A', accidental: 'flat' },
  { root: 'A' },
  { root: 'B', accidental: 'flat' },
  { root: 'B' },
] as const

/**
 * Map a tonic integer (0–11) to a {root, accidental} pair.
 *
 * The mode chooses default enharmonic spelling: major keys with sharps
 * naturally (G, D, A, E, B), minor keys with flats (Bb, Eb, Ab) — keeps
 * common pop-keys readable (Bb minor over A# minor, etc.).
 */
export function tonicIntToNote(
  tonic: number,
  mode: SongKeyMode,
): { root: NoteName; accidental?: Accidental } {
  const t = ((tonic % 12) + 12) % 12
  // Major: Db, Eb, F#, Ab, Bb — F# preferred over Gb in pop contexts.
  // Minor: C# m, Eb m, F# m, Ab m, Bb m — C# / F# minor over their flat twins.
  const flatTonics = mode === 'minor' ? [3, 8, 10] : [1, 3, 8, 10]
  const table = flatTonics.includes(t) ? FLAT_NAMES : SHARP_NAMES
  const entry = table[t]
  return entry.accidental
    ? { root: entry.root, accidental: entry.accidental }
    : { root: entry.root }
}
