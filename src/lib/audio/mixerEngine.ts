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

export type TrackKey = string

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
export interface MidiInstrument {
  /** Connect this to the track's input; the engine wires it once. */
  output: AudioNode
  /**
   * Schedule every note from `fromSec` on the mix timeline onward, where
   * `fromSec` lands at context time `atCtx`. `rate` is the varispeed factor.
   */
  schedule: (fromSec: number, atCtx: number, rate: number) => void
  /** Cancel everything pending/sounding — called on stop, seek and re-play. */
  allNotesOff: () => void
  /** Part length, so a MIDI-only song still has a mix duration. */
  durationSec: number
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
  /** How far ahead of the boundary we commit the scheduled sources (seconds). */
  private static readonly JUMP_LOOKAHEAD = 0.08

  constructor() {
    this.ac = new AudioContext()
    this.masterGain = this.ac.createGain()
    this.masterGain.gain.value = 1
    this.masterGain.connect(this.ac.destination)
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
    gain.connect(this.masterGain)
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
    ret.connect(this.masterGain)

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
    const prev = this.tracks.get(key)
    if (prev?.instrument) {
      prev.instrument.allNotesOff()
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

  /** masterGain → [project sound] → [pitch shift] → destination. */
  private rewireMasterOutput(): void {
    safeDisconnect(this.masterGain)
    safeDisconnect(this.masterChain?.output)
    safeDisconnect(this.masterTail)

    let tail: AudioNode = this.masterGain
    if (this.masterChain) {
      tail.connect(this.masterChain.input)
      tail = this.masterChain.output
    }
    if (this.masterTail) {
      tail.connect(this.masterTail)
      tail = this.masterTail
    }
    tail.connect(this.ac.destination)
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
    if (this.state === 'playing') this.scheduleAutoStop() // the end moved
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
      bufferSecToWallSec(Math.max(0, this.durationSec() - this.playStartPositionSec), this.playbackRate)
    )
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
    if (this.state !== 'playing') return
    const remaining = this.currentEndCtx() - this.ac.currentTime
    if (remaining <= 0) {
      if (this.durationSec() > 0) this.stop()
      return
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
            // accurately, exactly as buffers are re-started below.
            t.instrument.allNotesOff()
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

  private startTick(): void {
    if (this.rafId != null) return
    const tick = () => {
      this.serviceJumps()
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

  /** Tear down — disconnect all nodes, close the context. */
  async dispose(): Promise<void> {
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
    try {
      await this.ac.close()
    } catch {
      /* ignore */
    }
  }
}
