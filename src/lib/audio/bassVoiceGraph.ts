/**
 * The bass voice as Web Audio nodes — the ONE construction, shared by the
 * offline renderer and the live MIDI track.
 *
 * Both need the identical graph:
 *
 *   oscA + oscB (or a pitched sample) → lowpass → gain(ADSR) → bus
 *   bus → highpass(50 Hz) → waveshaper(drive) → out
 *
 * Keeping it here rather than inside the renderer is the same lesson the drum
 * migration taught: a second copy of a voice drifts from the first, and the
 * difference shows up as "the mixer sounds worse than the chords tab" long
 * after the change that caused it.
 *
 * Nothing here creates a context — callers pass their own, offline or live.
 */
import { bassSound, nearestRoot, type BassSound } from './bassSounds'
import type { BassTone } from './bassTone'

export type BassVoiceNote = {
  /** Seconds on the CALLER's timeline; the caller rebases as it needs. */
  atSec: number
  durationSec: number
  midi: number
  /** 0..1 */
  velocity: number
}

/**
 * Below this the kick and the bass fight for the same energy, and a PA mostly
 * can't reproduce it — it just eats headroom. Clearing it lets the KICK own
 * the sub while the bass is carried by its harmonics.
 */
export const BASS_BUS_HIGHPASS_HZ = 50

export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** The exact curve `KeysSynth.makeDriveCurve` uses. */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> | null {
  if (drive <= 0.001) return null
  const k = 1 + drive * 6
  const norm = Math.tanh(k)
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

/** Sampled sets carry their own grit; the synth uses the patch's. */
export function driveFor(soundId: string | undefined, tone: BassTone): number {
  const s = bassSound(soundId)
  return s.kind === 'sample' ? s.drive : tone.drive
}

export type BassBus = {
  /** Notes connect here. */
  input: AudioNode
  /** Wire this to a destination (offline) or a mixer track (live). */
  output: AudioNode
}

export function createBassBus(
  ctx: BaseAudioContext,
  tone: BassTone,
  soundId: string | undefined,
): BassBus {
  const input = ctx.createGain()
  input.gain.value = 1
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = BASS_BUS_HIGHPASS_HZ
  const shaper = ctx.createWaveShaper()
  const curve = driveCurve(driveFor(soundId, tone))
  if (curve) shaper.curve = curve
  input.connect(highpass)
  highpass.connect(shaper)
  return { input, output: shaper }
}

/** Everything a note needs that doesn't change per note. */
export type BassVoiceSetup = {
  sound: BassSound
  /** Decoded roots for a sampled set, or null (synth, or files absent). */
  samples: Map<number, AudioBuffer> | null
  useSamples: boolean
  shaping: { cutoffHz: number; drive: number } | null
}

export function bassVoiceSetup(
  soundId: string | undefined,
  samples: Map<number, AudioBuffer> | null,
): BassVoiceSetup {
  const sound = bassSound(soundId)
  const useSamples = sound.kind === 'sample' && samples !== null
  return {
    sound,
    samples,
    useSamples,
    shaping: sound.kind === 'sample' ? { cutoffHz: sound.cutoffHz, drive: sound.drive } : null,
  }
}

/**
 * Build and schedule ONE note into `dest`, starting at `startSec` on the
 * context's own clock. Returns the sources so a live caller can stop them.
 */
export function scheduleBassNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  note: BassVoiceNote,
  startSec: number,
  tone: BassTone,
  setup: BassVoiceSetup,
  /** Varispeed: >1 plays the part faster, shortening each note. */
  rate = 1,
): AudioScheduledSourceNode[] {
  if (!(note.durationSec > 0)) return []
  const nyquist = ctx.sampleRate / 2
  const vel = Math.max(0, Math.min(1, note.velocity))
  const f0 = midiToFreq(note.midi)

  const amp = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  // Velocity opens the filter, exactly as the live patch's velToCutoff does.
  filter.frequency.value = Math.max(
    30,
    Math.min(
      nyquist * 0.95,
      (setup.shaping?.cutoffHz ?? tone.cutoffHz) * (1 + tone.velToCutoff * (vel - 0.5) * 2),
    ),
  )
  filter.Q.value = setup.useSamples ? 0.0001 : Math.max(0.0001, tone.resonance)

  const sources: AudioScheduledSourceNode[] = []
  if (setup.useSamples && setup.samples) {
    // Nearest recorded root, shifted — a sampler, not one stretched sample.
    const root = nearestRoot([...setup.samples.keys()], note.midi)
    const buf = setup.samples.get(root)!
    const src = ctx.createBufferSource()
    src.buffer = buf
    // NOT scaled by `rate` — see the oscillator branch below.
    src.playbackRate.value = 2 ** ((note.midi - root) / 12)
    src.connect(filter)
    sources.push(src)
  } else {
    for (const [type, level, detune] of [
      [tone.waveA, tone.levelA, tone.detuneA],
      [tone.waveB, tone.levelB, tone.detuneB],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = type as OscillatorType
      // NOT pitched by the varispeed rate.
      //
      // A rendered buffer has to be re-pitched to transpose, but a MIDI lane
      // transposes by moving the NOTE (`transposeMidiNote`) — which is exact and
      // artifact-free. Applying the rate here as well would transpose it twice:
      // +2 semitones of notes played through a +2-semitone rate lands ~4 up.
      //
      // Timing still follows the rate (durations and the envelope below divide
      // by it), so the line stays locked to the song.
      osc.frequency.value = f0
      osc.detune.value = detune
      const g = ctx.createGain()
      g.gain.value = level
      osc.connect(g)
      g.connect(filter)
      sources.push(osc)
    }
  }

  filter.connect(amp)
  amp.connect(dest)

  // ADSR. A note shorter than attack+decay squeezes them in rather than
  // running past its own length. Times compress with the rate.
  const dur = note.durationSec / rate
  let a = tone.attack / rate
  let d = tone.decay / rate
  if (a + d > dur) {
    const scale = dur / (a + d)
    a *= scale
    d *= scale
  }
  const rel = tone.release / rate
  const peak = vel
  const sustain = Math.max(0.0001, vel * tone.sustain)
  const g = amp.gain
  g.setValueAtTime(0.0001, startSec)
  g.linearRampToValueAtTime(Math.max(0.0001, peak), startSec + a)
  g.exponentialRampToValueAtTime(sustain, startSec + a + d)
  g.setValueAtTime(sustain, startSec + dur)
  g.exponentialRampToValueAtTime(0.0001, startSec + dur + rel)

  const stopAt = startSec + dur + rel
  for (const src of sources) {
    try {
      src.start(startSec)
      src.stop(stopAt)
    } catch {
      /* out of range */
    }
  }
  // Release the per-note nodes once the voice has finished.
  const last = sources[sources.length - 1]
  if (last) {
    last.onended = () => {
      try {
        filter.disconnect()
        amp.disconnect()
      } catch {
        /* already gone */
      }
    }
  }
  return sources
}
