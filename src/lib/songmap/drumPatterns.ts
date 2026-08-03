/**
 * The drum machine's pattern library — the "regular rhythms and fills" that
 * `generateDrumGroove` lays down over a song's bars.
 *
 * Unlike `drumGroove.ts` (which INFERS a groove from detected audio), nothing
 * here looks at a recording. A style is authored data: slot positions on a
 * 16th-note grid, exactly like a hardware drum machine's step sequencer.
 *
 * Grid convention — slot = 16th note from the top of the bar:
 *
 *     slot   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
 *     beat   1   .   &   .   2   .   &   .   3   .   &   .   4   .   &   .
 *
 * Patterns are authored against 4/4. Bars in other meters simply drop the
 * slots that don't exist (`buildBarSlots` gives 4 slots per actual beat), so
 * a 3/4 bar plays slots 0–11 and a 5/4 bar repeats nothing — sparse but
 * correct, never out of position.
 *
 * Every style carries three intensities so sections can differ without
 * needing three separate styles:
 *
 *   - `light` — intros, bridges, outros: thinner, fewer hats
 *   - `base`  — verses and anything unmarked
 *   - `full`  — choruses and solos: busier kick, denser hats
 */
import type { DrumClass, DrumStyleId, SectionKind } from './types'

export type { DrumStyleId }

/** One step: where in the bar, and how hard. */
export type Step = { slot: number; vel: number }

/** A single bar of pattern, per voice. */
export type PatternBar = Partial<Record<DrumClass, Step[]>>

export type DrumIntensity = 'light' | 'base' | 'full'

export type DrumStyle = {
  id: DrumStyleId
  label: string
  /** One bar per intensity, repeated across the section's bars. */
  bars: Record<DrumIntensity, PatternBar>
}

/** Dropdown source — order is the order shown. */
export const DRUM_STYLES: { id: DrumStyleId; label: string }[] = [
  { id: 'rock', label: 'Rock' },
  { id: 'pop', label: 'Pop' },
  { id: 'funk', label: 'Funk' },
  { id: 'disco', label: 'Four on the floor' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'halfTime', label: 'Half-time' },
]

// ── Authoring helpers ───────────────────────────────────────────────────────

/** Steps at fixed slots, all one velocity. */
function at(slots: number[], vel: number): Step[] {
  return slots.map((slot) => ({ slot, vel }))
}

/**
 * A steady hat layer: every `every` slots, accented on beats (slot % 4 === 0).
 * `every` of 1 = 16ths, 2 = 8ths, 4 = quarters.
 */
function hats(every: number, accent: number, ghost: number): Step[] {
  const out: Step[] = []
  for (let slot = 0; slot < 16; slot += every) {
    out.push({ slot, vel: slot % 4 === 0 ? accent : ghost })
  }
  return out
}

const BACKBEAT = at([4, 12], 0.85)

// ── The styles ──────────────────────────────────────────────────────────────

const STYLES: Record<DrumStyleId, DrumStyle> = {
  rock: {
    id: 'rock',
    label: 'Rock',
    bars: {
      light: { kick: at([0, 8], 0.82), snare: BACKBEAT, hihat: hats(4, 0.6, 0.42) },
      base: { kick: at([0, 8], 0.88), snare: BACKBEAT, hihat: hats(2, 0.66, 0.44) },
      full: {
        kick: [...at([0, 8], 0.92), ...at([10], 0.72)],
        snare: BACKBEAT,
        hihat: hats(1, 0.68, 0.4),
      },
    },
  },
  pop: {
    id: 'pop',
    label: 'Pop',
    bars: {
      light: { kick: at([0, 8], 0.74), snare: at([12], 0.78), hihat: hats(4, 0.54, 0.38) },
      base: { kick: at([0, 8], 0.8), snare: BACKBEAT, hihat: hats(2, 0.58, 0.4) },
      full: {
        kick: [...at([0, 8], 0.85), ...at([14], 0.66)],
        snare: BACKBEAT,
        hihat: hats(2, 0.64, 0.44),
      },
    },
  },
  funk: {
    id: 'funk',
    label: 'Funk',
    bars: {
      light: { kick: at([0, 10], 0.82), snare: BACKBEAT, hihat: hats(2, 0.6, 0.4) },
      base: {
        kick: [...at([0], 0.9), ...at([6, 10], 0.74)],
        snare: BACKBEAT,
        hihat: hats(1, 0.62, 0.34),
      },
      full: {
        kick: [...at([0], 0.92), ...at([3, 6, 10], 0.76)],
        snare: [...BACKBEAT, ...at([7, 15], 0.38)], // ghost notes
        hihat: hats(1, 0.66, 0.36),
      },
    },
  },
  disco: {
    id: 'disco',
    label: 'Four on the floor',
    bars: {
      light: { kick: at([0, 4, 8, 12], 0.8), snare: at([12], 0.7), hihat: hats(4, 0.56, 0.4) },
      base: { kick: at([0, 4, 8, 12], 0.88), snare: BACKBEAT, hihat: hats(2, 0.62, 0.46) },
      full: {
        kick: at([0, 4, 8, 12], 0.92),
        snare: BACKBEAT,
        // Offbeat accent = the open-hat feel, with one hi-hat voice.
        hihat: hats(2, 0.5, 0.7),
      },
    },
  },
  ballad: {
    id: 'ballad',
    label: 'Ballad',
    bars: {
      light: { kick: at([0], 0.7), snare: at([12], 0.6), hihat: hats(4, 0.44, 0.32) },
      base: { kick: at([0, 8], 0.74), snare: at([4, 12], 0.68), hihat: hats(4, 0.5, 0.36) },
      full: { kick: at([0, 8], 0.8), snare: BACKBEAT, hihat: hats(2, 0.54, 0.38) },
    },
  },
  halfTime: {
    id: 'halfTime',
    label: 'Half-time',
    bars: {
      light: { kick: at([0], 0.82), snare: at([8], 0.8), hihat: hats(4, 0.54, 0.38) },
      base: { kick: at([0], 0.88), snare: at([8], 0.85), hihat: hats(2, 0.58, 0.4) },
      full: {
        kick: [...at([0], 0.9), ...at([11], 0.7)],
        snare: at([8], 0.88),
        hihat: hats(2, 0.62, 0.42),
      },
    },
  },
}

export function drumStyle(id: DrumStyleId): DrumStyle {
  return STYLES[id] ?? STYLES.rock
}

export function isDrumStyleId(v: unknown): v is DrumStyleId {
  return typeof v === 'string' && v in STYLES
}

// ── Fills ───────────────────────────────────────────────────────────────────

/** Steps rising (or falling) across slots — the shape that makes a fill move. */
function ramp(slots: number[], from: number, to: number): Step[] {
  const n = slots.length
  return slots.map((slot, i) => ({
    slot,
    vel: n <= 1 ? to : from + ((to - from) * i) / (n - 1),
  }))
}

/**
 * Alternating accent/ghost snares — the thing that makes a 16th run sound
 * PLAYED rather than typed. Beats get the accent, the notes between them are
 * ghosts, and the whole shape rises across the run.
 */
function snareRun(slots: number[], from: number, to: number, ghost = 0.42): Step[] {
  const n = slots.length
  return slots.map((slot, i) => {
    const swell = n <= 1 ? to : from + ((to - from) * i) / (n - 1)
    // Slots on a beat (multiples of 4) are the accents; the rest are ghosts.
    return { slot, vel: slot % 4 === 0 ? swell : swell * ghost }
  })
}

/**
 * Fill bars, ordered least → most busy. A fill takes over the last bar of a
 * section so the ear hears the section END rather than the groove just
 * stopping.
 *
 * Two rules keep them from sounding awkward:
 *
 *   1. They start late — slots 0–7 are left to the groove in the quieter
 *      fills, so the bar breaks down partway rather than dropping out whole.
 *   2. Velocities RAMP toward the section boundary and alternate accent /
 *      ghost, instead of every hit landing at the same level. A flat fill
 *      reads as a mistake; a rising one reads as an intention.
 *
 * Ceilings stay near 0.9 so the LOUDNESS knob has headroom before clipping.
 */
export const DRUM_FILLS: PatternBar[] = [
  // 0 — barely a fill: a two-note snare lift on the last 8ths.
  { snare: ramp([12, 14], 0.52, 0.78) },
  // 1 — half-bar snare pickup handing over to toms.
  { snare: ramp([8, 10], 0.5, 0.7), tom: ramp([12, 14], 0.74, 0.9) },
  // 2 — snare run with ghosts, then a descending tom figure.
  {
    snare: snareRun([8, 9, 10, 11], 0.68, 0.82),
    tom: ramp([12, 13, 14, 15], 0.6, 0.92),
  },
  // 3 — full 16th run: kick anchors the downbeat, snare ghosts through, toms
  //     crescendo into the next section.
  {
    kick: at([8], 0.82),
    snare: snareRun([8, 9, 10, 11], 0.72, 0.88, 0.38),
    tom: ramp([12, 13, 14, 15], 0.66, 0.95),
  },
]

// ── Section mapping ─────────────────────────────────────────────────────────

/**
 * Default COMPLEXITY per section kind (Logic's Drummer X axis, Simple ↔
 * Complex). A section inherits this unless the user drags its own knob.
 */
const KIND_COMPLEXITY: Record<SectionKind, number> = {
  intro: 0.2,
  verse: 0.5,
  preChorus: 0.62,
  chorus: 0.85,
  bridge: 0.3,
  solo: 0.85,
  riff: 0.55,
  break: 0.15,
  outro: 0.25,
  custom: 0.5,
}

export function complexityForKind(kind: SectionKind | undefined): number {
  return kind ? (KIND_COMPLEXITY[kind] ?? 0.5) : 0.5
}

/** Continuous complexity → one of the three authored pattern tiers. */
export function intensityForComplexity(complexity: number): DrumIntensity {
  if (complexity < 0.34) return 'light'
  if (complexity < 0.7) return 'base'
  return 'full'
}

/**
 * Velocity multiplier from the LOUDNESS knob (Logic's Y axis, Soft ↔ Loud).
 * 0.5 is neutral, so the authored velocities are what you get by default.
 */
export function loudnessGain(loudness: number): number {
  const l = Math.max(0, Math.min(1, loudness))
  return 0.62 + l * 0.76 // 0 → 0.62, 0.5 → 1.0, 1 → 1.38
}

/**
 * Which fill to play leaving a section. Busier as either the FILLS knob or
 * the section's own complexity goes up; alternates within a tier so repeated
 * sections don't fill identically. Deterministic — no RNG, renders must
 * reproduce exactly.
 */
export function fillIndexFor(fills: number, complexity: number, sectionIndex: number): number {
  const f = Math.max(0, Math.min(1, fills))
  const tier = Math.round(f * (DRUM_FILLS.length - 1) * 0.7 + complexity * 0.8)
  return Math.max(0, Math.min(DRUM_FILLS.length - 1, tier + (sectionIndex % 2)))
}
