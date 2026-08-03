/**
 * A tweakable BASS voice for chord playback (chords view). Plays the chord's
 * bass note (root, or the slash bass) on a rhythmic grid — whole notes, quarters,
 * eighths, or sixteenths — through its own {@link KeysSynth} so it has its own
 * patch + FX, independent of the keys.
 *
 * The rhythm GRID is a pure function ({@link buildBassHits}); the caller watches
 * the transport playhead and fires each hit via {@link playBassNote}. Its
 * `AudioContext` is created lazily on the first {@link resumeBass}, so importing
 * is SSR-safe.
 */
import { KeysSynth, structuredClonePatch, type SynthPatch } from './keysSynth'

export type BassPattern = '1/1' | '4/4' | '8/8' | '16/16'
export const BASS_PATTERNS: BassPattern[] = ['1/1', '4/4', '8/8', '16/16']
export const BASS_PATTERN_LABELS: Record<BassPattern, string> = {
  '1/1': 'Whole',
  '4/4': 'Quarter',
  '8/8': 'Eighth',
  '16/16': 'Sixteenth',
}

/**
 * A fat, warm finger-bass. Both oscillators sit AT the played (low) octave — a
 * saw for harmonic definition (so small speakers imply the fundamental via its
 * overtones) plus a strong sine for weight. Deliberately NO sub-octave layer:
 * that energy lands ~30-40 Hz where laptop/monitor speakers reproduce nothing,
 * which made the old bass sound thin. Warm low-pass, punchy-but-sustained.
 */
export const BASS_PATCH: SynthPatch = {
  name: 'Bass',
  oscA: { type: 'sawtooth', level: 0.9, detune: 0 },
  oscB: { type: 'sine', level: 0.9, detune: 0 }, // weight at the fundamental, not a sub
  filter: { cutoffHz: 650, resonance: 0.9, velToCutoff: 0.5 },
  lfo: { rateHz: 0.4, depth: 0 },
  env: { attack: 0.004, decay: 0.22, sustain: 0.72, release: 0.14 },
  gain: 1, // full — the bass should be felt
  fx: {
    chorus: 0,
    delayMix: 0,
    delayTime: 0.28,
    delayFeedback: 0.2,
    reverbMix: 0.03,
    reverbSize: 0.8,
    highpassHz: 24, // keep the lows, only trim rumble
    reverbPredelay: 0,
    reverbDamp: 2500,
    drive: 0.28, // grit so it cuts through the mix
    shimmer: 0,
  },
}

const BASS_CENTER = 40 // ~E2
const MIDI_MIN = 24
const MIDI_MAX = 72

const nearestOctaveTo = (pc: number, target: number): number => pc + 12 * Math.round((target - pc) / 12)
const clampMidi = (n: number): number => Math.max(MIDI_MIN, Math.min(MIDI_MAX, n))

/** MIDI note for a bass pitch-class, placed low (shifted by the octave offset). */
export function bassMidiFor(bassPc: number, octaveOffset = 0): number {
  return clampMidi(nearestOctaveTo(bassPc, BASS_CENTER + octaveOffset * 12))
}

/**
 * The rhythmic bass hit grid. `beats` are in time order; each carries the bass
 * pitch-class of the chord sounding on it (`null` = no chord → no bass there).
 *   - `1/1`   → one hit per BAR (on the downbeat)
 *   - `4/4`   → one per beat
 *   - `8/8`   → two per beat
 *   - `16/16` → four per beat
 * Subdivisions interpolate to the next beat, so they follow tempo changes.
 */
export function buildBassHits(
  beats: readonly { timeSec: number; barId: string; bassPc: number | null }[],
  pattern: BassPattern,
  octaveOffset = 0,
): { timeSec: number; midi: number }[] {
  const subsPerBeat = pattern === '8/8' ? 2 : pattern === '16/16' ? 4 : 1
  const hits: { timeSec: number; midi: number }[] = []

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!
    if (b.bassPc == null) continue
    const midi = bassMidiFor(b.bassPc, octaveOffset)

    if (pattern === '1/1') {
      const isBarStart = i === 0 || beats[i - 1]!.barId !== b.barId
      if (isBarStart) hits.push({ timeSec: b.timeSec, midi })
      continue
    }

    const next = beats[i + 1]
    const interval = next
      ? next.timeSec - b.timeSec
      : i > 0
        ? b.timeSec - beats[i - 1]!.timeSec
        : 0.5
    for (let k = 0; k < subsPerBeat; k++) {
      hits.push({ timeSec: b.timeSec + (interval * k) / subsPerBeat, midi })
    }
  }

  return hits
}

// ── Live engine ────────────────────────────────────────────────────────────
let synth: KeysSynth | null = null
let sounding: number | null = null
let volume = 0.6
let currentPatch: SynthPatch = BASS_PATCH

function ensureSynth(): KeysSynth {
  if (!synth) {
    synth = new KeysSynth()
    synth.setPatch(currentPatch)
    synth.setVolume(volume)
  }
  return synth
}

export async function resumeBass(): Promise<void> {
  try {
    await ensureSynth().resume()
  } catch {
    /* audio unavailable — bass is optional */
  }
}

export function setBassVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v))
  synth?.setVolume(volume)
}

export function setBassPatch(patch: SynthPatch): void {
  currentPatch = structuredClonePatch(patch)
  synth?.setPatch(currentPatch)
}

/** Play one bass note (monophonic — releases the previous note first). */
export function playBassNote(midi: number): void {
  const s = ensureSynth()
  if (sounding != null) s.noteOff(sounding)
  sounding = midi
  s.noteOn(midi, 120) // hit hard — the bass should be felt
}

export function stopBass(): void {
  if (!synth || sounding == null) return
  synth.noteOff(sounding)
  sounding = null
}
