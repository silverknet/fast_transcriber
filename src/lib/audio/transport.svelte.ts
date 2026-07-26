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
 * Internals CURRENTLY back onto `PlaybackController` (single decoded buffer +
 * the invariant-protected click/count-in scheduler). A later step swaps the
 * audio graph to `MixerEngine` (the no-stems song is the degenerate 1-track
 * case) reusing that SAME click scheduler on the mixer's context — without
 * changing this facade, so consumers wired against it don't move.
 *
 * Runtime-only: nothing here is ever written into the `.smap`, so autosave and
 * the cloud dirty-check are untouched.
 */
import { PlaybackController } from './playbackController.svelte'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import type { SongMap } from '$lib/songmap/types'

class UnifiedTransport {
  /**
   * The current audio graph + click/count-in scheduler. Exposed so that
   * `WaveformPlayer` — which already accepts an injected `controller` — can bind
   * to it during the migration. Treat as an implementation detail elsewhere;
   * prefer the song-time methods below.
   */
  readonly controller = new PlaybackController()

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

  /** Song-time offset of the decoded buffer's t=0 (= `plan.trimStartSec`). */
  #mediaOffsetSec = 0
  /** A dedicated decode context, reused across songs; separate from playback. */
  #decodeCtx: AudioContext | null = null
  /** The file whose decode is current, to skip redundant re-decodes. */
  #decodedFile: File | null = null

  // ── Transport observables (song-time) ──────────────────────────────
  get isPlaying(): boolean {
    return this.controller.isPlaying
  }
  /** Playhead in song-time seconds (song-start = 0). */
  get songTimeSec(): number {
    return this.controller.currentTime - this.#mediaOffsetSec
  }
  get ready(): boolean {
    return this.controller.mediaReady
  }
  /** Total song-time duration (0 until a buffer is loaded). */
  get durationSec(): number {
    const d = this.audioBuffer?.duration ?? 0
    return d > 0 ? d - this.#mediaOffsetSec : 0
  }

  // ── UI knobs (proxied to the controller's bind targets) ────────────
  get playWithClick(): boolean {
    return this.controller.playWithClick
  }
  set playWithClick(v: boolean) {
    this.controller.playWithClick = v
  }
  get clickVolume(): number {
    return this.controller.clickVolume
  }
  set clickVolume(v: number) {
    this.controller.clickVolume = v
  }
  get songVolume(): number {
    return this.controller.songVolume
  }
  set songVolume(v: number) {
    this.controller.songVolume = v
  }
  get clickOffsetSec(): number {
    return this.controller.clickOffsetSec
  }
  set clickOffsetSec(v: number) {
    this.controller.clickOffsetSec = v
  }

  // ── Configuration ──────────────────────────────────────────────────
  /**
   * Point the transport at a song. Sets the click/timing plan source and the
   * one canonical media-time offset (`plan.trimStartSec`), so every consumer's
   * song-time conversion agrees. Cheap + idempotent — safe to call reactively.
   */
  configure(sm: SongMap | null): void {
    this.controller.setSongMap(sm)
    const plan = sm ? songPlaybackPlan(sm) : null
    this.#mediaOffsetSec = plan?.trimStartSec ?? 0
  }

  /**
   * Decode `file` once and hand the buffer to the engine. No-op if the same
   * file is already decoded. Loading a null file clears the buffer.
   */
  async loadFile(file: File | null): Promise<void> {
    if (file === this.#decodedFile) return
    this.#decodedFile = file
    this.decodeError = null
    if (!file) {
      this.audioBuffer = null
      this.controller.setAudioBuffer(null)
      return
    }
    this.decoding = true
    try {
      if (!this.#decodeCtx) this.#decodeCtx = new AudioContext()
      const ctx = this.#decodeCtx
      const bytes = await file.arrayBuffer()
      const buf = await ctx.decodeAudioData(bytes)
      // A newer file may have superseded us while decoding.
      if (this.#decodedFile !== file) return
      this.audioBuffer = buf
      this.controller.setAudioBuffer(buf)
    } catch (e) {
      if (this.#decodedFile === file) {
        this.decodeError = e instanceof Error ? e.message : 'Could not decode audio.'
        this.audioBuffer = null
        this.controller.setAudioBuffer(null)
      }
    } finally {
      if (this.#decodedFile === file) this.decoding = false
    }
  }

  // ── Song-time selection / playback range ───────────────────────────
  /** Set the loop/selection range in SONG-TIME (empty range = whole song). */
  setRangeSongTime(startSec: number, endSec: number): void {
    this.controller.rangeStart = startSec + this.#mediaOffsetSec
    this.controller.rangeEnd = endSec > startSec ? endSec + this.#mediaOffsetSec : 0
  }

  // ── Transport (song-time) ──────────────────────────────────────────
  play(): void {
    this.controller.play()
  }
  pause(): void {
    this.controller.pause()
  }
  stop(): void {
    this.controller.stop()
  }
  togglePlay(): void {
    if (this.controller.isPlaying) this.controller.pause()
    else this.controller.play()
  }
  /** Seek to a SONG-TIME position. */
  seek(songTimeSec: number): void {
    this.controller.seek(songTimeSec + this.#mediaOffsetSec)
  }

  /** Buffer-time ↔ song-time helpers for surfaces that need the raw offset. */
  get mediaOffsetSec(): number {
    return this.#mediaOffsetSec
  }

  dispose(): void {
    this.controller.destroy()
    if (this.#decodeCtx) void this.#decodeCtx.close().catch(() => {})
    this.#decodeCtx = null
    this.#decodedFile = null
    this.audioBuffer = null
  }
}

/** The one transport for the app. */
export const transport = new UnifiedTransport()
