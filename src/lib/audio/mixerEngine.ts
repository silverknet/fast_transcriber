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

export type TrackKey = string

export interface MixerTrack {
  key: TrackKey
  /** Display label. */
  label: string
  /** Decoded buffer with any prepend-silence already applied. */
  buffer: AudioBuffer
  /** Per-track linear gain (0..1.5). 1 = unity. */
  volume: number
  muted: boolean
  soloed: boolean
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
    this.tracks.set(track.key, track)
    const existing = this.trackGains.get(track.key)
    if (existing) existing.disconnect()
    const gain = this.ac.createGain()
    gain.gain.value = this.effectiveGainFor(track)
    gain.connect(this.masterGain)
    this.trackGains.set(track.key, gain)
    this.emitUpdate()
  }

  removeTrack(key: TrackKey): void {
    this.tracks.delete(key)
    const gain = this.trackGains.get(key)
    if (gain) {
      gain.disconnect()
      this.trackGains.delete(key)
    }
    this.emitUpdate()
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

  /**
   * Effective per-track gain accounting for mute + solo:
   *   - any track is soloed → only soloed tracks play
   *   - else → muted tracks are silent
   */
  private effectiveGainFor(track: MixerTrack): number {
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
      const d = t.buffer.duration
      if (d > max) max = d
    }
    return max
  }

  positionSec(): number {
    if (this.state !== 'playing') return this.playStartPositionSec
    const elapsed = this.ac.currentTime - this.playStartCtxTime
    return Math.max(0, this.playStartPositionSec + elapsed)
  }

  snapshot(): MixerSnapshot {
    return {
      state: this.state,
      positionSec: this.positionSec(),
      durationSec: this.durationSec(),
    }
  }

  async play(fromSec?: number): Promise<void> {
    if (this.ac.state === 'suspended') await this.ac.resume().catch(() => {})
    if (this.state === 'playing') this.stopSourcesOnly()

    const startAt = Math.max(0, fromSec ?? this.playStartPositionSec)
    const ctxStartTime = this.ac.currentTime + 0.04 // small lookahead

    this.active = []
    for (const t of this.tracks.values()) {
      const src = this.ac.createBufferSource()
      src.buffer = t.buffer
      const gain = this.trackGains.get(t.key)
      if (!gain) continue
      src.connect(gain)
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

    // Auto-stop when all tracks finish.
    const remaining = this.durationSec() - startAt
    if (remaining > 0) {
      window.setTimeout(() => {
        if (this.state === 'playing' && this.positionSec() >= this.durationSec() - 0.01) {
          this.stop()
        }
      }, Math.ceil(remaining * 1000) + 80)
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
