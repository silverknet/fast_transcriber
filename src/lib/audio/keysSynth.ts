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

export type OscType = 'sine' | 'triangle' | 'sawtooth' | 'square'

/** Post-voice effects (the FX bus). */
export type SynthFx = {
  chorus: number // 0..1 width/shimmer
  delayMix: number // 0..1
  delayTime: number // seconds 0.02..1.2
  delayFeedback: number // 0..0.95
  reverbMix: number // 0..1
  reverbSize: number // seconds 0.2..6
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

const MAX_VOICES = 16
const LFO_SWING_HZ = 3500 // full-depth cutoff swing

type Voice = {
  oscs: OscillatorNode[]
  amp: GainNode
  vfilter: BiquadFilterNode
  startedAt: number
  releaseSec: number
}

export class KeysSynth {
  #ctx: AudioContext | null = null
  #voices = new Map<number, Voice>()
  #volume = 0.8
  #patch: SynthPatch = structuredClonePatch(DEFAULT_PATCH)

  // Graph
  #voiceBus: GainNode | null = null
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
  }

  async resume(): Promise<void> {
    if (!this.#ctx) {
      const Ctor: typeof AudioContext =
        (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.#ctx = new Ctor({ latencyHint: 0 })
      this.#buildGraph()
    }
    if (this.#ctx.state !== 'running') await this.#ctx.resume()
    this.#warmUp()
  }

  #buildGraph(): void {
    const ctx = this.#ctx!
    const voiceBus = ctx.createGain()

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
    voiceBus.connect(chorusL)
    voiceBus.connect(chorusR)
    chorusL.connect(chorusWetL)
    chorusR.connect(chorusWetR)
    chorusWetL.connect(panL)
    chorusWetR.connect(panR)

    const afterChorus = ctx.createGain()
    voiceBus.connect(afterChorus) // dry
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

    // Reverb (synthesized impulse).
    const convolver = ctx.createConvolver()
    convolver.buffer = this.#makeReverbIR(this.#patch.fx.reverbSize)
    this.#reverbSizeBuilt = this.#patch.fx.reverbSize
    const reverbWet = ctx.createGain()
    const out = ctx.createGain()
    afterDelay.connect(convolver)
    convolver.connect(reverbWet)
    afterDelay.connect(out)
    reverbWet.connect(out)
    out.gain.value = this.#volume
    out.connect(ctx.destination)

    this.#voiceBus = voiceBus
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
        d[i] = (Math.random() * 2 - 1) * env
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

  get baseLatencyMs(): number {
    return (this.#ctx?.baseLatency ?? 0) * 1000
  }
  get outputLatencyMs(): number {
    const ctx = this.#ctx
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
    const bus = this.#voiceBus
    if (!ctx || !bus) return
    if (this.#voices.has(note)) this.#endVoice(note, true)
    if (this.#voices.size >= MAX_VOICES) {
      let oldestNote = -1
      let oldestAt = Infinity
      for (const [n, v] of this.#voices) if (v.startedAt < oldestAt) ((oldestAt = v.startedAt), (oldestNote = n))
      if (oldestNote >= 0) this.#endVoice(oldestNote, true)
    }

    const p = this.#patch
    const t0 = ctx.currentTime
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

    const oscs: OscillatorNode[] = []
    for (const spec of [p.oscA, p.oscB]) {
      if (spec.level <= 0) continue
      const osc = ctx.createOscillator()
      osc.type = spec.type
      osc.frequency.value = freq
      osc.detune.value = spec.detune
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

    this.#voices.set(note, { oscs, amp, vfilter: vf, startedAt: t0, releaseSec: p.env.release })
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
  }

  async close(): Promise<void> {
    this.panic()
    try {
      this.#lfo?.stop()
    } catch {
      /* ignore */
    }
    try {
      await this.#ctx?.close()
    } catch {
      /* ignore */
    }
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
