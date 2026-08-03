/**
 * The drum machine — lay a pattern library over a song's bars.
 *
 * This is the counterpart to `drumGroove.ts`: that one INFERS a groove from
 * detected audio, this one GENERATES one from authored patterns. It reads
 * nothing but the timeline and the sections, so it works on a song with no
 * drum stem at all.
 *
 * Structure comes from the sections:
 *   - each section picks a style + intensity (its kind's default, or the
 *     user's per-section override)
 *   - the last bar of a section becomes a FILL, so sections lead into each
 *     other instead of just stopping
 *   - a crash lands on each section's first downbeat
 *
 * Fully deterministic — same `.smap` + same spec ⇒ identical events. No RNG:
 * renders have to be reproducible across machines and builds.
 */
import { buildBarSlots } from './drumGroove'
import {
  DRUM_FILLS,
  complexityForKind,
  drumStyle,
  fillIndexFor,
  intensityForComplexity,
  loudnessGain,
  type DrumStyleId,
  type PatternBar,
  type Step,
} from './drumPatterns'
import { buildSectionBlocksForBars, type SectionBlock } from './sectionBlocks'
import type {
  DrumClass,
  DrumMachine,
  DrumMachineSection,
  DrumMidiEvent,
  DrumPulseVoice,
  DrumVoiceToggles,
  SongMap,
} from './types'

/**
 * What the generator needs from a `DrumMachine` — the persisted track minus
 * the bits that are about storage rather than sound (`enabled`, `kit`,
 * `renderExport`). Derived from the schema type so the two cannot drift.
 */
export type DrumGrooveSpec = Pick<
  DrumMachine,
  | 'style'
  | 'complexity'
  | 'loudness'
  | 'fills'
  | 'pulse'
  | 'voices'
  | 'crashOnSectionStart'
  | 'perSection'
>

export type SectionGrooveOverride = DrumMachineSection

const CRASH_VEL = 0.9
const DRUM_CLASSES: DrumClass[] = ['kick', 'snare', 'hihat', 'tom', 'cymbal', 'ride']

/**
 * Bars grouped by section, with gaps between sections kept as unlabelled
 * blocks so an un-sectioned song still gets a groove.
 */
function blocksWithSections(sm: SongMap, barSlots: ReturnType<typeof buildBarSlots>): SectionBlock[] {
  return buildSectionBlocksForBars(sm.sections, barSlots.map((slot) => slot.bar))
}

/** Lowest slot touched by a fill — where the groove hands over. */
function fillStartSlot(fill: PatternBar): number {
  let min = Infinity
  for (const cls of DRUM_CLASSES) {
    for (const step of fill[cls] ?? []) min = Math.min(min, step.slot)
  }
  return Number.isFinite(min) ? min : 0
}

/**
 * A fill bar keeps the groove running up to where the fill starts, then hands
 * over. Without this the whole bar drops out and it reads as a stop, not a fill.
 */
function mergeFillOverPattern(pattern: PatternBar, fill: PatternBar): PatternBar {
  const cut = fillStartSlot(fill)
  const out: PatternBar = {}
  for (const cls of DRUM_CLASSES) {
    const kept = (pattern[cls] ?? []).filter((s) => s.slot < cut)
    const added = fill[cls] ?? []
    if (kept.length || added.length) out[cls] = [...kept, ...added]
  }
  return out
}

/**
 * Move the authored hi-hat layer onto the chosen pulse voice. Patterns only
 * ever author `hihat`, so every style can be played hat-driven, ride-driven,
 * or with no pulse at all without authoring three copies of each.
 */
function applyPulse(bar: PatternBar, pulse: DrumPulseVoice): PatternBar {
  if (pulse === 'hihat') return bar
  const { hihat, ...rest } = bar
  if (pulse === 'none') return rest
  // Ride: merge onto anything the pattern already put there.
  return { ...rest, ride: [...(rest.ride ?? []), ...(hihat ?? [])] }
}

/** Drop any kit piece the user switched off. */
function applyVoiceToggles(bar: PatternBar, voices: DrumVoiceToggles | undefined): PatternBar {
  if (!voices) return bar
  const out: PatternBar = {}
  for (const cls of DRUM_CLASSES) {
    if (voices[cls] === false) continue
    const steps = bar[cls]
    if (steps?.length) out[cls] = steps
  }
  return out
}

type ResolvedBlock = {
  pattern: PatternBar
  complexity: number
  gain: number
  fills: number
  pulse: DrumPulseVoice
  voices: DrumVoiceToggles | undefined
  muted: boolean
}

/**
 * Settle a section's effective controls: its own override, else the song-wide
 * value, else — for complexity only — the section KIND's default. That last
 * fallback is what makes an untouched song follow its own arrangement.
 */
function resolveBlock(block: SectionBlock, spec: DrumGrooveSpec): ResolvedBlock {
  const override = block.section ? spec.perSection?.[block.section.id] : undefined
  if (override?.muted) {
    return {
      pattern: {},
      complexity: 0,
      gain: 1,
      fills: 0,
      pulse: 'hihat',
      voices: undefined,
      muted: true,
    }
  }
  const styleId = override?.style ?? spec.style
  const complexity =
    override?.complexity ?? spec.complexity ?? complexityForKind(block.section?.kind)
  const loudness = override?.loudness ?? spec.loudness ?? 0.5
  const fills = override?.fills ?? spec.fills ?? 0.5
  const pulse = override?.pulse ?? spec.pulse ?? 'hihat'
  // A section's switches REPLACE the song's rather than merging: half-inherited
  // kit pieces would be impossible to reason about from the UI.
  const voices = override?.voices ?? spec.voices
  return {
    pattern: drumStyle(styleId).bars[intensityForComplexity(complexity)],
    complexity,
    gain: loudnessGain(loudness),
    fills,
    pulse,
    voices,
    muted: false,
  }
}

/**
 * Generate the drum part. Returns events in ORIGINAL audio time (the same
 * base as `Beat.timeSec`), sorted, ready to hand to `renderDrumTrack`.
 */
export function generateDrumGroove(sm: SongMap, spec: DrumGrooveSpec): DrumMidiEvent[] {
  const barSlots = buildBarSlots(sm)
  if (barSlots.length === 0) return []

  const withCrash = spec.crashOnSectionStart ?? true
  const blocks = blocksWithSections(sm, barSlots)
  const out: DrumMidiEvent[] = []

  const emit = (slotTimes: number[], cls: DrumClass, step: Step, gain: number) => {
    // Slots past the end of a short bar (3/4 etc.) simply don't exist.
    const t = slotTimes[step.slot]
    if (t === undefined || !Number.isFinite(t)) return
    out.push({ timeSec: t, cls, velocity: Math.max(0, Math.min(1, step.vel * gain)) })
  }

  blocks.forEach((block, blockIndex) => {
    const { pattern, complexity, gain, fills, pulse, voices, muted } = resolveBlock(block, spec)
    if (muted) return
    const crashOn = voices?.cymbal !== false
    const isFinalBlock = blockIndex === blocks.length - 1
    const barCount = block.end - block.start + 1

    for (let bar = block.start; bar <= block.end; bar++) {
      const slots = barSlots[bar]
      if (!slots) continue
      const { slotTimes } = slots

      // A fill needs somewhere to lead: not on a one-bar block, not at the
      // very end of the song, and not when the fills knob is all the way down.
      const isLastBar = bar === block.end
      const fillHere = fills > 0 && isLastBar && barCount >= 2 && !isFinalBlock
      const withFill = fillHere
        ? mergeFillOverPattern(
            pattern,
            DRUM_FILLS[fillIndexFor(fills, complexity, blockIndex)]!,
          )
        : pattern
      // Pulse swap first, THEN the switches — so turning the ride off really
      // silences a ride-driven groove rather than leaving stray hats.
      const barPattern = applyVoiceToggles(applyPulse(withFill, pulse), voices)

      for (const cls of DRUM_CLASSES) {
        for (const step of barPattern[cls] ?? []) emit(slotTimes, cls, step, gain)
      }

      if (withCrash && crashOn && bar === block.start && block.section) {
        emit(slotTimes, 'cymbal', { slot: 0, vel: CRASH_VEL }, gain)
      }
    }
  })

  out.sort((a, b) => a.timeSec - b.timeSec || a.cls.localeCompare(b.cls))
  return out
}
