/**
 * UnifiedTransport — the single playback authority for Song Edit.
 *
 * ONE decode, ONE clock, shared across every editor mode AND the mixer AND the
 * live route, so starting playback and switching modes keeps the same audio
 * playing (position / clicks / chord rail / karaoke continuous). It's a
 * module-level singleton (like `audioSession` / `songMap` / `project`) so it
 * survives component mount/unmount and the `/edit` ↔ `/project/playback` route
 * change.
 *
 * The PUBLIC API is engine-agnostic and expressed in SONG-TIME — the same base
 * as `songPlaybackPlan(sm).clickPoints[].timeSec` and `songTimings` (song-start
 * at 0, count-in negative). Each surface converts at its own edge; this facade
 * never double-shifts.
 *
 * **Internals: one `MixerEngine` (the song is the degenerate 1-track case) with
 * clicks + count-in scheduled on that SAME `AudioContext`.** The song plays as a
 * single `MixerEngine` track (`AudioBufferSourceNode.start(ctxStart, offset)`)
 * and the metronome rings through a `clickMaster` gain on `engine.ac` — one
 * clock (`engine.ac.currentTime`), one output latency, so song and clicks
 * cannot disagree. The scheduling DECISIONS (which click fires and when) reuse
 * the pure, test-pinned `clickScheduling` module — the exact same functions the
 * `PlaybackController` uses — so both engines stay bit-for-bit in step.
 *
 * `play()` is transcribed from `PlaybackController.play()`: same start-position
 * clamp, same count-in decision (`songStartBufferPos` / `atSongStart` /
 * `wantsCountIn` / `preroll = plan.prependSec`), then `engine.play(startPos,
 * { startDelaySec: preroll })` (which anchors `ctxStart = ac.currentTime + 0.04
 * + preroll`, identical to the controller). The count-in clicks are pre-
 * scheduled against the engine's exact `playStartCtx`; the song-beat clicks are
 * scheduled from a rAF loop off the engine's signed scheduling position.
 *
 * Runtime-only: nothing here is ever written into the `.smap`, so autosave and
 * the cloud dirty-check are untouched.
 */
import {
  countInClickTimes,
  dueClicks,
  initialClickIndex,
} from '$lib/audio/clickScheduling'
import { playMetronomeClick } from '$lib/audio/debugClickTrack'
import { MixerEngine, type MixerSnapshot } from '$lib/audio/mixerEngine'
import { songPlaybackPlan, type PlaybackPlan } from '$lib/songmap/playbackPlan'
import type { SongMap } from '$lib/songmap/types'

/** Auto-stop epsilon at clip / range ends. Mirrors the controller. */
const END_EPS = 0.028

/** The single track key the song is registered under (no stems this step). */
const SONG_TRACK_KEY = 'original'

/**
 * The minimal `PlaybackController`-shaped surface `WaveformPlayer` consumes.
 * Both the real `PlaybackController` (home trim variant) and the transport's
 * `playbackAdapter` (Song Edit) satisfy it structurally, so `WaveformPlayer`
 * can drive either engine without knowing which one backs it. Everything the
 * controller historically expressed in BUFFER-time (`currentTime`, `seek`,
 * `rangeStart/End`) stays BUFFER-time here; the adapter converts at its edge.
 *
 * `ownsDecode` is the one member the real controller lacks: when true the host
 * (`WaveformPlayer`) reuses `audioBuffer` instead of decoding the file itself,
 * so the whole editor shares ONE decode.
 */
export interface PlaybackControllerLike {
  readonly currentTime: number
  readonly isPlaying: boolean
  readonly audioBuffer: AudioBuffer | null
  readonly mediaTimeOffsetSec: number
  readonly mediaReady?: boolean
  readonly ownsDecode?: boolean
  rangeStart: number
  rangeEnd: number
  playWithClick: boolean
  clickVolume: number
  songVolume: number
  clickOffsetSec: number
  debugClickTiming: boolean
  setAudioBuffer(buf: AudioBuffer | null): void
  setAudioElement(el: HTMLAudioElement | null): void
  setSongMap(sm: SongMap | null): void
  seek(sec: number): void
  play(): void
  pause(): void
  stop(): void
}

class UnifiedTransport {
  /**
   * Shared, page-owned viewport in SONG-TIME seconds. The spine binds these; a
   * mode never rebuilds them, so zoom/scroll persists across mode switches.
   * `viewEnd === 0` means "not initialised yet — show the whole song".
   */
  viewStart = $state(0)
  viewEnd = $state(0)

  /** Decoded once here and shared (peaks readers use this same buffer). */
  audioBuffer = $state<AudioBuffer | null>(null)
  decoding = $state(false)
  decodeError = $state<string | null>(null)

  // ── UI knobs (bind targets from host components) ───────────────────
  playWithClick = $state(false)
  clickVolume = $state(1.5)
  songVolume = $state(1)
  clickOffsetSec = $state(0)
  /**
   * Per-device "log click scheduling to the console" toggle. The transport does
   * not consume it (its click loop is already test-pinned); it exists only so
   * the `playbackAdapter` can back `WaveformPlayer`'s `bind:debugClickTiming`.
   */
  debugClickTiming = $state(false)

  // ── Reactive runtime bus (song timing source of truth) ─────────────
  #songMap = $state<SongMap | null>(null)
  #plan = $derived<PlaybackPlan | null>(
    this.#songMap ? songPlaybackPlan(this.#songMap) : null,
  )

  // ── Reactive transport mirror (MixerEngine is NOT Svelte-reactive) ─
  /** Mirror of engine transport state; the facade's `isPlaying`. */
  #playing = $state(false)
  /** UI playhead in BUFFER-time, floored at song start (see `#computeUiPosition`). */
  #positionSec = $state(0)

  // ── Audio graph (created lazily so module import stays SSR-safe) ────
  #engine: MixerEngine | null = null
  #clickMaster: GainNode | null = null
  #unsubEngine: (() => void) | null = null

  /** Playback selection in BUFFER-time (auto-stop when position ≥ rangeEnd). */
  #rangeStart = 0
  #rangeEnd = 0

  /** The file whose decode is current, to skip redundant re-decodes. */
  #loadedFile: File | null = null

  /** rAF for the position mirror + range auto-stop guard. */
  #transportRaf = 0
  /** rAF for the click loop. */
  #clickRaf = 0
  /** Index into `plan.clickPoints` for the next song click to schedule. */
  #nextClickIdx = 0
  /** Cleanup for the `$effect.root` that owns the facade's sync effects. */
  #effectCleanup: (() => void) | null = null

  /** Lazily-built, stable `PlaybackControllerLike` view (see `playbackAdapter`). */
  #adapter: PlaybackControllerLike | null = null

  constructor() {
    this.#effectCleanup = $effect.root(() => {
      // 1. Sync click master gain from `clickVolume` (no upper cap).
      $effect(() => {
        const v = Math.max(0, this.clickVolume)
        if (this.#clickMaster) this.#clickMaster.gain.value = v
      })

      // 2. Sync the song track gain from `songVolume` (clamped [0, 1]).
      $effect(() => {
        const v = Math.max(0, Math.min(1, this.songVolume))
        if (this.#engine && this.audioBuffer) this.#engine.setVolume(SONG_TRACK_KEY, v)
      })

      // 3. Start / stop the click rAF loop when:
      //      isPlaying × playWithClick × plan.clickPoints.length > 0
      $effect(() => {
        const should =
          this.#playing &&
          this.playWithClick &&
          (this.#plan?.clickPoints.length ?? 0) > 0
        if (should) this.#startClickLoop()
        else this.#stopClickLoop()
      })
    })
  }

  // ── Transport observables (song-time) ──────────────────────────────
  get isPlaying(): boolean {
    return this.#playing
  }
  /** Playhead in song-time seconds (song-start = 0). */
  get songTimeSec(): number {
    return this.#positionSec - this.mediaOffsetSec
  }
  get ready(): boolean {
    return this.audioBuffer !== null && this.audioBuffer.duration > 0
  }
  /** Total song-time duration (0 until a buffer is loaded). */
  get durationSec(): number {
    // Read `audioBuffer` ($state) unconditionally so this stays reactive once the
    // shared decode lands, even though the engine is the authoritative length.
    const buf = this.audioBuffer
    const d = this.#engine ? this.#engine.durationSec() : (buf?.duration ?? 0)
    return d > 0 ? d - this.mediaOffsetSec : 0
  }
  /** Song-time offset of the decoded buffer's t=0 (= `plan.trimStartSec`). */
  get mediaOffsetSec(): number {
    return this.#plan?.trimStartSec ?? 0
  }

  // ── Configuration ──────────────────────────────────────────────────
  /**
   * Point the transport at a song. Sets the click/timing plan source and (via
   * the derived plan) the one canonical media-time offset (`plan.trimStartSec`),
   * so every consumer's song-time conversion agrees. Cheap + idempotent — safe
   * to call reactively.
   */
  configure(sm: SongMap | null): void {
    this.#songMap = sm
  }

  /**
   * Decode `file` once (on the playback context) and register it as the single
   * song track. No-op if the same file is already decoded. Loading a null file
   * clears the track.
   */
  async loadFile(file: File | null): Promise<void> {
    if (file === this.#loadedFile) return
    this.#loadedFile = file
    this.decodeError = null
    if (!file) {
      this.audioBuffer = null
      this.#engine?.removeTrack(SONG_TRACK_KEY)
      return
    }
    this.decoding = true
    try {
      const engine = this.#ensureEngine()
      const bytes = await file.arrayBuffer()
      const buf = await engine.ac.decodeAudioData(bytes)
      // A newer file may have superseded us while decoding.
      if (this.#loadedFile !== file) return
      this.audioBuffer = buf
      this.#registerTrack(buf)
    } catch (e) {
      if (this.#loadedFile === file) {
        this.decodeError = e instanceof Error ? e.message : 'Could not decode audio.'
        this.audioBuffer = null
        this.#engine?.removeTrack(SONG_TRACK_KEY)
      }
    } finally {
      if (this.#loadedFile === file) this.decoding = false
    }
  }

  // ── Song-time selection / playback range ───────────────────────────
  /** Set the loop/selection range in SONG-TIME (empty range = whole song). */
  setRangeSongTime(startSec: number, endSec: number): void {
    this.#rangeStart = startSec + this.mediaOffsetSec
    this.#rangeEnd = endSec > startSec ? endSec + this.mediaOffsetSec : 0
  }

  // ── Transport (song-time) ──────────────────────────────────────────
  play(): void {
    if (this.#playing) return
    const buf = this.audioBuffer
    if (!buf) return
    const engine = this.#ensureEngine()
    const plan = this.#plan

    // Where to start from (BUFFER-time). If the playhead is outside the
    // selection, clamp to rangeStart. Bound to the buffer so we never
    // schedule a start past the end.
    const dur = buf.duration
    let startPos = engine.playStartPos
    if (this.#rangeEnd > this.#rangeStart) {
      if (startPos < this.#rangeStart || startPos >= this.#rangeEnd - 0.02) {
        startPos = this.#rangeStart
      }
    }
    startPos = Math.max(0, Math.min(startPos, dur))
    const endPos =
      this.#rangeEnd > this.#rangeStart ? Math.min(this.#rangeEnd, dur) : dur
    if (endPos - startPos < 0.005) return // empty range

    // Count-in pre-roll: only when (a) click enabled, (b) tight trim needs
    // prepend silence, (c) playhead at/before song start. Identical decision
    // to `PlaybackController.play()`.
    const songStartBufferPos = plan
      ? plan.firstDownbeatOriginalSec - this.mediaOffsetSec
      : Number.POSITIVE_INFINITY
    const atSongStart = startPos <= songStartBufferPos + 0.05
    const wantsCountIn =
      this.playWithClick &&
      plan !== null &&
      plan.countInBeats > 0 &&
      plan.prependSec > 1e-6 &&
      atSongStart
    const preroll = wantsCountIn ? plan!.prependSec : 0

    // Ensure the context is running, then launch. When already running (the
    // normal post-gesture case, and every unit test), `engine.play()` runs
    // fully synchronously so `engine.playStartCtx` is set before we read it.
    if (engine.ac.state === 'suspended') {
      void engine.ac.resume().finally(() => {
        if (this.#loadedFile && !this.#playing) {
          this.#launch(engine, plan, startPos, preroll, wantsCountIn)
        }
      })
    } else {
      this.#launch(engine, plan, startPos, preroll, wantsCountIn)
    }
  }

  /** Schedule the song source + count-in clicks; mirror of the controller tail. */
  #launch(
    engine: MixerEngine,
    plan: PlaybackPlan | null,
    startPos: number,
    preroll: number,
    wantsCountIn: boolean,
  ): void {
    // `engine.play` sets `ctxStartTime = ac.currentTime + 0.04 + preroll` and
    // its `playStartCtx` / `playStartPos` anchor — IDENTICAL to the controller's
    // `ctxStart = ctx.currentTime + PLAY_START_LOOKAHEAD_SEC + preroll`.
    void engine.play(startPos, { startDelaySec: preroll })
    const ctxStart = engine.playStartCtx

    // Pre-schedule the count-in clicks against the exact ctxStart, so they are
    // sample-aligned with the song's first sample. The WHAT/WHEN is the pure
    // `countInClickTimes`; we only make the sound.
    if (wantsCountIn && plan && this.#clickMaster) {
      const fires = countInClickTimes(
        plan,
        ctxStart,
        this.clickOffsetSec,
        engine.ac.currentTime,
      )
      for (const f of fires) {
        playMetronomeClick(engine.ac, this.#clickMaster, f.atCtxTime, f.downbeat)
      }
    }

    this.#playing = true
    this.#positionSec = this.#computeUiPosition()
    this.#startTransport()
    this.#startClickLoop()
  }

  pause(): void {
    if (!this.#playing) return
    this.#stopClickLoop()
    this.#stopTransport()
    this.#playing = false
    this.#engine?.pause()
    this.#positionSec = this.#computeUiPosition()
  }

  /** Pause and seek to rangeStart. */
  stop(): void {
    this.#stopClickLoop()
    this.#stopTransport()
    const engine = this.#engine
    this.#playing = false
    if (!engine) return
    engine.stop()
    if (this.#rangeStart > 0) engine.seek(this.#rangeStart)
    this.#positionSec = this.#computeUiPosition()
  }

  togglePlay(): void {
    if (this.#playing) this.pause()
    else this.play()
  }

  /** Seek to a SONG-TIME position. */
  seek(songTimeSec: number): void {
    const engine = this.#ensureEngine()
    const target = songTimeSec + this.mediaOffsetSec // buffer-time
    const wasPlaying = this.#playing
    if (wasPlaying) {
      this.#stopClickLoop()
      this.#stopTransport()
      engine.pause()
      this.#playing = false
    }
    engine.seek(target) // clamps to [0, durationSec], sets playStartPos when stopped
    this.#positionSec = this.#computeUiPosition()
    if (wasPlaying) this.play()
  }

  /**
   * A stable `PlaybackControllerLike` view of this transport, so the existing
   * `WaveformPlayer` (grid / sections / chords) can drive the shared engine with
   * NO changes to how it talks to a controller. Everything the host expects in
   * BUFFER-time is converted here:
   *   • `currentTime` / `seek` translate buffer-time ↔ song-time via
   *     `mediaOffsetSec` (= `plan.trimStartSec`).
   *   • `rangeStart/End` are stored/read in buffer-time but routed through
   *     `setRangeSongTime` (song-time) so `play()` clamps to the same window.
   *   • `setAudioBuffer` / `setAudioElement` are no-ops — the transport owns the
   *     one decode and plays buffer-based, so there is no element or second
   *     buffer to hand it. `ownsDecode: true` tells the host to reuse
   *     `audioBuffer` instead of decoding the file again.
   * The getters read this instance's `$state`, so a consumer's `$derived(
   * adapter.currentTime)` stays reactive.
   */
  get playbackAdapter(): PlaybackControllerLike {
    if (this.#adapter) return this.#adapter
    const t = this
    this.#adapter = {
      ownsDecode: true,
      get currentTime() {
        return t.songTimeSec + t.mediaOffsetSec
      },
      get isPlaying() {
        return t.isPlaying
      },
      get audioBuffer() {
        return t.audioBuffer
      },
      get mediaTimeOffsetSec() {
        return t.mediaOffsetSec
      },
      get mediaReady() {
        return t.ready
      },
      get playWithClick() {
        return t.playWithClick
      },
      set playWithClick(v: boolean) {
        t.playWithClick = v
      },
      get clickVolume() {
        return t.clickVolume
      },
      set clickVolume(v: number) {
        t.clickVolume = v
      },
      get songVolume() {
        return t.songVolume
      },
      set songVolume(v: number) {
        t.songVolume = v
      },
      get clickOffsetSec() {
        return t.clickOffsetSec
      },
      set clickOffsetSec(v: number) {
        t.clickOffsetSec = v
      },
      get debugClickTiming() {
        return t.debugClickTiming
      },
      set debugClickTiming(v: boolean) {
        t.debugClickTiming = v
      },
      // Range in BUFFER-time. Read straight off the stored buffer range; on
      // write, convert to song-time and preserve the other edge so setting the
      // two independently (as the host does) still lands the right window.
      get rangeStart() {
        return t.#rangeStart
      },
      set rangeStart(v: number) {
        const off = t.mediaOffsetSec
        const endBuf = t.#rangeEnd
        t.setRangeSongTime(v - off, endBuf > v ? endBuf - off : v - off)
      },
      get rangeEnd() {
        return t.#rangeEnd
      },
      set rangeEnd(v: number) {
        const off = t.mediaOffsetSec
        const startBuf = t.#rangeStart
        t.setRangeSongTime(startBuf - off, v > startBuf ? v - off : startBuf - off)
      },
      setAudioBuffer(_buf: AudioBuffer | null) {
        /* transport owns the one decode — nothing to adopt */
      },
      setAudioElement(_el: HTMLAudioElement | null) {
        /* buffer-based playback — the <audio> element is not on the play path */
      },
      setSongMap(sm: SongMap | null) {
        t.configure(sm)
      },
      seek(bufferPos: number) {
        t.seek(bufferPos - t.mediaOffsetSec)
      },
      play() {
        t.play()
      },
      pause() {
        t.pause()
      },
      stop() {
        t.stop()
      },
    }
    return this.#adapter
  }

  dispose(): void {
    this.#stopClickLoop()
    this.#stopTransport()
    this.#unsubEngine?.()
    this.#unsubEngine = null
    if (this.#clickMaster) {
      try {
        this.#clickMaster.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.#clickMaster = null
    if (this.#engine) void this.#engine.dispose().catch(() => {})
    this.#engine = null
    this.#effectCleanup?.()
    this.#effectCleanup = null
    this.#adapter = null
    this.audioBuffer = null
    this.#loadedFile = null
    this.#playing = false
    this.#positionSec = 0
  }

  // ── Internals: engine graph ────────────────────────────────────────

  #ensureEngine(): MixerEngine {
    if (this.#engine) return this.#engine
    const engine = new MixerEngine()
    const click = engine.ac.createGain()
    click.gain.value = Math.max(0, this.clickVolume)
    click.connect(engine.ac.destination)
    this.#clickMaster = click
    // Mirror engine-driven transport changes (e.g. auto-stop at the buffer end)
    // into the reactive `#playing` flag. MixerEngine has no Svelte reactivity.
    this.#unsubEngine = engine.onUpdate((s: MixerSnapshot) => {
      if (this.#playing && s.state !== 'playing') {
        // Engine stopped on its own — tear down the loops.
        this.#playing = false
        this.#stopClickLoop()
        this.#stopTransport()
        this.#positionSec = this.#computeUiPosition()
      }
    })
    this.#engine = engine
    return engine
  }

  #registerTrack(buf: AudioBuffer): void {
    const engine = this.#ensureEngine()
    if (this.#playing) this.stop()
    engine.setTrack({
      key: SONG_TRACK_KEY,
      label: 'Song',
      buffer: buf,
      volume: Math.max(0, Math.min(1, this.songVolume)),
      muted: false,
      soloed: false,
    })
    // This transport is a persistent module singleton shared across songs, so a
    // freshly-loaded song must be reset to the top — otherwise playback AND the
    // click loop start from wherever the PREVIOUS song's playhead / selection was
    // left (the "click track starts in the second half after switching songs"
    // regression). Reset the engine position, the selection range, and the mirror.
    engine.seek(0)
    this.#rangeStart = 0
    this.#rangeEnd = 0
    this.#nextClickIdx = 0
    this.#positionSec = 0
  }

  // ── Internals: position derivation ─────────────────────────────────

  /**
   * UI playhead in BUFFER-time. Same derivation as the controller's
   * `#computeCurrentPosition()`: the engine's SIGNED scheduling position,
   * floored at `playStartPos` so the playhead never reports below song start
   * during the count-in pre-roll.
   */
  #computeUiPosition(): number {
    const engine = this.#engine
    if (!engine) return 0
    return Math.max(engine.playStartPos, engine.schedulingPositionSec())
  }

  // ── Internals: transport rAF (position mirror + range auto-stop) ───

  #startTransport(): void {
    if (this.#transportRaf) return
    this.#transportRaf = requestAnimationFrame(this.#tickTransport)
  }

  #stopTransport(): void {
    if (this.#transportRaf) cancelAnimationFrame(this.#transportRaf)
    this.#transportRaf = 0
  }

  #tickTransport = (): void => {
    const engine = this.#engine
    if (!this.#playing || !engine) {
      this.#stopTransport()
      return
    }
    // Engine reached the buffer end on its own → stop.
    if (engine.snapshot().state !== 'playing') {
      this.#playing = false
      this.#stopClickLoop()
      this.#positionSec = this.#computeUiPosition()
      this.#stopTransport()
      return
    }
    const pos = this.#computeUiPosition()
    this.#positionSec = pos
    // Range auto-stop: the engine plays to the buffer end (it has no range),
    // so we stop it when the floored position reaches rangeEnd — the same rAF
    // guard the controller uses (belt-and-suspenders there, primary here).
    if (this.#rangeEnd > this.#rangeStart && pos >= this.#rangeEnd - END_EPS) {
      this.#playing = false
      this.#stopClickLoop()
      this.#stopTransport()
      engine.stop()
      if (this.#rangeStart > 0) engine.seek(this.#rangeStart)
      this.#positionSec = this.#computeUiPosition()
      return
    }
    this.#transportRaf = requestAnimationFrame(this.#tickTransport)
  }

  // ── Internals: click rAF loop ──────────────────────────────────────

  #startClickLoop(): void {
    if (this.#clickRaf) return
    if (!this.playWithClick) return
    const engine = this.#engine
    const plan = this.#plan
    if (!engine || !plan || plan.clickPoints.length === 0) return
    // Signed scheduling position: during a count-in pre-roll this is negative,
    // so the downbeat at `timeSec === 0` is correctly still AHEAD of us.
    const planTime = engine.schedulingPositionSec() - this.mediaOffsetSec
    this.#nextClickIdx = initialClickIndex(plan, planTime)
    this.#clickRaf = requestAnimationFrame(this.#runClickLoop)
  }

  #stopClickLoop(): void {
    if (this.#clickRaf) cancelAnimationFrame(this.#clickRaf)
    this.#clickRaf = 0
  }

  #runClickLoop = (): void => {
    const engine = this.#engine
    const master = this.#clickMaster
    if (!engine || !master || !this.playWithClick || !this.#playing) {
      this.#stopClickLoop()
      return
    }
    const plan = this.#plan
    if (!plan) {
      this.#stopClickLoop()
      return
    }

    // Position derives from the SAME ctx clock the song source is locked to —
    // they cannot disagree. It is the SIGNED scheduling position, so during the
    // count-in pre-roll plan-time is negative and clicks are scheduled at their
    // true distance ahead instead of being dumped into "now".
    const planTime = engine.schedulingPositionSec() - this.mediaOffsetSec
    const ctxNow = engine.ac.currentTime

    const { fires, nextIdx, done } = dueClicks(
      plan,
      this.#nextClickIdx,
      planTime,
      ctxNow,
      this.clickOffsetSec,
    )
    this.#nextClickIdx = nextIdx
    for (const f of fires) {
      playMetronomeClick(engine.ac, master, f.atCtxTime, f.downbeat)
    }

    if (done) {
      this.#stopClickLoop()
      return
    }
    this.#clickRaf = requestAnimationFrame(this.#runClickLoop)
  }
}

/** The one transport for the app. */
export const transport = new UnifiedTransport()
