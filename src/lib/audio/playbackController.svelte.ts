/**
 * Single runtime owner of ONE playback surface.
 *
 * The grid-mode editor instantiates one of these. The cue-mode mix
 * preview (when wired in Step 8) instantiates another. Each owns one
 * `<audio>` element, one `AudioContext` for click playback, one rAF
 * transport loop, one rAF click loop, one Web Audio gain chain. No
 * bridges between instances.
 *
 * Architecture principle (set by the user):
 * `.smap` is the root of truth. The controller is a thin LENS:
 *   - `songMap` is the input state.
 *   - `plan` is `$derived(songPlaybackPlan(songMap))` — pure derivation,
 *     no `$effect`. Every consumer of count-in length, click positions,
 *     spoken intro text, etc. reads through `plan`.
 *   - The only `$effect`s on this class sync reactive state into
 *     non-reactive sinks (the AudioContext gain nodes, the HTMLAudioElement
 *     volume, and rAF loop lifecycle). Everything else is `$derived`.
 *
 * Count-in handling (the bug the user kept hitting):
 *   - The OLD path was pause-and-resume — `audioEl.pause()`,
 *     setTimeout, `audioEl.play()` — which was racy and silently
 *     failed in some browser states.
 *   - The NEW path schedules count-in clicks via Web Audio at `play()`
 *     time and `setTimeout`-delays `audioEl.play()` by `prependSec`.
 *     `setTimeout` preserves the user activation chain for the short
 *     2–4 second count-in window, so deferred `play()` is reliable.
 *     **No pause is ever called between user click and audio start.**
 *
 * Lifetime:
 *   - Create with `new PlaybackController()` in the host component.
 *   - Call `setAudioElement(el)` once the `<audio>` mounts.
 *   - Call `setSongMap(sm)` from your songMap subscription.
 *   - Call `destroy()` on component unmount.
 */
import { playMetronomeClick } from '$lib/audio/debugClickTrack'
import { songPlaybackPlan, type PlaybackPlan } from '$lib/songmap/playbackPlan'
import type { SongMap } from '$lib/songmap/types'

const END_EPS = 0.028
/** rAF lookahead for click scheduling — same as the legacy loops. */
const CLICK_LOOKAHEAD_SEC = 0.025
/** Web Audio scheduling lead-time so clicks aren't audibly late. */
const CLICK_SCHEDULE_LEAD_SEC = 0.002
/**
 * Grace window for "click happened just now" — anything more than this in
 * the past was missed (audio jumped, app stuttered, etc.) and is silently
 * dropped rather than firing late. Matches the legacy loop's 18 ms.
 */
const CLICK_PAST_GRACE_SEC = 0.018

export class PlaybackController {
  // ── Inputs ─────────────────────────────────────────────────────────
  songMap = $state<SongMap | null>(null)
  audioEl = $state<HTMLAudioElement | null>(null)

  /** Playback selection (auto-stop when currentTime >= rangeEnd).
   *  Both are in **audio-element-time** (whatever the `<audio>` reports). */
  rangeStart = $state(0)
  rangeEnd = $state(0)

  /**
   * Per-surface time-base offset that translates
   *
   *   `planTime = audioEl.currentTime − mediaTimeOffsetSec`
   *
   * The plan's `clickPoints[].timeSec` is **trim-shifted song-time**
   * (0 = `audio.trim.startSec`). Each playback surface picks the offset
   * that puts its audio element's `currentTime` on the same number line:
   *
   *   - Grid editor: audio src = full uploaded file → `currentTime` is
   *     original-time → offset = `plan.trimStartSec`.
   *   - Cue mix preview: audio src = synthesized mix WAV → `currentTime`
   *     starts at 0 = start of WAV → offset = `plan.titlePreludeSec +
   *     plan.prependSec`.
   *
   * Hosts set this once (or as a `$derived` from their plan). Leaving it
   * at 0 means "audio element already plays plan-time" (rare).
   */
  mediaTimeOffsetSec = $state(0)

  // ── UI knobs (bind targets from host components) ───────────────────
  playWithClick = $state(false)
  clickVolume = $state(1.5)
  songVolume = $state(1)

  /**
   * Per-system fine-tune. Positive = clicks fire LATER (in seconds);
   * negative = clicks fire EARLIER. Compensates for any residual
   * latency mismatch between the audio element's playback pipeline and
   * Web Audio's scheduling pipeline that the `MediaElementAudioSourceNode`
   * routing didn't fully eliminate (different speakers / Bluetooth /
   * USB interfaces / etc.). Default 0 — change with the calibration
   * slider in the Vol popover until clicks lock to the beat.
   */
  clickOffsetSec = $state(0)
  /**
   * Set true to log every scheduled click's `(planTime, ctxNow, scheduleAt,
   * delta, offsetApplied)` to the console for the first N firings after
   * each play. Used to verify sync numerically without ear-balling.
   */
  debugClickTiming = $state(false)
  /** How many remaining debug log lines to print before going quiet. */
  #debugLogBudget = 0

  // ── Audio-element mirrors (updated in the transport rAF) ───────────
  isPlaying = $state(false)
  currentTime = $state(0)
  mediaReady = $state(false)

  // ── The central reactive bus — single source of truth at runtime ──
  plan = $derived<PlaybackPlan | null>(
    this.songMap ? songPlaybackPlan(this.songMap) : null,
  )

  /** `songVolume` clamped into the `<audio>.volume` legal range. */
  clampedSongVolume = $derived(Math.max(0, Math.min(1, this.songVolume)))
  /** `clickVolume` clamped at zero (no audible cap; user-set gain). */
  clampedClickVolume = $derived(Math.max(0, this.clickVolume))

  // ── Private internals ──────────────────────────────────────────────
  #clickCtx: AudioContext | null = null
  #clickMaster: GainNode | null = null
  /**
   * Routes `audioEl` THROUGH `#clickCtx` so both song and clicks share
   * one Web Audio clock + one output latency. Without this the song
   * plays via the native `<audio>` pipeline (one latency) and the
   * clicks fire via Web Audio (a different latency); the mismatch is
   * exactly the audible drift the mixer doesn't have (because there
   * everything's already in Web Audio). Created lazily the first time
   * the click graph spins up.
   */
  #songSourceNode: MediaElementAudioSourceNode | null = null
  #songGain: GainNode | null = null
  #transportRaf = 0
  #clickRaf = 0
  /** Index into `plan.clickPoints` for the next click to schedule. */
  #nextClickIdx = 0
  /**
   * setTimeout id for the count-in's deferred `audio.play()`. Tracked so
   * `pause()` / `stop()` can cancel it before audio actually starts;
   * without this, the deferred play resolves anyway and audio starts
   * after the user has clearly told us to stop.
   */
  #pendingPlayTimeoutId: ReturnType<typeof setTimeout> | null = null
  /** Cleanup for the $effect.root that owns the controller's effects. */
  #effectCleanup: (() => void) | null = null

  constructor() {
    // Own all reactive effects under one $effect.root. Returned
    // function tears them down in `destroy()`.
    this.#effectCleanup = $effect.root(() => {
      // 1. Sync click master gain from `clickVolume`.
      $effect(() => {
        const v = this.clampedClickVolume
        if (this.#clickMaster) {
          this.#clickMaster.gain.value = v
        }
      })

      // 2. Sync song volume to BOTH the audio element (native pipeline
      //    fallback before the graph wires up) AND the Web Audio gain
      //    that sits after `MediaElementAudioSourceNode`. Both stay in
      //    sync — whichever pipeline is actually outputting reads the
      //    same value.
      $effect(() => {
        const v = this.clampedSongVolume
        if (this.audioEl) this.audioEl.volume = v
        if (this.#songGain) this.#songGain.gain.value = v
      })

      // 3. Attach play/pause/canplay listeners to the bound audio
      //    element. The lifecycle of these listeners is tied to the
      //    element identity — when `audioEl` changes, old listeners
      //    are torn down and new ones attached. No bridges.
      $effect(() => {
        const el = this.audioEl
        if (!el) return
        const onPlay = () => {
          this.isPlaying = true
          this.#startTransport()
          // Belt-and-suspenders: the click-loop $effect below ALSO
          // restarts the loop when `isPlaying` flips true, but if for
          // any reason that effect doesn't fire (race with reactive
          // graph ordering, or the loop bailed on a first frame where
          // `el.paused` was still racing the play event), this direct
          // call is the load-bearing path that gets clicks back on
          // the beat. `#startClickLoop` is idempotent — early returns
          // if the rAF is already running.
          if (
            this.playWithClick &&
            this.plan &&
            this.plan.clickPoints.length > 0
          ) {
            this.#startClickLoop()
          }
        }
        const onPause = () => {
          this.isPlaying = false
          this.#stopClickLoop()
        }
        const onCanPlay = () => {
          this.mediaReady = true
        }
        const onLoadedMeta = () => {
          this.mediaReady = true
        }
        el.addEventListener('play', onPlay)
        el.addEventListener('pause', onPause)
        el.addEventListener('ended', onPause)
        el.addEventListener('canplay', onCanPlay)
        el.addEventListener('loadedmetadata', onLoadedMeta)
        // Pick up the current state immediately in case the element
        // was already playing / ready when bound.
        if (el.readyState >= 1) this.mediaReady = true
        this.isPlaying = !el.paused
        return () => {
          el.removeEventListener('play', onPlay)
          el.removeEventListener('pause', onPause)
          el.removeEventListener('ended', onPause)
          el.removeEventListener('canplay', onCanPlay)
          el.removeEventListener('loadedmetadata', onLoadedMeta)
        }
      })

      // 4. Start / stop the click rAF loop in response to:
      //      isPlaying  × playWithClick  × plan.clickPoints.length
      //    Pure derivation-driven — no manual restart calls.
      $effect(() => {
        const should =
          this.isPlaying &&
          this.playWithClick &&
          (this.plan?.clickPoints.length ?? 0) > 0
        if (should) this.#startClickLoop()
        else this.#stopClickLoop()
      })
    })
  }

  // ── Public methods ─────────────────────────────────────────────────

  /**
   * The host component calls this once on mount with the underlying
   * `<audio>` element. Passing `null` detaches (used during teardown).
   */
  setAudioElement(el: HTMLAudioElement | null): void {
    this.audioEl = el
  }

  /**
   * Drive the controller's reactive plan with the current songMap.
   * Hosts call this from their songMap subscription (or pass a
   * derived value via getter, depending on integration style).
   */
  setSongMap(sm: SongMap | null): void {
    this.songMap = sm
  }

  /**
   * User-initiated play. Schedules count-in clicks via Web Audio (if
   * any), then starts the audio element. When the count-in needs
   * `prependSec` of pre-roll silence, the audio start is delayed by
   * exactly that — no pause-and-resume race.
   */
  play(): void {
    const el = this.audioEl
    if (!el || this.isPlaying) return
    // Each play() refreshes the debug log budget so we can compare
    // sync across multiple takes without remembering to toggle.
    if (this.debugClickTiming) this.#debugLogBudget = 16

    const plan = this.plan
    const preroll = plan?.prependSec ?? 0
    // "Are we at the song start?" check — count-in is a lead-IN, not a
    // mid-song interruption. When the user has scrubbed past bar 1 and
    // hits Play, no pre-roll: just play. The threshold uses
    // audio-element time (offset-translated from `firstDownbeatOriginalSec`)
    // so it works for every surface regardless of trim.
    const songStartAudioElTime = plan
      ? plan.firstDownbeatOriginalSec - this.mediaTimeOffsetSec
      : Number.POSITIVE_INFINITY
    const atSongStart = el.currentTime <= songStartAudioElTime + 0.05
    const wantsCountIn =
      this.playWithClick &&
      plan !== null &&
      plan.countInBeats > 0 &&
      preroll > 1e-6 &&
      atSongStart

    if (!wantsCountIn) {
      // Ensure the shared Web Audio graph (click + song routing) is up
      // BEFORE the first sample of audio plays, so the audio element's
      // output goes through the same context as clicks. Otherwise the
      // first play emits via the native `<audio>` pipeline, and
      // creating the MediaElementAudioSourceNode mid-playback is racey
      // in some browsers.
      this.#ensureClickGraph()
      void this.#clickCtx?.resume()

      el.play().catch((err) => {
        if (import.meta.env.DEV) {
          console.error('[PlaybackController] audioEl.play() rejected:', err)
        }
      })
      if (this.playWithClick && plan && plan.clickPoints.length > 0) {
        this.#startClickLoop()
      }
      return
    }

    // Count-in path. Schedule the negative-time count-in clicks via
    // Web Audio so they ring during the `prependSec` silence window,
    // then defer audio.play() by `prependSec` real seconds.
    this.#ensureClickGraph()
    const ctx = this.#clickCtx!
    const master = this.#clickMaster!
    void ctx.resume()

    const baseCtxTime = ctx.currentTime
    const calOffset = this.clickOffsetSec
    for (const c of plan.clickPoints) {
      if (!c.isCountIn) continue
      // c.timeSec is in [-prependSec, 0). Shift by +prependSec so the
      // first count-in click rings ~now and the last lands one beat
      // before audio starts. `clickOffsetSec` calibration is applied
      // so count-in stays in lockstep with the song clicks.
      const offset = preroll + c.timeSec + calOffset
      if (offset < -1e-9) continue
      playMetronomeClick(
        ctx,
        master,
        baseCtxTime + Math.max(0, offset) + CLICK_SCHEDULE_LEAD_SEC,
        c.downbeat,
      )
    }

    // Don't move the playhead — count-in is a pre-roll BEFORE audio
    // resumes from wherever it currently is. The host decides where the
    // playhead sits (typically rangeStart / songStart). Reset would be
    // wrong for grid-mode where currentTime=0 means "head of full file",
    // not "head of song" (trimStart != 0).

    this.#pendingPlayTimeoutId = setTimeout(() => {
      this.#pendingPlayTimeoutId = null
      // Re-check guards in case state changed during the delay.
      if (!this.audioEl || this.isPlaying || !this.playWithClick) return
      this.audioEl.play().catch((err) => {
        if (import.meta.env.DEV) {
          console.error('[PlaybackController] deferred audioEl.play() rejected:', err)
        }
      })
    }, preroll * 1000)
  }

  /** Cancel a queued count-in pre-roll deferred play, if any. */
  #cancelPendingPlay(): void {
    if (this.#pendingPlayTimeoutId !== null) {
      clearTimeout(this.#pendingPlayTimeoutId)
      this.#pendingPlayTimeoutId = null
    }
  }

  pause(): void {
    this.#cancelPendingPlay()
    this.audioEl?.pause()
  }

  /** Pause and seek to `rangeStart`. */
  stop(): void {
    this.#cancelPendingPlay()
    const el = this.audioEl
    if (!el) return
    el.pause()
    el.currentTime = this.rangeStart
    this.currentTime = this.rangeStart
  }

  seek(sec: number): void {
    const el = this.audioEl
    if (!el) return
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
    const t = Math.max(0, dur > 0 ? Math.min(sec, dur) : sec)
    el.currentTime = t
    this.currentTime = t
  }

  /**
   * Tear down all internal state. Must be called by the host on
   * component unmount (or on swap to another controller instance).
   */
  destroy(): void {
    this.#cancelPendingPlay()
    this.#stopClickLoop()
    this.#stopTransport()
    try {
      this.#songSourceNode?.disconnect()
      this.#songGain?.disconnect()
    } catch {
      // Disconnect throws if the node was already disconnected — fine.
    }
    this.#songSourceNode = null
    this.#songGain = null
    if (this.#clickCtx) {
      void this.#clickCtx.close().catch(() => {})
    }
    this.#clickCtx = null
    this.#clickMaster = null
    this.#effectCleanup?.()
    this.#effectCleanup = null
    this.audioEl = null
  }

  // ── Internals: click graph + loops ─────────────────────────────────

  #ensureClickGraph(): void {
    if (this.#clickCtx && this.#clickMaster) return
    const ctx = new AudioContext()
    const click = ctx.createGain()
    click.gain.value = Math.max(0, this.clickVolume)
    click.connect(ctx.destination)
    this.#clickCtx = ctx
    this.#clickMaster = click
    // Route the audio element through this same context so song and
    // clicks share one Web Audio pipeline. After the source node is
    // connected, native `<audio>` output is gone — playback comes out
    // of `ctx.destination`. `audioEl.volume` still scales the source
    // (it's applied BEFORE the MediaElementAudioSourceNode), and the
    // dedicated `#songGain` lets us match the click gain semantics.
    this.#ensureSongInGraph()
  }

  #ensureSongInGraph(): void {
    if (!this.#clickCtx || !this.audioEl) return
    if (this.#songSourceNode) return
    try {
      const src = this.#clickCtx.createMediaElementSource(this.audioEl)
      const songGain = this.#clickCtx.createGain()
      songGain.gain.value = Math.max(0, Math.min(1, this.songVolume))
      src.connect(songGain)
      songGain.connect(this.#clickCtx.destination)
      this.#songSourceNode = src
      this.#songGain = songGain
    } catch (err) {
      // `createMediaElementSource` throws if called twice on the same
      // element. We protect against that with the guard above, but
      // log so a regression doesn't go silent.
      if (import.meta.env.DEV) {
        console.error('[PlaybackController] could not route audio through Web Audio:', err)
      }
    }
  }

  #startTransport(): void {
    if (this.#transportRaf) return
    this.#transportRaf = requestAnimationFrame(() => this.#tickTransport())
  }

  #stopTransport(): void {
    if (this.#transportRaf) cancelAnimationFrame(this.#transportRaf)
    this.#transportRaf = 0
  }

  #tickTransport = (): void => {
    const el = this.audioEl
    if (!el) {
      this.#stopTransport()
      return
    }
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
    let t = el.currentTime
    if (dur > 0) t = Math.max(0, Math.min(t, dur))
    this.currentTime = t

    // Auto-stop at rangeEnd (replaces audioTransport's same behaviour).
    if (this.rangeEnd > this.rangeStart && t >= this.rangeEnd - END_EPS) {
      el.pause()
      el.currentTime = this.rangeStart
      this.currentTime = this.rangeStart
      this.isPlaying = false
      this.#stopTransport()
      return
    }

    if (el.paused) {
      this.#stopTransport()
      return
    }
    this.#transportRaf = requestAnimationFrame(this.#tickTransport)
  }

  #startClickLoop(): void {
    if (this.#clickRaf) return
    this.#ensureClickGraph()
    void this.#clickCtx?.resume()

    // Sync nextClickIdx to the first positive-time click ≥ current
    // plan-time. Negative-time count-in clicks (when `prependSec > 0`)
    // were pre-scheduled in `play()` and are skipped here.
    const plan = this.plan
    if (!plan || !this.audioEl) return
    const planTime = this.audioEl.currentTime - this.mediaTimeOffsetSec
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
    const el = this.audioEl
    const ctx = this.#clickCtx
    const master = this.#clickMaster
    if (!el || !ctx || !master || !this.playWithClick || el.paused) {
      this.#stopClickLoop()
      return
    }
    const plan = this.plan
    if (!plan) {
      this.#stopClickLoop()
      return
    }

    // Translate audio-element time into plan-time using the host-supplied
    // offset. Plan-time is what `clickPoints[].timeSec` is expressed in;
    // audio-element time is whatever the `<audio>` reports (depends on the
    // source the host wired in — see `mediaTimeOffsetSec` docs).
    const planTime = el.currentTime - this.mediaTimeOffsetSec
    const ctxNow = ctx.currentTime

    // Drop clicks that are too far in the past (audio seek, app stutter,
    // or a wrong `mediaTimeOffsetSec` would otherwise dump every missed
    // click into "now"). The grace window keeps near-miss clicks firing.
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
      // Skip negative-time count-in clicks — those were scheduled in `play()`
      // and would double-fire here.
      if (c.timeSec >= -1e-9) {
        // Schedule at the *future* time the click should land, not at
        // "now". The lookahead window means most clicks have `delta > 0`;
        // scheduling them all at `ctxNow + LEAD` would fire them up to
        // `CLICK_LOOKAHEAD_SEC` early (audible drift).
        const delta = c.timeSec - planTime
        const offset = this.clickOffsetSec
        const scheduleAt = ctxNow + Math.max(CLICK_SCHEDULE_LEAD_SEC, delta + offset)
        playMetronomeClick(ctx, master, scheduleAt, c.downbeat)
        if (this.debugClickTiming && this.#debugLogBudget > 0) {
          this.#debugLogBudget--
          // Numbers are in seconds; we log to 4 decimals (= 100 µs) which
          // is finer than human perception (~10 ms). What to look at:
          //   delta       = how far in the future this click should fire,
          //                 derived purely from the plan + audio.currentTime.
          //                 If consecutive deltas drift down toward 0 over
          //                 time the audio + Web Audio clocks are drifting.
          //   scheduleAt  = absolute ctx.currentTime at which the click
          //                 oscillator starts ramping in.
          //   audioElTime = the audio element's reported currentTime.
          //                 Compare against ctxNow to see if the two
          //                 pipelines stay locked through a track.
          console.log('[click]', {
            beat: this.#nextClickIdx,
            downbeat: c.downbeat,
            planTime: planTime.toFixed(4),
            ctxNow: ctxNow.toFixed(4),
            delta: delta.toFixed(4),
            offsetApplied: offset.toFixed(4),
            scheduleAt: scheduleAt.toFixed(4),
            audioElTime: el.currentTime.toFixed(4),
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
