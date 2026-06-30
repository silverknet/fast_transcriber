/**
 * Single runtime owner of ONE playback surface.
 *
 * **Architecture: same as `MixerEngine`.** The song plays through an
 * `AudioBufferSourceNode` and clicks through metronome oscillators —
 * BOTH scheduled against ONE `AudioContext`. There is only one clock
 * (`ctx.currentTime`); there is no `HTMLAudioElement.currentTime`
 * involved in the play path. Sync is guaranteed by construction.
 *
 *   - The song is started with `src.start(ctxStart, offsetInBuffer)`
 *     so its real-time output position is fully determined by the
 *     context clock from the moment of play.
 *   - The click loop derives playback position the same way:
 *     `position = playStartPositionSec + (ctx.currentTime − playStartCtxTime)`.
 *     Clicks are scheduled at `ctx.currentTime + (clickPoint.timeSec −
 *     planTime)`. Both numbers come off the same clock, both reach
 *     speakers through the same output latency. No drift, no
 *     `MediaElementAudioSourceNode` buffer.
 *
 * This replaces the earlier `HTMLAudioElement` + `MediaElementAudioSourceNode`
 * approach that introduced a `~23 ms` audio-side buffer the click
 * path didn't pay — manifesting as clicks ~25 ms ahead of the song.
 *
 * **Public API** (unchanged from the host's perspective):
 *
 *   - `setSongMap(sm)` — drives the `$derived plan`.
 *   - `setAudioBuffer(buf)` — REQUIRED for playback. Hosts pass the
 *     `AudioBuffer` they already decode for waveform peaks.
 *   - `setAudioElement(el)` — kept for back-compat (some hosts bind it
 *     for blob-URL lifetime / native UI). NOT used for playback.
 *   - `play()` / `pause()` / `stop()` / `seek(sec)` — transport.
 *   - `destroy()` — teardown.
 *
 * Count-in handling: pre-schedule N count-in oscillators against the
 * shared ctx (no setTimeout, no audio.play race). Song source starts
 * at `ctxStart + prependSec` so bar 1 beat 1 lands exactly one beat
 * after the last count-in click.
 */
import { playMetronomeClick } from '$lib/audio/debugClickTrack'
import { songPlaybackPlan, type PlaybackPlan } from '$lib/songmap/playbackPlan'
import type { SongMap } from '$lib/songmap/types'

const END_EPS = 0.028
/** rAF lookahead for click scheduling. */
const CLICK_LOOKAHEAD_SEC = 0.025
/** Web Audio scheduling lead-time so clicks aren't audibly late. */
const CLICK_SCHEDULE_LEAD_SEC = 0.002
/** Grace window for "click happened just now". */
const CLICK_PAST_GRACE_SEC = 0.018
/** Lookahead before we schedule the BufferSource to start. Same as MixerEngine. */
const PLAY_START_LOOKAHEAD_SEC = 0.04

export class PlaybackController {
  // ── Inputs ─────────────────────────────────────────────────────────
  songMap = $state<SongMap | null>(null)
  /**
   * Decoded audio (PCM). REQUIRED for playback. Hosts already decode
   * this for waveform peaks; they pass it via `setAudioBuffer()`.
   */
  audioBuffer = $state<AudioBuffer | null>(null)
  /**
   * Back-compat binding only. The controller does NOT use the audio
   * element for playback in the buffer-based model — playback flows
   * through `audioBuffer` + Web Audio. Hosts may still bind it for
   * blob-URL lifetime or other UI concerns.
   */
  audioEl = $state<HTMLAudioElement | null>(null)

  /** Playback selection (auto-stop when currentTime >= rangeEnd). */
  rangeStart = $state(0)
  rangeEnd = $state(0)

  /**
   * Per-surface time-base offset that translates
   *
   *   `planTime = position − mediaTimeOffsetSec`
   *
   * where `position` is in audio-buffer time (i.e. seconds into the
   * decoded buffer; 0 = start of file). `plan.clickPoints[].timeSec`
   * is trim-shifted song-time (0 = `audio.trim.startSec`), so the
   * grid editor uses `offset = plan.trimStartSec` and the buffer's
   * `0` corresponds to original-time 0.
   */
  mediaTimeOffsetSec = $state(0)

  // ── UI knobs (bind targets from host components) ───────────────────
  playWithClick = $state(false)
  clickVolume = $state(1.5)
  songVolume = $state(1)

  /**
   * Per-system fine-tune. Positive = clicks fire LATER; negative =
   * earlier. With buffer-based playback both audio and clicks share
   * ONE output latency, so 0 should be perfect on any hardware. The
   * slider stays as an escape hatch for unusual chains (BT, USB).
   */
  clickOffsetSec = $state(0)
  debugClickTiming = $state(false)
  #debugLogBudget = 0

  // ── Public observables ─────────────────────────────────────────────
  isPlaying = $state(false)
  currentTime = $state(0)

  /** Ready to play when there's a decoded buffer with non-zero duration. */
  mediaReady = $derived(this.audioBuffer !== null && this.audioBuffer.duration > 0)

  // ── The central reactive bus — single source of truth at runtime ──
  plan = $derived<PlaybackPlan | null>(
    this.songMap ? songPlaybackPlan(this.songMap) : null,
  )

  clampedSongVolume = $derived(Math.max(0, Math.min(1, this.songVolume)))
  clampedClickVolume = $derived(Math.max(0, this.clickVolume))

  // ── Private internals ──────────────────────────────────────────────
  /**
   * THE shared AudioContext. Song source nodes and click oscillators
   * both schedule against `#ctx.currentTime` — one clock, one output
   * latency, no drift.
   */
  #ctx: AudioContext | null = null
  #clickMaster: GainNode | null = null
  #songGain: GainNode | null = null
  #activeSource: AudioBufferSourceNode | null = null
  /** `ctx.currentTime` at which the current source was scheduled to start. */
  #playStartCtxTime = 0
  /** Buffer offset at which the source was started (= position at playStartCtxTime). */
  #playStartPositionSec = 0
  /** Buffer position where the current play range ends. */
  #playEndPositionSec = 0
  /** When count-in pre-roll is active, this is how much wall-clock time elapses before the song's first sample plays. */
  #playPreRollSec = 0
  /** Auto-stop setTimeout when the source reaches `#playEndPositionSec`. */
  #autoStopTimeoutId: ReturnType<typeof setTimeout> | null = null
  /** rAF for the position mirror (`currentTime` $state updates). */
  #transportRaf = 0
  /** rAF for the click loop. */
  #clickRaf = 0
  /** Index into `plan.clickPoints` for the next click to schedule. */
  #nextClickIdx = 0
  /** Cleanup for the $effect.root that owns the controller's effects. */
  #effectCleanup: (() => void) | null = null

  constructor() {
    this.#effectCleanup = $effect.root(() => {
      // 1. Sync click master gain from `clickVolume`.
      $effect(() => {
        const v = this.clampedClickVolume
        if (this.#clickMaster) this.#clickMaster.gain.value = v
      })

      // 2. Sync song gain from `songVolume`. Audio plays via
      //    `AudioBufferSourceNode → songGain → destination`; there is
      //    no `<audio>.volume` in the play path.
      $effect(() => {
        const v = this.clampedSongVolume
        if (this.#songGain) this.#songGain.gain.value = v
      })

      // 3. Start / stop the click rAF loop when:
      //      isPlaying × playWithClick × plan.clickPoints.length > 0
      $effect(() => {
        const should =
          this.isPlaying &&
          this.playWithClick &&
          (this.plan?.clickPoints.length ?? 0) > 0
        if (should) this.#startClickLoop()
        else this.#stopClickLoop()
      })

      // (No effect for "buffer swap mid-play stop" — that was a bug:
      // it tracked `isPlaying` too, and fired the moment `play()` set
      // `isPlaying = true`, killing the source we just started. Buffer
      // swap mid-play is handled imperatively in `setAudioBuffer()`.)
    })
  }

  // ── Public methods ─────────────────────────────────────────────────

  setSongMap(sm: SongMap | null): void {
    this.songMap = sm
  }

  /**
   * Provide the decoded `AudioBuffer` for the current song. REQUIRED
   * before `play()` — without it `play()` no-ops. Hosts already decode
   * this for waveform peaks; pass that same buffer here.
   *
   * If a new buffer arrives mid-play, the currently-playing source is
   * stopped imperatively here (NOT via a `$effect` — that path tracked
   * `isPlaying` too and would kill the source `play()` had just
   * started in the same microtask).
   */
  setAudioBuffer(buf: AudioBuffer | null): void {
    const swapMidPlay = this.isPlaying && this.audioBuffer !== null && this.audioBuffer !== buf
    if (swapMidPlay) {
      this.#stopSourceOnly()
      this.#cancelAutoStop()
      this.isPlaying = false
      this.#stopTransport()
    }
    this.audioBuffer = buf
  }

  /** Back-compat. Hosts may still bind the `<audio>` element. The controller does not use it for playback. */
  setAudioElement(el: HTMLAudioElement | null): void {
    this.audioEl = el
  }

  play(): void {
    if (this.isPlaying) {
      if (import.meta.env.DEV) {
        console.warn('[PlaybackController] play() ignored — already playing')
      }
      return
    }
    const buf = this.audioBuffer
    if (!buf) {
      if (import.meta.env.DEV) {
        console.warn(
          '[PlaybackController] play() ignored — no audioBuffer set yet. ' +
            'Did the host call setAudioBuffer(decodedAudioBuffer) after decode?',
        )
      }
      return
    }
    const plan = this.plan

    if (this.debugClickTiming) this.#debugLogBudget = 16

    this.#ensureGraph()
    const ctx = this.#ctx!
    void ctx.resume()

    // Where to start from. If the playhead is outside the selection,
    // clamp to rangeStart. Bound to the buffer's duration so we never
    // schedule a start past the end.
    const dur = buf.duration
    let startPos = this.currentTime
    if (this.rangeEnd > this.rangeStart) {
      if (startPos < this.rangeStart || startPos >= this.rangeEnd - 0.02) {
        startPos = this.rangeStart
      }
    }
    startPos = Math.max(0, Math.min(startPos, dur))
    const endPos = this.rangeEnd > this.rangeStart
      ? Math.min(this.rangeEnd, dur)
      : dur
    if (endPos - startPos < 0.005) {
      if (import.meta.env.DEV) {
        console.warn('[PlaybackController] play() ignored — empty range', {
          startPos,
          endPos,
          rangeStart: this.rangeStart,
          rangeEnd: this.rangeEnd,
          currentTime: this.currentTime,
          bufferDuration: dur,
        })
      }
      return
    }
    if (import.meta.env.DEV) {
      console.log('[PlaybackController] play() starting source', {
        startPos,
        endPos,
        ctxState: ctx.state,
        ctxCurrentTime: ctx.currentTime,
        bufferDuration: dur,
        songGainValue: this.#songGain?.gain.value,
        rangeStart: this.rangeStart,
        rangeEnd: this.rangeEnd,
      })
    }

    // Count-in pre-roll: only when (a) click enabled, (b) tight trim
    // needs prepend silence, (c) playhead at/before song start.
    const songStartBufferPos = plan
      ? plan.firstDownbeatOriginalSec - this.mediaTimeOffsetSec
      : Number.POSITIVE_INFINITY
    const atSongStart = startPos <= songStartBufferPos + 0.05
    const wantsCountIn =
      this.playWithClick &&
      plan !== null &&
      plan.countInBeats > 0 &&
      plan.prependSec > 1e-6 &&
      atSongStart
    const preroll = wantsCountIn ? plan!.prependSec : 0

    // Schedule the source. `ctxStart` is when the song's first sample
    // (= `startPos` inside the buffer) reaches the destination.
    const ctxStart = ctx.currentTime + PLAY_START_LOOKAHEAD_SEC + preroll
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.#songGain!)
    src.start(ctxStart, startPos)
    src.stop(ctxStart + (endPos - startPos) + 0.05)

    this.#activeSource = src
    this.#playStartCtxTime = ctxStart
    this.#playStartPositionSec = startPos
    this.#playEndPositionSec = endPos
    this.#playPreRollSec = preroll

    // Pre-schedule count-in clicks. They live in `ctx` time too, so
    // they're sample-aligned with the song's first sample.
    if (wantsCountIn) {
      const calOffset = this.clickOffsetSec
      for (const c of plan!.clickPoints) {
        if (!c.isCountIn) continue
        // c.timeSec is in [−prependSec, 0). The Nth count-in click
        // lands `prependSec + c.timeSec` seconds before song start,
        // i.e. `ctxStart + c.timeSec` (negative shift behind ctxStart).
        const fireAt = ctxStart + c.timeSec + calOffset
        if (fireAt < ctx.currentTime + CLICK_SCHEDULE_LEAD_SEC) continue
        playMetronomeClick(ctx, this.#clickMaster!, fireAt, c.downbeat)
      }
    }

    // Auto-stop when the buffer reaches `endPos`. setTimeout drives
    // the state flip; the source itself will stop at the scheduled
    // `src.stop()` time.
    if (this.#autoStopTimeoutId !== null) clearTimeout(this.#autoStopTimeoutId)
    this.#autoStopTimeoutId = setTimeout(
      () => {
        this.#autoStopTimeoutId = null
        if (!this.isPlaying) return
        this.#stopSourceOnly()
        this.isPlaying = false
        this.currentTime = this.rangeStart
        this.#stopTransport()
      },
      Math.max(0, (preroll + (endPos - startPos)) * 1000 + 30),
    )

    this.isPlaying = true
    this.#startTransport()
  }

  pause(): void {
    if (!this.isPlaying) {
      this.#cancelAutoStop()
      return
    }
    const pos = this.#computeCurrentPosition()
    this.#stopSourceOnly()
    this.#cancelAutoStop()
    this.currentTime = pos
    this.isPlaying = false
    this.#stopTransport()
  }

  /** Pause and seek to `rangeStart`. */
  stop(): void {
    this.#stopSourceOnly()
    this.#cancelAutoStop()
    this.isPlaying = false
    this.currentTime = this.rangeStart
    this.#stopTransport()
  }

  /** Seek to a buffer position (seconds into the decoded buffer). */
  seek(sec: number): void {
    const dur = this.audioBuffer?.duration ?? 0
    const t = Math.max(0, dur > 0 ? Math.min(sec, dur) : sec)
    const wasPlaying = this.isPlaying
    if (wasPlaying) {
      this.#stopSourceOnly()
      this.#cancelAutoStop()
      this.isPlaying = false
      this.#stopTransport()
    }
    this.currentTime = t
    if (wasPlaying) {
      // Resume from the new position. play() reads currentTime as the start.
      this.play()
    }
  }

  destroy(): void {
    this.#cancelAutoStop()
    this.#stopClickLoop()
    this.#stopTransport()
    this.#stopSourceOnly()
    if (this.#ctx) void this.#ctx.close().catch(() => {})
    this.#ctx = null
    this.#clickMaster = null
    this.#songGain = null
    this.#effectCleanup?.()
    this.#effectCleanup = null
    this.audioEl = null
    this.audioBuffer = null
  }

  // ── Internals: graph + transport + click loop ──────────────────────

  #ensureGraph(): void {
    if (this.#ctx && this.#clickMaster && this.#songGain) return
    const ctx = this.#ctx ?? new AudioContext()
    if (!this.#clickMaster) {
      const click = ctx.createGain()
      click.gain.value = Math.max(0, this.clickVolume)
      click.connect(ctx.destination)
      this.#clickMaster = click
    }
    if (!this.#songGain) {
      const song = ctx.createGain()
      song.gain.value = Math.max(0, Math.min(1, this.songVolume))
      song.connect(ctx.destination)
      this.#songGain = song
    }
    this.#ctx = ctx
  }

  #stopSourceOnly(): void {
    if (!this.#activeSource) return
    try {
      this.#activeSource.stop()
    } catch {
      // Already stopped; ignore.
    }
    try {
      this.#activeSource.disconnect()
    } catch {
      // Already disconnected; ignore.
    }
    this.#activeSource = null
  }

  #cancelAutoStop(): void {
    if (this.#autoStopTimeoutId !== null) {
      clearTimeout(this.#autoStopTimeoutId)
      this.#autoStopTimeoutId = null
    }
  }

  /**
   * Buffer position right now, derived purely from the ctx clock.
   * `playStartPositionSec` was the buffer offset at `playStartCtxTime`,
   * and the buffer advances 1:1 with `ctx.currentTime` after `ctxStart`.
   * Before `ctxStart` (during count-in pre-roll), position stays at
   * `playStartPositionSec` so the playhead doesn't jump backward.
   */
  #computeCurrentPosition(): number {
    if (!this.#ctx) return this.currentTime
    const elapsed = this.#ctx.currentTime - this.#playStartCtxTime
    if (elapsed <= 0) return this.#playStartPositionSec
    const pos = this.#playStartPositionSec + elapsed
    return Math.min(pos, this.#playEndPositionSec)
  }

  #startTransport(): void {
    if (this.#transportRaf) return
    this.#transportRaf = requestAnimationFrame(this.#tickTransport)
  }

  #stopTransport(): void {
    if (this.#transportRaf) cancelAnimationFrame(this.#transportRaf)
    this.#transportRaf = 0
  }

  #tickTransport = (): void => {
    if (!this.isPlaying || !this.#ctx) {
      this.#stopTransport()
      return
    }
    const pos = this.#computeCurrentPosition()
    this.currentTime = pos
    // Belt-and-suspenders auto-stop in case the setTimeout fires late.
    if (this.rangeEnd > this.rangeStart && pos >= this.rangeEnd - END_EPS) {
      this.#stopSourceOnly()
      this.#cancelAutoStop()
      this.isPlaying = false
      this.currentTime = this.rangeStart
      this.#stopTransport()
      return
    }
    this.#transportRaf = requestAnimationFrame(this.#tickTransport)
  }

  #startClickLoop(): void {
    if (this.#clickRaf) return
    this.#ensureGraph()
    void this.#ctx?.resume()
    const plan = this.plan
    if (!plan) return
    // Sync next index to the first positive-time click ≥ current plan-time.
    const planTime = this.#computeCurrentPosition() - this.mediaTimeOffsetSec
    let i = plan.clickPoints.findIndex((c) => !c.isCountIn || c.timeSec >= -1e-9)
    if (i < 0) i = plan.clickPoints.length
    while (i < plan.clickPoints.length && plan.clickPoints[i]!.timeSec < planTime - CLICK_PAST_GRACE_SEC) i++
    this.#nextClickIdx = i
    this.#clickRaf = requestAnimationFrame(this.#runClickLoop)
  }

  #stopClickLoop(): void {
    if (this.#clickRaf) cancelAnimationFrame(this.#clickRaf)
    this.#clickRaf = 0
  }

  #runClickLoop = (): void => {
    const ctx = this.#ctx
    const master = this.#clickMaster
    if (!ctx || !master || !this.playWithClick || !this.isPlaying) {
      this.#stopClickLoop()
      return
    }
    const plan = this.plan
    if (!plan) {
      this.#stopClickLoop()
      return
    }

    // Position derives from the shared ctx clock — same source the
    // song source is locked to. They CANNOT disagree.
    const position = this.#computeCurrentPosition()
    const planTime = position - this.mediaTimeOffsetSec
    const ctxNow = ctx.currentTime

    // Drop clicks too far in the past.
    while (
      this.#nextClickIdx < plan.clickPoints.length &&
      plan.clickPoints[this.#nextClickIdx]!.timeSec < planTime - CLICK_PAST_GRACE_SEC
    ) {
      this.#nextClickIdx++
    }

    while (
      this.#nextClickIdx < plan.clickPoints.length &&
      plan.clickPoints[this.#nextClickIdx]!.timeSec <= planTime + CLICK_LOOKAHEAD_SEC
    ) {
      const c = plan.clickPoints[this.#nextClickIdx]!
      // Skip count-in clicks — those were pre-scheduled in `play()`.
      if (c.timeSec >= -1e-9) {
        const delta = c.timeSec - planTime
        const offset = this.clickOffsetSec
        const scheduleAt = ctxNow + Math.max(CLICK_SCHEDULE_LEAD_SEC, delta + offset)
        playMetronomeClick(ctx, master, scheduleAt, c.downbeat)
        if (this.debugClickTiming && this.#debugLogBudget > 0) {
          this.#debugLogBudget--
          console.log('[click]', {
            beat: this.#nextClickIdx,
            downbeat: c.downbeat,
            position: position.toFixed(4),
            planTime: planTime.toFixed(4),
            ctxNow: ctxNow.toFixed(4),
            delta: delta.toFixed(4),
            offsetApplied: offset.toFixed(4),
            scheduleAt: scheduleAt.toFixed(4),
          })
        }
      }
      this.#nextClickIdx++
    }

    if (this.#nextClickIdx >= plan.clickPoints.length) {
      this.#stopClickLoop()
      return
    }
    this.#clickRaf = requestAnimationFrame(this.#runClickLoop)
  }
}
