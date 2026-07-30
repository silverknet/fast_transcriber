/**
 * The bass machine's SOUND catalogue — everything the picker offers.
 *
 * Two families behind one list:
 *
 *   - `synth`  — BarBro's own subtractive voice (`BassTone`), rendered through
 *                the same Web Audio graph the chords view plays.
 *   - `sample` — a multisampled instrument from `static/bass/<dir>/<midi>.wav`.
 *                Sampled sets come from the user's Logic library, so they only
 *                exist on a machine that has it; the picker hides any set whose
 *                files aren't there rather than offering silence.
 *
 * A sampled set doesn't need every semitone — the player picks the nearest
 * recorded root and shifts it, which is what a sampler does.
 */
import { DEFAULT_BASS_TONE, type BassTone } from './bassTone'

export type BassSound =
  | { id: string; label: string; group: string; kind: 'synth'; tone: BassTone }
  | {
      id: string
      label: string
      group: string
      kind: 'sample'
      /** Folder under `static/bass/`. */
      dir: string
      /** MIDI notes that exist as files. */
      roots: number[]
      /** Gentle tone shaping applied after the sampler. */
      cutoffHz: number
      drive: number
    }

const synth = (
  id: string,
  label: string,
  tone: Partial<BassTone>,
): Extract<BassSound, { kind: 'synth' }> => ({
  id,
  label,
  group: 'BarBro synth',
  kind: 'synth',
  tone: { ...DEFAULT_BASS_TONE, ...tone },
})

/**
 * The synth side. `finger` is the chords-view patch verbatim — the reference
 * point — and the rest move one or two things away from it so the differences
 * are audible rather than cosmetic.
 */
const SYNTH_SOUNDS: BassSound[] = [
  synth('finger', 'Finger', {}),
  synth('round', 'Round', {
    waveA: 'triangle',
    levelB: 1,
    cutoffHz: 420,
    resonance: 0.4,
    drive: 0.12,
  }),
  synth('pick', 'Pick', {
    cutoffHz: 1400,
    resonance: 1.3,
    attack: 0.002,
    decay: 0.12,
    sustain: 0.5,
    drive: 0.42,
  }),
  synth('sub', 'Sub', {
    waveA: 'sine',
    waveB: 'sine',
    levelB: 1,
    cutoffHz: 260,
    resonance: 0.2,
    drive: 0.05,
  }),
  synth('growl', 'Growl', {
    waveB: 'square',
    levelB: 0.6,
    cutoffHz: 900,
    resonance: 2.2,
    velToCutoff: 0.8,
    drive: 0.55,
  }),
  synth('moog', 'Moog', {
    waveA: 'sawtooth',
    waveB: 'sawtooth',
    levelB: 0.7,
    detuneB: 7,
    cutoffHz: 520,
    resonance: 2.8,
    velToCutoff: 0.6,
    decay: 0.35,
    sustain: 0.55,
    drive: 0.3,
  }),
  synth('acid', 'Acid', {
    waveA: 'sawtooth',
    waveB: 'sawtooth',
    levelB: 0,
    cutoffHz: 700,
    resonance: 3.6,
    velToCutoff: 1,
    attack: 0.001,
    decay: 0.16,
    sustain: 0.25,
    drive: 0.5,
  }),
  synth('flat', 'Clean DI', {
    waveA: 'triangle',
    waveB: 'sine',
    cutoffHz: 2600,
    resonance: 0.2,
    drive: 0,
  }),
]

/** Multisampled instruments. `roots` must match the files on disk. */
const SAMPLE_SOUNDS: BassSound[] = [
  {
    id: 'upright',
    label: 'Upright (Logic)',
    group: 'Sampled',
    kind: 'sample',
    dir: 'upright',
    roots: [28, 29, 33, 35, 36, 40, 41, 43, 45, 47],
    cutoffHz: 5000,
    drive: 0.08,
  },
]

export const BASS_SOUNDS: BassSound[] = [...SYNTH_SOUNDS, ...SAMPLE_SOUNDS]

export const DEFAULT_BASS_SOUND_ID = 'finger'

export function bassSound(id: string | undefined): BassSound {
  return BASS_SOUNDS.find((s) => s.id === id) ?? BASS_SOUNDS[0]!
}

/** Groups in list order, for an option-group picker. */
export function bassSoundGroups(): { group: string; sounds: BassSound[] }[] {
  const out: { group: string; sounds: BassSound[] }[] = []
  for (const s of BASS_SOUNDS) {
    const g = out.find((x) => x.group === s.group)
    if (g) g.sounds.push(s)
    else out.push({ group: s.group, sounds: [s] })
  }
  return out
}

/** Nearest recorded root — the sampler shifts from here. */
export function nearestRoot(roots: number[], midi: number): number {
  let best = roots[0] ?? midi
  for (const r of roots) if (Math.abs(r - midi) < Math.abs(best - midi)) best = r
  return best
}
