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
import { resolveStemAudibility } from './stemMix'
import { buildKickPunchChain } from './mastering'
import { stemNameForKey } from './liveStemDefaults'
import { clampTempoHold, varispeedPlan } from './varispeed'
import { createLivePitchShifter, type LivePitchShifter } from './livePitchShift'

/** Auto-stop epsilon at clip / range ends. Mirrors the controller. */
const END_EPS = 0.028

/** The full-mix song track key (the degenerate all-stems-on case plays this). */
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

  // ── Stems (edit-song stems dock; `original` is the all-stems-on case) ──
  /** Registered stem tracks (metadata; the buffers live in the engine). */
  #stems = $state<{ key: string; label: string }[]>([])
  /** Per-stem on/off — a stem is audible unless explicitly set to false. */
  #stemEnabled = $state<Record<string, boolean>>({})
  /**
   * Kick punch on the DRUMS stem, 0…1 (0 = off). A monitor-only insert for the
   * editor: the mixer builds the same stage as part of the full per-stem
   * mastering chain, but this transport plays stems raw, so without this the
   * effect is inaudible in /edit.
   */
  #kickPunch = $state(0)

  /**
   * NAIVE transpose (varispeed): semitone offset applied as a playback-rate
   * change, so pitch and tempo move together like a tape machine.
   *
   * The audio buffer is NEVER touched — the engine plays the original decoded
   * buffer and only sets `playbackRate`. Setting this back to 0 restores a rate
   * of exactly 1, so `transpose(-n)` after `transpose(+n)` is bit-identical
   * playback, not an approximation. See `varispeed.ts`.
   *
   * The `.smap` is not rescaled either: the playhead keeps being reported in
   * ORIGINAL audio time, so bars, beats, sections and chords stay in sync with
   * no changes on their side.
   */
  #transposeSemitones = $state(0)

  /**
   * How much of the transpose's tempo change to cancel, 0…1 (0 = pure
   * varispeed, 1 = keep the original tempo). Costs a live stretch worklet on
   * the master bus, and artifacts scale with it — see `varispeedPlan`.
   */
  #tempoHold = $state(0)
  /** The live shifter, created on first use and kept for the context's life. */
  #shifter: LivePitchShifter | null = null
  #shifterPending: Promise<LivePitchShifter | null> | null = null
  /**
   * Delays the metronome to match the shifter's processing latency. The clicks
   * are oscillators straight to `destination`, so they bypass the master bus —
   * without this they run AHEAD of the song by the worklet's latency.
   */
  #clickDelay: DelayNode | null = null

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
    this.#ensureEffects()
  }

  /**
   * (Re)create the reactive plumbing.
   *
   * The transport is a module-level SINGLETON, but its effects used to be born
   * in the constructor and killed in `dispose()` — permanently, because a
   * constructor runs once. After any dispose the object kept working just well
   * enough to look alive: `play()` still made sound, but the effects were gone,
   * so toggling the click mid-song did nothing and the volume slider was dead.
   * No error anywhere; just a musician in the Grid tab with no click.
   *
   * So effect creation is idempotent and re-run from every entry point
   * (`configure`, `loadFile`, `play`): whichever one is called first after a
   * dispose brings the plumbing back.
   */
  #ensureEffects(): void {
    if (this.#effectCleanup) return
    this.#effectCleanup = $effect.root(() => {
      // 1. Sync click master gain from `clickVolume` (no upper cap).
      $effect(() => {
        // Track BOTH deps before any early-return, so the effect re-fires
        // whichever one changes first.
        const v = Math.max(0, this.clickVolume)
        const playing = this.#playing
        // Only while playing: opening the gate during a pause would let the
        // count-in voices `#silenceClicks` just killed ring out.
        //
        // Through `#armClicks`, NEVER `gain.value = v`. The gate is driven by
        // `setValueAtTime` events, and a real AudioParam IGNORES plain value
        // writes while automation events exist — so after the first pause ever,
        // a raw write here does nothing and the slider goes dead. Caught by a
        // real-browser test; invisible to the mocked one.
        if (this.#clickMaster && playing) this.#armClicks(v)
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

  // ── Stems ──────────────────────────────────────────────────────────
  /** Reactive view for the stems dock: each stem + whether it's enabled. */
  get stems(): { key: string; label: string; enabled: boolean }[] {
    return this.#stems.map((s) => ({ ...s, enabled: this.#stemEnabled[s.key] !== false }))
  }
  get hasStems(): boolean {
    return this.#stems.length > 0
  }

  // ── Configuration ──────────────────────────────────────────────────
  /**
   * Point the transport at a song. Sets the click/timing plan source and (via
   * the derived plan) the one canonical media-time offset (`plan.trimStartSec`),
   * so every consumer's song-time conversion agrees. Cheap + idempotent — safe
   * to call reactively.
   */
  configure(sm: SongMap | null): void {
    this.#ensureEffects()
    this.#songMap = sm
  }

  // ── Stems: register the song's separated stems as extra engine tracks ──
  /**
   * Decode + register this song's stems. They start MUTED — the all-on default
   * plays the original full mix — and the dock toggles them live via
   * {@link setStemEnabled}. Replaces any previously-registered stems. Buffers
   * decode on the engine's own context so they schedule sample-aligned with the
   * song track (stems are untrimmed, so no prepend: stem t=0 = song t=0). If
   * called mid-playback, re-seeks in place so the new stem sources join in sync.
   */
  async setStems(entries: { key: string; label: string; blob: Blob }[]): Promise<void> {
    this.clearAudition()
    const engine = this.#ensureEngine()
    this.#clearStemTracks()
    const stems: { key: string; label: string }[] = []
    const enabled: Record<string, boolean> = {}
    for (const e of entries) {
      let buffer: AudioBuffer
      try {
        buffer = await engine.ac.decodeAudioData(await e.blob.arrayBuffer())
      } catch {
        continue // a single unreadable stem shouldn't sink the others
      }
      engine.setTrack({
        key: e.key,
        label: e.label,
        buffer,
        volume: Math.max(0, Math.min(1, this.songVolume)),
        muted: true, // all-on default → the original plays, stems silent
        soloed: false,
      })
      stems.push({ key: e.key, label: e.label })
      enabled[e.key] = true
    }
    this.#stems = stems
    this.#stemEnabled = enabled
    this.#applyStemMutes()
    this.#wireKickPunch() // a re-registered drums stem keeps the current setting
    if (this.#playing && stems.length > 0) this.seek(this.songTimeSec) // fold sources in
  }

  // ── Audition: hear ONE performer's mix, without touching anything saved ──
  /**
   * Per-track volumes as they were before the audition started, restored
   * exactly on `clearAudition`. A snapshot-and-restore overlay rather than a
   * second mix state: the transport's volumes are runtime-only (nothing here
   * persists to `mixState`), so the overlay cannot corrupt a saved mix — but
   * it MUST put back what it found, or a preview would quietly become the
   * evening's balance.
   */
  #auditionSaved: Map<string, number> | null = null
  /** Multiplies the click gain while an audition is on (1 = untouched). */
  #auditionClickFactor = 1

  /**
   * Apply a performer's monitor levels to the live graph — stems, original,
   * and the click (as a factor on the user's click volume). Idempotent while
   * active: slider moves re-apply on top of the SAME snapshot, so toggling the
   * audition off always restores the pre-audition state, not an intermediate.
   */
  auditionMix(levels: Record<string, number>, clickLevel = 1): void {
    const engine = this.#engine
    if (!engine) return
    if (!this.#auditionSaved) {
      this.#auditionSaved = new Map(engine.listTracks().map((t) => [t.key, t.volume]))
    }
    for (const [key, v] of Object.entries(levels)) {
      engine.setVolume(key, Math.max(0, Math.min(1, v)))
    }
    this.#auditionClickFactor = Math.max(0, Math.min(1, clickLevel))
    if (this.#playing) this.#armClicks()
  }

  /** End the audition and restore every volume exactly as it was. */
  clearAudition(): void {
    const engine = this.#engine
    if (engine && this.#auditionSaved) {
      for (const [key, v] of this.#auditionSaved) engine.setVolume(key, v)
    }
    this.#auditionSaved = null
    this.#auditionClickFactor = 1
    if (this.#playing) this.#armClicks()
  }

  get auditionActive(): boolean {
    return this.#auditionSaved !== null
  }

  /** Remove all stem tracks and reset toggle state (e.g. on song change). */
  clearStems(): void {
    this.#clearStemTracks()
    this.#stems = []
    this.#stemEnabled = {}
    this.#applyStemMutes()
  }

  /** Current naive-transpose offset in semitones (0 = off). */
  get transposeSemitones(): number {
    return this.#transposeSemitones
  }

  /** The playback rate that offset implies (1 = untransposed). */
  get transposeRate(): number {
    return varispeedPlan(this.#transposeSemitones, this.#tempoHold).rate
  }

  /**
   * The rate the ENGINE actually holds — which is what reaches the source
   * nodes. Distinct from {@link transposeRate}, which is only this facade's
   * intent; they disagreed once (engine created after the transpose was set)
   * and the result was a silently untransposed playback. Test-only observer.
   */
  /**
   * The metronome's master gain, by identity.
   *
   * Tests used to reach this as `createdGains[N]`, which broke every time the
   * engine grew an internal node — one added `GainNode` cost 68 test repairs and
   * made refactoring the graph expensive on purpose.
   */
  /** Test hook: the engine's tracks with their live volumes. */
  engineTracksForTest(): { key: string; volume: number }[] {
    return (this.#engine?.listTracks() ?? []).map((t) => ({ key: t.key, volume: t.volume }))
  }

  get clickMasterForTest(): GainNode | null {
    return this.#clickMaster
  }

  /** The song lane's gain, by track key rather than by construction order. */
  get songTrackGainForTest(): GainNode | null {
    const engine = this.#engine as unknown as { trackGains?: Map<string, GainNode> } | null
    return engine?.trackGains?.get(SONG_TRACK_KEY) ?? null
  }

  engineRateForTest(): number | null {
    return this.#engine?.rate ?? null
  }

  /**
   * Apply a NAIVE transpose: `semitones` up/down as a pure playback-rate
   * change. Tempo moves with pitch by design. Takes effect immediately, mid-
   * playback, with no render pass and no re-decode — and passing 0 restores
   * untouched playback exactly.
   */
  setTransposeSemitones(semitones: number): void {
    const n = Number.isFinite(semitones) ? Math.trunc(semitones) : 0
    if (n === this.#transposeSemitones) return
    this.#transposeSemitones = n
    this.#applyVarispeed()
  }

  /** How much of the tempo change the transpose is cancelling (0…1). */
  get tempoHold(): number {
    return this.#tempoHold
  }

  /**
   * Semitones the live stretcher must cover — the part of the transpose that
   * resampling is deliberately NOT doing. 0 means "bypass the worklet". The
   * mixer reads this to run the same stage on its own engine.
   */
  get residualShiftSemitones(): number {
    return varispeedPlan(this.#transposeSemitones, this.#tempoHold).shiftSemitones
  }

  /**
   * Hold the tempo through a transpose: 0 keeps pure varispeed (perfect audio,
   * full tempo change), 1 keeps the original tempo (a live stretch worklet does
   * all the work), and in between the worklet only shifts the residual.
   */
  setTempoHold(hold: number): void {
    const h = clampTempoHold(hold)
    if (h === this.#tempoHold) return
    this.#tempoHold = h
    this.#applyVarispeed()
  }

  /**
   * Push the current (transpose, hold) split onto the audio graph: resampling
   * rate on the engine, residual semitones on the live shifter. Recomputed from
   * the SEMITONE every time, never by composing rates — that keeps the round
   * trip exact.
   */
  #applyVarispeed(): void {
    const plan = varispeedPlan(this.#transposeSemitones, this.#tempoHold)
    this.#engine?.setPlaybackRate(plan.rate)
    if (plan.shiftSemitones === 0) {
      // Bypass entirely: an inert worklet still adds its latency, and at zero
      // shift the whole point is that playback is the untouched original.
      this.#detachShifter()
    } else {
      void this.#ensureShifter()
    }
    // The click loop's cached index was chosen under the old rate's lookahead
    // window; re-derive it so no click is skipped or double-fired.
    const engine = this.#engine
    const cplan = this.#plan
    if (this.#clickRaf && engine && cplan) {
      this.#nextClickIdx = initialClickIndex(cplan, engine.schedulingPositionSec() - this.mediaOffsetSec)
    }
  }

  /** Create (once) and tune the master-bus shifter, compensating the clicks. */
  async #ensureShifter(): Promise<void> {
    const engine = this.#engine
    if (!engine) return
    if (!this.#shifter) {
      if (!this.#shifterPending) {
        this.#shifterPending = createLivePitchShifter(engine.ac, 2)
      }
      const made = await this.#shifterPending
      if (!made) return // no worklet available — stay on pure varispeed
      this.#shifter = made
    }
    const shifter = this.#shifter
    // Re-read: the offset may have changed (or zeroed) while the node was being
    // created, and a stale value here would leave playback wrongly shifted.
    const live = varispeedPlan(this.#transposeSemitones, this.#tempoHold)
    if (live.shiftSemitones === 0) {
      this.#detachShifter()
      return
    }
    shifter.setSemitones(live.shiftSemitones)
    engine.setMasterTailNode(shifter.node)
    this.#setClickCompensation(shifter.latencySec)
  }

  /** Take the shifter back out of the graph and undo the click compensation. */
  #detachShifter(): void {
    this.#engine?.setMasterTailNode(null)
    this.#setClickCompensation(0)
  }

  /** Delay the metronome by the shifter's latency so it stays with the song. */
  #setClickCompensation(latencySec: number): void {
    const engine = this.#engine
    const click = this.#clickMaster
    if (!engine || !click) return
    if (!this.#clickDelay) {
      if (latencySec <= 0) return // nothing to compensate, nothing to build
      this.#clickDelay = engine.ac.createDelay(1)
      try {
        click.disconnect()
      } catch {
        /* not connected */
      }
      click.connect(this.#clickDelay)
      this.#clickDelay.connect(engine.ac.destination)
    }
    this.#clickDelay.delayTime.value = Math.max(0, Math.min(1, latencySec))
  }

  /** Current drums-stem kick punch (0…1). */
  get kickPunch(): number {
    return this.#kickPunch
  }

  /**
   * Set the kick punch on the drums stem (0…1, 0 = off). Rebuilds the insert in
   * place and re-seeks so the change is heard immediately, mid-playback.
   */
  setKickPunch(amount: number): void {
    const next = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0))
    if (next === this.#kickPunch) return
    this.#kickPunch = next
    if (this.#wireKickPunch() && this.#playing) this.seek(this.songTimeSec)
  }

  /**
   * Attach (or clear) the kick-punch insert on the drums stem track. Returns
   * whether a track was actually re-wired — the caller decides about re-seeking,
   * so stem registration doesn't seek twice.
   */
  #wireKickPunch(): boolean {
    const engine = this.#engine
    if (!engine) return false
    const drums = this.#stems.find((s) => stemNameForKey(s.key) === 'drums')
    if (!drums) return false
    const track = engine.listTracks().find((t) => t.key === drums.key)
    if (!track) return false
    engine.setTrack({
      ...track,
      insert: this.#kickPunch > 0 ? buildKickPunchChain(engine.ac, this.#kickPunch) : undefined,
    })
    return true
  }

  /** Turn one stem on/off; re-applies the original-vs-stems mute policy live. */
  setStemEnabled(key: string, on: boolean): void {
    if (!(key in this.#stemEnabled)) return
    this.#stemEnabled = { ...this.#stemEnabled, [key]: on }
    this.#applyStemMutes()
  }

  #clearStemTracks(): void {
    const engine = this.#engine
    if (!engine) return
    for (const s of this.#stems) engine.removeTrack(s.key)
  }

  /** original audible ⇔ all stems on; otherwise only the enabled stems sound. */
  #applyStemMutes(): void {
    const engine = this.#engine
    if (!engine) return
    const keys = this.#stems.map((s) => s.key)
    const { playOriginal, audibleStemKeys } = resolveStemAudibility(keys, this.#stemEnabled)
    const audible = new Set(audibleStemKeys)
    engine.setMuted(SONG_TRACK_KEY, !playOriginal)
    for (const k of keys) engine.setMuted(k, !audible.has(k))
  }

  /**
   * Decode `file` once (on the playback context) and register it as the single
   * song track. No-op if the same file is already decoded. Loading a null file
   * clears the track.
   */
  async loadFile(file: File | null): Promise<void> {
    this.#ensureEffects()
    this.clearAudition()
    if (file === this.#loadedFile) return
    this.#loadedFile = file
    this.decodeError = null
    if (!file) {
      this.audioBuffer = null
      this.clearStems()
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
    this.#ensureEffects()
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
    // The song begins at buffer position `mediaOffsetSec` (= trim.startSec).
    // Never start in the pre-trim lead-in: the click plan is trim-shifted, so
    // playing from before the song start delays the first click until playback
    // reaches it — the "clicks start in the second half" bug on songs trimmed to
    // begin partway into the uploaded file. This is the authoritative guard (the
    // .smap trim), independent of whatever selection the editor pushed.
    if (this.mediaOffsetSec > 0) {
      startPos = Math.min(dur, Math.max(startPos, this.mediaOffsetSec))
    }
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
    // Belt-and-braces: the engine may have been (re)created since the transpose
    // was set. Cheap — `setPlaybackRate` early-returns when unchanged.
    engine.setPlaybackRate(varispeedPlan(this.#transposeSemitones, this.#tempoHold).rate)
    // `ctxStart = ctx.currentTime + PLAY_START_LOOKAHEAD_SEC + preroll`.
    void engine.play(startPos, { startDelaySec: preroll })
    const ctxStart = engine.playStartCtx

    // Pre-schedule the count-in clicks against the exact ctxStart, so they are
    // sample-aligned with the song's first sample. The WHAT/WHEN is the pure
    // `countInClickTimes`; we only make the sound.
    if (wantsCountIn && plan && this.#clickMaster) {
      // Re-open the gate first: a previous pause closed it to kill the clicks
      // that were still pending, and a closed gate would swallow this count-in
      // entirely.
      this.#armClicks()
      const fires = countInClickTimes(
        plan,
        ctxStart,
        this.clickOffsetSec,
        engine.ac.currentTime,
        varispeedPlan(this.#transposeSemitones, this.#tempoHold).rate,
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
    this.#stems = []
    this.#stemEnabled = {}
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
    // Carry over any transpose set BEFORE this engine existed. The editor
    // restores the setting on mount, long before audio is decoded, so without
    // this the rate is silently dropped and playback stays untransposed.
    if (this.#transposeSemitones !== 0) engine.setPlaybackRate(varispeedPlan(this.#transposeSemitones, this.#tempoHold).rate)
    this.#engine = engine
    return engine
  }

  #registerTrack(buf: AudioBuffer): void {
    const engine = this.#ensureEngine()
    if (this.#playing) this.stop()
    // A new song's stems are loaded separately by the host; drop the old song's.
    this.clearStems()
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
    const songStart = this.mediaOffsetSec // buffer pos of song start (trim.startSec)
    const trimEnd = this.#songMap?.audio?.trim?.endSec
    engine.seek(songStart)
    this.#rangeStart = songStart
    this.#rangeEnd = trimEnd && trimEnd > songStart ? Math.min(trimEnd, buf.duration) : 0
    this.#nextClickIdx = 0
    this.#positionSec = songStart
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
    this.#armClicks()
    this.#clickRaf = requestAnimationFrame(this.#runClickLoop)
  }

  #stopClickLoop(): void {
    if (this.#clickRaf) cancelAnimationFrame(this.#clickRaf)
    this.#clickRaf = 0
    this.#silenceClicks()
  }

  /**
   * SILENCE CLICKS THAT ARE ALREADY SCHEDULED.
   *
   * Stopping the rAF stops us scheduling MORE clicks. It does nothing about the
   * ones already handed to the audio clock, and the count-in hands over ALL of
   * them at once — up to sixteen voices spread over several seconds, placed
   * against `playStartCtx` the instant play is pressed.
   *
   * So pausing during a count-in left it ringing on for seconds with the
   * transport stopped, and pressing play again laid a second count-in on top of
   * the first. `playMetronomeClick` returns nothing, so there are no handles to
   * cancel — but every voice is connected THROUGH this one gain, and closing it
   * silences all of them at once, scheduled or not.
   *
   * `cancelScheduledValues` first: the gain may itself be mid-ramp.
   */
  #silenceClicks(): void {
    const master = this.#clickMaster
    const engine = this.#engine
    if (!master || !engine) return
    const now = engine.ac.currentTime
    master.gain.cancelScheduledValues?.(now)
    master.gain.setValueAtTime(0, now)
    master.gain.value = 0
  }

  /** Open the click gain again, at the user's volume. The mirror of the above. */
  #armClicks(level?: number): void {
    const master = this.#clickMaster
    const engine = this.#engine
    if (!master || !engine) return
    const now = engine.ac.currentTime
    const v = (level ?? Math.max(0, this.clickVolume)) * this.#auditionClickFactor
    master.gain.cancelScheduledValues?.(now)
    master.gain.setValueAtTime(v, now)
    master.gain.value = v
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
      varispeedPlan(this.#transposeSemitones, this.#tempoHold).rate,
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
