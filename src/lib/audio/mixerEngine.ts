/**
 * Multi-track mixer engine — owns one AudioContext, one GainNode per track,
 * and a transport (play / pause / seek) that re-creates BufferSources on
 * each play.
 *
 * Model: every track is positioned at t=0 of the mix timeline. Time
 * alignment between tracks is achieved by **prepending silence** inside the
 * AudioBuffer when the source's natural start should be after t=0 (e.g.
 * stems offset by the cue track's preamble). This matches how an Ableton
 * clip-on-timeline export will lay things out — every clip starts at the
 * same musical t=0; offsets are baked into the audio.
 *
 * The engine itself is framework-agnostic — Svelte components subscribe via
 * `onUpdate(state => …)` callbacks and call mutator methods. No store
 * dependency.
 */
import { bufferSecToWallSec, wallSecToBufferSec } from './varispeed'
import { audioDevice } from './audioDevice'
import { liveOutputMap, type LiveOutputMap } from './liveOutputMap'
import {
  clickIsOutOfHouse,
  outputChannelsForLane,
  type RigLayout,
} from '$lib/hardware/liveRigPlan'

export type TrackKey = string

/** Ceiling for the MIDI compensation delay; real shifters report a few ms. */
const MAX_SHIFTER_LATENCY_SEC = 1

/** A processing insert: caller wires source → input, output → track gain. */
export interface MixerInsert {
  input: AudioNode
  output: AudioNode
}

/**
 * A shared EFFECT BUS (aux send/return). Unlike `MixerInsert`, which sits
 * in-line on ONE track, a bus is fed by sends from any number of tracks and
 * returns once into the master — so several tracks can share one reverb
 * instead of each paying for their own.
 *
 *     trackGain → sendGain(level) → bus.chain → returnGain → masterGain
 */
export interface MixerBus {
  key: string
  label: string
  /** The effect itself; signal enters `input` and leaves `output`. */
  chain: MixerInsert
  /** Return level into the master bus (0..1.5). */
  level: number
  muted?: boolean
}

/**
 * A live instrument backing a MIDI track.
 *
 * The engine never asks what it is — only to connect its output and to
 * schedule itself for a stretch of the timeline. That keeps drums (sampled
 * one-shots) and the synths (KeysSynth voices) behind one contract.
 *
 * Because `output` lands on the SAME track gain an audio lane uses, MIDI
 * tracks get faders, mute/solo and effect sends for free — the send taps that
 * gain node, so nothing about routing has to know MIDI exists.
 */
/** A lane-strip view of a MIDI part: hits on `rows` stacked lanes. */
export interface MidiVisual {
  /** How many stacked rows the hits are spread over (e.g. one per drum voice). */
  rows: number
  /** `row` 0 is drawn at the BOTTOM, like a drum grid with the kick lowest. */
  hits: { timeSec: number; row: number; gain: number }[]
}

export interface MidiInstrument {
  /** Connect this to the track's input; the engine wires it once. */
  output: AudioNode
  /**
   * Schedule every note from `fromSec` on the mix timeline onward, where
   * `fromSec` lands at context time `atCtx`. `rate` is the varispeed factor.
   */
  schedule: (fromSec: number, atCtx: number, rate: number) => void
  /**
   * Cancel everything pending/sounding.
   *
   * With no argument: silence NOW (stop, seek, re-play).
   * With `atCtxTime`: silence AT that context time — used by the bar-quantized
   * jump, where buffer lanes get `source.stop(at)` and a MIDI lane must not go
   * quiet the ~80 ms earlier that the jump commits.
   */
  allNotesOff: (atCtxTime?: number) => void
  /**
   * Optional: called each transport tick with the current scheduling position,
   * for instruments that schedule in a ROLLING WINDOW rather than all at once.
   * A synth voice costs several nodes, so a whole song's worth cannot go on the
   * clock in one pass the way a sampled drum lane can.
   */
  tick?: (positionSec: number) => void
  /** Part length, so a MIDI-only song still has a mix duration. */
  durationSec: number
  /**
   * What to DRAW for this lane. A MIDI track has no waveform, but it does have
   * a pattern, and showing it is far more use than an empty strip: you can see
   * the groove, the fills and the section changes at a glance.
   */
  visual?: () => MidiVisual | null
  /** Release nodes. Optional so simple instruments can skip it. */
  dispose?: () => void
}

export interface MixerTrack {
  key: TrackKey
  /** Display label. */
  label: string
  /**
   * AUDIO track: a decoded buffer with any prepend-silence applied.
   * Exactly one of `buffer` / `instrument` is set.
   */
  buffer?: AudioBuffer
  /** MIDI track: scheduled live, so changing its sound needs no re-render. */
  instrument?: MidiInstrument
  /** Per-track linear gain (0..1.5). 1 = unity. */
  volume: number
  muted: boolean
  soloed: boolean
  /**
   * Optional processing chain between the source and the track gain (e.g. the
   * project-sound compressor). Nodes must belong to this engine's context.
   */
  insert?: MixerInsert
}

export type TransportState = 'stopped' | 'playing'

export interface MixerSnapshot {
  state: TransportState
  /** Playhead in seconds on the mix timeline. */
  positionSec: number
  /** Longest track in the mix — defines total duration. */
  durationSec: number
}

export interface EchoTransitionSchedule {
  /** All times are on this engine's AudioContext clock. */
  throwAtCtxTime: number
  captureDurationSec: number
  dryCutAtCtxTime: number
  echoStopAtCtxTime: number
  delaySec: number
  sendLevel: number
  wetLevel: number
  feedback: number
  repeatBuild: number
  toneHz: number
  blendReverbLevel: number
  blendReverbLengthSec: number
  /** Explicitly admitted current-song programme lanes. Private keys are rejected regardless. */
  sourceTrackKeys?: readonly TrackKey[]
}

export interface EchoTransitionResult {
  audibleTrackKeys: TrackKey[]
  scheduled: boolean
  reason?: 'transport-stopped' | 'throw-already-passed' | 'no-audible-musical-source'
}

/**
 * The DEFAULT song hand-off: let the outgoing song ring out into a reverb
 * instead of being cut to silence.
 *
 * This is not the programmed `echo` transition — no delay, no feedback, no
 * authored recipe. It is what every song change gets for free so the set does
 * not stop dead between songs.
 */
export interface SongRingOutSchedule {
  /**
   * How long the dry song keeps playing while feeding the reverb. The tail is
   * built from this slice, so it must be long enough to bloom (a convolver
   * turns even a short input into a full tail) but short enough that the next
   * song is not held up.
   */
  captureSec: number
  /** Reverb decay after the dry song has gone. */
  tailSec: number
  /** Wet level, 0..1. */
  level: number
  /** Reverb colour — darker sits behind the next song instead of fighting it. */
  toneHz: number
}

export interface SongRingOutResult {
  scheduled: boolean
  reason?: 'transport-stopped' | 'no-audible-musical-source' | 'echo-transition-active'
  /** The dry song is silent from here — safe to stop sources and load the next song. */
  dryEndsAtCtxTime: number
  /** The tail has fully decayed by here. */
  tailEndsAtCtxTime: number
}

interface ActiveRingOut {
  input: GainNode
  predelay: DelayNode
  reverb: ConvolverNode
  wet: GainNode
  limiter: DynamicsCompressorNode
  tappedTrackGains: Array<{ key: TrackKey; node: GainNode }>
  fadedTrackGains: Array<{ key: TrackKey; node: GainNode }>
  fadedBusReturns: Array<{ node: GainNode; value: number }>
  cleanupTimer: number | null
}

interface ActiveEchoTransition {
  input: GainNode
  delay: DelayNode
  feedback: GainNode
  filter: BiquadFilterNode
  wet: GainNode
  reverbSend: GainNode
  reverbPredelay: DelayNode
  reverb: ConvolverNode
  reverbWet: GainNode
  limiter: DynamicsCompressorNode
  tappedTrackGains: Array<{ key: TrackKey; node: GainNode }>
  fadedTrackGains: Array<{ key: TrackKey; node: GainNode }>
  fadedBusReturns: Array<{ node: GainNode; value: number }>
  cleanupTimer: number | null
}

/**
 * Prepend `prependSec` of silence to a buffer. Returns a new AudioBuffer
 * with channel data copied at sample offset. If prependSec ≤ 0, returns
 * the source unchanged.
 */
export function bufferWithPrepend(
  ac: BaseAudioContext,
  source: AudioBuffer,
  prependSec: number,
): AudioBuffer {
  if (!(prependSec > 0)) return source
  const prependFrames = Math.round(prependSec * source.sampleRate)
  const out = ac.createBuffer(
    source.numberOfChannels,
    source.length + prependFrames,
    source.sampleRate,
  )
  for (let c = 0; c < source.numberOfChannels; c++) {
    const dst = out.getChannelData(c)
    const src = source.getChannelData(c)
    dst.set(src, prependFrames)
  }
  return out
}

interface ActiveSource {
  source: AudioBufferSourceNode
  gain: GainNode
  trackKey: TrackKey
}

/** Disconnect a node, tolerating "was never connected". */
function safeDisconnect(n: AudioNode | null | undefined): void {
  if (!n) return
  try {
    n.disconnect()
  } catch {
    /* not connected */
  }
}

/** Deterministic filtered-noise impulse for the overlap tail. */
/**
 * Put a faded gain back, effective immediately.
 *
 * `setValueAtTime(v, now)` alone is not enough: the event sits at `now`, so the
 * param does not report `v` until the audio thread reaches it, and a caller that
 * plays again in the same tick sees the faded value. Assigning `.value` sets the
 * intrinsic value straight away; the scheduled event keeps it there once
 * automation resumes.
 */
function restoreGainNow(node: GainNode, value: number, now: number): void {
  try {
    node.gain.cancelScheduledValues(now)
    node.gain.setValueAtTime(value, now)
    node.gain.value = value
  } catch {
    /* param already torn down */
  }
}

function buildTransitionReverbImpulse(
  context: BaseAudioContext,
  lengthSec: number,
  toneHz: number,
): AudioBuffer {
  const duration = Math.max(0.35, Math.min(8, lengthSec))
  const frameCount = Math.max(1, Math.round(context.sampleRate * duration))
  const impulse = context.createBuffer(2, frameCount, context.sampleRate)
  const cutoff = Math.max(700, Math.min(12_000, toneHz))
  const smoothing = 1 - Math.exp((-2 * Math.PI * cutoff) / context.sampleRate)
  const fadeInFrames = Math.max(1, Math.round(context.sampleRate * 0.008))
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel)
    let seed = (0x42524252 ^ frameCount ^ (channel * 0x9e3779b9)) >>> 0
    let filtered = 0
    for (let frame = 0; frame < frameCount; frame += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      const noise = (seed / 0xffffffff) * 2 - 1
      filtered += (noise - filtered) * smoothing
      const progress = frame / frameCount
      const fadeIn = Math.min(1, frame / fadeInFrames)
      data[frame] = filtered * Math.exp(-6 * progress) * fadeIn
    }
  }
  return impulse
}

export class MixerEngine {
  readonly ac: AudioContext
  readonly masterGain: GainNode
  private readonly tracks = new Map<TrackKey, MixerTrack>()
  private readonly trackGains = new Map<TrackKey, GainNode>()
  private active: ActiveSource[] = []
  /** AudioContext time when transport.play() was last called. */
  private playStartCtxTime = 0
  /** Mix-timeline position at the moment of the last play. */
  private playStartPositionSec = 0
  private state: TransportState = 'stopped'
  private subscribers = new Set<(s: MixerSnapshot) => void>()
  private rafId: number | null = null
  /** Current master-bus processing chain (see setMasterChain). */
  private masterChain: MixerInsert | null = null
  /** Last node on the master bus, after `masterChain` (see setMasterTailNode). */
  private masterTail: AudioNode | null = null
  /**
   * Sub-bus carrying only BUFFER-backed (recorded) tracks.
   *
   * A transpose re-pitches recorded audio, but a MIDI lane transposes by moving
   * its NOTES — so running MIDI through the pitch shifter as well shifts it
   * twice. Keeping recorded audio on its own bus lets the shifter sit where it
   * belongs without touching the synths.
   */
  private readonly audioBus: GainNode
  /** The pitch shifter, inserted between `audioBus` and the master. */
  private audioPitchShift: AudioNode | null = null
  /**
   * Sub-bus for everything that must NOT be pitch-shifted but must stay in
   * time with everything that is: MIDI lanes (their notes already carry the
   * transpose) and spoken cues (nobody wants a transposed voice).
   *
   * Bypassing the shifter also bypasses its LATENCY, so this path carries a
   * matching delay — otherwise these sources run early against the stems.
   */
  private readonly unshiftedBus: GainNode
  /** Created only when a shifter actually reports latency. */
  private unshiftedDelay: DelayNode | null = null
  /**
   * Transiently silenced tracks (gain forced to 0) WITHOUT changing their
   * stored mute/volume. Used to duck the baked cue lane during a loop/replay so
   * it doesn't collide with the live dynamic cue, then restore cleanly.
   */
  private suppressedKeys = new Set<TrackKey>()
  // ── Effect busses (aux send/return) ───────────────────────────────────────
  private readonly busses = new Map<string, MixerBus>()
  private readonly busReturnGains = new Map<string, GainNode>()
  /** trackKey → (busKey → send level). Absent/0 = no send. */
  private readonly sends = new Map<TrackKey, Map<string, number>>()
  /** `${trackKey}::${busKey}` → the tap gain node. */
  private readonly sendGains = new Map<string, GainNode>()
  /** One deliberately programmed cross-song effect; never includes private lanes. */
  private activeEchoTransition: ActiveEchoTransition | null = null
  /** The default song hand-off tail; outlives the tracks that fed it. */
  private activeRingOut: ActiveRingOut | null = null
  /**
   * Varispeed playback rate (1 = untransposed). The ONLY thing a naive
   * transpose changes: buffers are played untouched, just faster or slower, so
   * `rate = 1` is bit-identical playback. Every buffer-time ↔ context-time
   * conversion below divides/multiplies by it — see `varispeed.ts`.
   */
  private playbackRate = 1

  // ── Bar-quantized jump (crisp section launch, Ableton-style) ──────────────
  /** A jump waiting for its boundary to enter the lookahead window. */
  private pendingJump: { targetCtxTime: number; toPositionSec: number } | null = null
  /** A jump whose audio is already scheduled sample-accurately at the boundary. */
  private committedJump: { targetCtxTime: number; toPositionSec: number; newSources: ActiveSource[] } | null = null
  private autoStopTimer: number | null = null
  /**
   * A PROGRAMMED ending: the song stops here instead of at the end of its
   * audio. Mixer-timeline seconds, or null for "play to the end of the file".
   */
  private programmedEndSec: number | null = null
  /** One-shot ending hits scheduled but not yet played. Cancelled on teardown. */
  private endingHitSources = new Set<AudioBufferSourceNode>()
  /**
   * Tracks a programme fade has taken to silence, so the NEXT press restores
   * them. See `releaseProgrammeFade` — this exists because forgetting it is
   * the silent-next-press bug, which this engine has shipped once already.
   */
  private programmeFadedKeys = new Set<TrackKey>()
  /** Arms the hand-off tail shortly before a song ends on its own. */
  private autoRingOut: SongRingOutSchedule | null = null
  private autoRingOutTimer: number | null = null
  /** How far ahead of the boundary we commit the scheduled sources (seconds). */
  private static readonly JUMP_LOOKAHEAD = 0.08

  /**
   * @param ac  Context to run on. Defaults to the app-wide shared device;
   *            tests inject their own. The engine never closes it — several
   *            surfaces share one context, and one clock is what keeps them
   *            sample-accurate against each other.
   */
  /** True only when this engine created its own context and may close it. */
  #ownsContext: boolean
  /** Output layout for this device — stereo fallback or split. */
  private outputMap: LiveOutputMap | null = null
  private outputMerger: ChannelMergerNode | null = null
  private outputSplitter: ChannelSplitterNode | null = null
  /** Stereo-forcing gain ahead of the splitter — see `rewireMasterOutput`. */
  private outputStereoShim: GainNode | null = null
  private clickOut: GainNode | null = null
  private cueOut: GainNode | null = null

  /**
   * Turn an injected rig layout into the output map the graph is built from.
   *
   * The layout is the ONE derivation of the whole signal chain
   * (`liveRigPlan.ts`) — where a lane leaves, which desk channel it arrives on,
   * which USB source that strip listens to, and what stays off the house. The
   * engine consumes it; it does not get an opinion.
   *
   * With no layout injected it falls back to `liveOutputMap`, which keeps every
   * existing caller working unchanged while the migration lands in pieces.
   */
  private static resolveOutputMap(ac: AudioContext, layout?: RigLayout | null): LiveOutputMap {
    const max = ac.destination.maxChannelCount ?? 2
    if (!layout) return liveOutputMap(max)
    const song = outputChannelsForLane(layout, 'original')
    const click = outputChannelsForLane(layout, 'click')
    const cue = outputChannelsForLane(layout, 'cue')
    // "Split" means the click genuinely has somewhere else to go. Under
    // stereo-sum that is true on a two-channel device, which the old
    // `split`/`channelCount` pair could not express.
    const split = clickIsOutOfHouse(layout) && layout.requiredOutputChannels <= max
    return {
      split,
      channelCount: split ? layout.requiredOutputChannels : Math.max(1, Math.min(2, max)),
      channels: { song, click, cue },
      summary: layout.reason,
    }
  }

  constructor(ac?: AudioContext, opts?: { layout?: RigLayout | null }) {
    // Ownership decides who may CLOSE it. An injected context belongs to the
    // caller (tests, offline renders) and closing it on dispose is correct; the
    // shared device belongs to the whole app and closing it is catastrophic —
    // see `dispose()`.
    this.#ownsContext = ac !== undefined
    this.ac = ac ?? audioDevice()
    this.masterGain = this.ac.createGain()
    this.masterGain.gain.value = 1
    // Output stage — see `rewireMasterOutput()`. On a multichannel device the
    // song, the click and the cues leave on SEPARATE channels so the desk can
    // keep the click out of the house; on a laptop they fold back into stereo.
    // Opt-in. The split path silenced real playback when it was on by default,
    // having only ever been proven in an offline render — so the app ships on
    // the path that is known to work and separation is switched on deliberately.
    this.outputMap = MixerEngine.resolveOutputMap(this.ac, opts?.layout)
    if (this.outputMap.split) {
      // EXACTLY the channels the layout needs. This used to be
      // `maxChannelCount` — all eighteen, to place four — and asking CoreAudio
      // for an eighteen-channel stream is the prime suspect for the total
      // silence that followed when separation was switched on.
      this.ac.destination.channelCount = this.outputMap.channelCount
      this.ac.destination.channelCountMode = 'explicit'
      // Without 'discrete' a 4- or 6-channel destination applies a SURROUND
      // layout and sprays each signal across speakers instead of placing it.
      // (At 18 channels the spec already falls back to discrete, but this must
      // not depend on the device being big.)
      this.ac.destination.channelInterpretation = 'discrete'
      this.outputMerger = this.ac.createChannelMerger(this.outputMap.channelCount)
      this.outputMerger.connect(this.ac.destination)
      // Click and cues get their own gain nodes feeding their own channels.
      this.clickOut = this.ac.createGain()
      this.cueOut = this.ac.createGain()
      for (const c of this.outputMap.channels.click) this.clickOut.connect(this.outputMerger, 0, c)
      for (const c of this.outputMap.channels.cue) this.cueOut.connect(this.outputMerger, 0, c)
    }
    this.rewireMasterOutput()
    // Recorded audio passes through here on its way to the master; MIDI lanes
    // skip it. See `setAudioPitchShiftNode`.
    this.audioBus = this.ac.createGain()
    this.audioBus.gain.value = 1
    this.audioBus.connect(this.masterGain)
    this.unshiftedBus = this.ac.createGain()
    this.unshiftedBus.gain.value = 1
    this.unshiftedBus.connect(this.masterGain)
  }

  /** Subscribe to transport tick + state changes. Returns unsubscribe. */
  onUpdate(cb: (s: MixerSnapshot) => void): () => void {
    this.subscribers.add(cb)
    cb(this.snapshot())
    return () => {
      this.subscribers.delete(cb)
    }
  }

  setMasterVolume(v: number): void {
    this.masterGain.gain.value = Math.max(0, v)
  }

  /**
   * Replace (or insert) a track. Disconnects any existing gain node for
   * that key first. Re-creates per-track gain so future plays use it.
   */
  setTrack(track: MixerTrack): void {
    const prev = this.tracks.get(track.key)
    if (prev?.insert) prev.insert.output.disconnect()
    this.tracks.set(track.key, track)
    const existing = this.trackGains.get(track.key)
    if (existing) existing.disconnect()
    const gain = this.ac.createGain()
    gain.gain.value = this.effectiveGainFor(track)
    // WHERE THIS TRACK LEAVES.
    //
    // Click gets its own output channel when the device has one, so the desk can
    // send it to every in-ear while keeping it OFF the main bus. Routing it
    // through `masterGain` like everything else is what made that impossible:
    // it arrived inside the song's own stereo pair, so taking the click off the
    // house took the song with it.
    //
    // On stereo hardware `clickOutput` is null and it falls back to the normal
    // path — identical behaviour to before, rather than a click placed on a
    // channel that does not exist.
    const dedicated = track.key === 'click' ? this.clickOutput : null
    if (dedicated) {
      gain.connect(dedicated)
    } else {
      // MIDI lanes take the latency-matched path so the audio pitch shifter can
      // neither transpose them a second time nor leave them running early.
      gain.connect(track.instrument ? this.unshiftedBus : this.audioBus)
    }
    this.trackGains.set(track.key, gain)
    // Wire the insert's tail once; play() connects each source to insert.input.
    if (track.insert) track.insert.output.connect(gain)
    // A MIDI instrument's output is persistent (not per-note), so it's wired
    // here rather than in play().
    if (track.instrument) {
      safeDisconnect(track.instrument.output)
      track.instrument.output.connect(track.insert ? track.insert.input : gain)
    }
    // The gain node above is BRAND NEW, so any sends off this track point at a
    // node that is no longer in circuit — re-tap them or the effect goes quiet
    // the next time the lane reloads.
    this.rewireSendsForTrack(track.key)
    this.emitUpdate()
  }

  // ── Effect busses ─────────────────────────────────────────────────────────

  private static sendId(trackKey: TrackKey, busKey: string): string {
    return `${trackKey}::${busKey}`
  }

  /**
   * Add or replace an effect bus. Its chain returns into the master bus through
   * a return gain, so muting or trimming the bus never touches the dry tracks.
   */
  setBus(bus: MixerBus): void {
    const prev = this.busses.get(bus.key)
    if (prev && prev.chain !== bus.chain) safeDisconnect(prev.chain.output)
    this.busses.set(bus.key, bus)

    let ret = this.busReturnGains.get(bus.key)
    if (!ret) {
      ret = this.ac.createGain()
      this.busReturnGains.set(bus.key, ret)
    }
    safeDisconnect(ret)
    ret.gain.value = bus.muted ? 0 : bus.level
    bus.chain.output.connect(ret)
    // PRE-shifter, deliberately. A send taps the track GAIN, so a recorded
    // lane feeds the bus at ORIGINAL pitch; returning here means the wet tail
    // is transposed by the same shifter as its dry signal. Returning straight
    // to the master (as this did) left a reverb tail in the wrong key and
    // early by the shifter's latency.
    //
    // KNOWN DEVIATION: a MIDI lane's send is already at final pitch, so its wet
    // is shifted once too often. It only applies with the tempo-hold dial above
    // 0, and only to the wet portion. Fixing it properly needs a second chain
    // instance per bus — see `docs/audio-architecture-review.md`.
    ret.connect(this.audioBus)

    // Tracks may already have sends aimed at this key (e.g. the bus was
    // rebuilt) — re-tap them so the send survives.
    for (const trackKey of this.sends.keys()) this.rewireSendsForTrack(trackKey)
    this.emitUpdate()
  }

  removeBus(key: string): void {
    const bus = this.busses.get(key)
    if (bus) safeDisconnect(bus.chain.output)
    this.busses.delete(key)
    const ret = this.busReturnGains.get(key)
    if (ret) {
      safeDisconnect(ret)
      this.busReturnGains.delete(key)
    }
    // Drop every send feeding it, so no orphan taps are left running.
    for (const [trackKey, levels] of this.sends) {
      if (!levels.delete(key)) continue
      const id = MixerEngine.sendId(trackKey, key)
      const sg = this.sendGains.get(id)
      if (sg) {
        safeDisconnect(sg)
        this.sendGains.delete(id)
      }
      if (levels.size === 0) this.sends.delete(trackKey)
    }
    this.emitUpdate()
  }

  listBusses(): MixerBus[] {
    return [...this.busses.values()]
  }

  /**
   * How much of `trackKey` feeds `busKey`. POST-FADER: the tap is taken after
   * the track's own volume/mute, so pulling a fader down takes its effect with
   * it — the behaviour people expect from a mixer.
   */
  setSend(trackKey: TrackKey, busKey: string, level: number): void {
    const lv = Math.max(0, Math.min(1.5, level))
    const id = MixerEngine.sendId(trackKey, busKey)
    if (lv <= 0) {
      const sg = this.sendGains.get(id)
      if (sg) {
        safeDisconnect(sg)
        this.sendGains.delete(id)
      }
      const levels = this.sends.get(trackKey)
      if (levels) {
        levels.delete(busKey)
        if (levels.size === 0) this.sends.delete(trackKey)
      }
      this.emitUpdate()
      return
    }
    const levels = this.sends.get(trackKey) ?? new Map<string, number>()
    levels.set(busKey, lv)
    this.sends.set(trackKey, levels)
    this.rewireSendsForTrack(trackKey)
    this.emitUpdate()
  }

  getSend(trackKey: TrackKey, busKey: string): number {
    return this.sends.get(trackKey)?.get(busKey) ?? 0
  }

  /** Re-tap every send off a track onto its CURRENT gain node. */
  private rewireSendsForTrack(trackKey: TrackKey): void {
    const levels = this.sends.get(trackKey)
    const gain = this.trackGains.get(trackKey)
    if (!levels || !gain) return
    for (const [busKey, level] of levels) {
      const bus = this.busses.get(busKey)
      const id = MixerEngine.sendId(trackKey, busKey)
      let sg = this.sendGains.get(id)
      if (!sg) {
        sg = this.ac.createGain()
        this.sendGains.set(id, sg)
      }
      sg.gain.value = level
      safeDisconnect(sg)
      // A send whose bus is gone stays REMEMBERED but unconnected, so adding
      // the bus back restores it instead of silently losing the setting.
      if (!bus) continue
      gain.connect(sg)
      sg.connect(bus.chain.input)
    }
  }

  removeTrack(key: TrackKey): void {
    // A gone track cannot be un-faded; leaving its key would keep a dead entry
    // alive across every future song.
    this.programmeFadedKeys.delete(key)
    const prev = this.tracks.get(key)
    if (prev?.instrument) {
      prev.instrument.allNotesOff()
      prev.instrument.dispose?.()
      safeDisconnect(prev.instrument.output)
    }
    if (prev?.insert) prev.insert.output.disconnect()
    // Tear down this track's send taps — an orphan tap would keep feeding the
    // bus after the lane is gone.
    const levels = this.sends.get(key)
    if (levels) {
      for (const busKey of levels.keys()) {
        const sg = this.sendGains.get(MixerEngine.sendId(key, busKey))
        if (sg) safeDisconnect(sg)
        this.sendGains.delete(MixerEngine.sendId(key, busKey))
      }
      this.sends.delete(key)
    }
    this.tracks.delete(key)
    const gain = this.trackGains.get(key)
    if (gain) {
      gain.disconnect()
      this.trackGains.delete(key)
    }
    this.emitUpdate()
  }

  /**
   * Route the master bus through a processing chain (masterGain → chain →
   * destination), or restore the direct connection with null. Used for the
   * project-sound glue/limiter.
   */
  setMasterChain(chain: MixerInsert | null): void {
    this.masterChain = chain
    this.rewireMasterOutput()
  }

  /**
   * Park a node on the very end of the master bus (after the project-sound
   * chain), or clear it with null. Used for the live pitch shifter that holds
   * tempo during a naive transpose — one node for every summed track.
   */
  setMasterTailNode(node: AudioNode | null): void {
    this.masterTail = node
    this.rewireMasterOutput()
  }

  /**
   * Delay the un-shifted path to match the audio shifter's latency.
   *
   * The delay node is built lazily: with pure varispeed there is no shifter and
   * therefore nothing to compensate, so the MIDI path stays a plain connection.
   */
  private setUnshiftedLatencyCompensation(latencySec: number): void {
    const wanted = Math.max(0, Math.min(MAX_SHIFTER_LATENCY_SEC, latencySec))
    if (wanted <= 0) {
      if (!this.unshiftedDelay) return
      safeDisconnect(this.unshiftedBus)
      safeDisconnect(this.unshiftedDelay)
      this.unshiftedDelay = null
      this.unshiftedBus.connect(this.masterGain)
      return
    }
    if (!this.unshiftedDelay) {
      // A context without `createDelay` is a test stand-in; compensation is not
      // what those are exercising, so skip it rather than crash the engine.
      if (typeof this.ac.createDelay !== 'function') return
      this.unshiftedDelay = this.ac.createDelay(MAX_SHIFTER_LATENCY_SEC)
      safeDisconnect(this.unshiftedBus)
      this.unshiftedBus.connect(this.unshiftedDelay)
      this.unshiftedDelay.connect(this.masterGain)
    }
    this.unshiftedDelay.delayTime.value = wanted
  }

  /**
   * Where to connect sources that must not be pitch-shifted but must stay in
   * time — spoken cues, and anything else voice-like. Same path the MIDI lanes
   * take, so it carries the shifter's latency compensation.
   */
  get unshiftedInput(): AudioNode {
    return this.unshiftedBus
  }

  /**
   * Insert a pitch shifter for RECORDED audio only (null removes it).
   *
   * This is what the tempo-hold dial needs: varispeed covers part of the
   * transpose by changing the rate, and this covers the residual. MIDI lanes
   * must NOT pass through it — their notes already carry the full transpose, so
   * shifting them here would land them `n × tempoHold` semitones out of tune
   * with everything else.
   */
  setAudioPitchShiftNode(node: AudioNode | null, latencySec = 0): void {
    // Re-applied even when the node is unchanged: a shifter can report its
    // latency only after it has been wired in.
    this.setUnshiftedLatencyCompensation(node ? latencySec : 0)
    if (this.audioPitchShift === node) return
    safeDisconnect(this.audioBus)
    safeDisconnect(this.audioPitchShift)
    this.audioPitchShift = node
    if (node) {
      this.audioBus.connect(node)
      node.connect(this.masterGain)
    } else {
      this.audioBus.connect(this.masterGain)
    }
  }

  /** masterGain → [project sound] → [pitch shift] → destination. */
  private rewireMasterOutput(): void {
    safeDisconnect(this.masterGain)
    safeDisconnect(this.masterChain?.output)
    safeDisconnect(this.masterTail)
    safeDisconnect(this.outputStereoShim)
    safeDisconnect(this.outputSplitter)
    this.outputStereoShim = null
    this.outputSplitter = null

    let tail: AudioNode = this.masterGain
    if (this.masterChain) {
      tail.connect(this.masterChain.input)
      tail = this.masterChain.output
    }
    if (this.masterTail) {
      tail.connect(this.masterTail)
      tail = this.masterTail
    }
    if (this.outputMerger && this.outputMap?.split) {
      // The song pair. A splitter picks the two channels apart before they are
      // placed — connecting a stereo node straight to two merger inputs would
      // send BOTH channels to each. And the tail is forced to STEREO first:
      // the splitter is 'discrete', so a MONO master (mono song file, no
      // stereo stems loaded) would otherwise land on the LEFT house channel
      // only — the one-eared failure arriving by yet another route. The
      // 'speakers' upmix duplicates mono into both sides; true stereo passes
      // through untouched. Caught by the split-output render test, not a PA.
      const toStereo = this.ac.createGain()
      toStereo.channelCount = 2
      toStereo.channelCountMode = 'explicit'
      toStereo.channelInterpretation = 'speakers'
      const splitter = this.ac.createChannelSplitter(2)
      tail.connect(toStereo)
      toStereo.connect(splitter)
      const [l, r] = this.outputMap.channels.song
      splitter.connect(this.outputMerger, 0, l ?? 0)
      splitter.connect(this.outputMerger, 1, r ?? 1)
      this.outputStereoShim = toStereo
      this.outputSplitter = splitter
    } else {
      tail.connect(this.ac.destination)
    }
  }

  /**
   * Where the click should land so it can be kept out of the house.
   *
   * Null on a stereo device: there is nowhere separate to put it, and pretending
   * otherwise would place the click on a channel that does not exist — silence,
   * with no error, on the machine most people use.
   */
  /**
   * The engine's ACTUAL output mode — what the graph really does, not what any
   * panel derived it should do. Surfaces so the UI can never claim "separation
   * is on" while the engine quietly runs stereo (which happened, on a stage).
   */
  get outputSplitActive(): boolean {
    return this.outputMap?.split === true
  }

  get outputSummary(): string {
    if (!this.outputMap) return 'stereo (no output map)'
    return this.outputMap.split
      ? `split: song→${this.outputMap.channels.song.join('/')}, click→${this.outputMap.channels.click.join('/')}, cue→${this.outputMap.channels.cue.join('/')} of ${this.outputMap.channelCount}`
      : `stereo (${this.outputMap.summary || 'no separation'})`
  }

  get clickOutput(): AudioNode | null {
    return this.outputMap?.split ? (this.clickOut ?? null) : null
  }

  /** Same for spoken cues. See {@link clickOutput}. */
  get cueOutput(): AudioNode | null {
    return this.outputMap?.split ? (this.cueOut ?? null) : null
  }

  /** How the outputs are laid out right now — the rig page explains this. */
  get outputLayout(): LiveOutputMap | null {
    return this.outputMap ?? null
  }

  /** Returns a snapshot of current track keys + their saved per-track state. */
  listTracks(): MixerTrack[] {
    return Array.from(this.tracks.values())
  }

  setVolume(key: TrackKey, volume: number): void {
    const t = this.tracks.get(key)
    if (!t) return
    t.volume = Math.max(0, volume)
    this.applyGains()
  }

  setMuted(key: TrackKey, muted: boolean): void {
    const t = this.tracks.get(key)
    if (!t) return
    t.muted = muted
    this.applyGains()
  }

  setSoloed(key: TrackKey, soloed: boolean): void {
    const t = this.tracks.get(key)
    if (!t) return
    t.soloed = soloed
    this.applyGains()
  }

  /** Transiently force a track to silence (or restore it) without touching its
   *  stored mute/volume. See `suppressedKeys`. */
  setTrackSuppressed(key: TrackKey, suppressed: boolean): void {
    const had = this.suppressedKeys.has(key)
    if (suppressed === had) return
    if (suppressed) this.suppressedKeys.add(key)
    else this.suppressedKeys.delete(key)
    this.applyGains()
  }

  /**
   * Effective per-track gain accounting for mute + solo:
   *   - any track is soloed → only soloed tracks play
   *   - else → muted tracks are silent
   */
  private effectiveGainFor(track: MixerTrack): number {
    if (this.suppressedKeys.has(track.key)) return 0
    const anySolo = Array.from(this.tracks.values()).some((t) => t.soloed)
    if (anySolo && !track.soloed) return 0
    if (track.muted) return 0
    return track.volume
  }

  private applyGains(): void {
    for (const t of this.tracks.values()) {
      const g = this.trackGains.get(t.key)
      if (!g) continue
      g.gain.value = this.effectiveGainFor(t)
    }
    this.emitUpdate()
  }

  /**
   * Capture the currently audible musical programme into an echo throw.
   *
   * The tap is post-fader and excludes click/cue by identity. Muted lanes are
   * not admitted, so a two-stem live mix produces a two-stem transition; the
   * hidden original can never appear as an implicit fallback.
   */
  scheduleEchoTransition(schedule: EchoTransitionSchedule): EchoTransitionResult {
    this.cancelEchoTransition(true)
    if (this.state !== 'playing') {
      return { audibleTrackKeys: [], scheduled: false, reason: 'transport-stopped' }
    }
    const now = this.ac.currentTime
    if (schedule.throwAtCtxTime <= now + 0.005) {
      return { audibleTrackKeys: [], scheduled: false, reason: 'throw-already-passed' }
    }

    const admitted = schedule.sourceTrackKeys ? new Set(schedule.sourceTrackKeys) : null
    const tappedTrackGains: Array<{ key: TrackKey; node: GainNode }> = []
    const fadedTrackGains: Array<{ key: TrackKey; node: GainNode }> = []
    const audibleTrackKeys: TrackKey[] = []
    for (const track of this.tracks.values()) {
      if (track.key === 'click' || track.key === 'cue') continue
      const node = this.trackGains.get(track.key)
      if (!node) continue
      fadedTrackGains.push({ key: track.key, node })
      if (admitted && !admitted.has(track.key)) continue
      tappedTrackGains.push({ key: track.key, node })
      if (this.effectiveGainFor(track) > 0.0001) audibleTrackKeys.push(track.key)
    }
    if (audibleTrackKeys.length === 0) {
      return { audibleTrackKeys: [], scheduled: false, reason: 'no-audible-musical-source' }
    }

    const input = this.ac.createGain()
    const delay = this.ac.createDelay(2)
    const feedback = this.ac.createGain()
    const filter = this.ac.createBiquadFilter()
    const wet = this.ac.createGain()
    const reverbSend = this.ac.createGain()
    const reverbPredelay = this.ac.createDelay(0.2)
    const reverb = this.ac.createConvolver()
    const reverbWet = this.ac.createGain()
    const limiter = this.ac.createDynamicsCompressor()
    input.gain.value = 0
    delay.delayTime.value = Math.max(0.02, Math.min(1.9, schedule.delaySec))
    feedback.gain.value = 0
    filter.type = 'lowpass'
    filter.frequency.value = Math.max(600, Math.min(12_000, schedule.toneHz))
    filter.Q.value = 0.45
    wet.gain.value = 0
    reverbSend.gain.value = 0
    reverbPredelay.delayTime.value = 0.024
    reverb.buffer = buildTransitionReverbImpulse(
      this.ac,
      schedule.blendReverbLengthSec,
      schedule.toneHz,
    )
    reverbWet.gain.value = 0
    limiter.threshold.value = -3
    limiter.knee.value = 5
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.18

    for (const tap of tappedTrackGains) tap.node.connect(input)
    input.connect(delay)
    delay.connect(filter)
    filter.connect(wet)
    wet.connect(limiter)
    filter.connect(feedback)
    feedback.connect(delay)
    filter.connect(reverbSend)
    reverbSend.connect(reverbPredelay)
    reverbPredelay.connect(reverb)
    reverb.connect(reverbWet)
    reverbWet.connect(limiter)
    limiter.connect(this.masterGain)

    const throwAt = schedule.throwAtCtxTime
    const captureEnd = throwAt + Math.max(0.04, schedule.captureDurationSec)
    const captureEdge = Math.max(0.012, Math.min(0.07, schedule.captureDurationSec * 0.12))
    const stopAt = Math.max(captureEnd, schedule.echoStopAtCtxTime)
    const stopRampAt = Math.max(throwAt + 0.04, stopAt - 0.14)
    const feedbackStart = Math.max(0.05, Math.min(0.96, schedule.feedback))
    const feedbackEnd =
      schedule.repeatBuild > 0
        ? Math.min(1.045, 1 + schedule.repeatBuild * 0.075)
        : Math.max(0.05, Math.min(0.96, feedbackStart * (1 + schedule.repeatBuild * 0.75)))
    const wetStart = Math.max(0, Math.min(1.25, schedule.wetLevel * (schedule.repeatBuild > 0 ? 0.68 : 1)))
    const wetEnd = Math.max(0, Math.min(1.35, schedule.wetLevel * (1 + schedule.repeatBuild * 0.85)))

    input.gain.setValueAtTime(0, Math.max(now, throwAt - captureEdge))
    input.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, schedule.sendLevel)), throwAt)
    input.gain.setValueAtTime(Math.max(0, Math.min(1, schedule.sendLevel)), Math.max(throwAt, captureEnd - captureEdge))
    input.gain.linearRampToValueAtTime(0, captureEnd)
    feedback.gain.setValueAtTime(feedbackStart, throwAt)
    feedback.gain.linearRampToValueAtTime(feedbackEnd, stopRampAt)
    feedback.gain.linearRampToValueAtTime(0, stopAt)
    wet.gain.setValueAtTime(wetStart, throwAt)
    wet.gain.linearRampToValueAtTime(wetEnd, stopRampAt)
    wet.gain.linearRampToValueAtTime(0, stopAt)
    reverbSend.gain.setValueAtTime(1, throwAt)
    reverbSend.gain.setValueAtTime(1, stopRampAt)
    reverbSend.gain.linearRampToValueAtTime(0, stopAt)
    reverbWet.gain.setValueAtTime(
      Math.max(0, Math.min(0.8, schedule.blendReverbLevel)),
      throwAt,
    )
    reverbWet.gain.setValueAtTime(
      Math.max(0, Math.min(0.8, schedule.blendReverbLevel)),
      stopAt,
    )
    reverbWet.gain.linearRampToValueAtTime(
      0,
      stopAt + Math.max(0.35, Math.min(8, schedule.blendReverbLengthSec)),
    )

    const dryCut = Math.max(throwAt, schedule.dryCutAtCtxTime)
    for (const tap of fadedTrackGains) {
      const current = this.tracks.get(tap.key)
      const value = current ? this.effectiveGainFor(current) : tap.node.gain.value
      tap.node.gain.setValueAtTime(value, Math.max(now, dryCut - 0.045))
      tap.node.gain.linearRampToValueAtTime(0, dryCut)
    }
    const fadedBusReturns = [...this.busReturnGains.values()].map((node) => ({
      node,
      value: node.gain.value,
    }))
    for (const { node, value } of fadedBusReturns) {
      node.gain.setValueAtTime(value, Math.max(now, dryCut - 0.045))
      node.gain.linearRampToValueAtTime(0, dryCut)
    }

    const cleanupAt = stopAt + Math.max(0.35, Math.min(8, schedule.blendReverbLengthSec)) + 0.25
    const active: ActiveEchoTransition = {
      input,
      delay,
      feedback,
      filter,
      wet,
      reverbSend,
      reverbPredelay,
      reverb,
      reverbWet,
      limiter,
      tappedTrackGains,
      fadedTrackGains,
      fadedBusReturns,
      cleanupTimer: null,
    }
    active.cleanupTimer = window.setTimeout(() => {
      if (this.activeEchoTransition === active) this.cancelEchoTransition(false)
    }, Math.max(0, cleanupAt - now) * 1000)
    this.activeEchoTransition = active
    return { audibleTrackKeys, scheduled: true }
  }

  /**
   * Ring the outgoing song out into a reverb, so a song change is a hand-off
   * rather than a cut to silence.
   *
   * The tail deliberately OUTLIVES the song: the nodes hang off `masterGain`
   * and are fed by post-fader taps, so once the capture window has passed, the
   * reverb holds the sound and the caller is free to stop the transport, tear
   * every track down and load the next song while it decays. Exactly the
   * mechanism `scheduleEchoTransition` uses — this is its plain sibling.
   *
   * Click and cue lanes are never tapped: a metronome with a reverb tail on it
   * is not a hand-off, it is a mess.
   *
   * The caller should wait until `dryEndsAtCtxTime` before stopping sources,
   * otherwise the reverb is fed silence and there is nothing to ring.
   */
  /**
   * Ramp the PROGRAMME to silence between two context times — the mechanism
   * behind every simple ending.
   *
   * A `cut` uses a few milliseconds of this to avoid a click; a `fade` uses
   * bars of it as the ending itself. One mechanism, so a cut can never end up
   * with subtly different behaviour from a short fade.
   *
   * Click and cue are excluded BY IDENTITY, exactly as the echo tap excludes
   * them: fading the metronome out under an ending would take the click away
   * from the band at the precise moment they are trying to land together.
   *
   * Returns false when there is nothing to fade or the transport is not
   * playing, so the caller can report a refusal instead of assuming silence.
   */
  scheduleProgrammeFade(fromCtxTime: number, toCtxTime: number): boolean {
    if (this.state !== 'playing') return false
    const now = this.ac.currentTime
    const end = Math.max(toCtxTime, now + 0.005)
    const start = Math.max(now, Math.min(fromCtxTime, end - 0.005))
    let faded = 0
    for (const track of this.tracks.values()) {
      if (track.key === 'click' || track.key === 'cue') continue
      const node = this.trackGains.get(track.key)
      if (!node) continue
      const value = this.effectiveGainFor(track)
      node.gain.cancelScheduledValues(start)
      node.gain.setValueAtTime(value, start)
      node.gain.linearRampToValueAtTime(0, end)
      this.programmeFadedKeys.add(track.key)
      faded++
    }
    // Bus returns too, or an effect tail keeps sounding after the programme has
    // gone — the same reason the echo's dry cut fades them.
    for (const node of this.busReturnGains.values()) {
      const value = node.gain.value
      node.gain.cancelScheduledValues(start)
      node.gain.setValueAtTime(value, start)
      node.gain.linearRampToValueAtTime(0, end)
    }
    return faded > 0
  }

  /**
   * Land one authored ending hit — the kick or the crash of a band ending.
   *
   * ## Where it goes, and why that is the whole design
   *
   * Onto `unshiftedBus`, the path built for "must not be pitch-shifted but must
   * stay in time with everything that is". A transposed song re-pitches its
   * recorded audio; a crash cymbal dragged up three semitones with it would be
   * wrong, and `unshiftedBus` already carries the delay that matches the
   * shifter's latency so the hit still lands with the stems.
   *
   * ## Why it is not a mixer track
   *
   * It could be, and it would then get a fader — but a lane linked to no live
   * button is force-muted in live mode (`liveInitialMuted` fails closed), so an
   * `ending` track would be silent at exactly the gig it was written for, and
   * fixing that would mean touching the APC's memorised control map. This is
   * instead the same class as the echo tail and the ring-out: authored,
   * bounded, part of the ending, hanging off the master, torn down by the same
   * paths. It obeys the master fader; it is deliberately not on a channel.
   *
   * Returns false when there is no buffer for that voice, so a missing kit
   * reports a refusal rather than a silent no-op.
   */
  scheduleEndingHit(buffer: AudioBuffer, atCtxTime: number, level: number): boolean {
    if (!buffer || !(level > 0)) return false
    const at = Math.max(this.ac.currentTime + 0.004, atCtxTime)
    const src = this.ac.createBufferSource()
    const gain = this.ac.createGain()
    src.buffer = buffer
    gain.gain.value = Math.min(1.25, Math.max(0, level))
    src.connect(gain)
    gain.connect(this.unshiftedBus)
    src.start(at)
    this.endingHitSources.add(src)
    src.addEventListener(
      'ended',
      () => {
        this.endingHitSources.delete(src)
        try {
          gain.disconnect()
        } catch {
          /* already gone */
        }
      },
      { once: true },
    )
    return true
  }

  /**
   * Drop any ending hit that has not sounded yet.
   *
   * A hit is scheduled ahead of time on the audio clock, so a stop, seek or
   * song change between arming and the anchor would otherwise fire a crash into
   * the next song. Called from the same teardown every other scheduled source
   * goes through.
   */
  /**
   * Put back what an ending faded, so the next press is not silent.
   *
   * A `cut` or `fade` ending leaves every musical lane ramped to zero. Those
   * gain nodes survive a stop — they belong to the tracks, not the sources — so
   * without this, ending a song and pressing play again gives you silence with
   * a moving playhead. That is the exact shape of the replay show-stopper this
   * engine shipped once before (`mixerEngine.replay.browser.test.ts`), and the
   * ring-out path carries the same restore for the same reason.
   *
   * Restores only what THIS engine faded, and only for tracks that still exist:
   * a hand-off deliberately leaves the outgoing song faded, and those tracks
   * are gone by then anyway.
   */
  private releaseProgrammeFade(): void {
    if (this.programmeFadedKeys.size === 0) return
    const now = this.ac.currentTime
    for (const key of this.programmeFadedKeys) {
      const track = this.tracks.get(key)
      const node = this.trackGains.get(key)
      if (!track || !node) continue
      restoreGainNow(node, this.effectiveGainFor(track), now)
    }
    this.programmeFadedKeys.clear()
  }

  cancelEndingHits(): void {
    for (const src of this.endingHitSources) {
      try {
        src.stop()
      } catch {
        /* not started yet / already stopped */
      }
      try {
        src.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.endingHitSources.clear()
  }

  scheduleSongRingOut(schedule: SongRingOutSchedule): SongRingOutResult {
    const now = this.ac.currentTime
    const miss = (reason: SongRingOutResult['reason']): SongRingOutResult => ({
      scheduled: false,
      reason,
      dryEndsAtCtxTime: now,
      tailEndsAtCtxTime: now,
    })
    if (this.state !== 'playing') return miss('transport-stopped')
    // A programmed transition already owns the hand-off; two overlapping tails
    // would double the wash and fight over the same dry fade.
    if (this.activeEchoTransition) return miss('echo-transition-active')

    this.cancelRingOut(false)

    const captureSec = Math.max(0.05, Math.min(4, schedule.captureSec))
    const tailSec = Math.max(0.35, Math.min(8, schedule.tailSec))
    const level = Math.max(0, Math.min(1, schedule.level))

    const tappedTrackGains: Array<{ key: TrackKey; node: GainNode }> = []
    const fadedTrackGains: Array<{ key: TrackKey; node: GainNode }> = []
    let audible = 0
    for (const track of this.tracks.values()) {
      if (track.key === 'click' || track.key === 'cue') continue
      const node = this.trackGains.get(track.key)
      if (!node) continue
      fadedTrackGains.push({ key: track.key, node })
      tappedTrackGains.push({ key: track.key, node })
      if (this.effectiveGainFor(track) > 0.0001) audible += 1
    }
    if (audible === 0) return miss('no-audible-musical-source')

    const input = this.ac.createGain()
    const predelay = this.ac.createDelay(0.2)
    const reverb = this.ac.createConvolver()
    const wet = this.ac.createGain()
    const limiter = this.ac.createDynamicsCompressor()
    input.gain.value = 0
    predelay.delayTime.value = 0.018
    reverb.buffer = buildTransitionReverbImpulse(this.ac, tailSec, schedule.toneHz)
    wet.gain.value = 0
    limiter.threshold.value = -3
    limiter.knee.value = 5
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.18

    for (const tap of tappedTrackGains) tap.node.connect(input)
    input.connect(predelay)
    predelay.connect(reverb)
    reverb.connect(wet)
    wet.connect(limiter)
    limiter.connect(this.masterGain)

    const dryEnd = now + captureSec
    const tailEnd = dryEnd + tailSec

    // Send at FULL for the whole capture window while the dry fades underneath:
    // the reverb has to be fed a healthy slice or the tail is a whisper.
    input.gain.setValueAtTime(1, now)
    input.gain.setValueAtTime(1, dryEnd)
    input.gain.linearRampToValueAtTime(0, dryEnd + 0.02)
    wet.gain.setValueAtTime(level, now)
    wet.gain.setValueAtTime(level, dryEnd)
    wet.gain.linearRampToValueAtTime(0, tailEnd)

    // The dry song fades out across the capture window rather than stopping.
    for (const tap of fadedTrackGains) {
      const current = this.tracks.get(tap.key)
      const value = current ? this.effectiveGainFor(current) : tap.node.gain.value
      tap.node.gain.cancelScheduledValues(now)
      tap.node.gain.setValueAtTime(value, now)
      tap.node.gain.linearRampToValueAtTime(0, dryEnd)
    }
    const fadedBusReturns = [...this.busReturnGains.values()].map((node) => ({
      node,
      value: node.gain.value,
    }))
    for (const { node, value } of fadedBusReturns) {
      node.gain.cancelScheduledValues(now)
      node.gain.setValueAtTime(value, now)
      node.gain.linearRampToValueAtTime(0, dryEnd)
    }

    const active: ActiveRingOut = {
      input,
      predelay,
      reverb,
      wet,
      limiter,
      tappedTrackGains,
      fadedTrackGains,
      fadedBusReturns,
      cleanupTimer: null,
    }
    active.cleanupTimer = window.setTimeout(
      () => {
        if (this.activeRingOut === active) this.cancelRingOut(false)
      },
      Math.max(0, tailEnd + 0.25 - now) * 1000,
    )
    this.activeRingOut = active
    return { scheduled: true, dryEndsAtCtxTime: dryEnd, tailEndsAtCtxTime: tailEnd }
  }

  /**
   * Drop a ring-out tail. `restoreCurrentMix` puts the faded lanes back, which
   * is what a manual transport action (the operator hitting play again) needs.
   */
  cancelRingOut(restoreCurrentMix = true): void {
    const active = this.activeRingOut
    if (!active) return
    if (active.cleanupTimer != null) clearTimeout(active.cleanupTimer)
    const now = this.ac.currentTime
    for (const tap of active.tappedTrackGains) {
      try {
        tap.node.disconnect(active.input)
      } catch {
        /* already detached */
      }
    }
    for (const tap of active.fadedTrackGains) {
      if (restoreCurrentMix && this.trackGains.get(tap.key) === tap.node) {
        const track = this.tracks.get(tap.key)
        if (track) restoreGainNow(tap.node, this.effectiveGainFor(track), now)
      }
    }
    for (const item of active.fadedBusReturns) {
      if (restoreCurrentMix && [...this.busReturnGains.values()].includes(item.node)) {
        restoreGainNow(item.node, item.value, now)
      }
    }
    for (const node of [active.input, active.predelay, active.reverb, active.wet, active.limiter]) {
      safeDisconnect(node)
    }
    this.activeRingOut = null
  }

  /**
   * Let go of a ring-out because the transport is starting — WITHOUT killing a
   * tail that is supposed to be ringing under the incoming song.
   *
   * The taps say which case this is. If any tapped gain node is still the
   * current node for its key, nothing was reloaded: the operator aborted and is
   * replaying the SAME song, so the faded mix has to be restored (otherwise the
   * next press is silent) and the tail goes with it. If every tap is stale,
   * `setTrack` minted fresh gain nodes during a song load — this is a hand-off,
   * and cutting the tail here would silence it on the incoming song's first
   * sample, which is the whole thing the tail exists to prevent.
   */
  private releaseRingOut(): void {
    const active = this.activeRingOut
    if (!active) return
    const sameSongReplay = active.fadedTrackGains.some(
      (tap) => this.trackGains.get(tap.key) === tap.node,
    )
    if (sameSongReplay) {
      this.cancelRingOut(true)
      return
    }

    // Hand-off: let it ring. Detach the taps so the INCOMING song is not fed
    // into the outgoing song's reverb.
    for (const tap of active.tappedTrackGains) {
      try {
        tap.node.disconnect(active.input)
      } catch {
        /* already detached */
      }
    }
    active.tappedTrackGains = []
    active.fadedTrackGains = []
    // Bus returns are REUSED across a song load (`setBus` keeps the node), so
    // the fade-to-zero automation is still on them. `setBus` has already written
    // the incoming song's level; clearing the automation is what stops the old
    // ramp from dragging the new song's effect returns back to silence.
    const now = this.ac.currentTime
    for (const item of active.fadedBusReturns) {
      if (![...this.busReturnGains.values()].includes(item.node)) continue
      try {
        item.node.gain.cancelScheduledValues(now)
        item.node.gain.setValueAtTime(item.node.gain.value, now)
      } catch {
        /* param gone */
      }
    }
    active.fadedBusReturns = []
  }

  /**
   * Arm an automatic ring-out for a song that ends on its own.
   *
   * The natural end is the common case in a set, and it is the one the manual
   * path cannot cover: auto-advance only runs once the transport has already
   * stopped, by which point there is no audio left to capture. Passing a
   * schedule here makes the engine start the hand-off `captureSec` BEFORE the
   * end, so the last moment of the song feeds the reverb instead of hitting a
   * wall. `null` restores the old hard ending.
   */
  setAutoRingOut(schedule: SongRingOutSchedule | null): void {
    this.autoRingOut = schedule
    if (this.state === 'playing') this.scheduleAutoStop()
  }

  /** Is a hand-off tail currently armed or decaying? (Tests + diagnostics.) */
  hasActiveRingOut(): boolean {
    return this.activeRingOut !== null
  }

  /** A lane's live gain value. Test-only window onto the fade automation. */
  trackGainValueForTest(key: TrackKey): number {
    return this.trackGains.get(key)?.gain.value ?? 0
  }

  /** Cancel an armed/tailing transition. Manual transport actions restore the current mix. */
  cancelEchoTransition(restoreCurrentMix = true): void {
    const active = this.activeEchoTransition
    if (!active) return
    if (active.cleanupTimer != null) clearTimeout(active.cleanupTimer)
    const now = this.ac.currentTime
    for (const tap of active.tappedTrackGains) {
      try { tap.node.disconnect(active.input) } catch { /* already detached */ }
    }
    for (const tap of active.fadedTrackGains) {
      if (restoreCurrentMix && this.trackGains.get(tap.key) === tap.node) {
        const track = this.tracks.get(tap.key)
        if (track) {
          tap.node.gain.cancelScheduledValues(now)
          tap.node.gain.setValueAtTime(this.effectiveGainFor(track), now)
        }
      }
    }
    for (const item of active.fadedBusReturns) {
      if (restoreCurrentMix && [...this.busReturnGains.values()].includes(item.node)) {
        item.node.gain.cancelScheduledValues(now)
        item.node.gain.setValueAtTime(item.value, now)
      }
    }
    for (const node of [active.input, active.delay, active.feedback, active.filter, active.wet,
      active.reverbSend, active.reverbPredelay, active.reverb, active.reverbWet, active.limiter]) {
      safeDisconnect(node)
    }
    this.activeEchoTransition = null
  }

  /** Longest track buffer defines transport duration. */
  durationSec(): number {
    let max = 0
    for (const t of this.tracks.values()) {
      const d = t.buffer ? t.buffer.duration : (t.instrument?.durationSec ?? 0)
      if (d > max) max = d
    }
    return max
  }

  /**
   * Set the varispeed playback rate (1 = off). Applies to sources already
   * playing, and re-anchors the transport so the playhead does not jump: the
   * position reached SO FAR was accumulated at the old rate, so we restart the
   * accounting from here rather than re-deriving the whole elapsed span.
   */
  setPlaybackRate(rate: number): void {
    const next = Number.isFinite(rate) && rate > 0 ? rate : 1
    if (next === this.playbackRate) return
    if (this.state === 'playing') {
      // Freeze the current position under the OLD rate, then make it the new anchor.
      const here = this.positionSec()
      this.playStartPositionSec = here
      this.playStartCtxTime = this.ac.currentTime
    }
    this.playbackRate = next
    for (const a of this.active) a.source.playbackRate.value = next
    // A buffer source follows its `playbackRate`; a MIDI part does not — its
    // notes are already pinned to context times computed at the OLD rate. Left
    // alone the drums would keep the old tempo while everything else changed.
    if (this.state === 'playing') {
      for (const t of this.tracks.values()) {
        if (t.instrument) this.rescheduleInstrument(t.key)
      }
    }
    if (this.state === 'playing') this.scheduleAutoStop() // the end moved
  }

  /**
   * Re-schedule ONE MIDI track from the live playhead, without disturbing the
   * transport or restarting any other lane. This is what makes changing a
   * generated part instant: no render, no re-seek, nothing else interrupted.
   *
   * No-op unless playing — a stopped track picks the new part up on `play()`.
   */
  rescheduleInstrument(key: TrackKey): void {
    const t = this.tracks.get(key)
    if (!t?.instrument || this.state !== 'playing') return
    const now = this.ac.currentTime
    const at = now + 0.04
    // Where the playhead WILL be at `at`, not where it is now — scheduling
    // from the current position would drag the part late by the lead-in.
    //
    // SIGNED (`schedulingPositionSec`), not `positionSec()`: during an
    // announcement pre-roll the playhead is legitimately NEGATIVE, and
    // `positionSec()` floors it at 0. Using the floored value would place the
    // whole part however many seconds of pre-roll remain too early — and
    // because `schedule()` pins absolute context times, it would never
    // self-correct.
    const posAtStart =
      this.schedulingPositionSec() + wallSecToBufferSec(at - now, this.playbackRate)
    t.instrument.allNotesOff()
    t.instrument.schedule(posAtStart, at, this.playbackRate)
  }

  /** Current varispeed rate (1 = untransposed). */
  get rate(): number {
    return this.playbackRate
  }

  positionSec(): number {
    if (this.state !== 'playing') return this.playStartPositionSec
    // Wall-clock elapsed → BUFFER seconds: at rate r, r seconds of audio play
    // per second of wall time. The playhead therefore stays in ORIGINAL audio
    // time, which is what keeps the untouched `.smap` grid in sync for free.
    const elapsed = wallSecToBufferSec(this.ac.currentTime - this.playStartCtxTime, this.playbackRate)
    // Clamp to [0, duration]: floored during the count-in / announcement pre-roll
    // (elapsed negative), capped at the end so the UI clock never runs away if a
    // stop is a frame late.
    return Math.max(0, Math.min(this.durationSec(), this.playStartPositionSec + elapsed))
  }

  /**
   * The exact `ac.currentTime` at which the current sources finish: they were
   * started at `playStartCtxTime` from offset `playStartPositionSec`, so they run
   * for `(duration - startPos)` seconds. `playStartCtxTime` already bakes in the
   * `0.04` lookahead AND any `startDelaySec` announcement pre-roll — which is why
   * auto-stop must derive from THIS, not from `positionSec()` (0 during pre-roll).
   */
  private currentEndCtx(): number {
    // The remaining span is BUFFER seconds; at rate r it takes r× less wall time.
    return (
      this.playStartCtxTime +
      bufferSecToWallSec(Math.max(0, this.effectiveEndSec() - this.playStartPositionSec), this.playbackRate)
    )
  }

  /**
   * Where this song ends RIGHT NOW — the programmed ending if there is one and
   * we have not already passed it, otherwise the end of the audio.
   *
   * The "already passed" rule matters more than it looks. Seeking beyond the
   * programmed end is how you rehearse an outro you have chosen to cut, and an
   * ending that stopped the transport the instant you landed there would make
   * that impossible. So the anchor applies to a pass that STARTED before it,
   * and is otherwise inert.
   *
   * Routed through here rather than through `durationSec()` on purpose: the
   * playhead, the waveform and the scrubber all still describe the whole file.
   * Only the STOP moves.
   */
  private effectiveEndSec(): number {
    const dur = this.durationSec()
    const end = this.programmedEndSec
    if (end == null || end >= dur) return dur
    if (this.playStartPositionSec >= end) return dur
    return end
  }

  /**
   * Set (or clear) the programmed ending. Re-arms the stop immediately, so
   * moving the anchor while a song is playing takes effect on this pass.
   */
  setProgrammedEnd(positionSec: number | null): void {
    const next =
      typeof positionSec === 'number' && Number.isFinite(positionSec) && positionSec > 0
        ? positionSec
        : null
    if (next === this.programmedEndSec) return
    this.programmedEndSec = next
    if (this.state === 'playing') this.scheduleAutoStop()
  }

  /** Where the transport will stop on this pass. For tests and the stage UI. */
  effectiveEndPositionSec(): number {
    return this.effectiveEndSec()
  }

  /**
   * Transport anchor exposure for an EXTERNAL click/count-in loop that
   * schedules against this engine's clock (e.g. `UnifiedTransport`).
   *
   * `playStartCtx` is the exact `ac.currentTime` the current sources were
   * scheduled to start at (already includes the `0.04` lookahead + any
   * `startDelaySec` pre-roll). `playStartPos` is the mix-timeline offset
   * they were started from. Together they let the caller pre-schedule
   * count-in clicks at `playStartCtx + clickPoint.timeSec`, sample-aligned
   * with the song's first sample. Read-only — they do not mutate state.
   */
  get playStartCtx(): number {
    return this.playStartCtxTime
  }

  get playStartPos(): number {
    return this.playStartPositionSec
  }

  /**
   * SIGNED playhead on the scheduling timeline — same derivation as
   * `positionSec()` but WITHOUT the `Math.max(0, …)` floor, so it can go
   * below `playStartPositionSec` during a `startDelaySec` pre-roll (the
   * shortfall is "how long until the first sample plays", negated). An
   * external click loop needs this signed value so a downbeat at
   * plan-time 0 stays correctly AHEAD during the count-in instead of
   * being dumped into "now". Returns `playStartPositionSec` when stopped.
   */
  schedulingPositionSec(): number {
    if (this.state !== 'playing') return this.playStartPositionSec
    return (
      this.playStartPositionSec +
      wallSecToBufferSec(this.ac.currentTime - this.playStartCtxTime, this.playbackRate)
    )
  }

  snapshot(): MixerSnapshot {
    return {
      state: this.state,
      positionSec: this.positionSec(),
      durationSec: this.durationSec(),
    }
  }

  /** Number of live buffer sources currently scheduled (debug/test observability). */
  get activeSourceCount(): number {
    return this.active.length
  }

  async play(fromSec?: number, opts?: { startDelaySec?: number }): Promise<void> {
    if (this.ac.state === 'suspended') await this.ac.resume().catch(() => {})
    this.releaseRingOut()
    // An ending faded the programme to zero; put it back or this press is
    // silent. Must run BEFORE sources are created.
    this.releaseProgrammeFade()
    // ALWAYS tear down any prior/stale source set first — never overlap two sets
    // (the "fucked up sound" on replay). Safe to call when already stopped.
    this.stopSourcesOnly()

    let startAt = Math.max(0, fromSec ?? this.playStartPositionSec)
    // Defense-in-depth: a start position at/past the end (e.g. a stale wedged
    // position) would create NO sources → a dead replay. Restart from the top.
    const dur = this.durationSec()
    if (dur > 0 && startAt >= dur) startAt = 0
    // Optional lead delay (e.g. to let a song announcement finish first).
    const ctxStartTime = this.ac.currentTime + 0.04 + Math.max(0, opts?.startDelaySec ?? 0)

    this.active = []
    for (const t of this.tracks.values()) {
      const gain = this.trackGains.get(t.key)
      if (!gain) continue
      if (t.instrument) {
        // MIDI: the instrument schedules its own notes. Its output is wired
        // once in `setTrack`, so it already runs through the insert + fader
        // and feeds any effect sends.
        t.instrument.allNotesOff()
        t.instrument.schedule(startAt, ctxStartTime, this.playbackRate)
        continue
      }
      if (!t.buffer) continue
      const src = this.ac.createBufferSource()
      src.buffer = t.buffer
      // Through the insert when present (insert.output is pre-wired to gain).
      src.connect(t.insert ? t.insert.input : gain)
      src.playbackRate.value = this.playbackRate // naive transpose; 1 = untouched
      // Offset within the buffer = startAt; if startAt > buffer duration, skip.
      if (startAt < t.buffer.duration) {
        src.start(ctxStartTime, startAt)
        this.active.push({ source: src, gain, trackKey: t.key })
      }
    }

    this.playStartCtxTime = ctxStartTime
    this.playStartPositionSec = startAt
    this.state = 'playing'
    this.startTick()
    this.emitUpdate()
    this.scheduleAutoStop()
  }

  /**
   * (Re)arm the "all tracks finished → stop" timer, derived from the ctx-clock
   * END of the current sources (`currentEndCtx`) so it accounts for the `0.04`
   * lookahead AND any `startDelaySec` announcement pre-roll. If the OS coalesces
   * the timer and it fires early, RE-ARM rather than silently wedging.
   */
  private scheduleAutoStop(): void {
    if (this.autoStopTimer != null) {
      clearTimeout(this.autoStopTimer)
      this.autoStopTimer = null
    }
    if (this.autoRingOutTimer != null) {
      clearTimeout(this.autoRingOutTimer)
      this.autoRingOutTimer = null
    }
    if (this.state !== 'playing') return
    const remaining = this.currentEndCtx() - this.ac.currentTime
    if (remaining <= 0) {
      if (this.durationSec() > 0) this.stop()
      return
    }
    // Hand the song off BEFORE it ends. Arming after the stop is too late —
    // the sources are gone and the reverb would be fed silence.
    const auto = this.autoRingOut
    if (auto) {
      const leadSec = Math.max(0.05, Math.min(4, auto.captureSec))
      if (remaining > leadSec + 0.05) {
        this.autoRingOutTimer = window.setTimeout(
          () => {
            this.autoRingOutTimer = null
            if (this.state === 'playing') this.scheduleSongRingOut(auto)
          },
          Math.max(0, remaining - leadSec) * 1000,
        )
      }
    }
    this.autoStopTimer = window.setTimeout(() => {
      this.autoStopTimer = null
      if (this.state !== 'playing') return
      if (this.ac.currentTime >= this.currentEndCtx() - 0.05) this.stop()
      else this.scheduleAutoStop() // fired early — re-arm for the true end
    }, Math.ceil(remaining * 1000) + 40)
  }

  /** Current AudioContext time — the one true clock. */
  currentCtxTime(): number {
    return this.ac.currentTime
  }

  /** Convert a mixer-timeline position to the shared AudioContext clock. */
  contextTimeForPosition(positionSec: number): number | null {
    if (this.state !== 'playing') return null
    return (
      this.playStartCtxTime +
      bufferSecToWallSec(positionSec - this.playStartPositionSec, this.playbackRate)
    )
  }

  /**
   * Arm a SAMPLE-ACCURATE jump: when the playhead reaches `boundaryPositionSec`
   * (a bar line), swap to playing from `toPositionSec`. The switch is scheduled
   * on the audio clock (not polled), so it lands exactly on the beat — no slip.
   * Replaces any un-committed pending jump; no-op unless playing.
   */
  armJumpAtPosition(boundaryPositionSec: number, toPositionSec: number): void {
    if (this.state !== 'playing') return
    if (this.committedJump) return // too close to the boundary — let it fire
    const targetCtxTime =
      this.playStartCtxTime +
      bufferSecToWallSec(boundaryPositionSec - this.playStartPositionSec, this.playbackRate)
    if (targetCtxTime <= this.ac.currentTime) return // boundary already gone
    this.pendingJump = {
      targetCtxTime,
      toPositionSec: Math.max(0, Math.min(this.durationSec(), toPositionSec)),
    }
  }

  cancelJump(): void {
    this.pendingJump = null
  }

  /** True while a bar-quantized jump is queued or scheduled (for LED/UI). */
  jumpPending(): boolean {
    return this.pendingJump != null || this.committedJump != null
  }

  /**
   * Called every tick: commit a pending jump once its boundary is within the
   * lookahead window (scheduling stop/start on the audio clock), then promote a
   * committed jump once its boundary has passed.
   */
  private serviceJumps(): void {
    const now = this.ac.currentTime

    if (this.pendingJump && !this.committedJump) {
      const { targetCtxTime, toPositionSec } = this.pendingJump
      if (targetCtxTime - now <= MixerEngine.JUMP_LOOKAHEAD) {
        const at = Math.max(targetCtxTime, now + 0.005)
        // Stop the currently-playing sources exactly at the boundary…
        for (const a of this.active) {
          try {
            a.source.stop(at)
          } catch {
            /* already stopped */
          }
        }
        // …and start fresh sources at the boundary from the section offset.
        const newSources: ActiveSource[] = []
        for (const t of this.tracks.values()) {
          const gain = this.trackGains.get(t.key)
          if (!gain) continue
          if (t.instrument) {
            // A bar-quantized jump re-schedules MIDI from the target sample-
            // accurately, exactly as buffers are re-started below. Silence AT
            // the boundary, not now: the jump commits up to JUMP_LOOKAHEAD
            // early, and an immediate stop would punch that much silence into
            // the drums before every section launch while the stems play on.
            t.instrument.allNotesOff(at)
            t.instrument.schedule(toPositionSec, at, this.playbackRate)
            continue
          }
          const buffer = t.buffer
          if (buffer && toPositionSec < buffer.duration) {
            const src = this.ac.createBufferSource()
            src.buffer = buffer
            src.connect(t.insert ? t.insert.input : gain)
            src.playbackRate.value = this.playbackRate
            src.start(at, toPositionSec)
            newSources.push({ source: src, gain, trackKey: t.key })
          }
        }
        this.committedJump = { targetCtxTime: at, toPositionSec, newSources }
        this.pendingJump = null
      }
    }

    if (this.committedJump && now >= this.committedJump.targetCtxTime) {
      const c = this.committedJump
      // The old sources already stopped at the boundary; adopt the new ones.
      this.active = c.newSources
      this.playStartCtxTime = c.targetCtxTime
      this.playStartPositionSec = c.toPositionSec
      this.committedJump = null
      this.scheduleAutoStop()
    }
  }

  pause(): void {
    if (this.state !== 'playing') return
    const at = this.positionSec()
    this.stopSourcesOnly()
    this.playStartPositionSec = at
    this.state = 'stopped'
    this.stopTick()
    this.emitUpdate()
  }

  stop(): void {
    // A pending auto ring-out must not fire into a stopped transport — it would
    // fade lanes that are already silent and leave them down for the next press.
    if (this.autoRingOutTimer != null) {
      clearTimeout(this.autoRingOutTimer)
      this.autoRingOutTimer = null
    }
    this.stopSourcesOnly()
    this.playStartPositionSec = 0
    this.state = 'stopped'
    this.stopTick()
    this.emitUpdate()
  }

  seek(toSec: number): void {
    const t = Math.max(0, Math.min(this.durationSec(), toSec))
    if (this.state === 'playing') {
      void this.play(t)
    } else {
      this.playStartPositionSec = t
      this.emitUpdate()
    }
  }

  private stopSourcesOnly(): void {
    // MIDI tracks hold their own scheduled notes; a buffer stop can't reach
    // them, so they have to be silenced explicitly or a seek leaves the old
    // part ringing over the new one.
    for (const t of this.tracks.values()) t.instrument?.allNotesOff()
    // An ending hit is scheduled ahead on the audio clock; without this a stop
    // or a song change between arming and the anchor fires a crash into the
    // next song.
    this.cancelEndingHits()
    // Any armed/scheduled jump is void once we tear down the transport.
    this.pendingJump = null
    if (this.committedJump) {
      for (const a of this.committedJump.newSources) {
        try {
          a.source.stop()
        } catch {
          /* not yet started / already stopped */
        }
      }
      this.committedJump = null
    }
    if (this.autoStopTimer != null) {
      clearTimeout(this.autoStopTimer)
      this.autoStopTimer = null
    }
    for (const a of this.active) {
      try {
        a.source.stop()
      } catch {
        /* already stopped */
      }
      try {
        a.source.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.active = []
  }

  /**
   * Let instruments that schedule in a rolling window top it up.
   *
   * A synth voice is several oscillators plus a filter and a gain, so a lane
   * cannot put a whole song's worth on the clock at once the way a sampled
   * drum lane can. Instruments that need it expose `tick`; the rest ignore it.
   */
  private serviceInstrumentWindows(): void {
    if (this.state !== 'playing') return
    const pos = this.schedulingPositionSec()
    for (const t of this.tracks.values()) t.instrument?.tick?.(pos)
  }

  private startTick(): void {
    if (this.rafId != null) return
    const tick = () => {
      this.serviceJumps()
      // REQUIRED: the drum instrument (and any other rolling-window lane) only
      // schedules a window at a time now, so without this it falls silent once
      // the first window runs out.
      this.serviceInstrumentWindows()
      this.emitUpdate()
      if (this.state === 'playing') {
        this.rafId = requestAnimationFrame(tick)
      } else {
        this.rafId = null
      }
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopTick(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private emitUpdate(): void {
    const s = this.snapshot()
    for (const cb of this.subscribers) {
      try {
        cb(s)
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  /** Tear down — disconnect all of OUR nodes. Never closes a borrowed context. */
  async dispose(): Promise<void> {
    this.cancelEchoTransition(false)
    this.cancelRingOut(false)
    this.stopSourcesOnly()
    this.stopTick()
    for (const g of this.trackGains.values()) {
      try {
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.trackGains.clear()
    this.tracks.clear()
    try {
      this.masterGain.disconnect()
    } catch {
      /* ignore */
    }
    this.subscribers.clear()
    // ONLY a context we created. Closing the shared device here silenced the
    // ENTIRE APP: a closed AudioContext accepts createGain/connect/start and
    // every automation call without throwing, freezes currentTime at 0, and
    // `audioDevice()` kept handing the same dead object to every later caller.
    // Symptom: open a project, navigate away, and nothing makes a sound again
    // until reload — with no error anywhere. The class doc at the constructor
    // already promised "the engine never closes it"; now it is true.
    if (this.#ownsContext) {
      try {
        await this.ac.close()
      } catch {
        /* already closed */
      }
    }
  }
}
