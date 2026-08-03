/**
 * A small, low-latency, FULLY EDITABLE subtractive synth for playing the APC
 * Key 25 keybed (or an on-screen keyboard) directly in the app.
 *
 * A sound is one `SynthPatch`: two oscillators → a per-voice lowpass filter
 * (velocity + a shared cutoff LFO for movement) → an ADSR amp → the FX bus
 * (chorus → delay → reverb) → out. Everything is live-tweakable and
 * save/loadable, so you can design your own synths and load built-in presets.
 *
 * Same primitives the app already uses for the click track: oscillators + gain
 * envelopes on a live `AudioContext`, scheduled at `ctx.currentTime`. A dedicated
 * context with `latencyHint: 0` keeps latency at the platform floor. The reverb
 * impulse is synthesized (decaying noise) — no sample assets, no deps.
 *
 * Browser-only: the `AudioContext` is created lazily on `resume()` (a user
 * gesture), so importing this on the server is safe.
 */

import { audioDevice } from './audioDevice'

export type OscType = 'sine' | 'triangle' | 'sawtooth' | 'square'

/** Post-voice effects (the FX bus). */
export type SynthFx = {
  chorus: number // 0..1 width/shimmer
  delayMix: number // 0..1
  delayTime: number // seconds 0.02..1.2
  delayFeedback: number // 0..0.95
  reverbMix: number // 0..1
  reverbSize: number // seconds 0.2..6
  // ── Mix polish (optional; transparent defaults keep every old preset identical) ──
  /** Roll off mud below this Hz so the sound sits in the mix (≤20 = off). */
  highpassHz?: number
  /** Seconds of pre-delay before the reverb tail — keeps the attack clear (0 = off). */
  reverbPredelay?: number
  /** Low-pass on the reverb tail for a darker, smoother wash (high Hz = off). */
  reverbDamp?: number
  /** 0..1 soft saturation for analog warmth + glue (0 = perfectly clean). */
  drive?: number
  /** 0..1 bright, gently-pulsing high sparkle on top (0 = none). */
  shimmer?: number
  /** 0..1 analog-style humanization: subtle random per-note detune drift so the
   *  sound isn't the same "plastic" note every time (0 = mathematically perfect). */
  analog?: number
  /** 0..1 phaser — sweeping allpass notches for that psychedelic whoosh (0 = off). */
  phaser?: number
  /** 0..1 auto-wah — an LFO-swept resonant band-pass, funky/vocal (0 = off). */
  wah?: number
}

/** A complete, editable synth sound. */
export type SynthPatch = {
  name: string
  oscA: { type: OscType; level: number; detune: number } // level 0..1, detune cents
  oscB: { type: OscType; level: number; detune: number }
  filter: { cutoffHz: number; resonance: number; velToCutoff: number } // per-voice lowpass
  lfo: { rateHz: number; depth: number } // modulates the filter cutoff (0..1)
  env: { attack: number; decay: number; sustain: number; release: number } // s / 0..1
  gain: number // patch output 0..1
  fx: SynthFx
}

export const DEFAULT_FX: SynthFx = {
  chorus: 0,
  delayMix: 0,
  delayTime: 0.28,
  delayFeedback: 0.3,
  reverbMix: 0.18,
  reverbSize: 2.0,
  // Transparent defaults: HPF near-DC, no pre-delay, tail undamped, no drive/shimmer.
  highpassHz: 20,
  reverbPredelay: 0,
  reverbDamp: 14000,
  drive: 0,
  shimmer: 0,
  // A touch of analog drift on everything so no sound is dead-static/plastic.
  analog: 0.14,
  phaser: 0,
  wah: 0,
}

export const DEFAULT_PATCH: SynthPatch = {
  name: 'Init',
  oscA: { type: 'sawtooth', level: 1, detune: 0 },
  oscB: { type: 'sawtooth', level: 0.6, detune: 8 },
  filter: { cutoffHz: 6000, resonance: 0.8, velToCutoff: 0.4 },
  lfo: { rateHz: 0.4, depth: 0 },
  env: { attack: 0.005, decay: 0.4, sustain: 0.7, release: 0.3 },
  gain: 0.5,
  fx: { ...DEFAULT_FX },
}

/** My built-in presets — a starting palette to load and tweak. */
export const BUILTIN_PRESETS: SynthPatch[] = [
  {
    name: 'Lush Pad',
    oscA: { type: 'sawtooth', level: 1, detune: -7 },
    oscB: { type: 'sawtooth', level: 1, detune: 7 },
    filter: { cutoffHz: 2600, resonance: 3.2, velToCutoff: 0.3 },
    lfo: { rateHz: 0.22, depth: 0.4 },
    env: { attack: 0.35, decay: 0.6, sustain: 0.85, release: 1.1 },
    gain: 0.34,
    fx: { chorus: 0.65, delayMix: 0.25, delayTime: 0.44, delayFeedback: 0.42, reverbMix: 0.6, reverbSize: 3.8 },
  },
  {
    name: 'Electric Piano',
    oscA: { type: 'triangle', level: 1, detune: 0 },
    oscB: { type: 'sine', level: 0.6, detune: 7 },
    filter: { cutoffHz: 2600, resonance: 0.7, velToCutoff: 0.7 },
    lfo: { rateHz: 0.4, depth: 0 },
    env: { attack: 0.002, decay: 0.9, sustain: 0.25, release: 0.35 },
    gain: 0.5,
    fx: { chorus: 0.2, delayMix: 0, delayTime: 0.28, delayFeedback: 0.3, reverbMix: 0.25, reverbSize: 1.8 },
  },
  {
    name: 'Organ',
    oscA: { type: 'sine', level: 1, detune: 0 },
    oscB: { type: 'sine', level: 0.5, detune: 1200 },
    filter: { cutoffHz: 12000, resonance: 0.4, velToCutoff: 0.1 },
    lfo: { rateHz: 5.6, depth: 0.06 }, // gentle leslie-ish shimmer
    env: { attack: 0.005, decay: 0.02, sustain: 1, release: 0.12 },
    gain: 0.3,
    fx: { chorus: 0.3, delayMix: 0, delayTime: 0.28, delayFeedback: 0.3, reverbMix: 0.2, reverbSize: 1.6 },
  },
  {
    name: 'Pluck',
    oscA: { type: 'sawtooth', level: 1, detune: 0 },
    oscB: { type: 'square', level: 0.25, detune: 0 },
    filter: { cutoffHz: 1200, resonance: 2.5, velToCutoff: 0.8 },
    lfo: { rateHz: 0.4, depth: 0 },
    env: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.2 },
    gain: 0.5,
    fx: { chorus: 0, delayMix: 0.28, delayTime: 0.33, delayFeedback: 0.4, reverbMix: 0.22, reverbSize: 1.8 },
  },
  {
    name: 'Warm Brass',
    oscA: { type: 'sawtooth', level: 1, detune: -4 },
    oscB: { type: 'sawtooth', level: 0.9, detune: 4 },
    filter: { cutoffHz: 1800, resonance: 1.2, velToCutoff: 0.6 },
    lfo: { rateHz: 0.5, depth: 0.08 },
    env: { attack: 0.06, decay: 0.3, sustain: 0.8, release: 0.35 },
    gain: 0.38,
    fx: { chorus: 0.25, delayMix: 0, delayTime: 0.28, delayFeedback: 0.3, reverbMix: 0.28, reverbSize: 2.2 },
  },
  {
    name: 'Glass Bell',
    oscA: { type: 'sine', level: 1, detune: 0 },
    oscB: { type: 'sine', level: 0.5, detune: 1900 },
    filter: { cutoffHz: 9000, resonance: 0.6, velToCutoff: 0.4 },
    lfo: { rateHz: 0.4, depth: 0 },
    env: { attack: 0.001, decay: 1.6, sustain: 0.1, release: 0.9 },
    gain: 0.42,
    fx: { chorus: 0.15, delayMix: 0.3, delayTime: 0.38, delayFeedback: 0.35, reverbMix: 0.5, reverbSize: 3.2 },
  },
  {
    name: 'Sub Bass',
    oscA: { type: 'sine', level: 1, detune: 0 },
    oscB: { type: 'triangle', level: 0.4, detune: -1200 },
    filter: { cutoffHz: 800, resonance: 0.8, velToCutoff: 0.5 },
    lfo: { rateHz: 0.4, depth: 0 },
    env: { attack: 0.004, decay: 0.2, sustain: 0.9, release: 0.16 },
    gain: 0.6,
    fx: { chorus: 0, delayMix: 0, delayTime: 0.28, delayFeedback: 0.2, reverbMix: 0, reverbSize: 1.5 },
  },
  {
    name: 'Saw Lead',
    oscA: { type: 'sawtooth', level: 1, detune: 0 },
    oscB: { type: 'square', level: 0.5, detune: -12 },
    filter: { cutoffHz: 2400, resonance: 3, velToCutoff: 0.7 },
    lfo: { rateHz: 5.2, depth: 0.05 },
    env: { attack: 0.004, decay: 0.2, sustain: 0.75, release: 0.2 },
    gain: 0.44,
    fx: { chorus: 0.1, delayMix: 0.3, delayTime: 0.3, delayFeedback: 0.4, reverbMix: 0.2, reverbSize: 1.8 },
  },
]

/** MIDI note → frequency (A4 = note 69 = 440 Hz). Pure. */
export function midiNoteToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/** Velocity 0..127 → a gentle loudness curve 0..1 (never fully silent on a hit). */
export function velocityToGain(velocity: number): number {
  const v = Math.max(0, Math.min(127, velocity)) / 127
  return 0.25 + 0.75 * v * v
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/**
 * Soft-saturation transfer curve for the drive waveshaper. `null` (drive ≈ 0)
 * means pass-through, so a clean patch is bit-identical. Otherwise a normalized
 * `tanh` shape rounds off peaks for gentle analog warmth/glue.
 */
function makeDriveCurve(drive: number): Float32Array<ArrayBuffer> | null {
  if (drive <= 0.001) return null
  const k = 1 + drive * 6 // input gain into tanh (1..7)
  const norm = Math.tanh(k)
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

const MAX_VOICES = 16
const LFO_SWING_HZ = 3500 // full-depth cutoff swing

type Voice = {
  oscs: OscillatorNode[]
  amp: GainNode
  vfilter: BiquadFilterNode
  startedAt: number
  releaseSec: number
  /**
   * The level the ADSR settles at after decay. `scheduleNote` needs it to anchor
   * the release at the note's END — see the comment there for why omitting this
   * turned every sequenced note into a pluck.
   */
  sustainGain: number
}

export class KeysSynth {
  #ctx: BaseAudioContext | null = null
  /**
   * Per-note randomness (analog detune). Live uses `Math.random`; an offline
   * render swaps in a seeded source so the same song renders identically every
   * time. Keeping it injectable is what lets ONE voice implementation serve
   * both without the render drifting.
   */
  #rand: () => number = Math.random
  #voices = new Map<number, Voice>()
  /** Voices placed by `scheduleNote`, which the voice map deliberately skips. */
  #scheduled: { voice: Voice; endAt: number }[] = []
  #volume = 0.8
  #patch: SynthPatch = structuredClonePatch(DEFAULT_PATCH)

  // Graph
  #voiceBus: GainNode | null = null
  #busHighpass: BiquadFilterNode | null = null
  #busDrive: WaveShaperNode | null = null
  #reverbPredelay: DelayNode | null = null
  #reverbDamp: BiquadFilterNode | null = null
  #shimmerLevel: GainNode | null = null
  #shimmerLfoDepth: GainNode | null = null
  #phaserWet: GainNode | null = null
  #phaserDepth: GainNode | null = null
  #wahWet: GainNode | null = null
  #wahDepth: GainNode | null = null
  #lfo: OscillatorNode | null = null
  #lfoGain: GainNode | null = null
  #chorusWetL: GainNode | null = null
  #chorusWetR: GainNode | null = null
  #chorusLfoGainL: GainNode | null = null
  #chorusLfoGainR: GainNode | null = null
  #delay: DelayNode | null = null
  #delayFb: GainNode | null = null
  #delayWet: GainNode | null = null
  #convolver: ConvolverNode | null = null
  #reverbWet: GainNode | null = null
  #out: GainNode | null = null
  /** Where the FX bus lands. Null = the context's own destination. */
  #destination: AudioNode | null = null
  #reverbSizeBuilt: number | null = null

  get ready(): boolean {
    return this.#ctx !== null
  }
  get activeVoiceCount(): number {
    return this.#voices.size
  }
  get patch(): SynthPatch {
    return structuredClonePatch(this.#patch)
  }

  setVolume(v: number): void {
    this.#volume = clamp(v, 0, 1)
    if (this.#out) this.#out.gain.value = this.#volume
  }

  /** Load/replace the whole sound. Osc/filter/env changes affect NEW notes;
   *  LFO + FX apply live. */
  setPatch(p: SynthPatch): void {
    this.#patch = structuredClonePatch(p)
    const f = this.#patch.fx
    if (this.#lfo) this.#lfo.frequency.value = clamp(this.#patch.lfo.rateHz, 0.02, 8)
    if (this.#lfoGain) this.#lfoGain.gain.value = clamp(this.#patch.lfo.depth, 0, 1) * LFO_SWING_HZ
    const chorusMod = clamp(f.chorus, 0, 1) * 0.004
    if (this.#chorusWetL) this.#chorusWetL.gain.value = clamp(f.chorus, 0, 1) * 0.5
    if (this.#chorusWetR) this.#chorusWetR.gain.value = clamp(f.chorus, 0, 1) * 0.5
    if (this.#chorusLfoGainL) this.#chorusLfoGainL.gain.value = chorusMod
    if (this.#chorusLfoGainR) this.#chorusLfoGainR.gain.value = chorusMod
    if (this.#delay) this.#delay.delayTime.value = clamp(f.delayTime, 0.02, 1.2)
    if (this.#delayFb) this.#delayFb.gain.value = clamp(f.delayFeedback, 0, 0.95)
    if (this.#delayWet) this.#delayWet.gain.value = clamp(f.delayMix, 0, 1)
    if (this.#reverbWet) this.#reverbWet.gain.value = clamp(f.reverbMix, 0, 1)
    if (this.#convolver && Math.abs((this.#reverbSizeBuilt ?? -1) - f.reverbSize) > 0.05) {
      this.#convolver.buffer = this.#makeReverbIR(clamp(f.reverbSize, 0.2, 6))
      this.#reverbSizeBuilt = f.reverbSize
    }
    // Mix polish (transparent when unset).
    if (this.#busHighpass) this.#busHighpass.frequency.value = clamp(f.highpassHz ?? 20, 20, 2000)
    if (this.#busDrive) this.#busDrive.curve = makeDriveCurve(clamp(f.drive ?? 0, 0, 1))
    if (this.#reverbPredelay)
      this.#reverbPredelay.delayTime.value = clamp(f.reverbPredelay ?? 0, 0, 0.25)
    if (this.#reverbDamp) this.#reverbDamp.frequency.value = clamp(f.reverbDamp ?? 14000, 500, 16000)
    const shimmer = clamp(f.shimmer ?? 0, 0, 1)
    if (this.#shimmerLevel) this.#shimmerLevel.gain.value = shimmer * 0.4
    if (this.#shimmerLfoDepth) this.#shimmerLfoDepth.gain.value = shimmer * 0.22
    const phaser = clamp(f.phaser ?? 0, 0, 1)
    if (this.#phaserWet) this.#phaserWet.gain.value = phaser
    if (this.#phaserDepth) this.#phaserDepth.gain.value = phaser * 1500 // sweep depth (Hz)
    const wah = clamp(f.wah ?? 0, 0, 1)
    if (this.#wahWet) this.#wahWet.gain.value = wah
    if (this.#wahDepth) this.#wahDepth.gain.value = wah * 1700
  }

  async resume(): Promise<void> {
    if (!this.#ctx) {
      // The SHARED device, not a private one. Each KeysSynth used to build its
      // own context; with chord playback, bass, arp and kick that was four of
      // the browser's ~six, and the app hit the cap during ordinary use.
      this.#ctx = audioDevice()
      this.#buildGraph()
    }
    const live = this.#ctx as AudioContext
    if (live.state !== 'running') await live.resume()
    this.#warmUp()
  }

  #buildGraph(): void {
    const ctx = this.#ctx!
    const voiceBus = ctx.createGain()

    // Bus polish: a high-pass to clear low mud (so the sound sits in the mix)
    // feeding a soft-saturation waveshaper for warmth/glue. Both are transparent
    // by default (HPF ~20 Hz, drive curve null), so untouched presets are
    // bit-identical; the FX SEND + dry both read from here.
    const busHighpass = ctx.createBiquadFilter()
    busHighpass.type = 'highpass'
    busHighpass.frequency.value = 20
    const busDrive = ctx.createWaveShaper()
    voiceBus.connect(busHighpass)
    busHighpass.connect(busDrive)

    // Phaser: a 4-stage allpass chain swept by an LFO, its wet notches mixed back
    // with the dry — the classic psychedelic whoosh. Silent when phaser = 0.
    const phaserOut = ctx.createGain()
    busDrive.connect(phaserOut) // dry
    const phaserLfo = ctx.createOscillator()
    phaserLfo.type = 'sine'
    phaserLfo.frequency.value = 0.4
    const phaserDepth = ctx.createGain()
    phaserDepth.gain.value = 0
    phaserLfo.connect(phaserDepth)
    phaserLfo.start()
    let apNode: AudioNode = busDrive
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter()
      ap.type = 'allpass'
      ap.frequency.value = 300 + i * 420
      ap.Q.value = 0.6
      phaserDepth.connect(ap.frequency)
      apNode.connect(ap)
      apNode = ap
    }
    const phaserWet = ctx.createGain()
    phaserWet.gain.value = 0
    apNode.connect(phaserWet)
    phaserWet.connect(phaserOut)

    // Auto-wah: an LFO-swept resonant band-pass mixed with the dry — funky/vocal.
    const wahOut = ctx.createGain()
    phaserOut.connect(wahOut) // dry
    const wahBP = ctx.createBiquadFilter()
    wahBP.type = 'bandpass'
    wahBP.frequency.value = 700
    wahBP.Q.value = 4.5
    const wahLfo = ctx.createOscillator()
    wahLfo.type = 'sine'
    wahLfo.frequency.value = 1.8
    const wahDepth = ctx.createGain()
    wahDepth.gain.value = 0
    wahLfo.connect(wahDepth)
    wahDepth.connect(wahBP.frequency)
    wahLfo.start()
    phaserOut.connect(wahBP)
    const wahWet = ctx.createGain()
    wahWet.gain.value = 0
    wahBP.connect(wahWet)
    wahWet.connect(wahOut)

    // Shared cutoff LFO (connected to each voice's filter on note-on).
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0
    lfo.connect(lfoGain)
    lfo.start()

    // Chorus: two LFO-modulated delays panned L/R, mixed with the dry voiceBus.
    const chorusL = ctx.createDelay(0.05)
    const chorusR = ctx.createDelay(0.05)
    chorusL.delayTime.value = 0.018
    chorusR.delayTime.value = 0.023
    const clfoL = ctx.createOscillator()
    const clfoR = ctx.createOscillator()
    clfoL.type = 'sine'
    clfoR.type = 'sine'
    clfoL.frequency.value = 0.33
    clfoR.frequency.value = 0.41
    const clfoGL = ctx.createGain()
    const clfoGR = ctx.createGain()
    clfoL.connect(clfoGL)
    clfoR.connect(clfoGR)
    clfoGL.connect(chorusL.delayTime)
    clfoGR.connect(chorusR.delayTime)
    clfoL.start()
    clfoR.start()
    const panL = ctx.createStereoPanner()
    const panR = ctx.createStereoPanner()
    panL.pan.value = -0.7
    panR.pan.value = 0.7
    const chorusWetL = ctx.createGain()
    const chorusWetR = ctx.createGain()
    wahOut.connect(chorusL)
    wahOut.connect(chorusR)
    chorusL.connect(chorusWetL)
    chorusR.connect(chorusWetR)
    chorusWetL.connect(panL)
    chorusWetR.connect(panR)

    const afterChorus = ctx.createGain()
    wahOut.connect(afterChorus) // dry
    panL.connect(afterChorus)
    panR.connect(afterChorus)

    // Delay with damped feedback.
    const delay = ctx.createDelay(1.5)
    const delayFb = ctx.createGain()
    const delayFbLp = ctx.createBiquadFilter()
    delayFbLp.type = 'lowpass'
    delayFbLp.frequency.value = 3200
    const delayWet = ctx.createGain()
    afterChorus.connect(delay)
    delay.connect(delayFbLp)
    delayFbLp.connect(delayFb)
    delayFb.connect(delay)
    delay.connect(delayWet)
    const afterDelay = ctx.createGain()
    afterChorus.connect(afterDelay)
    delayWet.connect(afterDelay)

    // Reverb (synthesized impulse) with PRE-DELAY (keeps the dry attack clear
    // before the tail) and TAIL DAMPING (low-pass → dark, smooth, not fizzy).
    const reverbPredelay = ctx.createDelay(0.25)
    const reverbDamp = ctx.createBiquadFilter()
    reverbDamp.type = 'lowpass'
    reverbDamp.frequency.value = 14000
    const convolver = ctx.createConvolver()
    convolver.buffer = this.#makeReverbIR(this.#patch.fx.reverbSize)
    this.#reverbSizeBuilt = this.#patch.fx.reverbSize
    const reverbWet = ctx.createGain()
    const out = ctx.createGain()
    afterDelay.connect(reverbPredelay)
    reverbPredelay.connect(convolver)
    convolver.connect(reverbDamp)
    reverbDamp.connect(reverbWet)
    afterDelay.connect(out)
    reverbWet.connect(out)

    // Twinkle / shimmer: a bright, short, gently-pulsing high echo tapped off the
    // (driven) bus. High-passed so only the sparkle frequencies ring, with a slow
    // tremolo LFO on its level for the "twinkle". Silent when shimmer = 0.
    const shimmerHP = ctx.createBiquadFilter()
    shimmerHP.type = 'highpass'
    shimmerHP.frequency.value = 1900
    const shimmerDelay = ctx.createDelay(0.5)
    shimmerDelay.delayTime.value = 0.13
    const shimmerFb = ctx.createGain()
    shimmerFb.gain.value = 0.34
    const shimmerLevel = ctx.createGain()
    shimmerLevel.gain.value = 0
    const shimmerLfo = ctx.createOscillator()
    shimmerLfo.type = 'sine'
    shimmerLfo.frequency.value = 5.5
    const shimmerLfoDepth = ctx.createGain()
    shimmerLfoDepth.gain.value = 0
    shimmerLfo.connect(shimmerLfoDepth)
    shimmerLfoDepth.connect(shimmerLevel.gain)
    shimmerLfo.start()
    busDrive.connect(shimmerHP)
    shimmerHP.connect(shimmerDelay)
    shimmerDelay.connect(shimmerFb)
    shimmerFb.connect(shimmerDelay)
    shimmerDelay.connect(shimmerLevel)
    shimmerLevel.connect(out)

    out.gain.value = this.#volume
    // A mixer lane supplies its own destination so the synth lands on a track
    // gain (fader, mute/solo, effect sends) instead of straight on the speakers.
    out.connect(this.#destination ?? ctx.destination)

    this.#voiceBus = voiceBus
    this.#busHighpass = busHighpass
    this.#busDrive = busDrive
    this.#reverbPredelay = reverbPredelay
    this.#reverbDamp = reverbDamp
    this.#shimmerLevel = shimmerLevel
    this.#shimmerLfoDepth = shimmerLfoDepth
    this.#phaserWet = phaserWet
    this.#phaserDepth = phaserDepth
    this.#wahWet = wahWet
    this.#wahDepth = wahDepth
    this.#lfo = lfo
    this.#lfoGain = lfoGain
    this.#chorusWetL = chorusWetL
    this.#chorusWetR = chorusWetR
    this.#chorusLfoGainL = clfoGL
    this.#chorusLfoGainR = clfoGR
    this.#delay = delay
    this.#delayFb = delayFb
    this.#delayWet = delayWet
    this.#convolver = convolver
    this.#reverbWet = reverbWet
    this.#out = out

    this.setPatch(this.#patch) // push current values onto the fresh nodes
  }

  #makeReverbIR(seconds: number): AudioBuffer {
    const ctx = this.#ctx!
    const rate = ctx.sampleRate
    const len = Math.max(1, Math.floor(clamp(seconds, 0.2, 6) * rate))
    const ir = ctx.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, 2.6) * Math.min(1, i / (rate * 0.006))
        // Same injectable source as the analog detune: live stays Math.random,
        // an offline render is seeded so the same song renders identically.
        d[i] = (this.#rand() * 2 - 1) * env
      }
    }
    return ir
  }

  #warmUp(): void {
    const ctx = this.#ctx
    const bus = this.#voiceBus
    if (!ctx || !bus) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    g.gain.value = 0.0001
    osc.connect(g)
    g.connect(bus)
    osc.start(t)
    osc.stop(t + 0.015)
  }

  /** Latency is a LIVE concept — an offline render has none. */
  get #liveCtx(): AudioContext | null {
    const c = this.#ctx as AudioContext | null
    return c && typeof (c as AudioContext).baseLatency === 'number' ? c : null
  }

  get baseLatencyMs(): number {
    return (this.#liveCtx?.baseLatency ?? 0) * 1000
  }
  get outputLatencyMs(): number {
    const ctx = this.#liveCtx
    if (!ctx) return 0
    const ol = (ctx as AudioContext & { outputLatency?: number }).outputLatency
    if (ol && ol > 0) return ol * 1000
    try {
      const ts = ctx.getOutputTimestamp?.()
      if (ts && ts.contextTime && ctx.currentTime > ts.contextTime) return (ctx.currentTime - ts.contextTime) * 1000
    } catch {
      /* not supported */
    }
    return (ctx.baseLatency ?? 0) * 1000
  }

  noteOn(note: number, velocity = 100): void {
    const ctx = this.#ctx
    if (!ctx) return
    if (this.#voices.has(note)) this.#endVoice(note, true)
    if (this.#voices.size >= MAX_VOICES) {
      let oldestNote = -1
      let oldestAt = Infinity
      for (const [n, v] of this.#voices) if (v.startedAt < oldestAt) ((oldestAt = v.startedAt), (oldestNote = n))
      if (oldestNote >= 0) this.#endVoice(oldestNote, true)
    }
    const v = this.#startVoice(note, velocity, ctx.currentTime)
    if (v) this.#voices.set(note, v)
  }

  /**
   * Build one voice starting at `at`. Shared by live `noteOn` and offline
   * `scheduleNote` so the two cannot sound different — the whole reason this
   * is extracted rather than reimplemented.
   */
  #startVoice(note: number, velocity: number, at: number): Voice | null {
    const ctx = this.#ctx
    const bus = this.#voiceBus
    if (!ctx || !bus) return null

    const p = this.#patch
    const t0 = at
    const freq = midiNoteToFreq(note)
    const vel = velocityToGain(velocity)

    const amp = ctx.createGain()
    const vf = ctx.createBiquadFilter()
    vf.type = 'lowpass'
    vf.frequency.value = clamp(p.filter.cutoffHz + p.filter.velToCutoff * vel * 6000, 80, 18000)
    vf.Q.value = clamp(p.filter.resonance, 0.1, 18)
    vf.connect(amp)
    if (this.#lfoGain) {
      try {
        this.#lfoGain.connect(vf.frequency)
      } catch {
        /* ignore */
      }
    }

    // Analog humanization: a small RANDOM detune per note per oscillator so no
    // two hits are mathematically identical — this is most of what kills the
    // "plastic" feel. ±~8 cents at full; each osc drifts independently so they
    // gently beat against each other.
    const analog = clamp(p.fx.analog ?? 0.14, 0, 1)
    const oscs: OscillatorNode[] = []
    for (const spec of [p.oscA, p.oscB]) {
      if (spec.level <= 0) continue
      const osc = ctx.createOscillator()
      osc.type = spec.type
      osc.frequency.value = freq
      osc.detune.value = spec.detune + (this.#rand() * 2 - 1) * analog * 8
      const og = ctx.createGain()
      og.gain.value = spec.level
      osc.connect(og)
      og.connect(vf)
      osc.start(t0)
      oscs.push(osc)
    }

    const peak = clamp(p.gain, 0, 1) * vel
    const { attack, decay, sustain } = p.env
    amp.gain.setValueAtTime(0.0001, t0)
    amp.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.0005, attack))
    amp.gain.linearRampToValueAtTime(Math.max(0.0001, peak * sustain), t0 + Math.max(0.0005, attack) + decay)
    amp.connect(bus)

    // Release the per-note nodes once the voice has finished sounding.
    //
    // Without this the filter and the amp stay wired to the voice bus forever:
    // stopping an oscillator does NOT detach the nodes downstream of it. Playing
    // a part through `scheduleNote` therefore leaked two nodes per note —
    // thousands over a song — and the audio thread still walks every one of them
    // on every render quantum, so CPU climbed the longer you played.
    const last = oscs[oscs.length - 1]
    if (last) {
      last.addEventListener('ended', () => {
        try {
          this.#lfoGain?.disconnect(vf.frequency)
        } catch {
          /* not connected */
        }
        try {
          vf.disconnect()
          amp.disconnect()
        } catch {
          /* already gone */
        }
      })
    }

    return {
      oscs,
      amp,
      vfilter: vf,
      startedAt: t0,
      releaseSec: p.env.release,
      sustainGain: Math.max(0.0001, peak * sustain),
    }
  }

  /**
   * OFFLINE: schedule a complete note (attack → release) at an absolute time.
   * No voice map and no stealing — a render has no polyphony budget to protect,
   * and every note's lifetime is known up front.
   */
  scheduleNote(note: number, velocity: number, atSec: number, durationSec: number): void {
    if (!(durationSec > 0)) return
    this.#pruneScheduled()
    const p = this.#patch
    // A note shorter than attack+decay squeezes them in rather than running
    // past its own length.
    const a = Math.max(0.0005, p.env.attack)
    const d = p.env.decay
    const scale = a + d > durationSec ? durationSec / (a + d) : 1
    const v = this.#startVoiceScaled(note, velocity, atSec, a * scale, d * scale)
    if (!v) return
    const end = atSec + durationSec
    const rel = Math.max(0.005, p.env.release)
    // Scheduled voices are deliberately NOT in `#voices` (no stealing during a
    // render), so `panic` cannot see them. A live lane still has to be able to
    // silence them on a seek, hence this separate list.
    this.#scheduled.push({ voice: v, endAt: end + rel + 0.02 })
    try {
      // HOLD the sustain until the note actually ends, THEN release.
      //
      // Without the anchor, `linearRampToValueAtTime` interpolates from the
      // previous automation event — the end of the decay — so the gain slid
      // from sustain to silence across the note's WHOLE length. Every held
      // chord came out as a decaying pluck, which is exactly what a sequenced
      // lane must not sound like. `noteOn`/`noteOff` never had this because the
      // envelope simply rests at sustain until the release is triggered.
      v.amp.gain.setValueAtTime(v.sustainGain, end)
      v.amp.gain.linearRampToValueAtTime(0.0001, end + rel)
    } catch {
      /* out of range */
    }
    for (const osc of v.oscs) {
      try {
        osc.stop(end + rel + 0.02)
      } catch {
        /* already stopped */
      }
    }
  }

  /** `#startVoice` with the envelope times overridden (short-note fitting). */
  #startVoiceScaled(
    note: number,
    velocity: number,
    at: number,
    attack: number,
    decay: number,
  ): Voice | null {
    const saved = this.#patch.env
    this.#patch = { ...this.#patch, env: { ...saved, attack, decay } }
    try {
      return this.#startVoice(note, velocity, at)
    } finally {
      this.#patch = { ...this.#patch, env: saved }
    }
  }

  /** Which context this synth is running on — for asserting it is the shared one. */
  get contextForTest(): BaseAudioContext | null {
    return this.#ctx
  }

  /** The end of the FX bus, once a graph exists — for routing into a mixer. */
  get output(): AudioNode | null {
    return this.#out
  }

  /**
   * Attach an OfflineAudioContext and build the graph on it. The patch, the
   * voice and the whole FX bus are then exactly what the live instrument uses.
   * `seed` makes the analog detune reproducible.
   */
  attachOfflineContext(ctx: BaseAudioContext, seed = 0x9e3779b9): void {
    this.attachContext(ctx, { seed })
  }

  /**
   * Attach ANY context and build the graph on it, optionally routing the output
   * somewhere other than the speakers. This is how a mixer lane hosts the synth:
   * same patch, same voice, same FX bus, but landing on a track gain so it gets
   * a fader and effect sends like every other lane.
   */
  attachContext(ctx: BaseAudioContext, opts: { destination?: AudioNode; seed?: number } = {}): void {
    const seed = opts.seed ?? 0x9e3779b9
    this.#destination = opts.destination ?? null
    this.#ctx = ctx
    let a = seed >>> 0
    this.#rand = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    this.#buildGraph()
  }

  noteOff(note: number): void {
    this.#endVoice(note, false)
  }

  #endVoice(note: number, fast: boolean): void {
    const ctx = this.#ctx
    const v = this.#voices.get(note)
    if (!ctx || !v) return
    this.#voices.delete(note)
    const now = ctx.currentTime
    const rel = fast ? 0.03 : v.releaseSec
    try {
      v.amp.gain.cancelScheduledValues(now)
      v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), now)
      v.amp.gain.linearRampToValueAtTime(0.0001, now + rel)
    } catch {
      /* node already gone */
    }
    const stopAt = now + rel + 0.02
    for (const osc of v.oscs) {
      try {
        osc.stop(stopAt)
      } catch {
        /* already stopped */
      }
    }
    // Release the shared LFO from this (soon-dead) filter so it doesn't leak.
    if (this.#lfoGain) {
      try {
        this.#lfoGain.disconnect(v.vfilter.frequency)
      } catch {
        /* not connected */
      }
    }
  }

  panic(): void {
    for (const note of [...this.#voices.keys()]) this.#endVoice(note, true)
    this.stopScheduled()
  }

  /** Drop scheduled voices that have already finished sounding. */
  #pruneScheduled(): void {
    const now = this.#ctx?.currentTime ?? 0
    if (this.#scheduled.length === 0) return
    this.#scheduled = this.#scheduled.filter((s) => s.endAt > now)
  }

  /**
   * Silence everything `scheduleNote` put on the clock, including notes that
   * have not started yet. This is what a seek needs: the lane re-schedules from
   * the new position, and the old schedule must not still be queued.
   */
  stopScheduled(atCtxTime?: number): void {
    const now = this.#ctx?.currentTime ?? 0
    // A bar-quantized jump commits ~80 ms before the boundary; silencing at
    // `now` would cut the lane off early, so the caller can defer the stop.
    const at = atCtxTime !== undefined && atCtxTime > now ? atCtxTime : now
    for (const { voice } of this.#scheduled) {
      try {
        voice.amp.gain.cancelScheduledValues(at)
        // A voice that has not started by `at` is still at zero; one that is
        // sounding gets a short release so it does not click.
        const started = voice.startedAt <= at
        voice.amp.gain.setValueAtTime(started ? Math.max(0.0001, voice.amp.gain.value) : 0.0001, at)
        voice.amp.gain.linearRampToValueAtTime(0.0001, at + 0.03)
      } catch {
        /* node already gone */
      }
      for (const osc of voice.oscs) {
        try {
          osc.stop(at + 0.05)
        } catch {
          /* already stopped */
        }
      }
      if (this.#lfoGain) {
        try {
          this.#lfoGain.disconnect(voice.vfilter.frequency)
        } catch {
          /* not connected */
        }
      }
    }
    this.#scheduled = []
  }

  async close(): Promise<void> {
    this.panic()
    try {
      this.#lfo?.stop()
    } catch {
      /* ignore */
    }
    // Deliberately NOT closing the context: it is the app-wide shared device.
    // Closing it here would silence the mixer, the editor and every other voice.
    this.#ctx = null
    this.#voiceBus = null
    this.#out = null
  }
}

/** Deep copy a patch (safe defaults for missing fields). */
export function structuredClonePatch(p: SynthPatch): SynthPatch {
  return {
    name: p.name,
    oscA: { ...p.oscA },
    oscB: { ...p.oscB },
    filter: { ...p.filter },
    lfo: { ...p.lfo },
    env: { ...p.env },
    gain: p.gain,
    fx: { ...p.fx },
  }
}
