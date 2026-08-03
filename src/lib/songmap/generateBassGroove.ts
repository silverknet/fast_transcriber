/**
 * The bass machine — play a bass line from the song's CHORDS.
 *
 * Sibling of `generateDrumGroove`: same 16th grid, same section blocks, same
 * inherit-from-the-section-kind behaviour. The difference is where the notes
 * come from — a bass pattern names chord DEGREES, and the harmony under each
 * slot decides what pitch that actually is.
 *
 * Three things make it sound like a bass player rather than an arpeggiator:
 *
 *   1. Notes fold into a real bass register, so a chord chart that wanders
 *      through several octaves still plays in one place on the neck.
 *   2. A slash chord plays its BASS note, not its root — `C/E` is an E.
 *   3. Notes are trimmed at the next note and at chord changes, so nothing
 *      rings over a chord it doesn't belong to.
 *
 * Deterministic: same `.smap` + spec ⇒ identical notes. No RNG.
 */
import { buildBarSlots } from './drumGroove'
import {
  OCTAVE,
  bassComplexityForKind,
  bassIntensityForComplexity,
  bassLoudnessGain,
  bassStyle,
  type BassStep,
} from './bassPatterns'
import { chordIntervalSemitones } from '$lib/chords/chordVoicing'
import { chordRootToPitchClass } from '$lib/chords/pitchClass'
import { bassMidiFor } from '$lib/audio/chordBass'
import { buildSectionBlocksForBars, type SectionBlock } from './sectionBlocks'
import type {
  BassMachine,
  BassMachineSection,
  BassMidiEvent,
  ChordSymbol,
  HarmonyEvent,
  SongMap,
} from './types'

export type BassGrooveSpec = Pick<
  BassMachine,
  'style' | 'complexity' | 'loudness' | 'octave' | 'perSection'
>


/** Shortest audible note; also the gap left before the next note. */
const MIN_NOTE_SEC = 0.05
const NOTE_GAP_SEC = 0.015

function blocksWithSections(sm: SongMap, barSlots: ReturnType<typeof buildBarSlots>): SectionBlock[] {
  return buildSectionBlocksForBars(sm.sections, barSlots.map((slot) => slot.bar))
}

/**
 * The chords in play order. Harmony carries forward: a chord sounds until the
 * next event starts, which is how the editor displays it too.
 */
function chordTimeline(sm: SongMap): HarmonyEvent[] {
  return [...sm.harmony].sort((a, b) => a.startSec - b.startSec)
}

/** The chord sounding at `t`, or null before the first one / on an N.C. */
function chordAt(timeline: HarmonyEvent[], t: number): ChordSymbol | null {
  let lo = 0
  let hi = timeline.length - 1
  let found: HarmonyEvent | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (timeline[mid]!.startSec <= t + 1e-6) {
      found = timeline[mid]!
      lo = mid + 1
    } else hi = mid - 1
  }
  if (!found) return null
  return found.chord.noChord ? null : found.chord
}

/** Start time of the first chord change strictly after `t`, else Infinity. */
function nextChordChangeAfter(timeline: HarmonyEvent[], t: number): number {
  for (const h of timeline) if (h.startSec > t + 1e-6) return h.startSec
  return Infinity
}

/**
 * The note a chord's bass line sits on. A slash chord (`C/E`) plays its BASS
 * note — that's the whole point of writing one — otherwise the root.
 */
function bassPitchClass(chord: ChordSymbol): number {
  return chord.bass
    ? chordRootToPitchClass(chord.bass, chord.bassAccidental)
    : chordRootToPitchClass(chord.root, chord.accidental)
}

/**
 * Place a pitch class in the bass register — REUSING the chords view's own
 * placement (`bassMidiFor`, centred on E2) rather than a second rule.
 *
 * This was the bug behind "sounds much worse than the chords tab": folding
 * into the octave above E1 put the line ~6 semitones lower, where the bus
 * high-pass eats the fundamental. Thin and muddy at the same time.
 */
function foldToBassRegister(pc: number, octaveShift = 0): number {
  return bassMidiFor(pc, octaveShift)
}

/**
 * Resolve a pattern degree against a chord. Degree 0 is always the bass note;
 * higher degrees walk up the chord's own tones, so a minor chord gets a minor
 * third without the pattern knowing anything about quality.
 */
function midiForStep(chord: ChordSymbol, step: BassStep, octaveShift = 0): number {
  const base = foldToBassRegister(bassPitchClass(chord), octaveShift)
  if (step.degree === OCTAVE) return base + 12
  if (step.degree === 0) return base
  const tones = chordIntervalSemitones(chord)
  const interval = tones[step.degree] ?? tones[tones.length - 1] ?? 0
  return base + interval
}

type ResolvedBlock = {
  steps: BassStep[]
  followsChordChanges: boolean
  gain: number
  octaveShift: number
  muted: boolean
}

function resolveBlock(block: SectionBlock, spec: BassGrooveSpec): ResolvedBlock {
  const override = block.section ? spec.perSection?.[block.section.id] : undefined
  if (override?.muted) {
    return { steps: [], followsChordChanges: true, gain: 1, octaveShift: 0, muted: true }
  }
  const style = bassStyle(override?.style ?? spec.style)
  const complexity =
    override?.complexity ?? spec.complexity ?? bassComplexityForKind(block.section?.kind)
  const loudness = override?.loudness ?? spec.loudness ?? 0.5
  const octave = override?.octave ?? spec.octave ?? 0
  return {
    steps: style.bars[bassIntensityForComplexity(complexity)],
    followsChordChanges: style.followsChordChanges,
    gain: bassLoudnessGain(loudness),
    octaveShift: Math.max(-2, Math.min(2, Math.round(octave))),
    muted: false,
  }
}

/**
 * Generate the bass line. Returns events in ORIGINAL audio time (the same base
 * as `Beat.timeSec`), sorted, ready for `renderBassTrack`.
 */
export function generateBassGroove(sm: SongMap, spec: BassGrooveSpec): BassMidiEvent[] {
  const barSlots = buildBarSlots(sm)
  const timeline = chordTimeline(sm)
  // Without chords there is no bass line to play — this is not a failure, the
  // user just hasn't written the harmony yet.
  if (barSlots.length === 0 || timeline.length === 0) return []

  const blocks = blocksWithSections(sm, barSlots)
  const out: BassMidiEvent[] = []

  blocks.forEach((block) => {
    const { steps, followsChordChanges, gain, octaveShift, muted } = resolveBlock(block, spec)
    if (muted) return

    for (let bar = block.start; bar <= block.end; bar++) {
      const slots = barSlots[bar]
      if (!slots || slots.slotTimes.length === 0) continue
      const { slotTimes } = slots
      // Beat length from this bar's own grid, so the line follows tempo drift.
      const beatSec = (slots.bar.endSec - slots.bar.startSec) / Math.max(1, slots.beats.length)

      for (const step of steps) {
        const t = slotTimes[step.slot]
        if (t === undefined || !Number.isFinite(t)) continue
        const chord = chordAt(timeline, t)
        // N.C. and pre-first-chord bars stay silent rather than guessing.
        if (!chord) continue

        let end = t + step.lenBeats * beatSec
        // Never ring over a chord the note doesn't belong to.
        if (followsChordChanges) {
          end = Math.min(end, nextChordChangeAfter(timeline, t))
        }
        end = Math.min(end, slots.bar.endSec + beatSec) - NOTE_GAP_SEC
        const durationSec = end - t
        if (!(durationSec > MIN_NOTE_SEC)) continue

        const midi = midiForStep(chord, step, octaveShift)
        out.push({
          timeSec: t,
          durationSec,
          midi: Math.max(0, Math.min(127, midi)),
          velocity: Math.max(0, Math.min(1, step.vel * gain)),
        })
      }

      // A chord that lands mid-bar needs its own attack, or the line keeps
      // playing the previous chord until the next slot comes round.
      if (followsChordChanges) {
        const barEnd = slots.bar.endSec
        for (const h of timeline) {
          if (h.startSec <= slots.bar.startSec + 1e-6 || h.startSec >= barEnd - 1e-6) continue
          if (h.chord.noChord) continue
          // Only if no pattern step already attacks there.
          if (steps.some((s) => Math.abs((slotTimes[s.slot] ?? -1) - h.startSec) < 1e-3)) continue
          const end =
            Math.min(nextChordChangeAfter(timeline, h.startSec), barEnd + beatSec) - NOTE_GAP_SEC
          const durationSec = end - h.startSec
          if (!(durationSec > MIN_NOTE_SEC)) continue
          out.push({
            timeSec: h.startSec,
            durationSec,
            midi: Math.max(0, Math.min(127, foldToBassRegister(bassPitchClass(h.chord), octaveShift))),
            velocity: Math.max(0, Math.min(1, 0.8 * gain)),
          })
        }
      }
    }
  })

  out.sort((a, b) => a.timeSec - b.timeSec || a.midi - b.midi)
  return out
}
