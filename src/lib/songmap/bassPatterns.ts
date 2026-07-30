/**
 * The bass machine's pattern library — the counterpart to `drumPatterns.ts`.
 *
 * A bass pattern can't name absolute notes: what it plays depends on the chord
 * underneath. So a step names a CHORD DEGREE — an index into the chord's own
 * tones — plus where in the bar it lands and how long it rings. The generator
 * resolves that against the harmony at that moment.
 *
 * Grid is the same 16th-note bar grid the drums use:
 *
 *     slot   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
 *     beat   1   .   &   .   2   .   &   .   3   .   &   .   4   .   &   .
 *
 * Degrees are indices into `chordIntervalSemitones` (0 = root, 1 = third,
 * 2 = fifth, …) rather than raw semitones, so a minor chord gets a minor
 * third for free and a sus4 gets its fourth. `OCTAVE` is the special case.
 */
import type { BassStyleId, SectionKind } from './types'

/** Degree index into the chord's tones; `OCTAVE` = the root, an octave up. */
export const OCTAVE = -1

export type BassStep = {
  slot: number
  /** Index into the chord's tones, or `OCTAVE`. */
  degree: number
  vel: number
  /** How long the note rings, in beats. Trimmed at the next note / chord. */
  lenBeats: number
}

export type BassIntensity = 'light' | 'base' | 'full'

export type BassStyle = {
  id: BassStyleId
  label: string
  bars: Record<BassIntensity, BassStep[]>
  /** Re-attack the root when a chord changes mid-bar (off for pedal tones). */
  followsChordChanges: boolean
}

export const BASS_STYLES: { id: BassStyleId; label: string }[] = [
  { id: 'roots', label: 'Roots' },
  { id: 'rootFifth', label: 'Root & fifth' },
  { id: 'octaves', label: 'Octaves' },
  { id: 'eighths', label: 'Driving 8ths' },
  { id: 'walking', label: 'Walking' },
  { id: 'pedal', label: 'Pedal' },
]

// ── Authoring helpers ───────────────────────────────────────────────────────

function note(slot: number, degree: number, vel: number, lenBeats: number): BassStep {
  return { slot, degree, vel, lenBeats }
}

/** Even notes on the root at a fixed subdivision. */
function pulse(everySlots: number, vel: number, lenBeats: number): BassStep[] {
  const out: BassStep[] = []
  for (let slot = 0; slot < 16; slot += everySlots) {
    // Downbeats a touch stronger — a flat bass line sounds sequenced.
    out.push(note(slot, 0, slot % 4 === 0 ? vel : vel * 0.82, lenBeats))
  }
  return out
}

// ── The styles ──────────────────────────────────────────────────────────────

const STYLES: Record<BassStyleId, BassStyle> = {
  roots: {
    id: 'roots',
    label: 'Roots',
    followsChordChanges: true,
    bars: {
      light: [note(0, 0, 0.78, 4)],
      base: [note(0, 0, 0.82, 4)],
      full: [note(0, 0, 0.85, 2), note(8, 0, 0.76, 2)],
    },
  },
  rootFifth: {
    id: 'rootFifth',
    label: 'Root & fifth',
    followsChordChanges: true,
    bars: {
      light: [note(0, 0, 0.8, 2), note(8, 2, 0.72, 2)],
      base: [note(0, 0, 0.84, 2), note(8, 2, 0.75, 2)],
      full: [note(0, 0, 0.85, 1), note(4, 2, 0.72, 1), note(8, 0, 0.8, 1), note(12, 2, 0.74, 1)],
    },
  },
  octaves: {
    id: 'octaves',
    label: 'Octaves',
    followsChordChanges: true,
    bars: {
      light: [note(0, 0, 0.8, 2), note(8, OCTAVE, 0.7, 2)],
      base: [note(0, 0, 0.84, 1), note(4, OCTAVE, 0.72, 1), note(8, 0, 0.8, 1), note(12, OCTAVE, 0.72, 1)],
      full: [
        note(0, 0, 0.85, 0.5),
        note(2, OCTAVE, 0.7, 0.5),
        note(4, 0, 0.78, 0.5),
        note(6, OCTAVE, 0.7, 0.5),
        note(8, 0, 0.82, 0.5),
        note(10, OCTAVE, 0.7, 0.5),
        note(12, 0, 0.78, 0.5),
        note(14, OCTAVE, 0.72, 0.5),
      ],
    },
  },
  eighths: {
    id: 'eighths',
    label: 'Driving 8ths',
    followsChordChanges: true,
    bars: {
      light: pulse(4, 0.8, 1),
      base: pulse(2, 0.8, 0.5),
      full: pulse(2, 0.85, 0.5),
    },
  },
  walking: {
    id: 'walking',
    label: 'Walking',
    followsChordChanges: true,
    bars: {
      // Quarter notes climbing the chord — root, third, fifth, octave.
      light: [note(0, 0, 0.8, 1), note(8, 2, 0.74, 1)],
      base: [note(0, 0, 0.82, 1), note(4, 1, 0.74, 1), note(8, 2, 0.76, 1), note(12, 1, 0.72, 1)],
      full: [
        note(0, 0, 0.84, 1),
        note(4, 1, 0.75, 1),
        note(8, 2, 0.78, 1),
        note(12, OCTAVE, 0.74, 1),
      ],
    },
  },
  pedal: {
    id: 'pedal',
    label: 'Pedal',
    // A pedal deliberately IGNORES chord changes — that's the whole point.
    followsChordChanges: false,
    bars: {
      light: [note(0, 0, 0.72, 4)],
      base: [note(0, 0, 0.78, 4)],
      full: [note(0, 0, 0.8, 4)],
    },
  },
}

export function bassStyle(id: BassStyleId): BassStyle {
  return STYLES[id] ?? STYLES.roots
}

export function isBassStyleId(v: unknown): v is BassStyleId {
  return typeof v === 'string' && v in STYLES
}

// ── Section mapping ─────────────────────────────────────────────────────────

/** Default complexity per section kind — mirrors the drum machine's curve. */
const KIND_COMPLEXITY: Record<SectionKind, number> = {
  intro: 0.2,
  verse: 0.5,
  preChorus: 0.62,
  chorus: 0.85,
  bridge: 0.3,
  solo: 0.8,
  riff: 0.55,
  break: 0.15,
  outro: 0.25,
  custom: 0.5,
}

export function bassComplexityForKind(kind: SectionKind | undefined): number {
  return kind ? (KIND_COMPLEXITY[kind] ?? 0.5) : 0.5
}

export function bassIntensityForComplexity(complexity: number): BassIntensity {
  if (complexity < 0.34) return 'light'
  if (complexity < 0.7) return 'base'
  return 'full'
}

/** Velocity multiplier from the LOUDNESS knob; 0.5 is neutral. */
export function bassLoudnessGain(loudness: number): number {
  const l = Math.max(0, Math.min(1, loudness))
  return 0.66 + l * 0.68
}
