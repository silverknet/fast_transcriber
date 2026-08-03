/**
 * Parsing persisted jam settings — pure, so the rules are testable.
 *
 * These lived as private helpers inside `chordJam.svelte.ts`, where they could
 * only be exercised through the singleton. That hid a real bug for a long time:
 *
 *   const v = Number(localStorage.getItem(key))
 *   if (!Number.isFinite(v)) return fallback
 *
 * `getItem` returns `null` for a MISSING key, and `Number(null)` is `0` — which
 * is finite. So an absent setting never reached its fallback; it came back as
 * `clamp(0, min, max)`. On a device that had never opened the Chords tab that
 * made `keysVolume` 0, i.e. the chords lane rendered and scheduled and played
 * nothing at all.
 *
 * Every function here takes the RAW stored string (or `null` when absent, which
 * is also what a non-browser caller passes), so "missing" and "zero" stay
 * distinguishable — a fader deliberately pulled to silence must stay silent.
 */
import type { SynthPatch } from './keysSynth'

/** True when there is genuinely nothing stored. */
const absent = (raw: string | null): boolean => raw === null || raw.trim() === ''

export function parseBool(raw: string | null, fallback: boolean): boolean {
  return absent(raw) ? fallback : raw === '1'
}

export function parseNum(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (absent(raw)) return fallback
  const v = Number(raw)
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, v))
}

export function parseStr<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

export function parsePatch(raw: string | null, fallback: () => SynthPatch): SynthPatch {
  if (absent(raw)) return fallback()
  try {
    const parsed = JSON.parse(raw!) as SynthPatch
    return parsed && typeof parsed === 'object' && parsed.env ? parsed : fallback()
  } catch {
    return fallback()
  }
}
