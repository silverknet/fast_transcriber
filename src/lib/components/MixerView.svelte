<script lang="ts">
  /**
   * Multi-track mixer view — in-browser "parallel-track DAW" for one song.
   *
   * Lifecycle:
   *  1. On mount, decode the song's audio chunk + every stem WAV + cue track
   *     (whichever are present on disk). All decode work happens on a single
   *     AudioContext owned by [`MixerEngine`](../audio/mixerEngine.ts).
   *  2. Each track is registered with the engine. Time alignment: tracks
   *     whose natural t=0 is *before* the cue track's t=0 (stems, original
   *     mix) get silence prepended so every track starts at t=0 of the mix
   *     timeline. This matches how the eventual Ableton export will lay
   *     clips out — each track starts at the same musical zero.
   *  3. Volume / mute / solo are persisted into `songMap.mixState` (debounced
   *     1 s); the project autosave then ships it to disk.
   *  4. On unmount, dispose the engine (releases buffers + closes context).
   */
  import { onDestroy, onMount, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import ApcKey25Control from '$lib/components/ApcKey25Control.svelte'
  import LiveMidiController from '$lib/components/LiveMidiController.svelte'
  import XAirSettingsPanel from '$lib/components/XAirSettingsPanel.svelte'
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
  import LiveStageMobile from '$lib/components/LiveStageMobile.svelte'
  import LyricConfidenceLine from '$lib/components/LyricConfidenceLine.svelte'
  import LyricBreak from '$lib/components/LyricBreak.svelte'
  import { lyricBreakState } from '$lib/audio/lyricBreak'
  import { isNarrow } from '$lib/stores/viewport'
  import { upcomingChordRow } from '$lib/audio/upcomingChords'
  import {
    CANONICAL_LIVE_SLOTS,
    effectiveSlotLink,
    isGroupOn,
    isLiveSlotLink,
    LIVE_SLOT_LABELS,
    buildLiveSlotViews,
    hasMusicalSlotLane,
    liveInitialMuted,
    nextGroupMuted,
    resolveLiveSlotLanes,
    slotNameByIndex,
    type LiveSlotLink,
  } from '$lib/hardware/liveSlotLinks'
  import { isLaneReorderable, moveKey, sortBySavedOrder } from '$lib/audio/laneOrder'
  import {
    createChannelEqNodes,
    isEqActive,
    isEqWorthStoring,
    type ChannelEq,
    type ChannelEqNodes,
  } from '$lib/audio/channelEq'
  import { SECTION_PAD_COUNT, type LiveCommand, type LiveLedState } from '$lib/hardware/liveMidiMap'
  import { Button } from '$lib/components/ui/button'
  import LiveHardwareStrip from '$lib/components/LiveHardwareStrip.svelte'
  import MixerTrackLane from '$lib/components/MixerTrackLane.svelte'
  import DrumMachinePanel from '$lib/components/DrumMachinePanel.svelte'
  import BassMachinePanel from '$lib/components/BassMachinePanel.svelte'
  import ChordMachinePanel from '$lib/components/ChordMachinePanel.svelte'
  import { createReloadSerializer } from '$lib/components/mixerReloadSerialization'
  import { transposeSettings } from '$lib/stores/transposeSettings.svelte'
  import { createLivePitchShifter, type LivePitchShifter } from '$lib/audio/livePitchShift'
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu'
  import { Plus } from '@lucide/svelte'
  import {
    machineTrackLaneKey,
    withMachineTrack,
    type MachineTrackKind,
  } from '$lib/songmap/machineTracks'
  import MixerStageWaveform from '$lib/components/MixerStageWaveform.svelte'
  import MonitorStatusStrip from '$lib/components/MonitorStatusStrip.svelte'
  import { Cable, Pause, Play, Repeat, Repeat1, RotateCcw, SkipBack, SkipForward, Square, Trash2, X } from '@lucide/svelte'
  import ALargeSmall from '@lucide/svelte/icons/a-large-small'
  import {
    formatChordSymbol,
    formatSongKeyLabel,
    resolveChordAtEachBeat,
    songKeyPreferFlats,
  } from '$lib/chords'
  import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
  import { laneHasPrebakedPreamble } from '$lib/audio/laneAlignment'
  import { createRefreshQueue } from '$lib/audio/refreshQueue'
  import {
    createDrumMachineInstrument,
    updateDrumMachineInstrument,
  } from '$lib/audio/drumMachineTrack'
  import type { DrumMidiInstrument } from '$lib/audio/drumMidiInstrument'
  import {
    createBassMachineInstrument,
    updateBassMachineInstrument,
  } from '$lib/audio/bassMachineTrack'
  import type { BassMidiInstrument } from '$lib/audio/bassMidiInstrument'
  import { DRUM_KITS, loadDrumKit, type DrumKit, type DrumKitId } from '$lib/audio/drumKits'
  import type { MidiInstrument, MidiVisual } from '$lib/audio/mixerEngine'
  import { createReverbInsert, normalizeReverb, REVERB_PRESETS } from '$lib/audio/reverbBus'
  import { createDelayInsert, normalizeDelay, DELAY_PRESETS } from '$lib/audio/delayBus'
  import { createWidenerInsert, normalizeWidener, WIDENER_PRESETS } from '$lib/audio/widenerBus'
  import {
    buildEffectRack,
    retuneEffectRack,
    teardownEffectRack,
    type EffectRack,
  } from '$lib/audio/effectRack'
  import {
    createEffectBus,
    activeChain,
    addEffect,
    chainShapeKey,
    effectKindLabel,
    moveEffect,
    removeEffect,
    setEffectBypassed,
    setEffectSettings,
    EFFECT_KINDS,
    type EffectUnit,
    type EffectKind,
    isHookedUp,
    setHookedUp,
    setSendAmount,
    renameBus,
    type EffectBus,
  } from '$lib/songmap/effectBusses'
  // One definition of the shape, owned by the bar that consumes it.
  import type { MixerControls } from '$lib/components/editor/TransportBar.svelte'
  import { computeCountIn } from '$lib/audio/computeCountIn'
  import { effectiveCountInBeats } from '$lib/songmap/countIn'
  import {
    bufferWithPrepend,
    MixerEngine,
    type MixerInsert,
    type MixerSnapshot,
    type MixerTrack,
  } from '$lib/audio/mixerEngine'
  import DrumTrackPanel from '$lib/components/DrumTrackPanel.svelte'
  import {
    createDetectedBassInstrument,
    updateDetectedBassInstrument,
  } from '$lib/audio/detectedBassTrack'
  import { chordJam } from '$lib/audio/chordJam.svelte'
  import { UNITY, planFaderReset } from '$lib/audio/faderReset'
  import { audioDevice } from '$lib/audio/audioDevice'
  import { mayStartSong } from '$lib/audio/clickStartGate'
  import { liveRigLayout } from '$lib/hardware/liveRigPlan'
  import { loadRigSetup, resolveProfileRequest } from '$lib/hardware/rigSetupStore'
  import {
    createChordMachineInstrument,
    updateChordMachineInstrument,
    type ChordMachineVoice,
  } from '$lib/audio/chordMachineTrack'
  import type { KeysMidiInstrument } from '$lib/audio/keysMidiInstrument'
  import {
    bufferRmsDb,
    buildMasterChain,
    buildStemChain,
    loudnessMatchGainDb,
    stemKindForLaneKey,
  } from '$lib/audio/mastering'
  import { readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { readProjectTransposedAudioBlob } from '$lib/client/transposeAudioCache'
  import { loadProjectDrumKit } from '$lib/client/projectDrumKit'
  import { loadProjectSongIntoEditor, refreshProjectInfo, selectBestStemSet } from '$lib/project/commit'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import { renderClickTrackData, renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
  import { LiveCueScheduler } from '$lib/audio/liveCueScheduler'
  import { renderSectionCueClips } from '$lib/audio/sectionCueClips'
  import { sectionCueSpecsFromSongMap } from '$lib/songmap/sectionCueSpecs'
  import { fetchTtsWavCached } from '$lib/client/ttsCache'
  import {
    fingerprintClickTrackInputs,
    fingerprintCueTrackInputs,
  } from '$lib/songmap/cueTrackFingerprint'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { renderBassTrackWavBlob, renderBassMachineWavBlob } from '$lib/audio/renderBassTrack'
  import { renderDrumTrackWavBlob, renderDrumMachineWavBlob } from '$lib/audio/renderDrumTrack'
  import { cuePlaybackMuted, getPrimaryCueTrack, withCuePlaybackMuted } from '$lib/songmap/cueTracks'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import { audioSession } from '$lib/stores/audioSession'
  import { audibleStemSet } from '$lib/audio/liveStemDefaults'
  import type { AutoStemName, ProjectMastering } from '$lib/project/types'
  import { project as projectStore, isBrowserCloudProject } from '$lib/stores/project'
  import { loadCloudSongIntoEditor } from '$lib/client/browserCloudProject'
  import { loadSongStemBlobsFor } from '$lib/audio/loadSongStems'
  import { prefetchPlan } from '$lib/audio/livePrefetch'
  import {
    getCachedClickRender,
    getPreloadedStems,
    putCachedClickRender,
    putPreloadedStems,
    evictPreloaded,
    markFetched,
    decodedSongIds,
    clearLiveAudioCache,
    liveFetchedSongs,
  } from '$lib/audio/liveAudioCache'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import {
    clampTransposeSemitones,
    transposeChordForDisplay,
    transposeSongKey,
  } from '$lib/songmap/transposition'
  import type { MixState, MixTrackState, SongMap } from '$lib/songmap/types'
  import { RefreshCw } from '@lucide/svelte'

  /** Lane palette — distinct hues so tracks are easy to tell apart. */
  /**
   * The original full mix, deliberately OFF the rotation palette: a warm amber
   * against a set of cool stem colours, so the reference lane is identifiable
   * at a glance on a dark stage.
   */
  const ORIGINAL_LANE_COLOR = '#f59e0b'

  const LANE_COLORS = [
    '#0ea5e9', // sky (original)
    '#f43f5e', // rose (vocals)
    '#a855f7', // purple (drums)
    '#22c55e', // emerald (bass)
    '#eab308', // yellow (other / guitar)
    '#06b6d4', // cyan (fx / extra stems)
    '#f97316', // orange (cue)
  ]
  /**
   * Render-and-cache audio transpose (sidecar Rubber Band) — DISABLED.
   *
   * Transpose here is naive VARISPEED: the engine's playback rate, with the
   * tempo-hold dial trading tempo drift against worklet artifacts. That is
   * instant and needs nothing on disk.
   *
   * The render path is worse on every axis the user cares about: it blocks the
   * load behind "Preparing transposed …", and — because the branch below throws
   * when a song has no local project folder — it failed the WHOLE mixer load
   * for any song not stored locally, which presents as no audio at all.
   *
   * Set back to `true` only to re-enable the cached path; all wiring is intact.
   */
  const transposeAudioEnabled: boolean = false
  const MACHINE_PART_REFRESH_VERSION = 'section-blocks-v3'

  /**
   * Bump `reloadSignal` from the parent to force a full re-scan + re-load of
   * lanes (e.g. after the Overview "Play cues" toggle renders/removes the cue
   * WAV). Changing it re-runs `reload()`; the initial value is ignored so mount
   * doesn't double-load.
   */
  let {
    reloadSignal = 0,
    initialPlaybackMode = false,
    lockPlaybackMode = false,
    liveMode = false,
    playbackMode = $bindable(false),
    generatorPanel = $bindable(null),
    controls = $bindable(null),
    transposeSemitonesOverride = null,
    varispeedAudio: varispeedAudioProp = null,
    tempoHold: tempoHoldProp = null,
  } = $props<{
    reloadSignal?: number
    initialPlaybackMode?: boolean
    lockPlaybackMode?: boolean
    liveMode?: boolean
    /** Bindable so the editor's left rail can own the Playback tab. */
    playbackMode?: boolean
    /** Which stem GENERATOR panel is open — a different feature from the
     *  machines, so it gets its own "Add track" entries. */
    generatorPanel?: 'drums' | 'bass' | null
    /**
     * Playback handles published UP so the editor's single top transport can
     * drive THIS engine on Overview. The mixer owns its own engine (two
     * engines must never sound at once), so the shell can't just use its own.
     */
    controls?: MixerControls | null
    /** Edit-route personal transpose; live route falls back to shared `.smap` transpose. */
    transposeSemitonesOverride?: number | null
    /**
     * The host's varispeed switch + artifacts dial. Null when the mixer is
     * standalone (live stage), in which case the saved preference is used.
     */
    varispeedAudio?: boolean | null
    tempoHold?: number | null
  }>()

  /**
   * Is the click switched off?
   *
   * MIRRORS THE ENGINE — it is not a second opinion. The click has no mixer
   * lane (`HIDDEN_LANE_KEYS`), so unlike every other track its switch state
   * cannot be read off `lanes`, and it used to be a plain `$state(false)` that
   * nothing ever initialised.
   *
   * That desynced silently and in the worst direction. The click TRACK is
   * registered with `initialMutedFor('click', …)`, which returns the mute saved
   * in the song's `mixState` — so a song where the click had ever been switched
   * off came back with the ENGINE muted while this said `false` and the button
   * showed ON. The symptom is "I hear no click anywhere" with the UI insisting
   * it is playing, which is unfalsifiable from the stage.
   *
   * Written ONLY by `syncLanesFromEngine()`, which is the existing place UI
   * state is pulled from the engine.
   */
  let clickMuted = $state(false)
  /**
   * LIVE CLICK — 100% derived, per the spec in one sentence: "if there is a
   * grid there is a click". In live mode click audibility is a pure function
   * of exactly three inputs:
   *
   *     click sounds = grid exists && liveClickOn && practice-gate open
   *
   * `liveClickOn` is the per-SHOW switch: session-only, starts ON, never
   * persisted, never read from any song's saved mix state. The enforcement
   * effect (next to the practice gate) stamps it onto the engine continuously
   * — the engine is a sink here, never a source. Before this, registration
   * COPIED an initial mute once per lane load; a copy is not a derivation,
   * and every haunting ("some songs click, some don't", "no clicks on Love
   * Never Felt So Good") was that copy inheriting a song's editing history or
   * racing a reload.
   */
  let liveClickOn = $state(true)
  /** What every click pill/LED shows. In live: the derivation, never a mirror. */
  const clickOnNow = $derived(liveMode ? liveClickOn : !clickMuted)
  function setClickOn(on: boolean): void {
    if (liveMode) {
      // Write the derivation's INPUT; the enforcement effect owns the engine.
      liveClickOn = on
      return
    }
    // Editor: tell the engine, then read back — never set both independently.
    engine?.setMuted('click', !on)
    syncLanesFromEngine()
  }

  /**
   * The band, for the live in-ear strip.
   *
   * Read straight off the project — `Performer.monitorBus` is owned by Project
   * settings and nothing here may write it. This is a view, not a second place
   * to configure monitors.
   */
  const livePerformers = $derived(
    ($projectStore.data?.performers ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role ?? null,
      monitorBus: p.monitorBus ?? null,
    })),
  )

  /** Colours for the two non-musical live buttons (they have no mixer strip). */
  const CLICK_LANE_COLOR = '#ffffff'
  const CUE_LANE_COLOR = '#ff5400'

  /** Cue audibility — the ONE per-song flag every surface shares. */
  const cueLaneMuted = $derived($songMap ? cuePlaybackMuted($songMap) : false)
  /**
   * Cue is not an engine lane — it is scheduled live — so its on/off lives in
   * `mixState` and `cuesEnabled` gates the scheduler. Through the shared
   * helper: the editor's transport bar writes the same field, and two local
   * find-and-patch copies is how flags drift.
   */
  function setCueOn(on: boolean): void {
    patchSongMap((m) => withCuePlaybackMuted(m, !on))
  }


  /** What we hand to MixerTrackLane for rendering. */
  interface LaneView {
    key: string
    label: string
    color: string
    /** Null for a MIDI lane — there is no rendered waveform to draw. */
    buffer: AudioBuffer | null
    /** True when this lane is played live rather than from a buffer. */
    isInstrument: boolean
    /** The pattern to draw for a MIDI lane, in place of a waveform. */
    midiVisual: MidiVisual | null
    /** Mix-timeline length, from the buffer OR the instrument's part. */
    sourceDurationSec: number
    volume: number
    muted: boolean
    soloed: boolean
    /**
     * Automatic loudness-match gain for this lane, in dB (0 when matching is
     * off or the lane is not a stem). Shown next to the fader: this gain sits
     * BEFORE the fader in the chain, so without it on screen a stem can be
     * audibly louder than its fader suggests and nothing says why.
     */
    matchGainDb: number
  }

  interface ChordTimelineSegment {
    id: string
    label: string
    startSec: number
    endSec: number
    hasChord: boolean
  }

  interface ChordApproachView extends ChordTimelineSegment {
    startsInLabel: string
    distanceSec: number
    leftPct: number
    widthPct: number
    opacity: number
    urgent: boolean
    active: boolean
    row: number
  }

  interface SectionTimelineRange {
    id: string
    label: string
    kind: string
    startSec: number
    endSec: number
    index: number
  }

  interface LaneLight {
    key: string
    label: string
    color: string
    active: boolean
    muted: boolean
  }

  const NO_CHORD_LABEL = 'No chord'
  const CHORD_APPROACH_WINDOW_SEC = 12

  let loading = $state(true)
  let loadingMsg = $state('Loading tracks…')
  let loadError = $state<string | null>(null)
  /**
   * "Grid exists but the click could not be built" — the one remaining way a
   * click can be missing, and it must be LOUD, not a silent `continue`. Does
   * not block playback (the song still matters on stage); shown as a red line.
   */
  let clickBuildError = $state<string | null>(null)
  /** Channels that failed to load, named — never hidden behind a happy count. */
  let laneLoadWarning = $state<string | null>(null)
  let initialPlaybackModeSeeded = false
  // The playback stage is a fixed overlay, but the app navbar/context bar sit in
  // their own stacking context above the editor — so the stage fills the area
  // BELOW the chrome (measured) rather than fighting z-index with the navbar.
  let chromeInsetPx = $state(0)
  let largeStageText = $state(false)
  let repeatSectionEnabled = $state(false)
  let repeatSectionId = $state<string | null>(null)
  let repeatSeekGuard = false
  let replayOnceSectionId = $state<string | null>(null)
  let replayOnceConsumed = $state(false)
  let projectSongSwitching = $state(false)
  let drumMachineScope = $state<string>('song')
  let bassMachineScope = $state<string>('song')

  let engine: MixerEngine | null = null
  let snapshot = $state<MixerSnapshot>({ state: 'stopped', positionSec: 0, durationSec: 0 })
  let mixerDurationSec = $state(0)
  // DISCRETE transport state — updated only on transition, NOT every frame like
  // `snapshot`. Deriveds that only care about play/pause (lane LEDs, headings)
  // read THIS so they stay off the per-frame reactive cascade (live-lag fix).
  let transportState = $state<MixerSnapshot['state']>('stopped')
  let lanes = $state<LaneView[]>([])
  /**
   * Jam voices the mixer plays as scheduled MIDI lanes. Those must NOT also be
   * fired per frame by `chordJam`, or you hear each note twice — once on the
   * mixer's clock and once on the jam's own context.
   */
  /**
   * Jam voices the mixer must NOT fire directly — which is every voice that is
   * not hosted as a visible lane.
   *
   * This list used to contain only lane-hosted voices (to avoid doubling), so
   * any jam voice armed in localStorage could sound during mixer and LIVE
   * playback with no channel, no fader, no mute and no pill anywhere. What you
   * see is what sounds: a hosted voice is suppressed from the preview player to
   * avoid doubling, and an unhosted voice is suppressed completely.
   */
  const jamVoicesSuppressedHere = $derived(
    (['keys', 'bass', 'arp'] as const).filter(
      (v) =>
        !(v === 'keys' && lanes.some((l) => l.key === 'chord-machine')) &&
        !(v === 'arp' && lanes.some((l) => l.key === 'arp-machine')),
    ),
  )
  const mixerCanPlay = $derived(!loading && !loadError && lanes.length > 0)

  // Declutter: the generated BarBro Band (drums/bass) lanes and the live-rig
  // hardware strips (XR18 / APC) are hidden by default and remembered per browser.
  function lsBool(key: string): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  }
  function setLsBool(key: string, v: boolean): void {
    try {
      localStorage.setItem(key, v ? '1' : '0')
    } catch {
      /* private mode — remembering is best-effort */
    }
  }
  // The Band toggle was removed from the transport bar; generated lanes are
  // explicit tracks now (you add them), so they always show.
  const showBand = true

  /**
   * Whether the mixer HOSTS the chord voices as lanes — a separate question
   * from whether the Chords tab previews them.
   *
   * These were originally keyed off `chordJam.keysOn`/`arpOn`, which is the
   * Chords tab's "hear chords" switch. That meant ticking a preview checkbox
   * silently grew two synth lanes on EVERY song, which is not something the
   * user asked for in the mixer. The knobs are still shared (that was the
   * point); only the lane's existence is a mixer decision, made through
   * "+ Add track" and undone with the panel's remove button.
   */
  const CHORD_LANE_KEY = 'barbro::mixer::chordLane'
  const ARP_LANE_KEY = 'barbro::mixer::arpLane'
  let chordLaneOn = $state(lsBool(CHORD_LANE_KEY))
  let arpLaneOn = $state(lsBool(ARP_LANE_KEY))
  function setChordLane(voice: ChordMachineVoice, on: boolean): void {
    if (voice === 'keys') {
      chordLaneOn = on
      setLsBool(CHORD_LANE_KEY, on)
    } else {
      arpLaneOn = on
      setLsBool(ARP_LANE_KEY, on)
    }
  }
  let showRig = $state(lsBool('barbro::mixer::rig'))
  /** The XR18 "Live Rig" settings dialog (connect / route / monitor mixes / FOH-safety). */
  let xairPanelOpen = $state(false)

  // ── Machine-lane refresh ───────────────────────────────────────────────────
  // Editing a knob changes ONE lane. A full `reload()` re-fetches and re-decodes
  // every stem, which makes the editors unusable — so re-render just the lane
  // that changed, and coalesce the burst of events a slider drag produces.

  const MACHINE_REFRESH_DEBOUNCE_MS = 220

  /**
   * The drum machine's kit: "Your kit" comes from the project folder, anything
   * else is a built-in. Shared by the lane builder and the refresh path so they
   * can't resolve it differently.
   */
  async function resolveDrumMachineKit(sm: NonNullable<typeof $songMap>): Promise<DrumKit> {
    const id = sm.drumMachine?.kit
    if (id === 'custom' && $projectStore.osPath) {
      const custom = await loadProjectDrumKit($projectStore.osPath)
      if (custom) return custom.kit
    }
    return loadDrumKit(DRUM_KITS.some((k) => k.id === id) ? (id as DrumKitId) : 'synth')
  }

  /** Re-render one machine lane in place, keeping its fader/mute/solo state. */
  async function refreshMachineLane(key: string): Promise<void> {
    const eng = engine
    const sm = get(songMap)
    if (!eng || !sm) return

    // BarBro Bass: a live instrument like the machine, but its on/off switch is
    // "are there detected notes", not a `machine.enabled` flag — so it takes
    // its own short path rather than being bent through the machine logic.
    if (key === 'bass-gen') {
      const prev = eng.listTracks().find((t) => t.key === key)
      if (!sm.bassMidi || sm.bassMidi.events.length === 0) {
        if (prev) {
          eng.removeTrack(key)
          syncLanesFromEngine()
        }
        if (selectedLaneKey === key) selectedLaneKey = null
        return
      }
      if (!prev) {
        await reload()
        return
      }
      try {
        const inst = prev.instrument as BassMidiInstrument | undefined
        if (!inst) return
        const alive = await updateDetectedBassInstrument(inst, sm, transposeSemitones)
        if (!alive) {
          eng.removeTrack(key)
          syncLanesFromEngine()
          return
        }
        if (snapshot.state === 'playing') void engine?.play(snapshot.positionSec)
      } catch (e) {
        console.warn('bass-gen refresh failed', e)
      }
      return
    }

    const isDrum = key === 'drum-machine'
    // The chords/arp lanes are driven by the Chords-tab knobs, not by `.smap`,
    // so their on/off switch is the jam's rather than a machine's.
    const chordVoice: ChordMachineVoice | null =
      key === 'chord-machine' ? 'keys' : key === 'arp-machine' ? 'arp' : null
    // For a chord voice, OFF means gone: there is no `.smap` entry to keep
    // settings in, so `null` here (rather than `{enabled:false}`) is what makes
    // the branch below drop the lane AND clear the selection.
    const chordVoiceOn = chordVoice === 'keys' ? chordLaneOn : arpLaneOn
    const machine = chordVoice
      ? chordVoiceOn
        ? { enabled: true }
        : null
      : isDrum
        ? sm.drumMachine
        : sm.bassMachine
    const prev = eng.listTracks().find((t) => t.key === key)

    // Deleted or switched off → drop the lane rather than leave a stale one.
    // Deleting also clears the selection (there's nothing left to edit);
    // switching OFF keeps it, so the editor stays open to switch back on.
    if (!machine?.enabled) {
      if (prev) {
        eng.removeTrack(key)
        syncLanesFromEngine()
      }
      if (!machine && selectedLaneKey === key) selectedLaneKey = null
      return
    }
    // Newly added: no lane yet, so the plan has to build it.
    if (!prev) {
      await reload()
      return
    }

    try {
      // CHORDS / ARP: same in-place update. The part is rebuilt from the
      // current knobs and the patch pushed into the hosted synth.
      if (chordVoice) {
        const inst = prev.instrument as KeysMidiInstrument | undefined
        if (inst) {
          if (!updateChordMachineInstrument(inst, sm, chordVoice, transposeSemitones)) {
            eng.removeTrack(key)
            syncLanesFromEngine()
            return
          }
          eng.rescheduleInstrument(key)
          syncLanesFromEngine()
        }
        return
      }
      // DRUMS are a live MIDI track: push the new part and kit straight into
      // the instrument and re-schedule just that lane. No render, no decode,
      // and — unlike the buffer path below — no transport re-seek, so nothing
      // else is interrupted.
      if (isDrum) {
        const inst = prev.instrument as DrumMidiInstrument | undefined
        if (inst) {
          const stillPlayable = updateDrumMachineInstrument(inst, sm, await resolveDrumMachineKit(sm))
          if (!stillPlayable) {
            eng.removeTrack(key)
            syncLanesFromEngine()
            return
          }
          eng.rescheduleInstrument(key)
          syncLanesFromEngine()
          return
        }
      }
      // BASS is a live MIDI track as well now — same in-place update, same
      // targeted re-schedule, no render and no transport re-seek.
      const bassInst = prev.instrument as BassMidiInstrument | undefined
      if (bassInst) {
        const stillPlayable = await updateBassMachineInstrument(bassInst, sm, transposeSemitones)
        if (!stillPlayable) {
          eng.removeTrack(key)
          syncLanesFromEngine()
          return
        }
        eng.rescheduleInstrument(key)
        syncLanesFromEngine()
        return
      }
      // Same here: notes move, audio is not re-pitched.
      const blob = (await renderBassMachineWavBlob(sm, { transposeSemitones })).blob
      let buf = await decodeBlob(eng, blob)
      const pre = computePrepend(key)
      if (pre > 0) buf = bufferWithPrepend(eng.ac, buf, pre)
      eng.setTrack({ ...prev, buffer: buf })
      syncLanesFromEngine()
      // Sources already started keep playing the OLD buffer, so re-seek to the
      // playhead to make the edit audible without stopping the transport.
      if (eng.snapshot().state === 'playing') eng.seek(eng.positionSec())
    } catch (e) {
      // Keep the previous buffer — a half-written setting shouldn't blank the
      // lane mid-edit.
      console.warn('Failed to refresh', key, e)
    }
  }

  const machineRefreshQueue = createRefreshQueue(
    refreshMachineLane,
    MACHINE_REFRESH_DEBOUNCE_MS,
  )

  /** Any machine edit re-renders only that lane, debounced and coalesced. */
  function onMachineChanged(): void {
    if (!selectedLaneKey) return
    machineRefreshQueue.schedule(selectedLaneKey)
  }

  function secSig(sec: number | undefined): number | null {
    return sec === undefined || !Number.isFinite(sec) ? null : Math.round(sec * 10000) / 10000
  }

  function machineTimingSignature(sm: SongMap) {
    return {
      v: MACHINE_PART_REFRESH_VERSION,
      trim: sm.audio?.trim
        ? { startSec: secSig(sm.audio.trim.startSec), endSec: secSig(sm.audio.trim.endSec) }
        : null,
      countInBeats: effectiveCountInBeats(sm),
      startBeatId: sm.startBeatId ?? null,
      preludeSec: secSig(titleCuePreludeSec(sm, getPrimaryCueTrack(sm))),
      bars: [...sm.timeline.bars]
        .sort((a, b) => a.index - b.index)
        .map((b) => [
          b.id,
          b.index,
          secSig(b.startSec),
          secSig(b.endSec),
          b.meter.numerator,
          b.meter.denominator,
          ...b.beatIds,
        ]),
      beats: sortBeatsByTime(sm.timeline.beats).map((b) => [
        b.id,
        b.barId,
        b.indexInBar,
        secSig(b.timeSec),
      ]),
      sections: [...sm.sections]
        .sort((a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex || a.id.localeCompare(b.id))
        .map((s) => [
          s.id,
          s.kind,
          s.barRange.startBarIndex,
          s.barRange.endBarIndex,
        ]),
    }
  }

  function drumMachineSignature(sm: SongMap | null | undefined): string {
    if (!sm?.drumMachine?.enabled) return ''
    const { renderExport: _renderExport, ...machine } = sm.drumMachine
    return JSON.stringify({ timing: machineTimingSignature(sm), machine })
  }

  function bassMachineSignature(sm: SongMap | null | undefined): string {
    if (!sm?.bassMachine?.enabled) return ''
    const { renderExport: _renderExport, ...machine } = sm.bassMachine
    return JSON.stringify({
      timing: machineTimingSignature(sm),
      machine,
      harmony: sm.harmony.map((h) => [
        h.id,
        h.barId,
        h.beatId ?? null,
        secSig(h.startSec),
        secSig(h.endSec),
        h.chord,
        h.beatAnchor?.indexInBar ?? null,
        h.barFraction ?? null,
      ]),
    })
  }

  /**
   * BarBro Bass's settings, for the same live-refresh treatment the machines
   * get. The detected NOTES are summarized rather than serialized — there can
   * be hundreds and they only change on a re-detect, which `analyzedAt`
   * already marks.
   */
  function detectedBassSignature(sm: SongMap | null | undefined): string {
    const bm = sm?.bassMidi
    if (!bm || bm.events.length === 0) return ''
    const { renderExport: _renderExport, events: _events, ...settings } = bm
    return JSON.stringify({
      timing: machineTimingSignature(sm),
      settings,
      noteCount: bm.events.length,
    })
  }

  const drumAutoRefreshSig = $derived(drumMachineSignature($songMap))
  const bassAutoRefreshSig = $derived(bassMachineSignature($songMap))
  const detectedBassRefreshSig = $derived(detectedBassSignature($songMap))
  let lastDrumAutoRefreshSig: string | null = null
  let lastBassAutoRefreshSig: string | null = null
  let lastDetectedBassSig: string | null = null

  $effect(() => {
    const sig = detectedBassRefreshSig
    if (!sig || !engine || loading || !lanes.some((l) => l.key === 'bass-gen')) return
    if (lastDetectedBassSig === sig) return
    lastDetectedBassSig = sig
    machineRefreshQueue.schedule('bass-gen')
  })

  $effect(() => {
    const sig = drumAutoRefreshSig
    if (!sig || !engine || loading || !lanes.some((l) => l.key === 'drum-machine')) return
    if (lastDrumAutoRefreshSig === sig) return
    lastDrumAutoRefreshSig = sig
    machineRefreshQueue.schedule('drum-machine')
  })

  $effect(() => {
    const sig = bassAutoRefreshSig
    if (!sig || !engine || loading || !lanes.some((l) => l.key === 'bass-machine')) return
    if (lastBassAutoRefreshSig === sig) return
    lastBassAutoRefreshSig = sig
    machineRefreshQueue.schedule('bass-machine')
  })

  /**
   * Keep the chords/arp lanes in step with their knobs.
   *
   * This used to be an `$effect` that JSON.stringify'd the whole settings
   * object (patches included) and, on any difference, scheduled a refresh for
   * BOTH lanes. That was wrong twice over: it walked two deep `$state` proxies
   * on every reactive tick, and a refresh for a lane that did not exist yet
   * fell through to a full `reload()` — so two of them could overlap and wipe
   * the mixer. It is a `$derived` now, per the repo's rule, and it only ever
   * refreshes a lane that is ALREADY on the engine. Adding and removing lanes
   * stays where the user actually does it: the "+ Add track" menu and the
   * panel's remove button, both of which reload explicitly.
   */
  const chordJamSig = $derived(
    [
      chordJam.keysOctave,
      chordJam.keysVolume,
      chordJam.keysPatch.name,
      chordJam.arpOctave,
      chordJam.arpVolume,
      chordJam.arpRate,
      chordJam.arpDirection,
      chordJam.arpOctaves,
      chordJam.arpSwing,
      chordJam.arpPatch.name,
    ].join('|'),
  )

  let lastChordJamSig: string | null = null
  $effect(() => {
    const sig = chordJamSig
    const prev = lastChordJamSig
    lastChordJamSig = sig
    // First run records the baseline — the initial load already built the lanes
    // from these values.
    if (prev === null || prev === sig || loading) return
    for (const key of ['chord-machine', 'arp-machine']) {
      // Existing lanes only: a missing one must NOT trigger a full reload here.
      if (lanes.some((l) => l.key === key)) machineRefreshQueue.schedule(key)
    }
  })

  /**
   * The selected lane — Logic shows the editor for the selected track, so an
   * editor only appears once you click its lane. Null = nothing selected.
   */
  let selectedLaneKey = $state<string | null>(null)
  /** Lanes with an editor behind them; everything else is just a fader. */
  /**
   * Lanes that open an editor when clicked. A lane NOT in here gets no
   * `onSelect` at all, so clicking it does nothing — which is why a new machine
   * has to be added here as well as to `openEditor`.
   */
  const EDITABLE_LANE_KEYS = new Set([
    'drum-machine',
    'bass-machine',
    // BarBro Bass has an editor too (detect / feel / timing / sound). It was
    // missing here, so the lane got no `onSelect` and clicking it did nothing.
    'bass-gen',
    'chord-machine',
    'arp-machine',
  ])

  /** "+ Add track" → create it, reveal the Band group, and select it. */
  function addMachineTrack(kind: MachineTrackKind): void {
    patchSongMap((sm) => withMachineTrack(sm, kind))
    selectLane(machineTrackLaneKey(kind))
    void reload()
  }

  /** Which stem GENERATOR panel is open, if any. Bound by the mixer panel —
   *  generators are a different feature from the machines (they detect what
   *  the recording played), so they get their own menu entries. */
  const canAddDrumMachine = $derived(!$songMap?.drumMachine?.enabled)
  const canAddBassMachine = $derived(!$songMap?.bassMachine?.enabled)
  /**
   * The chord voices are switched on per-device (they're the Chords tab's own
   * knobs), not stored on the song — so "already added" is just "already on".
   */
  const canAddChordMachine = $derived(!chordLaneOn)
  const canAddArpMachine = $derived(!arpLaneOn)

  /** "+ Add track" for a Chords-tab voice: switch it on and build the lane. */
  function addChordVoiceTrack(voice: ChordMachineVoice): void {
    setChordLane(voice, true)
    selectLane(voice === 'keys' ? 'chord-machine' : 'arp-machine')
    // `reload()` builds the lane from the plan. Record the new signature first
    // so the watcher below doesn't ALSO schedule a refresh for the same edit.
    lastChordJamSig = null
    void reload()
  }

  /** Which machine editor is open, if any — drives the bottom dock. */
  const openEditor = $derived<'drum' | 'bass' | 'barbro-bass' | 'keys' | 'arp' | null>(
    playbackMode
      ? null
      : selectedLaneKey === 'drum-machine' && $songMap?.drumMachine
        ? 'drum'
        : selectedLaneKey === 'bass-machine' && $songMap?.bassMachine
          ? 'bass'
          : // BarBro Bass opens the BAND panel (detect / feel / timing / sound),
            // which is where its controls live — it had no case at all, so
            // clicking the lane did nothing.
            selectedLaneKey === 'bass-gen' && $songMap?.bassMidi
            ? 'barbro-bass'
          : // The chord voices have no `.smap` entry to check — the lane
            // existing IS the switch, and it's driven by `chordJam`.
            selectedLaneKey === 'chord-machine'
            ? 'keys'
            : selectedLaneKey === 'arp-machine'
              ? 'arp'
              : null,
  )
  function toggleRig(): void {
    showRig = !showRig
    setLsBool('barbro::mixer::rig', showRig)
  }

  /** Pull the current saved state for one track-key from songMap. */
  function savedFor(key: string): MixTrackState | undefined {
    return $songMap?.mixState?.tracks.find((t) => t.key === key)
  }

  // ── Live-button links ────────────────────────────────────────────────────
  /**
   * Which live BUTTON each track is on, when the user has said so explicitly.
   * A track with no entry falls back to the name-based guess, so songs nobody
   * has configured behave exactly as before. Several tracks may share a slot —
   * that is the point: one button, a whole group (drums + percussion).
   *
   * Kept beside the engine rather than inside it: this is configuration, not
   * audio state. Seeded from `mixState` on load and saved back with it.
   */
  let liveSlotByKey = $state<Record<string, LiveSlotLink>>({})

  /** Picker options: every live button, plus "off the buttons". */
  const LIVE_SLOT_OPTIONS = [
    { value: 'none', label: '— none' },
    ...CANONICAL_LIVE_SLOTS.map((name, i) => ({
      value: name,
      label: `${i + 1} ${LIVE_SLOT_LABELS[name]}`,
    })),
  ]

  /**
   * The 10 fixed slots, each holding every lane linked to it.
   *
   * `click` is filtered out of `lanes` (it has no mixer strip) and `cue` is
   * scheduled rather than being a normal lane — but both are canonical live
   * buttons, so they are added back here. Without this their buttons read as
   * "this song hasn't got one" and could never be switched on from the stage.
   */
  const liveSlotLanes = $derived(
    resolveLiveSlotLanes([
      ...lanes.map((l) => ({ key: l.key, liveSlot: liveSlotByKey[l.key] })),
      { key: 'click', liveSlot: liveSlotByKey['click'] },
      { key: 'cue', liveSlot: liveSlotByKey['cue'] },
    ]),
  )

  /** What a lane's picker shows — explicit setting, else the guess. */
  function slotLinkFor(key: string): LiveSlotLink {
    return effectiveSlotLink(key, liveSlotByKey[key])
  }

  /** Re-link a track to a live button (or off the buttons entirely). */
  function onChangeLiveSlot(key: string, link: LiveSlotLink) {
    liveSlotByKey = { ...liveSlotByKey, [key]: link }
    schedulePersist()
  }

  /** True when this mixer is showing a live/performance surface (the playback
   *  page, or the editor's playback-mode toggle) rather than the arranging mixer. */
  function inPlaybackContext(): boolean {
    return initialPlaybackMode || lockPlaybackMode || playbackMode
  }

  /** Initial mute for a lane. Live/playback mode ignores the saved arranging
   *  mix and starts from the PROJECT-WIDE standard-stem default
   *  (`defaults.liveStems`, e.g. `['drums','bass']` for a gig with no live
   *  rhythm section) — the chosen stems audible, the rest muted — so the whole
   *  set opens from one backing-track config regardless of editing-time
   *  solos/mutes. `liveStems` unset = legacy behavior (all stems except vocals).
   *  The `original` full mix stays muted while audible stems cover the song, but
   *  falls back to audible when the song lacks the selected stems so it is never
   *  silent on stage. Non-stem lanes (click / cue / generated band) keep their
   *  saved default. */
  function initialMutedFor(
    key: string,
    saved: MixTrackState | undefined,
    liveStems: AutoStemName[] | undefined,
    hasAudibleStem: boolean,
  ): boolean {
    if (inPlaybackContext()) {
      return liveInitialMuted({
        key,
        liveSlot: liveSlotByKey[key],
        savedMuted: !!saved?.muted,
        liveStems,
        hasMusicalSlotLane: hasAudibleStem,
      })
    }
    return !!saved?.muted
  }

  function nextColor(): string {
    return LANE_COLORS[lanes.length % LANE_COLORS.length]!
  }

  /**
   * Tracks that PLAY but are not shown as mixer rows. A click isn't a musical
   * part you balance against the band — it's a metronome. It stays in the
   * engine so it sounds and stays sample-aligned; the transport's Click
   * checkbox turns it on and off.
   */
  const HIDDEN_LANE_KEYS = new Set(['click'])

  // ── Effect busses ─────────────────────────────────────────────────────────
  // The `.smap` DECLARES busses and their routing; this keeps the audio graph
  // matching that declaration. Inserts are cached per bus id so tweaking a
  // parameter updates the live node instead of rebuilding the graph (which
  // clicks), and so a lane reload doesn't cost a new reverb tail.

  // The rack builder lives in `$lib/audio/effectRack` so it can be tested
  // directly — a missing series connection there silences every multi-effect
  // bus, and that is not something a test should have to re-implement to check.
  const busInserts = new Map<string, EffectRack>()

  const effectBusses = $derived<EffectBus[]>($songMap?.effectBusses ?? [])

  /** Make the audio graph match the declared busses. Safe to run repeatedly. */
  function syncEffectBusses(): void {
    const eng = engine
    if (!eng) return
    const declared = new Set(effectBusses.map((b) => b.id))

    for (const [id, rack] of busInserts) {
      if (declared.has(id)) continue
      teardownEffectRack(rack)
      eng.removeBus(id)
      busInserts.delete(id)
    }

    for (const bus of effectBusses) {
      let entry = busInserts.get(bus.id)
      // Adding, removing, reordering or bypassing an effect changes the GRAPH,
      // so that rack is rebuilt. Merely retuning one does not — see below.
      // `MixerEngine.setBus` re-taps every send at the new chain input, so a
      // rebuild is gapless and needs no re-seek.
      if (entry && entry.shape !== chainShapeKey(bus)) {
        teardownEffectRack(entry)
        busInserts.delete(bus.id)
        entry = undefined
      }
      if (!entry) {
        entry = buildEffectRack(eng.ac, bus)
        busInserts.set(bus.id, entry)
      } else {
        // Same shape → retune each effect in place, so dragging a reverb's size
        // is heard immediately instead of restarting the bus.
        retuneEffectRack(entry, bus)
      }
      eng.setBus({
        key: bus.id,
        label: bus.label,
        chain: entry.chain,
        level: bus.level,
        muted: bus.muted,
      })
      // Routing: every declared send on, everything else off.
      const laneKeys = new Set(eng.listTracks().map((t) => t.key))
      for (const key of laneKeys) {
        eng.setSend(key, bus.id, bus.sends[key] ?? 0)
      }
    }
  }

  $effect(() => {
    // Re-run when the declaration OR the lane set changes.
    void effectBusses
    void lanes
    syncEffectBusses()
  })

  function updateBus(id: string, fn: (b: EffectBus) => EffectBus): void {
    patchSongMap((sm) => ({
      ...sm,
      effectBusses: (sm.effectBusses ?? []).map((b) => (b.id === id ? fn(b) : b)),
    }))
  }

  function addEffectBus(kind: EffectKind): void {
    patchSongMap((sm) => {
      const existing = sm.effectBusses ?? []
      return { ...sm, effectBusses: [...existing, createEffectBus(existing, kind)] }
    })
  }

  function removeEffectBus(id: string): void {
    patchSongMap((sm) => {
      const next = (sm.effectBusses ?? []).filter((b) => b.id !== id)
      return { ...sm, effectBusses: next.length ? next : undefined }
    })
    if (selectedBusId === id) selectedBusId = null
  }

  // The bottom dock shows ONE thing. Selecting a bus closes a track editor and
  // vice versa — two stacked docks is both ugly and ambiguous about which
  // thing the controls belong to.
  let selectedBusId = $state<string | null>(null)
  function selectBus(id: string | null): void {
    selectedBusId = id
    if (id) selectedLaneKey = null
  }
  function selectLane(key: string | null): void {
    selectedLaneKey = key
    if (key) selectedBusId = null
  }
  function onMachineLaneSectionSelect(key: string, sectionId: string): void {
    if (key === 'drum-machine') drumMachineScope = sectionId
    else if (key === 'bass-machine') bassMachineScope = sectionId
    else return
    selectLane(key)
  }
  const selectedBus = $derived(effectBusses.find((b) => b.id === selectedBusId) ?? null)
  /** Which pane of the mixer is showing: the channels, or the effect busses. */
  let mixerTab = $state<'tracks' | 'effects'>('tracks')

  function syncLanesFromEngine() {
    if (!engine) return
    // The click is hidden from `lanes`, so its switch state has to be pulled
    // from the engine explicitly or the two drift — see `clickMuted`. A song
    // with no beats has no click track at all, and then the switch means
    // nothing rather than "off".
    const clickTrack = engine.listTracks().find((t) => t.key === 'click')
    clickMuted = clickTrack ? clickTrack.muted : false
    clickLaneReady = !!clickTrack
    const tracks = engine.listTracks().filter((t) => !HIDDEN_LANE_KEYS.has(t.key))
    const byKey = new Map(tracks.map((t) => [t.key, t]))
    const ordered = sortBySavedOrder(
      tracks.map((t) => t.key),
      laneOrder,
    )
    lanes = ordered.flatMap((key, i) => {
      const t = byKey.get(key)
      if (!t) return []
      return [
        {
          key: t.key,
          label: t.label,
          // The original mix is the reference every other lane is heard
          // against, so it gets its own colour rather than a rotation slot.
          color: t.key === 'original' ? ORIGINAL_LANE_COLOR : LANE_COLORS[i % LANE_COLORS.length]!,
          buffer: t.buffer ?? null,
          isInstrument: !!t.instrument,
          midiVisual: t.instrument?.visual?.() ?? null,
          sourceDurationSec: t.buffer?.duration ?? t.instrument?.durationSec ?? 0,
          volume: t.volume,
          muted: t.muted,
          soloed: t.soloed,
          matchGainDb: matchGainDbFor(t.key, t.buffer ?? null),
        },
      ]
    })
  }

  /**
   * The automatic gain loudness-matching is applying to this lane right now.
   *
   * Reads the SAME measurement the audio chain uses (the cached buffer RMS),
   * so the number on screen cannot drift from the number being heard. Zero
   * when matching is off, the lane is not a separated stem, or it has no
   * buffer to measure.
   */
  function matchGainDbFor(key: string, buffer: AudioBuffer | null): number {
    if (!buffer) return 0
    const cfg = get(projectStore).data?.mastering
    if (!cfg?.enabled || !cfg.matchLoudness || soundBypassed) return 0
    const kind = stemKindForLaneKey(key)
    if (!kind) return 0
    let rms = laneRms.get(buffer)
    if (rms === undefined) {
      rms = bufferRmsDb(buffer)
      laneRms.set(buffer, rms)
    }
    return loudnessMatchGainDb(kind, rms)
  }

  // ── Lane order (drag to reorder; the original mix is pinned at the top) ───
  /** Remembered key order, seeded from `mixState.tracks` and saved back to it. */
  let laneOrder = $state<string[]>([])
  /** The lane being dragged, and the lane it is currently over. */
  let draggingKey = $state<string | null>(null)
  let dropTargetKey = $state<string | null>(null)

  function onLaneDragStart(key: string) {
    draggingKey = key
  }
  function onLaneDragOver(key: string) {
    if (draggingKey && key !== draggingKey) dropTargetKey = key
  }
  function onLaneDragEnd() {
    draggingKey = null
    dropTargetKey = null
  }
  function onLaneDrop(key: string) {
    const from = draggingKey
    onLaneDragEnd()
    if (!from) return
    laneOrder = moveKey(
      lanes.map((l) => l.key),
      from,
      key,
    )
    syncLanesFromEngine()
    schedulePersist()
  }

  /** Compute the silence-prepend each source needs so all tracks share t=0. */
  function computePrepend(forKey: string): number {
    const sm = get(songMap)
    if (!sm) return 0
    // Cue + click tracks already contain the preamble silence inside their
    // buffers — same render, just speech vs no-speech — so they play at t=0
    // of their own buffer. Stems + original get the same preamble of silence
    // prepended so musical time aligns: the cue's "beat 1" sits at the same
    // mix-timeline second as each stem's `trim.startSec` sample.
    if (laneHasPrebakedPreamble(forKey)) return 0
    const preludeSec = titleCuePreludeSec(sm, getPrimaryCueTrack(sm))
    let prependSec = 0
    const countInBeats = effectiveCountInBeats(sm)
    if (countInBeats > 0) {
      const ci = computeCountIn(sm, countInBeats)
      if (ci) prependSec = ci.prependSec
    }
    const trimStart = sm.audio?.trim?.startSec ?? 0
    // Offset: cue's beat-1 moment = preludeSec + prependSec. That should
    // line up with stem time = trimStart. So stem needs to start
    // `(preludeSec + prependSec) - trimStart` seconds after t=0.
    const offset = preludeSec + prependSec - trimStart
    return Math.max(0, offset)
  }

  function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n))
  }

  function pushChordSegment(
    segments: ChordTimelineSegment[],
    next: Omit<ChordTimelineSegment, 'id'>,
  ): void {
    if (next.endSec - next.startSec <= 0.01) return
    const last = segments.at(-1)
    if (
      last &&
      last.label === next.label &&
      last.hasChord === next.hasChord &&
      Math.abs(last.endSec - next.startSec) < 0.05
    ) {
      last.endSec = next.endSec
      return
    }
    segments.push({ ...next, id: `${segments.length}:${next.startSec.toFixed(3)}:${next.label}` })
  }

  const mixerSongOffsetSec = $derived.by(() => {
    if (!$songMap) return 0
    return computePrepend('original')
  })

  const songTitle = $derived($songMap?.metadata.title?.trim() || 'Untitled song')
  /**
   * The offset comes from the STORE, not from a prop.
   *
   * It used to fall back to `effectiveTransposeSemitones($songMap)`, which reads
   * `transpose.baseSemitones` — a field written nowhere in the app, so the
   * fallback was always 0. Any surface that forgot the prop (Overview, and the
   * live stage, which passes none) silently played at concert pitch.
   *
   * The override is kept only for hosts that must force a value, such as tests.
   */
  // The store is per-song; keep it pointed at the song this mixer is showing.
  // The live stage relies on this: it passes no transpose props at all.
  $effect(() => {
    void $songMap
    void $projectStore.activeSongId
    transposeSettings.loadForCurrentSong()
  })

  const transposeSemitones = $derived(
    transposeSemitonesOverride == null
      ? transposeSettings.semitones
      : clampTransposeSemitones(transposeSemitonesOverride),
  )
  /**
   * TRANSPOSE — the mixer applies it to its OWN engine.
   *
   * Deliberately computed from this component's `transposeSemitones` plus the
   * persisted per-device preferences, NOT by mirroring the edit route's
   * `transport` singleton. Mirroring a live singleton is what let a stale
   * personal setting make the mixer play slow without anyone asking; reading
   * the same saved preference the user set is the thing they actually want,
   * which is for a transposed song to sound transposed here too.
   *
   * `tempoHold` is the artifacts-vs-slowdown dial: 0 = pure varispeed (perfect
   * quality, the song gets faster/slower), 1 = the worklet does all the pitch
   * work and the tempo is held. In between it only shifts the residual.
   */
  // Same story: the switch and the dial live in the store. The props remain as
  // forced overrides for hosts that need one.
  const varispeedAudio = $derived(varispeedAudioProp ?? transposeSettings.varispeedAudio)
  const tempoHold = $derived(tempoHoldProp ?? transposeSettings.tempoHold)

  const transposePlan = $derived(transposeSettings.planFor(transposeSemitones, varispeedAudio, tempoHold))

  /**
   * Rebuild the PITCHED lanes when the transpose changes.
   *
   * The stems follow the transpose for free (the engine's playback rate), but a
   * MIDI lane's notes are baked into its part when the lane is built, so
   * without this the bass and chord voices keep playing in the OLD key while
   * everything else moves — the worst possible outcome.
   *
   * Drums are deliberately absent: they are never transposed, by note or by
   * pitch. See `drumTransposeImmunity.browser.test.ts`.
   */
  const PITCHED_MACHINE_LANES = ['bass-machine', 'bass-gen', 'chord-machine', 'arp-machine']
  let lastTransposeSemis: number | null = null
  $effect(() => {
    const semis = transposeSemitones
    const prev = lastTransposeSemis
    lastTransposeSemis = semis
    // First run is the baseline: the initial load already built these lanes at
    // the current transpose.
    if (prev === null || prev === semis || loading) return
    for (const key of PITCHED_MACHINE_LANES) {
      if (lanes.some((l) => l.key === key)) machineRefreshQueue.schedule(key)
    }
  })

  let shifter: LivePitchShifter | null = null
  let shifterPending: Promise<LivePitchShifter | null> | null = null

  // Push the plan into the engine — a non-reactive sink, which is what $effect
  // is for. Recomputed from the SEMITONE every time, never by composing rates.
  $effect(() => {
    const plan = transposePlan
    // `engineReady` is $state; `engine` is a plain `let` and therefore NOT
    // reactive. Reading only `engine` meant this ran once at mount while it was
    // still null and never again — so a song opened with a transpose already
    // set never had the rate applied at all.
    if (!engineReady) return
    const eng = engine
    if (!eng) return
    eng.setPlaybackRate(plan.rate)
    if (plan.shiftSemitones === 0) {
      // An inert worklet still costs its latency, and at zero shift the whole
      // point is that playback is the untouched original.
      eng.setAudioPitchShiftNode(null)
      return
    }
    void (async () => {
      if (!shifter) {
        shifterPending ??= createLivePitchShifter(eng.ac, 2)
        shifter = await shifterPending
        if (!shifter) return // no worklet here — stay on pure varispeed
      }
      // Re-read: the offset may have changed while the node was being created.
      const live = untrack(() => transposePlan)
      if (live.shiftSemitones === 0) {
        eng.setAudioPitchShiftNode(null)
        return
      }
      shifter.setSemitones(live.shiftSemitones)
      // RECORDED AUDIO ONLY. A MIDI lane's notes already carry the full
      // transpose; sending it through here too would put it `n × tempoHold`
      // semitones out of tune with the stems.
      // Pass the latency too: MIDI lanes bypass the shifter, so without this
      // they run EARLY by exactly this much against the stems.
      eng.setAudioPitchShiftNode(shifter.node, shifter.latencySec)
    })()
  })

  const displayedSongKey = $derived(
    $songMap?.metadata.keyDetail ? transposeSongKey($songMap.metadata.keyDetail, transposeSemitones) : null,
  )
  const songKeyLabel = $derived(displayedSongKey ? formatSongKeyLabel(displayedSongKey) : 'No key')
  const songBpmLabel = $derived(
    $songMap?.metadata.bpm != null ? `${Math.round($songMap.metadata.bpm)} BPM` : 'No BPM',
  )
  const projectSongNavItems = $derived.by(() => {
    const project = $projectStore.data
    if (!project) return []
    return project.songs
      .filter((entry) => !entry.hidden)
      .map((entry) => ({
        id: entry.id,
        title: $projectStore.metadataByFolder[entry.folder]?.title?.trim() || 'Untitled song',
      }))
  })
  const activeProjectSongIndex = $derived(
    projectSongNavItems.findIndex((entry) => entry.id === $projectStore.activeSongId),
  )
  const projectSongSwitchAvailable = $derived(activeProjectSongIndex >= 0 && !projectSongSwitching)
  const canGoPreviousProjectSong = $derived(projectSongSwitchAvailable && activeProjectSongIndex > 0)
  const canGoNextProjectSong = $derived(
    projectSongSwitchAvailable && activeProjectSongIndex < projectSongNavItems.length - 1,
  )

  const chordTimelineSegments = $derived.by<ChordTimelineSegment[]>(() => {
    const sm = $songMap
    const durationSec = mixerDurationSec
    if (!sm || !(durationSec > 0)) return []

    const beats = sortBeatsByTime(sm.timeline.beats)
    if (beats.length === 0) {
      return [
        {
          id: 'no-grid',
          label: NO_CHORD_LABEL,
          startSec: 0,
          endSec: durationSec,
          hasChord: false,
        },
      ]
    }

    const segments: ChordTimelineSegment[] = []
    const offset = mixerSongOffsetSec
    const firstBeatStart = beats[0]!.timeSec + offset
    if (firstBeatStart > 0) {
      pushChordSegment(segments, {
        label: NO_CHORD_LABEL,
        startSec: 0,
        endSec: Math.min(firstBeatStart, durationSec),
        hasChord: false,
      })
    }

    const resolved = resolveChordAtEachBeat(sm)
    const key = displayedSongKey
    const preferFlats = key ? songKeyPreferFlats(key) : false
    // Bars with OFF-GRID (fraction) chords are rendered from those chords below,
    // so skip their per-beat segments here.
    const offGridBarIds = new Set(sm.harmony.filter((h) => h.barFraction != null).map((h) => h.barId))
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i]!
      if (offGridBarIds.has(beat.barId)) continue
      const nextBeat = beats[i + 1]
      const startSec = beat.timeSec + offset
      const endSec = nextBeat ? nextBeat.timeSec + offset : durationSec
      if (endSec <= 0 || startSec >= durationSec) continue

      const chord = resolved.get(beat.id)
      const displayedChord = chord
        ? transposeChordForDisplay(chord, transposeSemitones, key ?? undefined)
        : null
      pushChordSegment(segments, {
        label: displayedChord ? formatChordSymbol(displayedChord, { preferFlats }) : NO_CHORD_LABEL,
        startSec: clamp(startSec, 0, durationSec),
        endSec: clamp(endSec, 0, durationSec),
        hasChord: !!chord,
      })
    }

    // Off-grid (fraction) chords: emit one segment each, then merge into the
    // timeline by start time (the skipped beat-bars leave exactly their slots).
    for (const h of sm.harmony) {
      if (h.barFraction == null) continue
      const s = clamp(h.startSec + offset, 0, durationSec)
      const e = clamp(h.endSec + offset, 0, durationSec)
      if (e - s <= 0.01) continue
      const disp = transposeChordForDisplay(h.chord, transposeSemitones, key ?? undefined)
      segments.push({
        id: `frac:${h.id}`,
        label: formatChordSymbol(disp, { preferFlats }),
        startSec: s,
        endSec: e,
        hasChord: true,
      })
    }
    segments.sort((a, b) => a.startSec - b.startSec)

    if (segments.length === 0) {
      pushChordSegment(segments, {
        label: NO_CHORD_LABEL,
        startSec: 0,
        endSec: durationSec,
        hasChord: false,
      })
    } else {
      segments[segments.length - 1]!.endSec = durationSec
    }

    return segments
  })

  const currentChordSegmentIndex = $derived.by(() => {
    const segments = chordTimelineSegments
    if (segments.length === 0) return -1
    const pos = clamp(snapshot.positionSec, 0, Math.max(mixerDurationSec, 0))
    const idx = segments.findIndex((seg, i) => {
      const isLast = i === segments.length - 1
      return pos >= seg.startSec - 1e-6 && (pos < seg.endSec - 1e-6 || isLast)
    })
    return idx >= 0 ? idx : 0
  })

  const currentChordSegment = $derived(
    currentChordSegmentIndex >= 0 ? chordTimelineSegments[currentChordSegmentIndex] : null,
  )
  const currentChordLabel = $derived(currentChordSegment?.label ?? NO_CHORD_LABEL)
  const currentChordProgressPct = $derived.by(() => {
    const seg = currentChordSegment
    if (!seg) return 0
    const span = seg.endSec - seg.startSec
    if (!(span > 0)) return 0
    return clamp(((snapshot.positionSec - seg.startSec) / span) * 100, 0, 100)
  })
  const currentChordRemainingLabel = $derived.by(() => {
    const seg = currentChordSegment
    if (!seg) return fmtTime(0)
    return fmtTime(Math.max(0, seg.endSec - snapshot.positionSec))
  })
  // Phone live "chord row": current chord + next 3. Next-3 (not 1) so a fast run
  // of chords is readable; harmless when it's one chord per bar.
  const mobileChordRow = $derived(upcomingChordRow(chordTimelineSegments, snapshot.positionSec, 3))
  // Stable rows from ABSOLUTE chord times so chords don't jump vertically when
  // the front one is consumed. Recomputed only when the chord data changes.
  const chordRowById = $derived.by(() => {
    const MIN_GAP_SEC = 0.9
    const MAX_ROWS = 3
    const rows = new Map<string, number>()
    const rowEndTime: number[] = []
    for (const seg of [...chordTimelineSegments]
      .filter((s) => s.hasChord)
      .sort((a, b) => a.startSec - b.startSec)) {
      const end = seg.startSec + Math.max(seg.endSec - seg.startSec, MIN_GAP_SEC)
      let row = rowEndTime.findIndex((t) => seg.startSec >= t)
      if (row === -1) row = Math.min(rowEndTime.length, MAX_ROWS - 1)
      rowEndTime[row] = end
      rows.set(seg.id, row)
    }
    return rows
  })
  const chordApproachViews = $derived.by<ChordApproachView[]>(() => {
    const approachWindowSec = CHORD_APPROACH_WINDOW_SEC
    const now = snapshot.positionSec
    const views = chordTimelineSegments
      .filter((seg) => seg.hasChord)
      .filter((seg) => seg.endSec > now + 1e-6 && seg.startSec < now + approachWindowSec - 1e-6)
      .map((seg) => {
        const startDistanceSec = seg.startSec - now
        const endDistanceSec = seg.endSec - now
        const distanceSec = Math.max(0, startDistanceSec)
        const active = startDistanceSec <= 0 && endDistanceSec > 0
        const closeness = clamp(1 - distanceSec / approachWindowSec, 0, 1)
        const leftPct = clamp((Math.max(0, startDistanceSec) / approachWindowSec) * 100, 0, 100)
        const endPct = clamp((Math.max(0, endDistanceSec) / approachWindowSec) * 100, leftPct, 100)
        const widthPct = endPct - leftPct
        return {
          ...seg,
          startsInLabel: active ? 'now' : fmtTime(distanceSec),
          distanceSec,
          leftPct,
          widthPct,
          opacity: active ? 1 : 0.45 + closeness * 0.55,
          urgent: !active && distanceSec < 2,
          active,
          row: chordRowById.get(seg.id) ?? 0,
        }
      })
      .filter((seg) => seg.active || seg.widthPct > 0.2)
    return views
  })
  const nextChordView = $derived(chordApproachViews.find((seg) => !seg.active) ?? null)
  const currentChordHeading = $derived(transportState === 'playing' ? 'Playing chord' : 'Current chord')

  const sectionTimelineRanges = $derived.by<SectionTimelineRange[]>(() => {
    const sm = $songMap
    const durationSec = mixerDurationSec
    if (!sm || !sm.sections?.length || !sm.timeline.bars.length || !(durationSec > 0)) return []
    const offset = mixerSongOffsetSec
    const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]))
    const out: SectionTimelineRange[] = []
    // NOTE: sm.sections is NOT stored in song order. This array is the ONE
    // canonical mapping that drives the APC pad grid (LED colours AND presses,
    // both via padToSection over THIS array), so it must be chronological and
    // stable — otherwise a pad's colour and where it jumps you disagree.
    for (const section of sm.sections) {
      const startBar = barByIndex.get(section.barRange.startBarIndex)
      const endBar = barByIndex.get(section.barRange.endBarIndex)
      if (!startBar || !endBar) continue
      const startSec = clamp(startBar.startSec + offset, 0, durationSec)
      const endSec = clamp(endBar.endSec + offset, 0, durationSec)
      if (endSec <= startSec) continue
      out.push({
        id: section.id,
        label: section.label,
        kind: section.kind,
        startSec,
        endSec,
        index: 0, // set below, after sorting, to the canonical position
      })
    }
    // Chronological by start time, then index === array position so the pad
    // grid reads top-left → bottom-right in song order and never shifts.
    out.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
    out.forEach((r, i) => (r.index = i))
    return out
  })

  const currentSectionRange = $derived.by(() => {
    const pos = snapshot.positionSec
    return (
      sectionTimelineRanges.find((section, i) => {
        const isLast = i === sectionTimelineRanges.length - 1
        return pos >= section.startSec - 1e-6 && (pos < section.endSec - 1e-6 || isLast)
      }) ?? null
    )
  })

  /** Colour of the section under the playhead (falls back to the studio accent). */
  const currentSectionColor = $derived(
    currentSectionRange ? sectionKindColor(currentSectionRange.kind) : 'var(--studio-orange)',
  )

  const repeatSectionRange = $derived.by(() => {
    if (!repeatSectionEnabled || !repeatSectionId) return null
    return sectionTimelineRanges.find((section) => section.id === repeatSectionId) ?? null
  })

  const repeatSectionButtonLabel = $derived.by(() => {
    if (repeatSectionRange) return `Repeat ${repeatSectionRange.label}`
    if (currentSectionRange) return `Repeat ${currentSectionRange.label}`
    return 'Repeat section'
  })
  const replayOnceSectionRange = $derived.by(() => {
    if (!replayOnceSectionId) return null
    return sectionTimelineRanges.find((section) => section.id === replayOnceSectionId) ?? null
  })
  const replayOnceButtonLabel = $derived.by(() => {
    if (replayOnceSectionRange) {
      return replayOnceConsumed ? `Replaying ${replayOnceSectionRange.label}` : `Replay ${replayOnceSectionRange.label} once`
    }
    if (currentSectionRange) return `Replay ${currentSectionRange.label} once`
    return 'Replay once'
  })

  const stageWaveformLane = $derived(
    lanes.find((lane) => lane.key === 'original') ??
      lanes.find((lane) => lane.key.startsWith('stem:') && lane.buffer) ??
      lanes.find((lane) => lane.buffer) ??
      null,
  )

  const laneLights = $derived.by<LaneLight[]>(() => {
    const anySoloed = lanes.some((lane) => lane.soloed)
    // Reads the DISCRETE `transportState`, not `snapshot.positionSec`, so this
    // (and everything it feeds — lane pills, canonical stem slots, APC LEDs) is
    // recomputed only on play/pause + mute/solo/volume, NOT 60×/s.
    return lanes.map((lane) => {
      const audible =
        transportState === 'playing' &&
        (!!lane.buffer || lane.isInstrument) &&
        lane.volume > 0.001 &&
        !lane.muted &&
        (!anySoloed || lane.soloed)
      return {
        key: lane.key,
        label: lane.label.replace(/\s+·\s+.+$/, ''),
        color: lane.color,
        active: audible,
        muted: lane.muted,
      }
    })
  })

  const liveHardwareLanes = $derived(
    lanes.map((lane) => ({
      key: lane.key,
      label: lane.label,
      volume: lane.volume,
      muted: lane.muted,
      soloed: lane.soloed,
    })),
  )

  /**
   * The lanes the DESK needs to know about — which is not the same set the
   * mixer shows.
   *
   * `lanes` has click filtered out by `HIDDEN_LANE_KEYS` (it is driven by the
   * transport's Click checkbox, not by a mixer strip) and has never contained
   * cue at all. That filtering had a consequence nobody intended: the XR18
   * routing table had no click or cue row, so `xairFohSafetyPlan` emitted
   * NOTHING and the front-of-house check passed having examined nothing —
   * while click was in fact travelling inside the song's own channels, which go
   * to the house.
   *
   * So the desk gets its own list. The mixer UI is untouched.
   */
  const monitorRoutableLanes = $derived([
    ...liveHardwareLanes,
    // Click exists for EVERY analysed song (it is derived from the beat grid,
    // not rendered), so it is always offered to the desk. Its mute follows the
    // transport's Click checkbox.
    { key: 'click', label: 'Click', volume: 1, muted: clickMuted, soloed: false },
    // Cue is not an engine track — it is scheduled straight to its own output by
    // `LiveCueScheduler` — but the desk still needs a strip for it, otherwise
    // spoken cues reach the house.
    { key: 'cue', label: 'Cue', volume: 1, muted: false, soloed: false },
  ])

  // ── Karaoke lyrics (playback mode) ────────────────────────────────────────
  // Word times are ORIGINAL audio time; the mixer timeline adds
  // `mixerSongOffsetSec` (prelude + count-in prepend − trim), so the song-time
  // playhead is `positionSec − mixerSongOffsetSec`. Same conversion the chord
  // segments use — lyrics, chords and waveform stay in lockstep by sharing it.
  type LyricLineView = {
    line: number
    words: { text: string; startSec: number; endSec: number }[]
    startSec: number
    endSec: number
  }
  const lyricLines = $derived.by<LyricLineView[]>(() => {
    const words = $songMap?.lyrics?.words ?? []
    if (words.length === 0) return []
    const byLine = new Map<number, LyricLineView>()
    for (const w of words) {
      const cur = byLine.get(w.line)
      if (cur) {
        cur.words.push(w)
        cur.startSec = Math.min(cur.startSec, w.startSec)
        cur.endSec = Math.max(cur.endSec, w.endSec)
      } else {
        byLine.set(w.line, {
          line: w.line,
          words: [w],
          startSec: w.startSec,
          endSec: w.endSec,
        })
      }
    }
    return [...byLine.values()].sort((a, b) => a.line - b.line)
  })

  /**
   * Forgiveness lead: highlight slightly EARLY. Aligned times mark the sung
   * onset; readers want the word lit a beat before it lands, and a small lead
   * also absorbs alignment error without ever feeling "behind".
   */
  const LYRIC_LEAD_SEC = 0.18
  /** After a line has been over this long, promote the NEXT line to the main slot. */
  const LYRIC_GAP_PROMOTE_SEC = 0.4

  const lyricsSongTime = $derived(snapshot.positionSec - mixerSongOffsetSec + LYRIC_LEAD_SEC)

  /**
   * Index of the line in the MAIN display slot. Usually the line being sung;
   * during instrumental gaps the finished line steps aside and the upcoming
   * line takes the slot (unhighlighted until its first word starts) so the
   * singer preps the entry instead of staring at a stale line.
   */
  const currentLyricIdx = $derived.by(() => {
    const t = lyricsSongTime
    let idx = -1
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i]!.startSec <= t) idx = i
      else break
    }
    if (idx >= 0 && idx < lyricLines.length - 1) {
      const cur = lyricLines[idx]!
      if (t > cur.endSec + LYRIC_GAP_PROMOTE_SEC) return idx + 1
    }
    return idx
  })

  /** A long instrumental gap → the live view shows a countdown, not a stale line. */
  const lyricBreak = $derived(lyricBreakState(lyricLines, lyricsSongTime))

  /**
   * Song sections mapped onto the mixer timeline as fractions [0..1]. Uses the
   * SAME silence offset the stems/original get (`computePrepend('original')`)
   * so the bands line up with the waveforms. Display-only — the shaded bands
   * are groundwork for future per-section stem control.
   */
  const sectionBands = $derived.by<
    { id: string; startFrac: number; endFrac: number; label: string; index: number; color: string }[]
  >(() => {
    const dur = mixerDurationSec
    if (dur <= 0) return []
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
    return sectionTimelineRanges.map((section) => ({
      id: section.id,
      startFrac: clamp01(section.startSec / dur),
      endFrac: clamp01(section.endSec / dur),
      label: section.label,
      index: section.index,
      color: sectionKindColor(section.kind),
    }))
  })

  /** Pretty label for a stem filename — Vocals/Drums/Bass/Other/etc. */
  function labelForStem(filename: string): string {
    const m: Record<string, string> = {
      'vocals.wav': 'Vocals',
      'drums.wav': 'Drums',
      'bass.wav': 'Bass',
      'other.wav': 'Other',
      'guitar.wav': 'Guitar',
      'fx.wav': 'FX',
    }
    return m[filename.toLowerCase()] ?? filename.replace(/\.[^.]+$/, '')
  }

  async function decodeBlob(eng: MixerEngine, blob: Blob): Promise<AudioBuffer> {
    return await eng.ac.decodeAudioData(await blob.arrayBuffer())
  }

  /**
   * The click's samples, rendered AT MOST ONCE per musical state.
   *
   * Keyed by the click fingerprint — the same one that guards the on-disk WAV —
   * so a count-in, start-beat or grid change misses naturally, and a plain
   * song switch or mixer remount is a lookup instead of a full-length offline
   * render. Raw samples, not an AudioBuffer: they stay valid across engine
   * recreations and are copied onto the current context per load.
   */
  async function renderClickCached(
    eng: MixerEngine,
    sm: NonNullable<typeof $songMap>,
    cueTrack: ReturnType<typeof getPrimaryCueTrack>,
  ): Promise<{ data: Float32Array; preludeOffsetSec: number } | null> {
    const key = `${eng.ac.sampleRate}:${fingerprintClickTrackInputs(sm, cueTrack)}`
    const hit = getCachedClickRender(key)
    if (hit) return hit
    try {
      const r = await renderClickTrackData(sm, { cueTrack, sampleRate: eng.ac.sampleRate })
      const entry = { data: new Float32Array(r.data), preludeOffsetSec: r.preludeOffsetSec }
      putCachedClickRender(key, entry)
      return entry
    } catch (e) {
      // NEVER swallow the reason — "The click could not be built" with no
      // cause cost a night of guessing. The message travels to the UI line.
      console.error('[mixer] click render failed:', e)
      lastClickRenderError = e instanceof Error ? e.message : String(e)
      return null
    }
  }
  /** The actual reason the last click render failed — joined to the red line. */
  let lastClickRenderError: string | null = null

  function sourceAudioSubpath(sm: NonNullable<typeof $songMap>): string | null {
    if (sm.audio?.originalPath) return sm.audio.originalPath
    if (sm.audio?.fileName) return `audio/${sm.audio.fileName}`
    return null
  }

  async function loadAndRegisterTracks() {
    if (!engine) return
    // Non-null capture for the async loader closures below — TS narrowing on
    // the outer `let` does not survive into them.
    const eng = engine
    const sm = get(songMap)
    const ps = get(projectStore)
    const sess = get(audioSession)

    type Plan = {
      key: string
      label: string
      /** AUDIO lane: fetch/render a blob to decode. */
      loader?: () => Promise<Blob | null>
      /**
       * SYNTHESIZED lane: produce samples directly, already at the engine's
       * rate. No blob, no `decodeAudioData`, no resample — the whole point.
       * The click uses this; a full-length WAV encode/decode round-trip was
       * costing seconds at the top of every song, in live mode too.
       */
      bufferLoader?: () => Promise<AudioBuffer | null>
      /** MIDI lane: build a live instrument — no render, no decode. */
      instrument?: () => Promise<MidiInstrument | null>
      transposeSrcSubpath?: string | null
    }
    const plan: Plan[] = []

    // Original audio — from the live audioSession (already decoded once into editor).
    if (sess.file) {
      plan.push({
        key: 'original',
        label: 'Original',
        loader: async () => sess.file,
        transposeSrcSubpath: sm ? sourceAudioSubpath(sm) : null,
      })
    }

    // Stems on disk. Multiple renderings can exist tagged by quality
    // preset (`best`/`balanced`/`preview`); pick the highest-quality set
    // available for this song. Lower-quality copies are ignored — they
    // stay on disk but never load into the mixer.
    const folderMeta = ps.osPath && ps.activeSongFolder
      ? ps.metadataByFolder[ps.activeSongFolder]
      : undefined
    const bestStems = selectBestStemSet(folderMeta)
    const primaryCueTrack = sm ? getPrimaryCueTrack(sm) : undefined
    if (bestStems) {
      for (const filename of bestStems.files) {
        const key = `stem:${filename}`
        const baseLabel = labelForStem(filename)
        const label = `${baseLabel} · ${bestStems.preset}`
        const subpath = `${bestStems.pathPrefix}${filename}`
        plan.push({
          key,
          label,
          transposeSrcSubpath: subpath,
          loader: async () => {
            if (!ps.osPath || !ps.activeSongFolder) return null
            const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, subpath)
            return r.ok ? r.blob : null
          },
        })
      }
    }

    // Collab mode (no local folder): stems come from the compressed cloud copy
    // (the `project-audio` bucket) instead of disk. Same lane shape; the loader
    // just fetches the AAC. The failsafe still applies — the fetch throws if
    // Studio mode is somehow active.
    if (!ps.osPath && ps.activeSongId) {
      const songId = ps.activeSongId
      const { getBrowserCloudAudio } = await import('$lib/client/browserCloudProject')
      const ca = getBrowserCloudAudio(songId)
      if (ca?.stems && Object.keys(ca.stems).length > 0) {
        const { fetchCloudAudioBlob, cloudAudioCacheKey } = await import('$lib/client/cloudAudio')
        const { desktopCompanionStatus } = await import('$lib/stores/desktopCompanionStatus')
        const reachable = get(desktopCompanionStatus).reachable
        for (const [stemName, obj] of Object.entries(ca.stems)) {
          plan.push({
            key: `stem:${stemName}`,
            label: stemName,
            transposeSrcSubpath: null,
            loader: async () =>
              await fetchCloudAudioBlob({
                sidecarReachable: reachable,
                // Browser-cloud stems (no local folder) — the failsafe must not
                // block them when the sidecar is running.
                localProjectPresent: false,
                path: obj.path,
                cacheKey: cloudAudioCacheKey({
                  songId,
                  sourceSha256: ca.sourceSha256,
                  kind: `stem:${stemName}`,
                }),
              }).catch(() => null),
          })
        }
      }
    }

    // NO baked cue lane in the mixer. Spoken cues here are played by the live
    // dynamic scheduler (fired on approach AND on launch) — the single cue
    // system. The baked cue WAV is still rendered to disk for Ableton/setlist
    // export, but playing it here too would double with the dynamic cue.

    // Click track (clicks only). Always present for a song with beats —
    // either fetched from disk WHEN THE CACHE IS FRESH, or synthesized
    // client-side from the current SongMap. The user never has to "render".
    //
    // Freshness check: `sm.clickExport` is auto-cleared on fingerprint
    // mismatch (see `stores/songMap.ts`), so its presence is the source-of-
    // truth that the disk WAV matches the current count-in / start-beat /
    // beat-grid. The on-disk file lingers when stale (we don't delete it
    // proactively) — so loading by file-existence alone gives back a stale
    // click track that drifts from the live beat grid. Synthesize instead.
    if (sm && sm.timeline.beats.length > 0) {
      plan.push({
        key: 'click',
        label: 'Click',
        // Straight to samples, at the engine's own rate. The old path went
        // synthesize → encode a ~20 MB WAV → `decodeAudioData` → resample
        // 44.1 → 48 kHz — seconds of work to get back data we had already.
        // The disk WAV cache is deliberately NOT read here either: reading and
        // decoding a full-length file is slower than synthesizing, and the
        // cache keeps serving what it exists for (Ableton export).
        bufferLoader: async () => {
          try {
            const r = await renderClickCached(eng, sm, primaryCueTrack)
            if (!r) return null
            const buf = eng.ac.createBuffer(1, r.data.length, eng.ac.sampleRate)
            // Fresh copy pins the backing store to a plain ArrayBuffer, which
            // is what `copyToChannel` is typed for.
            buf.copyToChannel(new Float32Array(r.data), 0)
            return buf
          } catch {
            return null
          }
        },
      })
    }

    // BarBro's generated drum track — present whenever drum hits have been
    // detected. Prefers the saved render (its presence == fingerprint-fresh,
    // same auto-drop contract as clickExport); otherwise synthesizes from
    // the events in memory (fast, no network).
    if (showBand && sm && sm.drumMidi && sm.drumMidi.events.length > 0) {
      const dmRel = sm.drumMidi.renderExport?.relativePath
      // "Your kit" always re-synthesizes: the render fingerprint can't see
      // the user's sample FILES change, so a saved render is never trusted.
      const kitIsCustom = sm.drumMidi.kit === 'custom'
      plan.push({
        key: 'drums-gen',
        label: 'BarBro Drums',
        loader: async () => {
          if (!kitIsCustom && dmRel && ps.osPath && ps.activeSongFolder) {
            const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, dmRel)
            if (r.ok) return r.blob
          }
          try {
            const custom =
              kitIsCustom && ps.osPath ? await loadProjectDrumKit(ps.osPath) : null
            const r = await renderDrumTrackWavBlob(sm, custom ? { customKit: custom.kit } : {})
            return r.blob
          } catch {
            return null
          }
        },
      })
    }

    // The programmed drum machine — its own lane, independent of the detected
    // drum track above. A song can carry both at once, like tracks in a DAW.
    // Always re-synthesized: the part is derived from settings + timeline, so
    // it must follow bar/beat/section edits rather than trust a stale render.
    if (showBand && sm && sm.drumMachine?.enabled) {
      plan.push({
        key: 'drum-machine',
        label: 'Drum Machine',
        // MIDI, not a render: the part is scheduled live, so changing the kit
        // or the pattern costs a re-schedule instead of a full WAV round trip.
        instrument: async () => {
          try {
            return await createDrumMachineInstrument(engine!.ac, sm, await resolveDrumMachineKit(sm))
          } catch (e) {
            console.warn('drum machine instrument failed', e)
            return null
          }
        },
      })
    }

    // BarBro's generated bass track — same contract as the drums lane. No
    // `transposeSrcSubpath`: when the song is transposed we shift the NOTES
    // and re-synthesize — exact pitch, no stretch artifacts — so the loaded
    // buffer must not be pitch-shifted again. The saved render is at written
    // pitch and only trusted untransposed.
    if (showBand && sm && sm.bassMidi && sm.bassMidi.events.length > 0) {
      const bmRel = sm.bassMidi.renderExport?.relativePath
      // NOTE transpose, not audio pitch-shift — so it is NOT gated on
      // `transposeAudioEnabled`. This lane is rendered from MIDI, so moving the
      // notes is exact and costs nothing in quality.
      const bassSemis = transposeSemitones
      plan.push({
        key: 'bass-gen',
        label: 'BarBro Bass',
        // MIDI, like the bass machine: the detected line is scheduled live, so
        // changing its sound costs a re-schedule instead of a full re-render.
        // The saved WAV on disk stays what the Ableton export uses.
        instrument: async () => {
          try {
            return await createDetectedBassInstrument(engine!.ac, sm, bassSemis)
          } catch (e) {
            console.warn('detected bass instrument failed', e)
            return null
          }
        },
      })
    }

    // The programmed bass machine — its own lane, independent of the detected
    // bass above. Always re-synthesized: the line is derived from the CHORDS,
    // so it must follow harmony edits rather than trust a stale render.
    if (showBand && sm && sm.bassMachine?.enabled) {
      plan.push({
        key: 'bass-machine',
        label: 'Bass Machine',
        // MIDI, like the drum machine: the line is scheduled live, so changing
        // the sound or the pattern costs a re-schedule, not a render.
        instrument: async () => {
          try {
            return await createBassMachineInstrument(engine!.ac, sm, transposeSemitones)
          } catch (e) {
            console.warn('bass machine instrument failed', e)
            return null
          }
        },
      })
    }

    // The Chords-tab voices as real lanes. Unlike the drum and bass machines
    // these have no `.smap` settings of their own — they read the same knobs the
    // Chords tab uses, so there is exactly one place to set the sound.
    //
    // Being lanes rather than the frame-driven jam matters: they land on the
    // mixer's own clock (sample-accurate against the click, instead of rAF
    // jitter on a second AudioContext) and get a fader and effect sends.
    if (showBand && sm && chordLaneOn) {
      plan.push({
        key: 'chord-machine',
        label: 'Chords',
        instrument: async () => {
          try {
            return createChordMachineInstrument(engine!.ac, sm, 'keys', transposeSemitones)
          } catch (e) {
            console.warn('chord machine instrument failed', e)
            return null
          }
        },
      })
    }

    if (showBand && sm && arpLaneOn) {
      plan.push({
        key: 'arp-machine',
        label: 'Arp',
        instrument: async () => {
          try {
            return createChordMachineInstrument(engine!.ac, sm, 'arp', transposeSemitones)
          } catch (e) {
            console.warn('arp machine instrument failed', e)
            return null
          }
        },
      })
    }

    if (plan.length === 0) {
      loadError = 'No audio tracks found. Render stems or a cue track first.'
      loading = false
      return
    }

    // Project-wide standard-stem default for live/playback loads. Computed once
    // per load. The full mix stands down whenever this song has ANY lane on a
    // musical button — not merely when the project's standard stems happen to
    // match — so switching every button off is silence rather than the whole
    // song reappearing underneath.
    const liveStems = get(projectStore).data?.defaults?.liveStems
    const savedLinks = new Map(
      ($songMap?.mixState?.tracks ?? [])
        .filter((t) => isLiveSlotLink(t.liveSlot))
        .map((t) => [t.key, t.liveSlot as LiveSlotLink]),
    )
    const hasAudibleStem = hasMusicalSlotLane(
      resolveLiveSlotLanes(plan.map((p) => ({ key: p.key, liveSlot: savedLinks.get(p.key) }))),
    )

    // Saved live-button links for this song. Tracks without one are absent, so
    // they keep falling back to the name guess.
    {
      const links: Record<string, LiveSlotLink> = {}
      for (const t of $songMap?.mixState?.tracks ?? []) {
        if (isLiveSlotLink(t.liveSlot)) links[t.key] = t.liveSlot
      }
      liveSlotByKey = links
      // The saved lane order IS the order of mixState.tracks.
      laneOrder = ($songMap?.mixState?.tracks ?? []).map((t) => t.key)
      // Saved channel EQs. Nodes belong to the old context, so drop them and
      // let the next insert build fresh ones on this engine.
      const eqs: Record<string, ChannelEq> = {}
      for (const t of $songMap?.mixState?.tracks ?? []) {
        if (t.eq) eqs[t.key] = t.eq
      }
      eqByKey = eqs
      eqNodesByKey = new Map()
    }

    const transposeActive = transposeAudioEnabled && transposeSemitones !== 0
    const activeSongId = ps.activeSongId
    // Stems this song already has PRE-DECODED (warmed by the live prefetcher
    // while the previous song played) → install with zero fetch/decode, so the
    // switch is instant instead of watching a loading ticker. Only trusted at
    // written pitch; a transposed load re-decodes + shifts from source.
    const preloaded = !transposeActive && activeSongId ? getPreloadedStems(activeSongId) : undefined
    // Raw (untransposed, un-prepended) stem decodes from THIS load, to seed the
    // cache so a switch BACK to this song is instant too.
    const decodedStemsThisLoad = new Map<string, AudioBuffer>()

    // THE CLICK LOADS FIRST.
    //
    // Lanes load one at a time (deliberately — decoding four full-length stems
    // in parallel spikes memory), and the click sat fourth in the plan, behind
    // the full mix and every stem. The click itself is ~100 ms of pure DSP or a
    // small mono WAV, but the band's timekeeper was waiting behind ~15 seconds
    // of stereo decodes — so at the top of a song the click toggle did nothing,
    // because the track it mutes did not exist yet.
    //
    // Sorting the plan instead of moving the push keeps lane CREATION order (and
    // everything keyed off it — colours, saved order) untouched.
    plan.sort((a, b) => (a.key === 'click' ? -1 : b.key === 'click' ? 1 : 0))

    let done = 0
    const t0 = performance.now()
    const failedLanes: string[] = []
    laneLoadWarning = null
    for (const p of plan) {
      // The component can be torn down (or the engine rebuilt) while this loop
      // is mid-decode — mode switches and song switches do it routinely. Keep
      // loading into the DEAD engine and every lane "fails" with a null crash,
      // the console fills with warnings, and the decode work steals CPU from
      // the load the user is actually watching. A stale loop stops, quietly.
      if (engine !== eng) return
      const isStemLane = p.key.startsWith('stem:')
      try {
        // MIDI lanes short-circuit the audio-file pipeline: no fetch/decode and
        // no audio pitch-shift. Musical MIDI lanes receive transposed NOTE
        // numbers at part-build time; drum hits stay untransposed.
        if (p.instrument) {
          loadingMsg = `Loading ${p.label}… (${done + 1} / ${plan.length})`
          const inst = await p.instrument()
          if (!inst) continue
          const savedMidi = savedFor(p.key)
          eng.setTrack({
            key: p.key,
            label: p.label,
            instrument: inst,
            volume: savedMidi?.volume ?? 1,
            muted: initialMutedFor(p.key, savedMidi, liveStems, hasAudibleStem),
            soloed: inPlaybackContext() ? false : !!savedMidi?.soloed,
          })
          syncLanesFromEngine()
          done++
          continue
        }
        // Synthesized lanes produce their buffer directly — no blob, no
        // decode, and no sidecar transpose (their samples derive from the
        // SongMap itself; varispeed is applied by the engine at play time,
        // exactly as it was for the decoded-WAV click before).
        if (p.bufferLoader) {
          loadingMsg = `Loading ${p.label}… (${done + 1} / ${plan.length})`
          const direct = await p.bufferLoader()
          if (!direct) {
            if (p.key === 'click') {
              // An analysed song ALWAYS gets a click lane in the plan; failing
              // to build one is a defect, and a silent skip is how "no clicks
              // on song X" becomes undebuggable. Say it, on screen and in the
              // console.
              clickBuildError = `The click could not be built for this song${lastClickRenderError ? ` — ${lastClickRenderError}` : ''}. Reload the song; if it persists, run Project health in Settings.`
              console.error('[mixer] click lane failed to build for the current song')
            }
            continue
          }
          const savedDirect = savedFor(p.key)
          eng.setTrack({
            key: p.key,
            label: p.label,
            buffer: direct,
            volume: savedDirect?.volume ?? 1,
            muted: initialMutedFor(p.key, savedDirect, liveStems, hasAudibleStem),
            soloed: inPlaybackContext() ? false : !!savedDirect?.soloed,
          })
          syncLanesFromEngine()
          done++
          continue
        }
        if (transposeActive && p.transposeSrcSubpath === null) {
          throw new Error('Transpose audio needs this song audio in a local project folder.')
        }
        let buf: AudioBuffer
        const cacheable = isStemLane || p.key === 'original'
        const cached = preloaded && cacheable ? preloaded.get(p.key) : undefined
        if (transposeActive && p.transposeSrcSubpath != null) {
          if (!ps.osPath || !ps.activeSongFolder) {
            throw new Error('Transpose audio needs a local project folder and the desktop sidecar.')
          }
          loadingMsg = `Preparing transposed ${p.label}… (${done + 1} / ${plan.length})`
          const shifted = await readProjectTransposedAudioBlob(
            ps.osPath,
            ps.activeSongFolder,
            p.transposeSrcSubpath,
            transposeSemitones,
          )
          if (!shifted.ok) throw new Error(shifted.error)
          buf = await decodeBlob(eng, shifted.blob)
        } else if (cached) {
          buf = cached
        } else {
          loadingMsg = `Loading ${p.label}… (${done + 1} / ${plan.length})`
          const blob = await p.loader!()
          if (!blob) continue
          buf = await decodeBlob(eng, blob)
        }
        // Remember the raw decode before transpose/prepend so a switch back to
        // this song reuses it (only untransposed stems are cache-eligible).
        if (cacheable && !transposeActive) decodedStemsThisLoad.set(p.key, buf)
        const pre = computePrepend(p.key)
        if (pre > 0) buf = bufferWithPrepend(eng.ac, buf, pre)
        const saved = savedFor(p.key)
        const track: MixerTrack = {
          key: p.key,
          label: p.label,
          buffer: buf,
          volume: saved?.volume ?? 1,
          muted: initialMutedFor(p.key, saved, liveStems, hasAudibleStem),
          // A saved solo (from arranging) would silence every other lane in the
          // live default, so ignore it in playback context.
          soloed: inPlaybackContext() ? false : !!saved?.soloed,
        }
        eng.setTrack(track)
        syncLanesFromEngine()
      } catch (e) {
        console.warn('Failed to load', p.key, e)
        failedLanes.push(`${p.label} (${e instanceof Error ? e.message : String(e)})`)
        if (transposeActive && p.transposeSrcSubpath != null) {
          const msg = e instanceof Error ? e.message : String(e)
          loadError = `Could not render transposed ${p.label}: ${msg}`
        }
      }
      done++
    }
    if (activeSongId && decodedStemsThisLoad.size > 0)
      putPreloadedStems(activeSongId, decodedStemsThisLoad)
    // HONEST COUNT: `done` counts ATTEMPTS — it once printed "9/9 ready" over
    // four working channels while five stems had failed, which reads as "all
    // good" precisely when it is not. Count what actually REGISTERED, and put
    // failures on screen, not only in a console nobody has open on stage.
    const registered = eng.listTracks().length
    console.info(
      `[mixer] ${registered} channels registered (${done}/${plan.length} attempted) in ${Math.round(performance.now() - t0)} ms${failedLanes.length ? ` — FAILED: ${failedLanes.join('; ')}` : ''}`,
    )
    if (failedLanes.length > 0 && !loadError) {
      laneLoadWarning = `${failedLanes.length} channel${failedLanes.length === 1 ? '' : 's'} failed to load: ${failedLanes.join('; ')}`
    }
    applyProjectSound()
    loading = false
  }

  // ── Project sound (mastering) ────────────────────────────────────────────
  // Builds per-stem inserts + the master glue/limiter from the shared project
  // config. RMS is cached per decoded buffer (WeakMap → stale-proof across
  // reloads). Re-applying mid-play re-schedules sources at the same position.
  const laneRms = new WeakMap<AudioBuffer, number>()
  let lastAppliedSoundJson = '"__unset__"'
  /**
   * LOCAL before/after switch: true = play the raw lanes (chains removed) for
   * comparison. Never written to the shared config — collaborators and the
   * saved project sound are untouched.
   */
  let soundBypassed = $state(false)
  const projectSoundOn = $derived(!!$projectStore.data?.mastering?.enabled)

  /**
   * The ONE builder for a lane's insert. The channel EQ and the project-sound
   * chain both live on `track.insert`, so they have to be composed here rather
   * than each writing it — whichever wrote last would otherwise silently erase
   * the other.
   *
   *     source → [channel EQ] → [project sound] → track gain
   *
   * EQ first: it is the user's own corrective move on the raw channel, and the
   * project's compressor should react to the sound they actually chose.
   */
  function buildLaneInsert(track: MixerTrack, cfg: ProjectMastering | undefined): MixerInsert | undefined {
    if (!engine) return undefined
    const ctx = engine.ac
    const eqChain = isEqActive(eqByKey[track.key]) ? laneEqNodes(track.key) : null

    let soundChain: MixerInsert | undefined
    const kind = stemKindForLaneKey(track.key)
    // The project-sound chain is fitted to a stem's measured level, so it only
    // applies to AUDIO tracks — a MIDI track has no buffer to measure.
    if (cfg?.enabled && kind && track.buffer) {
      const buf = track.buffer
      let rms = laneRms.get(buf)
      if (rms === undefined) {
        rms = bufferRmsDb(buf)
        laneRms.set(buf, rms)
      }
      soundChain = buildStemChain(ctx, kind, cfg, rms) ?? undefined
    }

    if (eqChain && soundChain) {
      eqChain.output.connect(soundChain.input)
      return { input: eqChain.input, output: soundChain.output }
    }
    return eqChain ?? soundChain
  }

  function applyProjectSound() {
    if (!engine) return
    const saved = get(projectStore).data?.mastering
    const cfg = soundBypassed ? undefined : saved
    const wasPlaying = snapshot.state === 'playing'
    const pos = snapshot.positionSec
    engine.setMasterChain(cfg ? buildMasterChain(engine.ac, cfg) : null)
    for (const t of engine.listTracks()) {
      engine.setTrack({ ...t, insert: buildLaneInsert(t, cfg) })
    }
    syncLanesFromEngine()
    lastAppliedSoundJson = JSON.stringify(saved ?? null)
    if (wasPlaying) void engine.play(pos)
  }

  // ── Channel EQ (a per-lane insert; nothing to do with the busses) ─────────
  /** laneKey → its EQ. Absent / flat = no filters are inserted for that lane. */
  let eqByKey = $state<Record<string, ChannelEq>>({})
  /** Live filter nodes per lane, kept so a slider drag retunes instead of rewiring. */
  let eqNodesByKey = new Map<string, ChannelEqNodes>()

  function laneEqNodes(key: string): ChannelEqNodes {
    let nodes = eqNodesByKey.get(key)
    if (!nodes) {
      nodes = createChannelEqNodes(engine!.ac)
      nodes.update(eqByKey[key])
      eqNodesByKey.set(key, nodes)
    }
    return nodes
  }

  /**
   * Apply an EQ edit.
   *
   * The common case — dragging a band on a lane that already has an EQ — only
   * retunes existing filters, so it is heard instantly with no rewire and no
   * re-seek. Only turning the EQ on or off changes the graph SHAPE, and that is
   * the one case that has to re-seek, because replacing a track's insert
   * disconnects the old chain and the lane would otherwise drop out.
   */
  function onEqChange(key: string, next: ChannelEq | undefined) {
    if (!engine) return
    const wasActive = isEqActive(eqByKey[key])
    if (next === undefined) {
      const { [key]: _dropped, ...rest } = eqByKey
      eqByKey = rest
    } else {
      eqByKey = { ...eqByKey, [key]: next }
    }
    const nowActive = isEqActive(eqByKey[key])

    eqNodesByKey.get(key)?.update(eqByKey[key])

    if (wasActive !== nowActive) {
      const track = engine.listTracks().find((t) => t.key === key)
      if (track) {
        const cfg = soundBypassed ? undefined : get(projectStore).data?.mastering
        engine.setTrack({ ...track, insert: buildLaneInsert(track, cfg) })
        if (snapshot.state === 'playing') void engine.play(snapshot.positionSec)
      }
    }
    schedulePersist()
  }

  /** Before/after: flip the bypass and re-apply, resuming at the playhead. */
  function toggleSoundBypass() {
    soundBypassed = !soundBypassed
    applyProjectSound()
  }

  // Live re-apply when the SHARED config actually changes (JSON-compared so
  // unrelated project-store ticks — autosave, cloud status — don't restart
  // playback; see the settings-dialog re-seeding bug).
  $effect(() => {
    const cfg = $projectStore.data?.mastering
    const json = JSON.stringify(cfg ?? null)
    if (!engine || loading) return
    if (json === lastAppliedSoundJson) return
    untrack(() => applyProjectSound())
  })

  /** Persist current track state into songMap.mixState (debounced). */
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      if (!engine) return
      // Written in LANE order — the array order is what restores the rows.
      const byKey = new Map(engine.listTracks().map((t) => [t.key, t]))
      const orderedTracks = sortBySavedOrder(
        [...byKey.keys()],
        lanes.map((l) => l.key),
      )
      const tracks: MixTrackState[] = orderedTracks.flatMap((key) => {
        const t = byKey.get(key)
        if (!t) return []
        const entry: MixTrackState = { key: t.key, volume: t.volume }
        if (t.muted) entry.muted = true
        if (t.soloed) entry.soloed = true
        // Only an EXPLICIT link is written; an untouched track stays absent so
        // it keeps following the name-based guess.
        const link = liveSlotByKey[t.key]
        if (link !== undefined) entry.liveSlot = link
        // A flat EQ is not worth storing; a deliberately bypassed one is.
        const eq = eqByKey[t.key]
        if (isEqWorthStoring(eq)) entry.eq = eq
        return [entry]
      })
      const next: MixState = { tracks }
      patchSongMap((m) => ({ ...m, mixState: next }))
    }, 800)
  }

  /** What "Faders → unity" would do, recomputed from the live lane state. */
  const faderResetPlan = $derived(
    planFaderReset(lanes.map((l) => ({ key: l.key, volume: l.volume, muted: l.muted }))),
  )
  /**
   * Clear the per-song fader compensation so loudness matching is the only
   * thing setting stem levels. Goes through the ENGINE and the existing
   * persist path — no second writer of `mixState`.
   */
  function resetStemFaders() {
    if (!engine) return
    for (const key of faderResetPlan.reset) engine.setVolume(key, UNITY)
    syncLanesFromEngine()
    schedulePersist()
  }

  function onVolume(key: string, v: number) {
    if (!engine) return
    engine.setVolume(key, v)
    syncLanesFromEngine()
    schedulePersist()
  }

  function onToggleMuted(key: string) {
    if (!engine) return
    const t = engine.listTracks().find((x) => x.key === key)
    if (!t) return
    engine.setMuted(key, !t.muted)
    syncLanesFromEngine()
    schedulePersist()
  }

  function onToggleSoloed(key: string) {
    if (!engine) return
    const t = engine.listTracks().find((x) => x.key === key)
    if (!t) return
    engine.setSoloed(key, !t.soloed)
    syncLanesFromEngine()
    schedulePersist()
  }

  function onSeekFraction(frac: number) {
    if (!engine) return
    engine.seek(frac * snapshot.durationSec)
  }

  // Keep the published handles current so the shell transport reflects THIS
  // engine's state (enabled/playing/position), not the shell's own.
  $effect(() => {
    controls = {
      canPlay: mixerCanPlay,
      isPlaying: snapshot.state === 'playing',
      positionSec: snapshot.positionSec,
      durationSec: snapshot.durationSec,
      playPause: onPlayPause,
      stop: onStop,
      restart: onRestartSong,
      clickOn: clickOnNow,
      setClick: setClickOn,
    }
  })

  function onPlayPause() {
    if (!mixerCanPlay) return
    if (!engine) return
    if (snapshot.state === 'playing') engine.pause()
    else announcedPlay()
  }

  function onStop() {
    if (!engine) return
    pendingStartWhenClickReady = null // stop also cancels a parked start
    cueScheduler?.cancelPending()
    engine.stop()
  }

  function onRestartSong() {
    if (!mixerCanPlay || !engine) return
    replayOnceSectionId = null
    replayOnceConsumed = false
    if (snapshot.state === 'playing') {
      lastLinearCuePos = 0 // restart-from-top: re-scan cues from the start
      loopCueArmedForId = null
      engine.seek(0)
    } else {
      announcedPlay(0)
    }
  }

  async function loadProjectSongAt(index: number) {
    const target = projectSongNavItems[index]
    if (!target || projectSongSwitching) return
    if (target.id === $projectStore.activeSongId) return
    projectSongSwitching = true
    try {
      loading = true
      loadError = null
      clickBuildError = null
      clickLaneReady = false
      pendingStartWhenClickReady = null // a queued start must not fire into a NEW song
      loadingMsg = `Loading ${target.title}…`
      onStop()
      // Collab (browser-cloud) mode has no local folder (`osPath` is null), so
      // the disk loader throws "No active project" — the exact reason in-mixer
      // prev/next did nothing in browser mode. Route through the cloud loader,
      // mirroring the setlist page's openSong().
      if (isBrowserCloudProject(get(projectStore))) {
        const r = await loadCloudSongIntoEditor(target.id)
        if (!r.ok) loadError = r.error
      } else {
        await loadProjectSongIntoEditor(target.id)
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
      loading = false
    } finally {
      projectSongSwitching = false
    }
  }

  function onPreviousProjectSong() {
    if (!canGoPreviousProjectSong) return
    void loadProjectSongAt(activeProjectSongIndex - 1)
  }

  function onNextProjectSong() {
    if (!canGoNextProjectSong) return
    void loadProjectSongAt(activeProjectSongIndex + 1)
  }

  // State pushed to the APC's LEDs so the pads mirror the app (lit = active).
  // Declared here so the LED state below can read them (Svelte TDZ).
  let queuedSectionIndex = $state<number | null>(null)
  let awaitingStart = $state(false)

  // ── Dynamic section cues: fire a section's spoken-name + count-in clip when
  // that section is LAUNCHED (jump / loop / replay), so cues work even when you
  // jump around — not just on a linear pass. Rendered per-section clips are
  // scheduled sample-accurately against the same AudioContext clock as the jump.
  let cueScheduler: LiveCueScheduler | null = null
  // Reactive so the cue-render effect re-runs once the engine is created in
  // onMount (`engine` itself is a plain let and not tracked).
  let engineReady = $state(false)
  let sectionCueClips = new Map<string, { buffer: AudioBuffer; downbeatOffsetSec: number }>()
  let sectionCueFp = ''
  let sectionCueRenderToken = 0
  // Guard so each loop/replay pass pre-fires its lead-in cue exactly once.
  let loopCueArmedForId: string | null = null
  // Playhead position at the previous transport tick — drives "fire a section's
  // cue as we cross into its lead-in" during normal (non-launch) playback.
  let lastLinearCuePos = 0

  /** The lanes toggleable from the controller's live pads: stems + cue + click
   *  (not the original mix or the generated band). Stable order. */

  /**
   * PRACTICE OUTPUT — the one way click and cues may reach the main mix in
   * LIVE mode, and it is OFF until a person switches it on.
   *
   * On this output everything leaves on one stereo pair, so anything the
   * engine plays goes to the house. Click and cues are for the band's ears;
   * the room hearing "TWO, THREE, FOUR" between songs is the mistake everyone
   * remembers. So in live mode they FAIL CLOSED: silent, not "on until routed
   * away" — exactly the contract in docs/architecture/audio-system-overview.md.
   *
   * Session-local by design ($state, never persisted): practice at home is a
   * decision for tonight, not a setting that quietly survives to the gig.
   */
  let practiceOutputOn = $state(false)
  /**
   * Is the engine ACTUALLY splitting click/cue onto their own output channels?
   * Set once from the engine at creation — the engine's graph is the truth,
   * never a panel's derivation of what it should be.
   */
  let engineSplitActive = $state(false)
  /**
   * May click/cues sound AT ALL on this surface right now?
   *
   * THREE ways to yes, each a different world:
   *  - not live: the editor always hears its click
   *  - practice on: a person chose to put click/cues in the mains, tonight
   *  - THE SPLIT IS ACTIVE: click/cue leave on their own channels, which the
   *    desk keeps off the house (verified by the FOH banner). Suppressing them
   *    here silenced the MONITOR path at its source — the band lost its click
   *    in the name of protecting a house that could never receive it. The gate
   *    exists for the stereo world where click shares the house pair; in the
   *    split world the desk is the gate.
   */
  const privateLanesAudible = $derived(!liveMode || practiceOutputOn || engineSplitActive)

  // Fail-closed enforcement for the CLICK at the engine, not the UI: suppression
  // zeroes the lane's gain without touching the user's saved mute, so flipping
  // Practice on restores exactly the state they had. The cue side is gated at
  // its scheduling calls — it has no lane to suppress.
  $effect(() => {
    engineReady
    engine?.setTrackSuppressed('click', !privateLanesAudible)
  })

  // LIVE CLICK ENFORCEMENT — the other half of the `liveClickOn` derivation
  // (declared with `clickMuted`). Re-runs on every lane registration/engine
  // sync (`lanes`), so WHENEVER the click lane appears — first load, song
  // switch, hydration, reload — it is stamped with the current per-show state.
  // No load-order dependence, nothing inherited. The write is conditional so
  // the effect settles instead of ping-ponging with `syncLanesFromEngine`.
  $effect(() => {
    if (!liveMode || !engineReady) return
    lanes
    const t = engine?.listTracks().find((t) => t.key === 'click')
    if (t && t.muted === liveClickOn) {
      engine?.setMuted('click', !liveClickOn)
      syncLanesFromEngine()
    }
  })

  // FIXED canonical slots (0-9): a given instrument is ALWAYS the same pad,
  // every song. `null` = no lane for that slot in this song (button stays dark).
  // This is what makes the APC stem buttons trustworthy live.
  // A slot can drive SEVERAL lanes (e.g. drums + percussion on the Drums
  // button), so each slot carries the whole group. It reads as ON when anything
  // in it sounds, and one press moves the group together.
  type LiveLane = { keys: string[]; on: boolean; kind: 'stem' | 'cue' | 'click' }
  // ONE resolution for the whole live surface: the on-screen pills, the APC
  // LEDs and the pad / track-button presses all read `liveSlotViews`. They used
  // to derive separate lists, which is how the screen and the controller ended
  // up showing different things in a different order.
  const liveSlotViews = $derived(
    buildLiveSlotViews(liveSlotLanes, [
      ...laneLights,
      // Click has no mixer strip, so its state comes from its own flag.
      { key: 'click', muted: !clickOnNow, active: clickOnNow && privateLanesAudible && transportState === 'playing', color: CLICK_LANE_COLOR },
      // Cue follows the saved "Play cues" preference rather than a lane mute.
      { key: 'cue', muted: cueLaneMuted, active: !cueLaneMuted && privateLanesAudible && transportState === 'playing', color: CUE_LANE_COLOR },
    ]),
  )
  /** LED/press shape: null for an empty slot, so a dark button does nothing. */
  const liveLanes = $derived<(LiveLane | null)[]>(
    liveSlotViews.map((v) => (v.present ? { keys: v.keys, on: v.on, kind: v.kind } : null)),
  )

  /**
   * The live stage's stem row, as the SAME 10 canonical slots the APC drives.
   *
   * This row used to render `laneLights` — EVERY mixer lane, in mixer order —
   * while the pads and track buttons drove `liveLanes` (the fixed slots). So
   * the screen showed `drum-machine` / `bass-machine` pills the controller had
   * no button for, in a different order, and the mixer's "live button" picker
   * appeared to do nothing because it only moved the slots. Same source now:
   * what you see is what button N toggles.
   *
   * Every slot is rendered, present or not — button 3 is Vocals whether or not
   * this song has vocals, exactly like the hardware. Empty slots read as dim and
   * are not clickable.
   */
  const liveSlotPills = $derived(liveSlotViews)

  /** Press a live button: move every lane linked to that slot as one. */
  function toggleLiveSlot(slot: number) {
    const view = liveSlotViews[slot]
    if (!view?.present) return
    // Click and cue aren't ordinary lanes — click has no mixer strip and cue is
    // scheduled rather than played from a track — so they route to their own
    // switches instead of the group mute below.
    if (view.kind === 'click') return setClickOn(!view.on)
    if (view.kind === 'cue') return setCueOn(!view.on)
    const lane = liveLanes[slot]
    if (!engine || !lane) return
    const muted = new Map(engine.listTracks().map((t) => [t.key, !!t.muted]))
    const next = nextGroupMuted(lane.keys, (k) => muted.get(k) !== false)
    for (const key of lane.keys) engine.setMuted(key, next)
    syncLanesFromEngine()
    schedulePersist()
  }

  /** Beat-start times in MIXER time — drives the current-section beat blink. */
  const beatStartsMixer = $derived.by<number[]>(() => {
    const sm = $songMap
    if (!sm?.timeline?.beats?.length) return []
    const offset = mixerSongOffsetSec
    return sm.timeline.beats.map((b) => b.timeSec + offset)
  })

  /** True on the first half of the current beat — a tempo-locked on/off gate. */
  const beatOn = $derived.by(() => {
    if (snapshot.state !== 'playing') return true
    const beats = beatStartsMixer
    const pos = snapshot.positionSec
    if (beats.length === 0) return true
    let i = -1
    for (const b of beats) {
      if (b <= pos) i++
      else break
    }
    if (i < 0) return true
    const start = beats[i]!
    const end = beats[i + 1] ?? start + 0.5
    return (pos - start) / Math.max(0.05, end - start) < 0.5
  })

  const liveLedState = $derived<LiveLedState>({
    playing: transportState === 'playing',
    loopActive: !!repeatSectionRange,
    replayArmed: !!replayOnceSectionRange,
    canReplay: !!currentSectionRange,
    canPrev: canGoPreviousProjectSong,
    canNext: canGoNextProjectSong,
    lanes: liveLanes.map((l) => (l ? { on: l.on, kind: l.kind } : null)),
    sectionKinds: sectionTimelineRanges.slice(0, SECTION_PAD_COUNT).map((s) => s.kind),
    currentSection: currentSectionRange
      ? sectionTimelineRanges.findIndex((s) => s.id === currentSectionRange!.id)
      : -1,
    queuedSection: queuedSectionIndex ?? -1,
    awaitingStart,
    beatOn,
  })

  // Auto-advance: when a song finishes, load the next one (ready at 0) and arm
  // "awaiting start" so the Play control blinks until the operator kicks it off.
  let wasPlayingForEnd = false
  let lastPosForEnd = 0
  $effect(() => {
    const st = snapshot.state
    const pos = snapshot.positionSec
    const dur = snapshot.durationSec
    if (st === 'playing') {
      wasPlayingForEnd = true
      lastPosForEnd = pos
      if (awaitingStart) awaitingStart = false // operator started it
      return
    }
    if (wasPlayingForEnd) {
      wasPlayingForEnd = false
      // Stopping or ending cancels any pending one-shot launch, so its indicator
      // stops flashing instead of sticking (the in-playback clear only runs
      // while playing, so a stop/end would otherwise leave it armed forever).
      replayOnceSectionId = null
      replayOnceConsumed = false
      queuedSectionIndex = null
      loopCueArmedForId = null
      // Natural end (playhead was at the tail), not a manual stop.
      if (liveMode && dur > 0 && lastPosForEnd >= dur - 1.0) {
        if (canGoNextProjectSong) {
          onNextProjectSong()
          awaitingStart = true
        }
      }
    }
  })

  // Section launch is quantized to the bar (Ableton default): pressing a section
  // arms a SAMPLE-ACCURATE jump in the engine that fires exactly on the next bar
  // line — no polling, no slip. Pressing the section you're on re-triggers it.

  /** Bar-start times in MIXER time (song bars + the mixer offset). */
  const barStartsMixer = $derived.by<number[]>(() => {
    const sm = $songMap
    if (!sm?.timeline?.bars?.length) return []
    const offset = mixerSongOffsetSec
    return sm.timeline.bars.map((b) => b.startSec + offset)
  })

  /** The next bar-start strictly after `posSec` (mixer time), or null near end. */
  function nextBarBoundary(posSec: number): number | null {
    for (const b of barStartsMixer) if (b > posSec + 1e-3) return b
    return null
  }

  // Render (and cache) the per-section lead-in cue clips whenever the cue setup
  // or timing changes. Needs the desktop sidecar for TTS; a no-op in browser
  // mode (dynamic cues simply don't fire there, same as the baked cue WAV).
  $effect(() => {
    const sm = $songMap
    const reachable = $desktopCompanionStatus.reachable
    void engineReady
    const eng = engine
    if (!eng || !sm || !reachable) return
    const fp = fingerprintCueTrackInputs(sm)
    if (fp === sectionCueFp) return
    const specs = sectionCueSpecsFromSongMap(sm)
    sectionCueFp = fp
    if (specs.length === 0) {
      sectionCueClips = new Map()
      return
    }
    const token = ++sectionCueRenderToken
    void (async () => {
      // Positioning is pure frontend; only the spoken WORDS come from the
      // sidecar, and those are cached by text — so moving sections / retiming
      // re-lays-out cues here without re-synthesizing anything.
      const clips = await renderSectionCueClips(specs, {
        fetchTts: fetchTtsWavCached,
        decodeWav: async (blob) => {
          const buf = await eng.ac.decodeAudioData(await blob.arrayBuffer())
          return { data: buf.getChannelData(0), sampleRate: buf.sampleRate }
        },
      })
      if (token !== sectionCueRenderToken) return // superseded by a newer render
      const map = new Map<string, { buffer: AudioBuffer; downbeatOffsetSec: number }>()
      for (const [id, clip] of clips) {
        const buffer = eng.ac.createBuffer(1, clip.data.length, clip.sampleRate)
        buffer.copyToChannel(new Float32Array(clip.data), 0, 0)
        map.set(id, { buffer, downbeatOffsetSec: clip.downbeatOffsetSec })
      }
      sectionCueClips = map
    })()
  })

  // Cues are on unless explicitly muted in mixState (persisted, per-song).
  // There's no baked cue lane anymore, so this gates the dynamic scheduler.
  const cuesEnabled = $derived(!($songMap ? cuePlaybackMuted($songMap) : false))


  /** Fire a section's lead-in cue so its downbeat lands at `arrivalCtxTime`. */
  function fireSectionCue(sectionId: string, arrivalCtxTime: number) {
    if (!privateLanesAudible) return // live: fail closed off the main mix
    if (!cueScheduler || !cuesEnabled) return
    const clip = sectionCueClips.get(sectionId)
    if (!clip) return
    cueScheduler.scheduleAt(clip.buffer, arrivalCtxTime - clip.downbeatOffsetSec)
  }

  /** Convert an arrival POSITION (song seconds) to ctx time and fire the cue.
   *  Uses the engine's LIVE position (not the ~16 ms-stale snapshot) so the
   *  count-in lands on the beat. */
  function fireSectionCueLeadingTo(sectionId: string, arrivalPositionSec: number) {
    if (!engine) return
    fireSectionCue(sectionId, engine.ac.currentTime + (arrivalPositionSec - engine.positionSec()))
  }

  // ── Song announcement (project-wide: auto / triggered / off) ──────────────
  const announcementMode = $derived($projectStore.data?.defaults?.preCountInCue?.mode ?? 'off')
  /** What it says: the song's own title, or a per-song intro override. */
  const announcementText = $derived.by(() => {
    const sm = $songMap
    if (!sm) return ''
    const intro = getPrimaryCueTrack(sm)
      ?.events.find((e) => e.kind === 'intro' && e.enabled)
      ?.text?.trim()
    return intro || sm.metadata.title?.trim() || ''
  })
  let announcementClip = $state<AudioBuffer | null>(null)
  let announcementClipText = ''
  let announcementRenderToken = 0
  // Synthesize (cached by text) the announcement clip whenever it's in use.
  $effect(() => {
    void engineReady
    const eng = engine
    const mode = announcementMode
    const text = announcementText
    const reachable = $desktopCompanionStatus.reachable
    if (!eng || mode === 'off' || !text || !reachable) {
      announcementClip = null
      announcementClipText = ''
      return
    }
    if (text === announcementClipText && announcementClip) return
    announcementClipText = text
    const token = ++announcementRenderToken
    void (async () => {
      const r = await fetchTtsWavCached(text)
      if (!r.ok || token !== announcementRenderToken) return
      try {
        const buf = await eng.ac.decodeAudioData(await r.blob.arrayBuffer())
        if (token === announcementRenderToken) announcementClip = buf
      } catch {
        if (token === announcementRenderToken) announcementClip = null
      }
    })()
  })

  /** Speak the song name now — the 'triggered' Akai action, and 'auto' on play. */
  function announceSongNow() {
    if (!privateLanesAudible) return // live: fail closed off the main mix
    if (announcementClip && cueScheduler && engine) {
      cueScheduler.scheduleAt(announcementClip, engine.ac.currentTime)
    }
  }

  /** Play, announcing the song first when starting from the top in 'auto' mode. */
  /**
   * Is the click track REGISTERED in the engine right now? Written by
   * `syncLanesFromEngine` (the one place engine state is mirrored), cleared
   * when a load begins. This is presence, not audibility — mute/suppression
   * stay their own concerns.
   */
  let clickLaneReady = $state(false)
  const songHasGrid = $derived((($songMap?.timeline.beats.length ?? 0) as number) > 0)
  /**
   * A START that arrived before the click lane existed, parked. The recorded
   * cold open put TEN SECONDS of clickless song into a rehearsal: play began
   * while lanes were still loading and the click joined late. In live, a song
   * with a grid must not start clickless — so the start waits for the click
   * lane and fires the moment it registers. A FAILED click build releases the
   * hold (playable, with the red line saying why) — a broken click must never
   * lock a song out of a show.
   */
  let pendingStartWhenClickReady = $state<(() => void) | null>(null)
  function clickGateAllowsStart(start: () => void): boolean {
    if (mayStartSong({ liveMode, songHasGrid, clickLaneReady, clickBuildError })) return true
    pendingStartWhenClickReady = start
    loadingMsg = 'Waiting for the click track…'
    return false
  }
  $effect(() => {
    if (pendingStartWhenClickReady && (clickLaneReady || clickBuildError)) {
      const go = pendingStartWhenClickReady
      pendingStartWhenClickReady = null
      go()
    }
  })

  function announcedPlay(fromSec?: number) {
    if (!engine) return
    if (!clickGateAllowsStart(() => announcedPlay(fromSec))) return
    const startAt = fromSec ?? snapshot.positionSec
    // Fresh play/replay: reset the linear-cue scan from the start position so the
    // opening spoken cue fires again (it stayed stale ≈duration after the last
    // play finished, which suppressed the intro cue on every replay).
    lastLinearCuePos = startAt
    loopCueArmedForId = null
    const clip = announcementClip
    // `privateLanesAudible` must gate the DELAY too, not only the speech: with
    // the announcement failing closed (live, Practice off) the song would
    // otherwise still wait out a clip nobody hears — seconds of dead air at
    // the top of every song, which on a stage reads as "it broke".
    if (startAt < 0.05 && announcementMode === 'auto' && clip && privateLanesAudible) {
      announceSongNow()
      void engine.play(fromSec, { startDelaySec: clip.duration + 0.15 })
    } else {
      void engine.play(fromSec)
    }
  }

  /**
   * Launch a section, quantized. `mode`:
   *   'next-bar'     — single tap: jump on the next bar line.
   *   'section-end'  — double tap: jump when the CURRENT section finishes.
   */
  function jumpToSection(index: number, mode: 'next-bar' | 'section-end' = 'next-bar') {
    const section = sectionTimelineRanges[index]
    if (!engine || !section) return
    replayOnceSectionId = null
    replayOnceConsumed = false
    // Not playing → nothing to quantize to; start there now (through the
    // click gate — a section launch is a START like any other).
    if (snapshot.state !== 'playing') {
      if (!clickGateAllowsStart(() => jumpToSection(index, mode))) return
      void engine.play(section.startSec)
      return
    }
    const boundary =
      mode === 'section-end' && currentSectionRange
        ? currentSectionRange.endSec
        : nextBarBoundary(snapshot.positionSec)
    if (boundary == null || boundary <= snapshot.positionSec) {
      seekSectionStartWithGuard(section.startSec)
      return
    }
    engine.armJumpAtPosition(boundary, section.startSec)
    queuedSectionIndex = index
    // Lead the spoken name + count-in into the section's arrival at `boundary`.
    fireSectionCueLeadingTo(section.id, boundary)
  }

  // Zero-latency double-tap: a single press launches on the next bar IMMEDIATELY
  // (no waiting to detect a second tap). A quick second tap of the same section
  // UPGRADES that still-pending launch to wait for the current section to end.
  // If the next-bar launch already fired/committed, the second tap is ignored
  // (never a double-jump). See the 'jump-section' handler.
  let lastSectionTap: { index: number; at: number } | null = null
  const DOUBLE_TAP_MS = 400

  // Clear the "queued" LED once the scheduled jump has fired (engine idle).
  $effect(() => {
    void snapshot.positionSec
    if (queuedSectionIndex != null && engine && !engine.jumpPending()) queuedSectionIndex = null
  })

  // A song switch cancels any pending launch.
  $effect(() => {
    void $projectStore.activeSongId
    engine?.cancelJump()
    cueScheduler?.cancelPending()
    queuedSectionIndex = null
    loopCueArmedForId = null
  })

  // Live MIDI (APC Key 25) → the SAME actions the keyboard + on-screen buttons
  // use, so there is exactly one behaviour per command regardless of source.
  function handleLiveMidiCommand(cmd: LiveCommand) {
    switch (cmd.type) {
      case 'play-pause':
        if (mixerCanPlay) onPlayPause()
        break
      case 'stop':
        onStop()
        break
      case 'prev-song':
        if (canGoPreviousProjectSong) onPreviousProjectSong()
        break
      case 'next-song':
        if (canGoNextProjectSong) onNextProjectSong()
        break
      case 'replay-once':
        if (currentSectionRange || replayOnceSectionRange) replayCurrentSectionOnce()
        break
      case 'loop':
        if (currentSectionRange || repeatSectionEnabled) toggleRepeatSection()
        break
      case 'announce-song':
        announceSongNow()
        break
      case 'toggle-stem':
        toggleLiveSlot(cmd.index)
        break
      case 'toggle-jam':
        // A pad press IS a user gesture, so this is where the jam's audio
        // contexts are allowed to start.
        chordJam.toggleVoice(cmd.voice)
        break
      case 'cycle-arp-rate':
        chordJam.cycleArpRate()
        break
      case 'jump-section': {
        const now = performance.now()
        const isDouble =
          !!lastSectionTap && lastSectionTap.index === cmd.index && now - lastSectionTap.at < DOUBLE_TAP_MS
        lastSectionTap = { index: cmd.index, at: now }
        if (isDouble) {
          // Upgrade the still-pending launch to "wait for section end". If it
          // already fired/committed, jumpPending() is false → do nothing, so a
          // late second tap never triggers a second, unwanted jump.
          if (engine?.jumpPending()) jumpToSection(cmd.index, 'section-end')
        } else {
          jumpToSection(cmd.index, 'next-bar')
        }
        break
      }
    }
  }

  function toggleRepeatSection() {
    if (repeatSectionEnabled) {
      repeatSectionEnabled = false
      repeatSectionId = null
      return
    }
    if (!currentSectionRange) return
    replayOnceSectionId = null
    replayOnceConsumed = false
    repeatSectionId = currentSectionRange.id
    repeatSectionEnabled = true
  }

  function replayCurrentSectionOnce() {
    if (!engine || !currentSectionRange) return
    // Press again while it's still armed (before the replay has fired) cancels.
    if (replayOnceSectionId && !replayOnceConsumed) {
      replayOnceSectionId = null
      replayOnceConsumed = false
      return
    }
    repeatSectionEnabled = false
    repeatSectionId = null
    replayOnceSectionId = currentSectionRange.id
    replayOnceConsumed = false
    if (snapshot.state !== 'playing') {
      engine.seek(currentSectionRange.startSec)
      void engine.play(currentSectionRange.startSec)
    }
  }

  function seekSectionStartWithGuard(startSec: number) {
    if (!engine) return
    repeatSeekGuard = true
    engine.seek(startSec)
    // Re-arm the loop/replay lead-in cue for the next pass.
    loopCueArmedForId = null
    window.setTimeout(() => {
      repeatSeekGuard = false
    }, 120)
  }

  function handleTransportUpdate(s: MixerSnapshot) {
    snapshot = s
    if (s.state !== transportState) transportState = s.state // discrete, off the per-frame path
    // Drive the chord jam from THIS engine's playhead, converted to song time
    // (the `.smap` base its schedules are in). Called before the early-returns
    // below so stopping still releases the voices.
    if (chordJam.anyOn || s.state !== 'playing') {
      chordJam.setPosition(
        s.positionSec - mixerSongOffsetSec,
        s.state === 'playing',
        'mixer',
        jamVoicesSuppressedHere,
      )
    }
    if (Math.abs(mixerDurationSec - s.durationSec) > 1e-4) {
      mixerDurationSec = s.durationSec
    }
    if (!engine || repeatSeekGuard || s.state !== 'playing') return

    // Pre-fire the lead-in cue for a looping/replaying section so its count-in
    // counts back into the top of the section right at the loop point.
    const reentryRange =
      repeatSectionEnabled && repeatSectionRange
        ? repeatSectionRange
        : replayOnceSectionRange && !replayOnceConsumed
          ? replayOnceSectionRange
          : null
    if (reentryRange && loopCueArmedForId !== reentryRange.id) {
      const clip = sectionCueClips.get(reentryRange.id)
      if (clip) {
        const fireAtPos = reentryRange.endSec - clip.downbeatOffsetSec
        if (s.positionSec >= fireAtPos && s.positionSec < reentryRange.endSec) {
          loopCueArmedForId = reentryRange.id
          fireSectionCueLeadingTo(reentryRange.id, reentryRange.endSec)
        }
      }
    }

    // Normal-playback cue firing: speak each section's lead-in as the playhead
    // crosses into it. Only during smooth forward playback (small tick delta);
    // a seek/jump has a big delta and is skipped here (launches + loop/replay
    // fire their own cue). `launchActive` guards against doubling a pending jump.
    const launchActive =
      engine.jumpPending() || repeatSectionEnabled || !!replayOnceSectionRange
    const cueDelta = s.positionSec - lastLinearCuePos
    if (!launchActive && cueDelta > 0 && cueDelta < 0.5) {
      for (const range of sectionTimelineRanges) {
        const clip = sectionCueClips.get(range.id)
        if (!clip) continue
        const triggerPos = range.startSec - clip.downbeatOffsetSec
        if (triggerPos > lastLinearCuePos && triggerPos <= s.positionSec) {
          fireSectionCueLeadingTo(range.id, range.startSec)
        }
      }
    }
    lastLinearCuePos = s.positionSec

    const continuousRange = repeatSectionRange
    if (
      repeatSectionEnabled &&
      continuousRange &&
      continuousRange.endSec - continuousRange.startSec >= 0.1 &&
      s.positionSec >= continuousRange.endSec - 0.035
    ) {
      seekSectionStartWithGuard(continuousRange.startSec)
      return
    }

    const onceRange = replayOnceSectionRange
    if (
      onceRange &&
      onceRange.endSec - onceRange.startSec >= 0.1 &&
      s.positionSec >= onceRange.endSec - 0.035
    ) {
      if (!replayOnceConsumed) {
        replayOnceConsumed = true
        seekSectionStartWithGuard(onceRange.startSec)
      } else {
        replayOnceSectionId = null
        replayOnceConsumed = false
      }
    }
  }

  function fmtTime(sec: number): string {
    const safe = Math.max(0, sec)
    const m = Math.floor(safe / 60)
    const s = Math.floor(safe - m * 60)
    const ms = Math.floor((safe - Math.floor(safe)) * 10)
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`
  }

  /**
   * Re-fetch the sidecar's on-disk view before deciding which lanes to load.
   * This is the difference between the mixer reflecting whatever happened to
   * be cached when the user last visited /project and what's actually on
   * disk right now. Without this, generating a cue track in the Cue tab and
   * then switching to Mix would show no cue lane until the user navigated
   * back through /project to trigger a refresh.
   */
  async function syncAndLoad(rescan = true) {
    loading = true
    loadError = null
    clickBuildError = null
    clickLaneReady = false
    pendingStartWhenClickReady = null
    // The sidecar rescan reflects on-disk changes (e.g. a cue track just
    // rendered) but it's a full HTTP round-trip. On a live SONG SWITCH every
    // song's stem metadata is already loaded, so the rescan only delays the
    // load without changing what we load — skip it there (`rescan=false`) to
    // keep switching instant. Keep it on mount + explicit refresh signals.
    const warmEngine = engine
    const warmSm = get(songMap)
    if (warmEngine && warmSm && warmSm.timeline.beats.length > 0) {
      // Fire-and-forget: the click lane's loader awaits the same cache entry.
      void renderClickCached(warmEngine, warmSm, getPrimaryCueTrack(warmSm))
    }
    if (rescan) {
      loadingMsg = 'Scanning project…'
      try {
        await refreshProjectInfo()
      } catch {
        /* sidecar offline — fall through with whatever's cached */
      }
    }
    await loadAndRegisterTracks()
  }

  /**
   * Rebuilding the mixer is NOT re-entrant: it wipes every track and then
   * rebuilds asynchronously. Two overlapping calls therefore wipe each other's
   * freshly-added tracks and can leave the mixer empty — silence, with the
   * decode work still burning CPU.
   *
   * So reloads are serialized: a call arriving while one is in flight rides
   * along and asks for exactly one more pass afterwards, which is what a
   * coalesced "something changed again" needs.
   */
  /**
   * `rescan` for the NEXT pass; a coalesced burst rescans if any caller asked.
   */
  let pendingRescan = true
  const runReload = createReloadSerializer(async () => {
    const eng = engine
    if (!eng) return
    const rescan = pendingRescan
    pendingRescan = true
    // Wipe existing tracks + buffers so re-loading is a clean slate.
    for (const t of eng.listTracks()) eng.removeTrack(t.key)
    syncLanesFromEngine()
    await syncAndLoad(rescan)
  })

  async function reload(rescan = true) {
    if (!engine) return
    if (!rescan) pendingRescan = false
    await runReload()
  }

  $effect(() => {
    if (repeatSectionEnabled && repeatSectionId && !repeatSectionRange) {
      repeatSectionEnabled = false
      repeatSectionId = null
    }
    if (replayOnceSectionId && !replayOnceSectionRange) {
      replayOnceSectionId = null
      replayOnceConsumed = false
    }
    const sectionIds = new Set(sectionTimelineRanges.map((section) => section.id))
    if (drumMachineScope !== 'song' && !sectionIds.has(drumMachineScope)) drumMachineScope = 'song'
    if (bassMachineScope !== 'song' && !sectionIds.has(bassMachineScope)) bassMachineScope = 'song'
  })

  $effect(() => {
    if (!initialPlaybackModeSeeded) {
      initialPlaybackModeSeeded = true
      if (initialPlaybackMode) playbackMode = true
    }
    if (lockPlaybackMode && !playbackMode) playbackMode = true
  })

  // Parent-driven reload — only used when a NEW lane must appear (e.g. the
  // Overview toggle just rendered the cue WAV). Skips the initial value so
  // mount's own load isn't duplicated.
  let lastReloadSignal = untrack(() => reloadSignal)
  let lastTransposeForReload = untrack(() => transposeSemitones)
  let lastActiveProjectSongId = untrack(() => get(projectStore).activeSongId)
  let transposeReloadGeneration = 0
  $effect(() => {
    const sig = reloadSignal
    if (sig === lastReloadSignal) return
    lastReloadSignal = sig
    void reload()
  })

  $effect(() => {
    const semitones = transposeSemitones
    if (semitones === lastTransposeForReload) return
    lastTransposeForReload = semitones
    if (!engine) return
    transposeReloadGeneration += 1
    const generation = transposeReloadGeneration
    const wasPlaying = snapshot.state === 'playing'
    const resumeAt = snapshot.positionSec
    if (wasPlaying) engine.pause()
    void (async () => {
      await reload(false) // pitch change only — no on-disk metadata changed
      if (generation !== transposeReloadGeneration || !engine || loadError) return
      engine.seek(resumeAt)
      if (wasPlaying) await engine.play(resumeAt)
    })()
  })

  $effect(() => {
    const activeId = $projectStore.activeSongId
    if (activeId === lastActiveProjectSongId) return
    lastActiveProjectSongId = activeId
    if (!engine) return
    // New song: reset the transport to a clean stopped-at-0 state. reload()
    // only swaps the buffers — without this the engine clock would carry over
    // and the next song would resume at the previous song's playhead. Also
    // disarm any section replay/loop, which pointed at the old song's sections.
    engine.stop()
    replayOnceSectionId = null
    replayOnceConsumed = false
    repeatSectionEnabled = false
    repeatSectionId = null
    void reload(false) // song switch — metadata already loaded; keep it instant
  })

  // ── Live prefetch — never watch stems load mid-set ─────────────────────────
  // While the current song plays, pre-DECODE the next song's stems on this
  // engine's persistent AudioContext and evict songs outside the window, so
  // hitting Next installs buffers with zero fetch/decode. Bytes for the rest of
  // the set are warmed (cloud → IndexedDB) so even a far jump never waits on the
  // network. Auto/background; live stage only. Pure policy lives in
  // `livePrefetch.ts`; the decoded-buffer cache in `liveAudioCache.ts`.

  /** Map a setlist song id to a stem descriptor (disk folder + cloud id). */
  function stemDescriptorFor(
    songId: string,
  ): { osPath: string | null; folder: string | null; songId: string } | null {
    const ps = get(projectStore)
    const entry = ps.data?.songs.find((s) => s.id === songId)
    return { osPath: ps.osPath, folder: entry?.folder ?? null, songId }
  }

  let prefetchGeneration = 0
  async function runLivePrefetch() {
    if (!engine) return
    const setlist = projectSongNavItems.map((s) => s.id)
    const currentIndex = activeProjectSongIndex
    if (currentIndex < 0 || setlist.length < 2) return

    const generation = (prefetchGeneration += 1)
    const alive = () => engine != null && generation === prefetchGeneration
    const activeId = get(projectStore).activeSongId
    // "Fetched" (blue dot) = bytes cached in IndexedDB that OUTLIVE eviction — a
    // cloud-only concept. For a disk project the bytes are always local, so the
    // only meaningful states are cold and ready; don't flag disk songs fetched.
    const isCloud = isBrowserCloudProject(get(projectStore))

    const plan = prefetchPlan({
      setlist,
      currentIndex,
      decoded: decodedSongIds(),
      fetched: get(liveFetchedSongs),
      window: 1,
    })

    // Evict first — free RAM before allocating the next song's buffers.
    for (const id of plan.evict) if (id !== activeId) evictPreloaded(id)

    // Pre-decode the upcoming song(s). Skip the current song (the foreground
    // load already decoded + cached it) and anything already resident.
    for (const songId of plan.decode) {
      if (!alive()) return
      if (songId === activeId || getPreloadedStems(songId)) continue
      const desc = stemDescriptorFor(songId)
      if (!desc) continue
      try {
        const blobs = await loadSongStemBlobsFor(desc, { includeOriginal: true })
        if (!alive()) return
        if (blobs.length === 0) {
          if (isCloud) markFetched(songId)
          continue
        }
        const decoded = new Map<string, AudioBuffer>()
        for (const b of blobs) {
          if (!alive()) return
          decoded.set(b.key, await engine.ac.decodeAudioData(await b.blob.arrayBuffer()))
        }
        if (!alive()) return
        putPreloadedStems(songId, decoded)
        if (isCloud) markFetched(songId)
      } catch (e) {
        console.warn('[live-prefetch] decode failed', songId, e)
      }
    }

    // Warm the rest of the set's BYTES nearest-first — CLOUD ONLY. For cloud,
    // `loadSongStemBlobsFor` fetches over the network and caches to IndexedDB,
    // so a far jump then only pays decode, never the wire. For a disk project
    // the bytes are already local (localhost reads are fast) and the slow part
    // is decode, which the window already covers — reading whole stem files off
    // disk just to drop them would be pointless IO, so we skip it.
    if (isCloud) {
      for (const songId of plan.fetch) {
        if (!alive()) return
        if (songId === activeId || get(liveFetchedSongs).has(songId)) continue
        const desc = stemDescriptorFor(songId)
        if (!desc) continue
        try {
          await loadSongStemBlobsFor(desc) // side effect: fills the cloud byte cache
          markFetched(songId)
        } catch (e) {
          console.warn('[live-prefetch] warm failed', songId, e)
        }
      }
    }
  }

  $effect(() => {
    if (!liveMode || !engineReady) return
    // Track: re-warm whenever the position in the setlist changes.
    const idx = activeProjectSongIndex
    void projectSongNavItems.map((s) => s.id).join('|')
    if (idx < 0) return
    // Defer so the foreground load of the CURRENT song (what the operator is
    // waiting on) isn't slowed by background decode work.
    const handle = setTimeout(() => void runLivePrefetch(), 1200)
    return () => clearTimeout(handle)
  })

  // Keep the cue lane's mute in sync with mixState (per-machine, stripped from
  // cloud sync). The Overview "Play cues" toggle flips this — applying it live
  // here means no full reload and no cloud conflict for a local preference.
  $effect(() => {
    const desiredMuted = $songMap?.mixState?.tracks.find((t) => t.key === 'cue')?.muted ?? false
    if (!engine) return
    const t = engine.listTracks().find((x) => x.key === 'cue')
    if (t && t.muted !== desiredMuted) {
      engine.setMuted('cue', desiredMuted)
      syncLanesFromEngine()
    }
  })

  // ── Chord jam (keys / bass / arp as a live instrument) ───────────────────
  // The schedules derive from the song map; the playhead is pushed in from
  // `handleTransportUpdate`. Settings are per-device and pushed into the synths
  // here so a MIDI-driven change takes effect without a UI round-trip.
  $effect(() => {
    chordJam.configure($songMap)
    chordJam.setTransposeSemitones(transposeSemitones)
  })
  // Re-read the persisted jam switches ONCE, at mount, before the sync effect
  // below can write. The singleton reads localStorage at import; without this,
  // mounting the mixer wrote its stale page-load values back over an edit made
  // in the Chords tab — un-checking "hear chords" there, then opening the
  // mixer, silently turned it back ON for every future load.
  //
  // Deliberately NOT inside the effect: there it would re-run on every synced
  // change and revert in-session toggles (an APC jam toggle would flip
  // straight back).
  chordJam.reloadFromStorage()
  $effect(() => {
    chordJam.syncSettings()
  })
  onDestroy(() => chordJam.releaseAll())

  onDestroy(() => {
    // A queued machine refresh must not fire into a torn-down engine.
    machineRefreshQueue.cancel()
  })

  onMount(() => {
    // Fresh engine → fresh AudioContext. Any buffers cached against a prior
    // context are now invalid, so wipe the live prefetch cache before we start
    // warming this session's songs.
    clearLiveAudioCache()
    // The output LAYOUT, DERIVED — no switch anyone has to remember. 'auto'
    // (the default) splits click/cue onto their own channels exactly when the
    // evidence says this is the rig: the device carries ≥4 channels AND a
    // desk address is saved on this machine. A laptop, or an HDMI TV with its
    // 6 phantom channels, derives plain stereo. `liveRigLayout` additionally
    // degrades any impossible request back to stereo, in words.
    const rigSetup = loadRigSetup()
    const deviceChannels = audioDevice().destination.maxChannelCount
    const layout = liveRigLayout({
      profileRequest: resolveProfileRequest(rigSetup, deviceChannels),
      deviceChannels,
      firstDeskChannel: rigSetup.leftCh,
    })
    engine = new MixerEngine(undefined, { layout })
    // The engine's REAL output mode, on the record. If this says stereo while
    // the Rig dialog says separation is on, the engine is the truth and the
    // dialog's derivation has drifted — believe this line.
    engineSplitActive = engine.outputSplitActive
    console.info(
      `[mixer] output: ${engine.outputSummary} (device ${audioDevice().destination.maxChannelCount} ch, requested ${resolveProfileRequest(rigSetup, deviceChannels)})`,
    )
    engine.onUpdate(handleTransportUpdate)
    // Cues tap the master bus: they get master volume + master processing but
    // are unaffected by individual stem mutes/solos.
    // The UN-SHIFTED path: a spoken cue must never be pitch-shifted with the
    // song, but it must still land in time — that path carries the shifter's
    // latency compensation, which tapping the master directly did not.
    // Spoken cues get their OWN output channel when the device has one, so the
    // desk can keep them out of the house exactly like the click. Falls back to
    // the normal path on stereo hardware, where there is nowhere else to put
    // them — see `liveOutputMap`.
    cueScheduler = new LiveCueScheduler(engine.ac, engine.cueOutput ?? engine.unshiftedInput)
    engineReady = true
    void syncAndLoad()
  })

  onDestroy(() => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    cueScheduler?.dispose()
    cueScheduler = null
    void engine?.dispose()
    engine = null
    engineSplitActive = false
  })

  // Measure the app chrome (navbar + context bar + any banners) so the fixed
  // playback stage starts right below it instead of being hidden behind it.
  $effect(() => {
    if (liveMode || !playbackMode || typeof document === 'undefined') return
    const measure = () => {
      const scroll = document.querySelector('.app-scroll')
      chromeInsetPx = scroll ? Math.max(0, Math.round(scroll.getBoundingClientRect().top)) : 0
    }
    measure()
    window.addEventListener('resize', measure)
    let ro: ResizeObserver | null = null
    const chrome = document.querySelector('.app-scroll')?.previousElementSibling
    if (chrome && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(chrome)
    }
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  })

  // Live keyboard surface — active whenever the playback stage is open (editor
  // playback mode AND the live page). Deliberately small + safe: nothing here
  // exits, restarts the project, or edits. Ignored while typing in a field.
  //   Space play/pause · S stop · ←/→ prev/next song · R replay section once
  //   · L loop section · 1–8 toggle stem
  $effect(() => {
    if (typeof window === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.code === 'Space' || e.key === ' ') {
        // Space is the transport EVERYWHERE in the mixer, not just on the
        // playback stage. DAWs keep this global even after you clicked a
        // button/fader; only actual text entry keeps the character.
        e.preventDefault()
        e.stopPropagation()
        if (mixerCanPlay) onPlayPause()
        return
      }

      // Everything below is a STAGE control (song nav, section replay/loop,
      // stem toggles) and stays scoped to playback mode.
      if (!playbackMode) return
      if (e.key === 'ArrowRight') {
        if (!canGoNextProjectSong) return
        e.preventDefault()
        void onNextProjectSong()
        return
      }
      if (e.key === 'ArrowLeft') {
        if (!canGoPreviousProjectSong) return
        e.preventDefault()
        void onPreviousProjectSong()
        return
      }
      if (/^[1-8]$/.test(e.key)) {
        // Same fixed slots as the APC pads, so key 1 and pad 1 are one control
        // and both follow the track's live-button link.
        const slot = Number(e.key) - 1
        if (!liveLanes[slot]) return
        e.preventDefault()
        toggleLiveSlot(slot)
        return
      }
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        onStop()
      } else if (k === 'r') {
        if (!currentSectionRange) return
        e.preventDefault()
        replayCurrentSectionOnce()
      } else if (k === 'l') {
        if (!currentSectionRange && !repeatSectionEnabled) return
        e.preventDefault()
        toggleRepeatSection()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
</script>

<div
  class={liveMode
    ? 'flex min-h-0 flex-1 flex-col gap-3 px-0 py-0'
    : playbackMode
      ? 'fixed bottom-0 left-0 right-0 z-[100] flex flex-col gap-3 overflow-hidden px-4 py-4 sm:px-8'
      : 'bg-background space-y-3 px-3 py-3'}
  style={liveMode
    ? undefined
    : playbackMode
      ? `top: ${chromeInsetPx}px; background-color: var(--background); background-image: repeating-linear-gradient(90deg, color-mix(in oklch, var(--foreground) 4%, transparent) 0 1px, transparent 1px 42px), repeating-linear-gradient(0deg, color-mix(in oklch, var(--foreground) 3%, transparent) 0 1px, transparent 1px 42px); background-position: 0 ${-(chromeInsetPx % 42)}px;`
      : undefined}
>
  <!-- Transport bar — full controls in overview only; playback mode uses a clean header. -->
  {#if !playbackMode}
  <div class="border-foreground/30 flex flex-wrap items-center gap-2 border-b-2 pb-2">
    <Button
      variant="outline"
      size="sm"
      class="h-9 w-9 p-0"
      onclick={onRestartSong}
      disabled={!mixerCanPlay}
      aria-label="Restart song"
      title="Restart song"
    >
      <RotateCcw class="size-3.5" aria-hidden="true" />
    </Button>
    <div class="font-mono text-sm tabular-nums">
      {fmtTime(snapshot.positionSec)} / {fmtTime(snapshot.durationSec)}
    </div>
    {#if projectSoundOn}
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border-2 px-2 text-xs font-bold transition-colors {soundBypassed
          ? 'border-foreground/40 bg-background text-muted-foreground'
          : 'border-foreground bg-foreground text-background'}"
        onclick={toggleSoundBypass}
        aria-pressed={!soundBypassed}
        title={soundBypassed
          ? 'Playing the original, untreated sound — click to hear the project sound'
          : 'Playing with the project sound — click to compare with the original'}
      >
        <span
          class="size-2 rounded-full {soundBypassed ? 'bg-foreground/30' : 'bg-emerald-400'}"
          aria-hidden="true"
        ></span>
        {soundBypassed ? 'Original' : 'Project sound'}
      </button>
    {/if}
    {#if !playbackMode}
      <div
        class="bg-muted/70 ring-foreground/10 flex min-w-0 flex-[1_1_24rem] items-center gap-2 overflow-hidden rounded-[var(--radius)] px-2 py-1 ring-1"
        aria-live="polite"
        aria-label={`${currentChordHeading}: ${currentChordLabel}`}
      >
        <div class="min-w-[7.5rem] flex-none">
          <div class="flex items-baseline gap-2">
            <span class="text-muted-foreground text-[10px] font-black uppercase">Chord</span>
            <span class="truncate font-mono text-lg leading-none font-black tabular-nums">{currentChordLabel}</span>
          </div>
          <div class="bg-foreground/10 mt-1 h-1.5 overflow-hidden rounded-full">
            <div
              class="bg-primary h-full rounded-full transition-[width] duration-100 ease-linear"
              style={`width: ${currentChordProgressPct}%`}
            ></div>
          </div>
          <div class="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[10px] leading-none font-bold tabular-nums">
            <span class="uppercase">Next</span>
            <span class="text-foreground truncate font-black">{nextChordView?.label ?? 'End'}</span>
            {#if nextChordView}
              <span>{nextChordView.startsInLabel}</span>
            {/if}
          </div>
        </div>
        <div
          class="bg-background/70 ring-foreground/10 relative h-9 min-w-0 flex-1 overflow-hidden rounded-[var(--radius)] ring-1"
          aria-label="Upcoming chord approach lane"
        >
          <div
            class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px"
            style="left: 33%"
          ></div>
          <div
            class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px"
            style="left: 66%"
          ></div>
          {#if chordApproachViews.length === 0}
            <span class="text-muted-foreground flex h-full items-center justify-center text-xs font-bold">End</span>
          {:else}
            {#each chordApproachViews as seg (seg.id)}
              <span
                class="ring-foreground/10 absolute top-1/2 flex h-7 -translate-y-1/2 items-center justify-center overflow-hidden rounded-[var(--radius)] px-1 text-center font-mono text-xs leading-none font-black tabular-nums shadow-sm ring-1 transition-[left,width,opacity] duration-100 ease-linear {seg.active
                  ? 'bg-primary text-primary-foreground ring-primary/20'
                  : seg.id === nextChordView?.id
                    ? 'bg-primary/20 text-foreground ring-primary/40'
                  : 'bg-background/95 text-foreground'}"
                style={`left: ${seg.leftPct}%; width: ${seg.widthPct}%; opacity: ${seg.opacity}; z-index: ${seg.active ? 4 : seg.id === nextChordView?.id ? 3 : 1};`}
                title={`${seg.label} in ${seg.startsInLabel}`}
              >
                {seg.label}
              </span>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
    {#if !playbackMode}
      <div class="text-muted-foreground ml-auto text-xs">
        {lanes.length} track{lanes.length === 1 ? '' : 's'}
      </div>
      <Button
        variant="outline"
        size="sm"
        class="h-8 gap-1 px-2"
        onclick={() => void reload()}
        disabled={loading}
        title="Re-scan disk and reload all tracks"
      >
        <RefreshCw class="size-3.5 {loading ? 'animate-spin' : ''}" aria-hidden="true" />
        Reload
      </Button>
    {/if}
  </div>
  {/if}

  {#if showRig && !playbackMode}
  <LiveHardwareStrip
    lanes={liveHardwareLanes}
    projectId={$projectStore.data?.id ?? null}
  />
  <ApcKey25Control
    lanes={liveHardwareLanes}
    isPlaying={snapshot.state === 'playing'}
    onPlayPause={onPlayPause}
    onStop={onStop}
    onRestartSong={onRestartSong}
    onReplaySectionOnce={replayCurrentSectionOnce}
    onLaneVolumeChange={onVolume}
    onToggleLaneMuted={onToggleMuted}
    canRestartSong={mixerCanPlay}
    canReplaySectionOnce={!!currentSectionRange}
    sectionReplayOnceArmed={!!replayOnceSectionRange}
    canGoPreviousSong={canGoPreviousProjectSong}
    canGoNextSong={canGoNextProjectSong}
    onPreviousSong={onPreviousProjectSong}
    onNextSong={onNextProjectSong}
  />
  {/if}

  {#if loadError}
    <p class="text-destructive text-sm" role="status">{loadError}</p>
  {:else if loading}
    <p class="text-muted-foreground text-sm">{loadingMsg}</p>
  {/if}
  {#if clickBuildError && !loading}
    <p class="text-destructive text-sm" role="status">{clickBuildError}</p>
  {/if}
  {#if laneLoadWarning && !loading}
    <p class="text-destructive text-sm" role="status">{laneLoadWarning}</p>
  {/if}

  {#if playbackMode}
    <LiveMidiController enabled={playbackMode} onCommand={handleLiveMidiCommand} led={liveLedState} />
    {#if liveMode && $isNarrow}
      <!-- Read-only PHONE live stage: balanced, non-scrolling, reusing the same
           chord/lyric/waveform derivations. Desktop stage below is untouched. -->
      <LiveStageMobile
        chordRow={mobileChordRow}
        {lyricLines}
        {currentLyricIdx}
        {lyricsSongTime}
        waveBuffer={stageWaveformLane?.buffer ?? null}
        positionSec={snapshot.positionSec}
        durationSec={snapshot.durationSec}
        {sectionBands}
        {onSeekFraction}
        isPlaying={snapshot.state === 'playing'}
        {onPlayPause}
        {onStop}
      />
    {:else}
    <section class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden" aria-label="Playback mode">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="border-foreground bg-foreground text-background inline-flex size-12 shrink-0 items-center justify-center rounded-full border-2 shadow-md transition hover:brightness-110 disabled:opacity-40"
            onclick={onPlayPause}
            disabled={!mixerCanPlay}
            aria-label={snapshot.state === 'playing' ? 'Pause' : 'Play'}
          >
            {#if snapshot.state === 'playing'}
              <Pause class="size-6" aria-hidden="true" />
            {:else}
              <Play class="size-6 translate-x-0.5" aria-hidden="true" />
            {/if}
          </button>
          <button
            type="button"
            class="border-foreground/40 text-foreground hover:border-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-40"
            onclick={onStop}
            disabled={!mixerCanPlay}
            aria-label="Stop"
            title="Stop (S)"
          >
            <Square class="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="border-foreground/40 text-foreground hover:border-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-40"
            onclick={onRestartSong}
            disabled={!mixerCanPlay}
            aria-label="Restart song"
            title="Restart song"
          >
            <RotateCcw class="size-4" aria-hidden="true" />
          </button>
          <!--
            Section replay-once (blinks while armed) + loop (lit while looping).

            ICON-ONLY, like every other transport control. The words "Once" and
            "Loop" cost about 140px between them in a row that already carries
            eight controls, a readout and the live pills — enough to make
            the whole bar wrap and eat the stage. Both have keyboard shortcuts
            (R and L) and a tooltip, and their lit states say more than the label
            did.
          -->
          <button
            type="button"
            class="inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-40 {replayOnceSectionRange
              ? 'border-foreground bg-foreground text-background animate-pulse'
              : 'border-foreground/40 text-foreground hover:border-foreground'}"
            onclick={replayCurrentSectionOnce}
            disabled={!currentSectionRange && !replayOnceSectionRange}
            aria-pressed={!!replayOnceSectionRange}
            aria-label={replayOnceButtonLabel}
            title={replayOnceButtonLabel + ' — R'}
          >
            <Repeat1 class="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-40 {repeatSectionRange
              ? 'border-destructive bg-destructive text-white'
              : 'border-foreground/40 text-foreground hover:border-foreground'}"
            onclick={toggleRepeatSection}
            disabled={!currentSectionRange && !repeatSectionEnabled}
            aria-pressed={!!repeatSectionRange}
            aria-label={repeatSectionButtonLabel}
            title={repeatSectionButtonLabel + ' — L'}
          >
            <Repeat class="size-4" aria-hidden="true" />
          </button>
          <!--
            The Rig button is NOT here any more.

            It is a setup control sitting among performance controls, the same
            size as Play's neighbours, competing for the eye during a song. It
            has moved down to the in-ear line, where it is next to the thing it
            fixes: if a monitor goes red, the way to do something about it is
            immediately beside it.
          -->
          {#if !liveMode}
            <button
              type="button"
              class="border-foreground/40 text-foreground hover:border-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
              onclick={() => (xairPanelOpen = true)}
              aria-label="XR18 live rig"
              title="XR18 live rig — routing, in-ear monitor mixes, house-safety"
            >
              <Cable class="size-4" aria-hidden="true" />
            </button>
          {/if}
          <!-- Setlist prev / next — the new song loads ready at its start. -->
          <button
            type="button"
            class="border-foreground/40 text-foreground hover:border-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-40"
            onclick={() => void onPreviousProjectSong()}
            disabled={!canGoPreviousProjectSong}
            aria-label="Previous song"
            title="Previous song (←)"
          >
            <SkipBack class="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="border-foreground/40 text-foreground hover:border-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-40"
            onclick={() => void onNextProjectSong()}
            disabled={!canGoNextProjectSong}
            aria-label="Next song"
            title="Next song (→)"
          >
            <SkipForward class="size-4" aria-hidden="true" />
          </button>
          <div class="min-w-0">
            <!-- In live mode the playback page's banner already shows the song
                 title; suppress the duplicate here. -->
            {#if !liveMode}
              <h2 class="text-foreground truncate text-2xl font-black leading-none sm:text-3xl">{songTitle}</h2>
            {/if}
            <!--
              WHAT YOU GLANCE AT MID-SONG, and nothing else.

              Position and the section you are in change constantly and are the
              reason to look here at all. The key and the BPM do not change
              during a song — they are reference, they are already on the
              chord lane and the song header, and on stage they were pure width
              in a bar that was wrapping because of it.
            -->
            <div class="text-foreground flex items-baseline gap-2 font-mono text-sm font-black tabular-nums">
              <span>{fmtTime(snapshot.positionSec)}</span>
              <span class="text-muted-foreground font-normal">/ {fmtTime(snapshot.durationSec)}</span>
              {#if currentSectionRange}
                <span class="text-muted-foreground truncate font-normal">{currentSectionRange.label}</span>
              {/if}
              {#if !liveMode}
                <span class="text-muted-foreground font-normal">{songKeyLabel}</span>
                <span class="text-muted-foreground font-normal">{songBpmLabel}</span>
              {/if}
            </div>
          </div>
        </div>
        <div class="flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {#if liveMode}
            <button
              type="button"
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-black transition-colors {largeStageText
                ? 'bg-[var(--studio-orange)] text-[var(--studio-ink)] shadow-sm'
                : 'bg-foreground/8 text-muted-foreground hover:bg-foreground/15 hover:text-foreground'}"
              onclick={() => (largeStageText = !largeStageText)}
              aria-pressed={largeStageText}
              aria-label="Large chords and lyrics"
              title="Make upcoming chords and lyrics larger"
            >
              <ALargeSmall class="size-4" aria-hidden="true" />
              Large view
            </button>
          {/if}
          <!-- The 10 canonical live slots, in controller order: slots 1-8 are
               the APC's bottom row / track buttons; Custom 1/2 begin row 4.
               The arranging mixer below
               still lists every lane; that is the place to see machines and to
               link a track to a live button. -->
          <!-- ONE segmented pill, not loose ones: the canonical buttons in a
               single rounded strip with straight dividers, so it reads as one
               control and its segments line up with the controller's row.
               THREE distinct states, because "this song hasn't got one" and
               "you switched it off" must never look alike:
                 · absent  — hollow, dashed divider, no dot, not clickable
                 · off     — solid muted fill, hollow dot
                 · on      — inverted fill, coloured dot (glow = sounding now) -->
          <div
            class="border-foreground/40 inline-flex h-8 max-w-full overflow-hidden rounded-full border"
            role="group"
            aria-label="Live tracks"
          >
            {#each liveSlotPills as pill, i (pill.slot)}
              <button
                type="button"
                disabled={!pill.present}
                class="relative inline-flex items-center gap-1.5 px-2.5 text-[11px] font-black transition-all {i > 0
                  ? 'border-l'
                  : ''} {pill.present
                  ? 'border-foreground/40 hover:brightness-110'
                  : 'border-foreground/20 cursor-default border-dashed'} {pill.present && pill.on
                  ? 'bg-foreground text-background'
                  : pill.present
                    ? 'bg-muted/60 text-muted-foreground'
                    : 'text-muted-foreground/35 bg-transparent'}"
                style={pill.active ? `box-shadow: inset 0 -2px 0 0 ${pill.color}` : ''}
                onclick={() => toggleLiveSlot(pill.slot)}
                title={!pill.present
                  ? `${pill.label} — button ${pill.slot + 1}: not in this song`
                  : `${pill.on ? 'Turn off' : 'Turn on'} ${pill.label} (button ${pill.slot + 1})`}
                aria-pressed={pill.present && pill.on}
                aria-disabled={!pill.present}
                aria-label={`${pill.label}, live button ${pill.slot + 1}${pill.present ? '' : ', not in this song'}`}
              >
                {#if pill.present}
                  <span
                    class="size-2 shrink-0 rounded-full transition-colors"
                    style={`background: ${pill.on ? pill.color : 'transparent'}; box-shadow: inset 0 0 0 1px ${pill.on ? pill.color : 'color-mix(in oklch, var(--foreground) 35%, transparent)'}`}
                  ></span>
                {/if}
                {pill.label}
                {#if pill.count > 1}
                  <span class="font-mono text-[9px] opacity-70">×{pill.count}</span>
                {/if}
              </button>
            {/each}
          </div>
          {#if !liveMode}
            <button
              type="button"
              class="border-foreground/50 text-foreground hover:bg-foreground hover:text-background ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border-2 px-2.5 text-xs font-black uppercase transition-colors"
              onclick={() => (playbackMode = false)}
              title="Exit playback mode"
            >
              <X class="size-3.5" aria-hidden="true" />
              Exit
            </button>
          {/if}
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
        <!-- Current chord — centered toward the middle, big but not overwhelming. -->
        <div class="flex flex-col items-center text-center">
          <div class="text-muted-foreground text-xs font-black uppercase tracking-wider">{currentChordHeading}</div>
          <!--
            Smaller than it was (7xl/8xl). The chord is read in a glance from a
            distance, and one glance does not need eight rem of it — the height
            it was taking came straight out of the lyrics, which are read
            continuously and are the harder thing to follow on a stage.
          -->
          <div class="font-mono text-5xl leading-none font-black tabular-nums sm:text-6xl">
            {currentChordLabel}
          </div>
          <div class="bg-foreground/10 mt-3 h-2 w-56 max-w-[70vw] overflow-hidden rounded-full">
            <div
              class="bg-primary h-full rounded-full transition-[width] duration-100 ease-linear"
              style={`width: ${currentChordProgressPct}%`}
            ></div>
          </div>
          <div class="text-muted-foreground mt-1 font-mono text-xs tabular-nums">
            {currentChordRemainingLabel} left
          </div>
        </div>

        <!-- Upcoming chords approach lane (Guitar-Hero style) — half height. -->
        <div class="w-full {largeStageText ? 'max-w-6xl' : 'max-w-4xl'}">
          <div class="flex items-center justify-between gap-3 px-1">
            <div class="text-muted-foreground text-xs font-black uppercase">Upcoming chords</div>
            <div class="text-muted-foreground flex items-center gap-1 font-mono text-[10px] font-bold tabular-nums">
              <span class="uppercase">Next</span>
              <span class="text-foreground font-black">{nextChordView?.label ?? 'End'}</span>
              {#if nextChordView}
                <span>{nextChordView.startsInLabel}</span>
              {/if}
            </div>
          </div>
          <!--
            A SOFT DARK BLOB BEHIND THE BARS — not a box, and not a shadow drawn
            around a box.

            The lane used to be a 2px border over a flat tint: a hard rectangle
            around the busiest part of the stage, carrying no information. The
            first attempt at removing it just moved the rectangle into a
            box-shadow, which is the same box wearing a softer edge.

            This is a radial gradient that is densest under the bars and feathers
            to nothing well before any edge, so there IS no edge — just a patch
            of depth for the chords to travel over. The right side is masked so
            bars entering the lane fade in rather than being sliced by a clip
            boundary that would give the rectangle away again.

            Taller than before (h-24) because the bars grew: three rows at 36px
            pitch with a 33.6px bar needs 109px, and the old height clipped the
            bottom row.
          -->
          <div class="relative mt-2 {largeStageText ? 'h-36' : 'h-28'}">
            <!--
              A WASH IN THE SECTION'S OWN COLOUR, POURED FROM THE PLAYHEAD.

              Not a shadow. A neutral dark blob was the wrong idea twice over:
              it sat behind the line as well as in front of it, and it carried
              no meaning. This starts exactly AT the playhead — nothing spills
              to its left — and fades away to the right, so the lane reads as
              light thrown forward from "now" rather than as a container.

              It takes `currentSectionColor`, so the runway is the same colour
              as the line and the section you are in, and changes with it.

              Both ends are handled so no rectangle can reappear: the horizontal
              stops die out before the right edge, and a vertical mask feathers
              the top and bottom. The only hard edge left is the left one, which
              is the playhead — and that is meant to be seen.
            -->
            <div
              class="pointer-events-none absolute inset-0"
              style={`background: linear-gradient(90deg,
                  color-mix(in oklch, ${currentSectionColor} 24%, transparent) 0%,
                  color-mix(in oklch, ${currentSectionColor} 11%, transparent) 28%,
                  color-mix(in oklch, ${currentSectionColor} 4%, transparent) 58%,
                  transparent 86%);
                -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 20%, #000 80%, transparent 100%);
                mask-image: linear-gradient(180deg, transparent 0%, #000 20%, #000 80%, transparent 100%);`}
              aria-hidden="true"
            ></div>
            <!--
              The clipped layer: bars only. Masked on the right so a chord
              sliding in fades up rather than appearing at a cut edge.
            -->
            <div
              class="absolute inset-0 overflow-hidden"
              style="-webkit-mask-image: linear-gradient(90deg, #000 0%, #000 88%, transparent 100%);
                mask-image: linear-gradient(90deg, #000 0%, #000 88%, transparent 100%);"
              aria-label="Upcoming chord approach lane"
            >
            <!--
              Faint time gridlines, faded out top and bottom. Full-height lines
              would draw the rectangle's edges back in by implication, which is
              exactly what the blob is there to avoid.
            -->
            <div
              class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px"
              style="left: 33%; -webkit-mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent); mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent);"
            ></div>
            <div
              class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px"
              style="left: 66%; -webkit-mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent); mask-image: linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent);"
            ></div>

            <!--
              The playhead: chords fire when they slide into it.

              Its old companion — a separate 12%-wide gradient marking the hit
              zone — is gone. The section-coloured wash behind the whole lane is
              already densest right here and fades from it, so the two were
              painting the same idea on top of each other.
            -->
            <div
              class="pointer-events-none absolute inset-y-0 left-0 z-[5] w-1"
              style={`background: ${currentSectionColor}; box-shadow: 0 0 12px 1px color-mix(in oklch, ${currentSectionColor} 75%, transparent);`}
            ></div>
            <div
              class="pointer-events-none absolute bottom-0.5 left-2 z-[6] text-[9px] font-black uppercase tracking-wider"
              style={`color: ${currentSectionColor};`}
            >
              Now
            </div>

            {#if chordApproachViews.length === 0}
              <div class="text-muted-foreground flex h-full items-center justify-center text-sm font-bold">
                End
              </div>
            {:else}
              {#each chordApproachViews as seg (seg.id)}
                <!--
                  Bars are 20% taller (was h-7 / 28px) with the row pitch grown
                  to match — 30px would have overlapped them.
                -->
                <div
                  class="absolute overflow-hidden rounded-[var(--radius)] transition-[left,top,width,opacity] duration-100 ease-linear {largeStageText
                    ? 'h-11'
                    : 'h-[2.1rem]'} {seg.active
                    ? ''
                    : largeStageText
                      ? 'min-w-[4.75rem]'
                      : 'min-w-[3.5rem]'}"
                  style={`left: ${seg.leftPct}%; top: ${seg.row * (largeStageText ? 48 : 36) + 3}px; width: ${seg.widthPct}%; opacity: ${seg.opacity}; z-index: ${seg.active ? 4 : seg.id === nextChordView?.id ? 3 : 1};`}
                  title={`${seg.label} in ${seg.startsInLabel}`}
                >
                  <!--
                    Outlines dropped here too, for a shadow that lifts the bar
                    off the lane instead of drawing a box around it. The FILLS
                    stay: primary means "playing now" and orange means "next",
                    and those two carry meaning a border never did.
                  -->
                  <div
                    class="flex h-full items-center justify-center overflow-hidden rounded-[var(--radius)] px-1.5 {seg.active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground'}"
                    style={seg.active
                      ? 'box-shadow: 0 1px 4px color-mix(in oklch, var(--foreground) 26%, transparent);'
                      : seg.id === nextChordView?.id
                        ? 'background: color-mix(in oklch, var(--studio-orange) 88%, white); color: var(--studio-ink); box-shadow: 0 1px 4px color-mix(in oklch, var(--foreground) 26%, transparent);'
                        : 'background: var(--background); box-shadow: 0 1px 3px color-mix(in oklch, var(--foreground) 20%, transparent);'}
                  >
                    <span
                      class="whitespace-nowrap font-mono leading-none font-black tabular-nums {largeStageText
                        ? 'text-2xl'
                        : 'text-sm'}">{seg.label}</span
                    >
                  </div>
                </div>
              {/each}
            {/if}
          </div>
          </div>
        </div>
      </div>

      {#if lyricLines.length > 0}
        {@const prev = currentLyricIdx > 0 ? lyricLines[currentLyricIdx - 1] : null}
        {@const cur = currentLyricIdx >= 0 ? lyricLines[currentLyricIdx] : null}
        {@const next = lyricLines[currentLyricIdx + 1] ?? null}
        <!--
          Lyrics carry more of the weight than the chord does: they are read
          continuously rather than glanced at, and the line before and after are
          what stop you losing your place. All three rows grew, funded by the
          chord above shrinking.
        -->
        <div
          class="flex shrink-0 flex-col items-center justify-center gap-1.5 px-4 text-center {largeStageText
            ? 'min-h-[10rem]'
            : 'min-h-[8.5rem]'}"
          aria-label="Lyrics"
          aria-live="polite"
        >
          {#if lyricBreak.active}
            <LyricBreak
              untilSec={lyricBreak.untilSec}
              progress={lyricBreak.progress}
              nextText={lyricBreak.nextLine ? lyricBreak.nextLine.words.map((w) => w.text).join(' ') : ''}
            />
          {:else}
          <div
            class="text-muted-foreground/70 min-h-6 truncate font-bold {largeStageText ? 'text-xl' : 'text-lg'}"
          >
            {prev ? prev.words.map((w) => w.text).join(' ') : ' '}
          </div>
          <div
            class="min-h-12 font-black leading-snug {largeStageText ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'}"
          >
            {#if cur}
              <LyricConfidenceLine words={cur.words} songTime={lyricsSongTime} />
            {:else if next}
              <span class="text-muted-foreground">{next.words.map((w) => w.text).join(' ')}</span>
            {/if}
          </div>
          <div
            class="text-muted-foreground min-h-6 truncate font-bold {largeStageText ? 'text-xl' : 'text-lg'}"
          >
            {cur && next ? next.words.map((w) => w.text).join(' ') : ' '}
          </div>
          {/if}
        </div>
      {/if}

      <!--
        WHOSE IN-EARS ARE ALIVE — and the way into the rig, together on one
        line directly under the transport. Live stage only: off the stage there
        is no band wearing packs, and the same information lives in the Rig
        dialog where there is room for it.
      -->
      {#if liveMode}
        <div class="flex shrink-0 items-center gap-2">
          <div class="min-w-0 flex-1">
            <MonitorStatusStrip
              performers={livePerformers}
              songChannels={[9, 10]}
              clickChannel={11}
              outputSplit={engineSplitActive}
              onOpenRig={() => (xairPanelOpen = true)}
            />
          </div>
          <!--
            THE ONE WAY click and cues reach the main mix in live mode. Off by
            default, never persisted, and impossible to mistake for anything
            else when it is on: the room is about to hear the count-in.
          -->
          {#if engineSplitActive}
            <!-- The split rig: click/cue leave on their own desk channels, off
                 the house by the desk's own (verified) routing. There is no
                 "put them in the main" here — the toggle would be a lie. -->
            <span
              class="border-foreground/30 text-foreground/60 inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-[11px] font-black"
              title="This rig sends click and cues on their own desk channels, straight to the band's ears. The house cannot receive them."
            >
              <span class="size-2 rounded-full bg-emerald-500" aria-hidden="true"></span>
              Click+cues in ears only
            </span>
          {:else}
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-[11px] font-black transition-colors {practiceOutputOn
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-foreground/30 text-foreground/60 hover:border-foreground hover:text-foreground'}"
              onclick={() => (practiceOutputOn = !practiceOutputOn)}
              aria-pressed={practiceOutputOn}
              title={practiceOutputOn
                ? 'Click and cues are playing into the MAIN MIX — the room can hear them. For practice only; click to silence them.'
                : 'Click and cues are OFF the main mix (they only exist in monitor mixes). Switch on for practice without a desk — the room WILL hear them.'}
            >
              <span
                class="size-2 rounded-full {practiceOutputOn ? 'animate-pulse bg-white' : 'bg-foreground/25'}"
                aria-hidden="true"
              ></span>
              {practiceOutputOn ? 'Click+cues IN MAIN' : 'Click+cues off main'}
            </button>
          {/if}
        </div>
      {/if}

      <MixerStageWaveform
        buffer={stageWaveformLane?.buffer ?? null}
        color="var(--foreground)"
        positionSec={snapshot.positionSec}
        durationSec={snapshot.durationSec}
        {sectionBands}
        onSeekFraction={onSeekFraction}
      />
    </section>
    {/if}
  {:else if lanes.length > 0}
    <!-- Mixer panes: the CHANNELS, or the EFFECT BUSSES. Routing is edited
         from the bus, so a channel strip stays a channel strip. -->
    <div class="flex items-center gap-1" role="tablist" aria-label="Mixer view">
      <button
        type="button"
        role="tab"
        aria-selected={mixerTab === 'tracks'}
        class="rounded-[var(--radius)] border-2 px-2.5 py-1 text-xs font-bold transition-colors {mixerTab ===
        'tracks'
          ? 'border-foreground bg-foreground text-background'
          : 'border-foreground/25 bg-background hover:border-foreground/50'}"
        onclick={() => (mixerTab = 'tracks')}
      >
        Channels
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mixerTab === 'effects'}
        class="rounded-[var(--radius)] border-2 px-2.5 py-1 text-xs font-bold transition-colors {mixerTab ===
        'effects'
          ? 'border-foreground bg-foreground text-background'
          : 'border-foreground/25 bg-background hover:border-foreground/50'}"
        onclick={() => (mixerTab = 'effects')}
      >
        Effects{effectBusses.length ? ` (${effectBusses.length})` : ''}
      </button>

      <!-- Old per-song fader compensation double-counts against loudness
           matching. One press clears it — and deliberately leaves a role you
           have blended from several lanes alone. -->
      {#if mixerTab === 'tracks' && faderResetPlan.reset.length > 0}
        <button
          type="button"
          class="border-foreground/25 bg-background hover:border-foreground/50 ml-auto rounded-[var(--radius)] border-2 px-2.5 py-1 text-[11px] font-bold transition-colors"
          onclick={resetStemFaders}
          title={faderResetPlan.summary}
        >
          Faders → unity ({faderResetPlan.reset.length})
        </button>
      {/if}
    </div>

    <!-- A ruled list, not a stack of cards: each row draws its own hairline,
         the container closes the top edge. -->
    <div class="border-foreground/15 flex flex-col border-t" hidden={mixerTab !== 'tracks'}>
      {#each lanes as lane, i (lane.key)}
        <MixerTrackLane
          label={lane.label}
          buffer={lane.buffer}
          isInstrument={lane.isInstrument}
          sourceDurationSec={lane.sourceDurationSec}
          midiVisual={lane.midiVisual}
          volume={lane.volume}
          matchGainDb={lane.matchGainDb}
          muted={lane.muted}
          soloed={lane.soloed}
          color={lane.color}
          positionSec={snapshot.positionSec}
          durationSec={snapshot.durationSec}
          {sectionBands}
          showSectionLabels={i === 0 || lane.key === 'drum-machine' || lane.key === 'bass-machine'}
          activeSectionId={lane.key === 'drum-machine'
            ? drumMachineScope === 'song'
              ? null
              : drumMachineScope
            : lane.key === 'bass-machine' && bassMachineScope !== 'song'
              ? bassMachineScope
              : null}
          selected={selectedLaneKey === lane.key}
          onSelect={EDITABLE_LANE_KEYS.has(lane.key)
            ? () => selectLane(selectedLaneKey === lane.key ? null : lane.key)
            : undefined}
          onVolumeChange={(v) => onVolume(lane.key, v)}
          onToggleMuted={() => onToggleMuted(lane.key)}
          onToggleSoloed={() => onToggleSoloed(lane.key)}
          onSeekFraction={onSeekFraction}
          onSectionSelect={lane.key === 'drum-machine' || lane.key === 'bass-machine'
            ? (sectionId) => onMachineLaneSectionSelect(lane.key, sectionId)
            : undefined}
          liveSlot={slotLinkFor(lane.key)}
          liveSlotOptions={LIVE_SLOT_OPTIONS}
          onLiveSlotChange={(v) => onChangeLiveSlot(lane.key, v as LiveSlotLink)}
          pinned={lane.key === 'original'}
          reorderable={isLaneReorderable(lane.key)}
          dragging={draggingKey === lane.key}
          dropTarget={dropTargetKey === lane.key}
          onDragStartLane={() => onLaneDragStart(lane.key)}
          onDragOverLane={() => onLaneDragOver(lane.key)}
          onDropLane={() => onLaneDrop(lane.key)}
          onDragEndLane={onLaneDragEnd}
          eq={eqByKey[lane.key]}
          onEqChange={(next) => onEqChange(lane.key, next)}
        />
      {/each}
    </div>

    {#if mixerTab === 'effects'}
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              class="border-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border-2 border-dashed px-2.5 text-xs font-bold transition-colors"
            >
              <Plus class="size-3.5" /> Add effect bus
            </DropdownMenuTrigger>
            <DropdownMenuContent class="" align="start">
              {#each EFFECT_KINDS as k (k.kind)}
                <DropdownMenuItem class="" onSelect={() => addEffectBus(k.kind)}>
                  {k.label}
                </DropdownMenuItem>
              {/each}
            </DropdownMenuContent>
          </DropdownMenu>
          {#if effectBusses.length === 0}
            <span class="text-muted-foreground text-[11px]">
              Create a bus, then hook up the channels you want feeding it.
            </span>
          {/if}
        </div>

        {#if effectBusses.length > 0}
          <!-- Bus list: pick one to edit. Its routing lives inside it. -->
          <div class="flex flex-wrap gap-1">
            {#each effectBusses as bus (bus.id)}
              {@const hooked = Object.keys(bus.sends).length}
              <button
                type="button"
                aria-pressed={selectedBusId === bus.id}
                class="rounded-[var(--radius)] border-2 px-2 py-1 text-left text-xs font-bold transition-colors {selectedBusId ===
                bus.id
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-foreground/25 bg-background hover:border-foreground/50'} {bus.muted
                  ? 'opacity-50'
                  : ''}"
                onclick={() => selectBus(selectedBusId === bus.id ? null : bus.id)}
              >
                {bus.label}
                <span class="ml-1 opacity-70">
                  {hooked === 0 ? 'no channels' : `${hooked} ch`}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Editors for the SELECTED lane only, the way a DAW shows the selected
       track's instrument — plus the "+ Add track" menu underneath. -->
  {#if !playbackMode}
    <div class="mt-2 flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          class="border-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border-2 border-dashed px-2.5 text-xs font-bold transition-colors"
        >
          <Plus class="size-3.5" /> Add track
        </DropdownMenuTrigger>
        <DropdownMenuContent class="" align="start">
          <!-- PROGRAMMED tracks: play from your sections and chords, no stem
               needed. Each song gets at most one of each. -->
          <DropdownMenuItem
            class=""
            disabled={!canAddDrumMachine}
            onSelect={() => canAddDrumMachine && addMachineTrack('drum')}
          >
            {$songMap?.drumMachine && !$songMap.drumMachine.enabled
              ? 'Enable drum machine'
              : 'Drum machine'}
          </DropdownMenuItem>
          <DropdownMenuItem
            class=""
            disabled={!canAddBassMachine}
            onSelect={() => canAddBassMachine && addMachineTrack('bass')}
          >
            {$songMap?.bassMachine && !$songMap.bassMachine.enabled
              ? 'Enable bass machine'
              : 'Bass machine'}
          </DropdownMenuItem>
          <DropdownMenuItem
            class=""
            disabled={!canAddChordMachine}
            onSelect={() => canAddChordMachine && addChordVoiceTrack('keys')}
          >
            Chords
          </DropdownMenuItem>
          <DropdownMenuItem
            class=""
            disabled={!canAddArpMachine}
            onSelect={() => canAddArpMachine && addChordVoiceTrack('arp')}
          >
            Arp
          </DropdownMenuItem>
          <DropdownMenuSeparator class="" />
          <!-- GENERATORS: a different thing entirely — they detect what the
               real recording played and re-voice it, so they need a stem. -->
          <DropdownMenuItem class="" onSelect={() => (generatorPanel = 'drums')}>
            Drum generator (from stem)
          </DropdownMenuItem>
          <DropdownMenuItem class="" onSelect={() => (generatorPanel = 'bass')}>
            Bass generator (from stem)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  {/if}

  <!-- The open machine editor DOCKS to the bottom of the mixer's own scroll
       area, the way a DAW pins its editor pane: the lane list scrolls above it
       while the controls you're dialling stay put. `sticky` (not `fixed`) is
       deliberate — it stays inside the mixer column, so the sidebar is never
       covered, and it keeps its place in flow so no spacer is needed. -->
  {#if selectedBus}
    {@const bus = selectedBus}
    <div
      class="border-foreground bg-background sticky bottom-0 z-20 -mx-3 -mb-3 max-h-[60vh] overflow-y-auto border-t-2 px-3 py-2 shadow-[0_-10px_28px_rgba(0,0,0,0.18)]"
    >
      <header class="mb-2 flex flex-wrap items-center gap-2">
        <input
          class="border-foreground/25 bg-background h-7 w-40 rounded-[var(--radius)] border-2 px-1.5 text-sm font-bold"
          value={bus.label}
          oninput={(e) => updateBus(bus.id, (b) => renameBus(b, e.currentTarget.value))}
          aria-label="Bus name"
        />
        <span class="text-muted-foreground text-[11px] font-bold uppercase">
          {bus.chain.length === 0
            ? 'empty'
            : bus.chain.map((u) => effectKindLabel(u.kind)).join(' → ')}
        </span>
        <button
          type="button"
          class="inline-flex h-7 items-center rounded-[var(--radius)] border-2 px-2 text-xs font-bold transition-colors {bus.muted
            ? 'border-foreground/40 bg-background text-muted-foreground'
            : 'border-foreground bg-foreground text-background'}"
          onclick={() => updateBus(bus.id, (b) => ({ ...b, muted: !b.muted }))}
        >
          {bus.muted ? 'Off' : 'On'}
        </button>
        <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
          Return
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.02"
            class="accent-foreground w-24"
            value={bus.level}
            oninput={(e) => updateBus(bus.id, (b) => ({ ...b, level: Number(e.currentTarget.value) }))}
            aria-label="Return level"
          />
        </label>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground ml-auto inline-flex h-7 items-center gap-1 px-1.5 text-[11px] font-bold"
          onclick={() => removeEffectBus(bus.id)}
          title="Delete this bus"
        >
          <Trash2 class="size-3.5" /> Delete
        </button>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 px-1 text-[11px] font-bold"
          onclick={() => selectBus(null)}
        >
          <X class="size-3.5" /> Close
        </button>
      </header>

      <!-- The RACK. Signal runs top to bottom, so the order you see is the
           order it is processed — reverb→stereo is not stereo→reverb. -->
      <div class="mb-2 flex flex-col gap-1.5">
        {#each bus.chain as unit, ui (unit.id)}
          <div
            class="border-foreground/20 rounded-[var(--radius)] border p-1.5 {unit.bypassed
              ? 'opacity-45'
              : ''}"
          >
            <div class="mb-1 flex flex-wrap items-center gap-1.5">
              <span class="text-muted-foreground w-3 font-mono text-[10px] tabular-nums">
                {ui + 1}
              </span>
              <span class="text-[11px] font-black uppercase tracking-wider">
                {effectKindLabel(unit.kind)}
              </span>
              <button
                type="button"
                class="border-foreground/30 hover:bg-muted disabled:opacity-30 rounded-[var(--radius)] border px-1 leading-none"
                disabled={ui === 0}
                onclick={() => updateBus(bus.id, (b) => moveEffect(b, unit.id, -1))}
                aria-label="Move {effectKindLabel(unit.kind)} earlier"
                title="Earlier in the chain"
              >
                ↑
              </button>
              <button
                type="button"
                class="border-foreground/30 hover:bg-muted disabled:opacity-30 rounded-[var(--radius)] border px-1 leading-none"
                disabled={ui === bus.chain.length - 1}
                onclick={() => updateBus(bus.id, (b) => moveEffect(b, unit.id, 1))}
                aria-label="Move {effectKindLabel(unit.kind)} later"
                title="Later in the chain"
              >
                ↓
              </button>
              <button
                type="button"
                class="rounded-[var(--radius)] border px-1.5 text-[10px] font-bold transition-colors {unit.bypassed
                  ? 'border-foreground/30 text-muted-foreground'
                  : 'border-foreground bg-foreground text-background'}"
                onclick={() =>
                  updateBus(bus.id, (b) => setEffectBypassed(b, unit.id, !unit.bypassed))}
                aria-pressed={!unit.bypassed}
                title={unit.bypassed ? 'Bypassed — settings kept' : 'Active'}
              >
                {unit.bypassed ? 'Bypassed' : 'On'}
              </button>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground ml-auto px-1 text-[11px] font-bold"
                onclick={() => updateBus(bus.id, (b) => removeEffect(b, unit.id))}
                aria-label="Remove {effectKindLabel(unit.kind)}"
                title="Remove from the chain"
              >
                <Trash2 class="size-3" />
              </button>
            </div>
            {@render effectControls(bus, unit)}
          </div>
        {/each}

        <div class="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              class="border-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-[var(--radius)] border-2 border-dashed px-2 text-[11px] font-bold transition-colors"
            >
              <Plus class="size-3" /> Add effect
            </DropdownMenuTrigger>
            <DropdownMenuContent class="" align="start">
              {#each EFFECT_KINDS as k (k.kind)}
                <DropdownMenuItem class="" onSelect={() => updateBus(bus.id, (b) => addEffect(b, k.kind))}>
                  {k.label}
                </DropdownMenuItem>
              {/each}
            </DropdownMenuContent>
          </DropdownMenu>
          {#if bus.chain.length === 0}
            <span class="text-muted-foreground text-[11px]">
              No effects yet — add one, or this bus stays silent.
            </span>
          {/if}
        </div>
      </div>

      <!-- ROUTING lives here: hook a channel up, then set how much of it feeds
           this bus. No slider on every channel strip. -->
      <div class="border-foreground/10 border-t-2 pt-2">
        <span class="text-muted-foreground text-[11px] font-bold uppercase">Channels</span>
        <div class="mt-1 flex flex-col gap-0.5">
          {#each lanes as lane (lane.key)}
            {@const on = isHookedUp(bus, lane.key)}
            <div class="flex items-center gap-2">
              <label class="flex w-40 shrink-0 items-center gap-1.5 text-xs font-bold">
                <input
                  type="checkbox"
                  class="accent-foreground size-3.5"
                  checked={on}
                  onchange={(e) =>
                    updateBus(bus.id, (b) => setHookedUp(b, lane.key, e.currentTarget.checked))}
                />
                <span class="truncate">{lane.label}</span>
              </label>
              {#if on}
                <input
                  type="range" min="0" max="1.5" step="0.02" class="accent-foreground w-40"
                  value={bus.sends[lane.key] ?? 0}
                  oninput={(e) =>
                    updateBus(bus.id, (b) =>
                      setSendAmount(b, lane.key, Number(e.currentTarget.value)),
                    )}
                  aria-label="{lane.label} send to {bus.label}"
                />
                <span class="text-muted-foreground w-8 text-right font-mono text-[10px] tabular-nums">
                  {Math.round((bus.sends[lane.key] ?? 0) * 100)}
                </span>
              {:else}
                <span class="text-muted-foreground text-[10px]">not connected</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if openEditor && !selectedBus}
    <div
      class="border-foreground bg-background sticky bottom-0 z-20 -mx-3 -mb-3 max-h-[60vh] overflow-y-auto border-t-2 px-3 py-3 shadow-[0_-10px_28px_rgba(0,0,0,0.18)]"
    >
      <div class="mb-1 flex justify-end">
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground inline-flex h-6 items-center gap-1 px-1 text-[11px] font-bold"
          onclick={() => (selectedLaneKey = null)}
          title="Close the editor"
        >
          <X class="size-3.5" /> Close
        </button>
      </div>
      {#if openEditor === 'drum'}
        <DrumMachinePanel
          onChanged={onMachineChanged}
          scope={drumMachineScope}
          onScopeChange={(next) => (drumMachineScope = next)}
          showSectionStrip={false}
        />
      {:else if openEditor === 'bass'}
        <BassMachinePanel
          onChanged={onMachineChanged}
          scope={bassMachineScope}
          onScopeChange={(next) => (bassMachineScope = next)}
          showSectionStrip={false}
        />
      {:else if openEditor === 'barbro-bass'}
        <DrumTrackPanel show="bass" onChanged={onMachineChanged} />
      {:else}
        <ChordMachinePanel
          voice={openEditor}
          onChanged={onMachineChanged}
          onRemove={() => {
            setChordLane(openEditor === 'keys' ? 'keys' : 'arp', false)
            onMachineChanged()
          }}
        />
      {/if}
    </div>
  {/if}

  <!-- XR18 "Live Rig" settings — connect, route, per-performer monitor mixes,
       and the verified house-safety check. Reachable from the live stage. -->
  <Dialog bind:open={xairPanelOpen}>
    <DialogContent class="max-h-[85vh] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden">
      <DialogHeader>
        <DialogTitle>XR18 live rig</DialogTitle>
      </DialogHeader>
      <XAirSettingsPanel lanes={monitorRoutableLanes} projectId={$projectStore.data?.id ?? null} />
    </DialogContent>
  </Dialog>
</div>

<!-- One effect's own controls, inside a bus's rack. Parameterised by UNIT, so
     the same markup serves a bus holding several of the same kind. -->
{#snippet effectControls(bus: EffectBus, unit: EffectUnit)}
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
    {#if unit.kind === 'reverb'}
      {@const rv = normalizeReverb(unit.reverb)}
      <div class="flex gap-1">
        {#each REVERB_PRESETS as p (p.id)}
          <button
            type="button"
            class="rounded-[var(--radius)] border-2 px-1.5 py-0.5 text-[11px] font-bold transition-colors {rv.sizeSec ===
            p.settings.sizeSec
              ? 'border-foreground bg-foreground text-background'
              : 'border-foreground/25 bg-background hover:border-foreground/50'}"
            onclick={() => updateBus(bus.id, (b) => setEffectSettings(b, unit.id, p.settings))}
          >
            {p.label}
          </button>
        {/each}
      </div>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        Size
        <input
          type="range" min="0.15" max="8" step="0.05" class="accent-foreground w-24"
          value={rv.sizeSec}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeReverb({ ...rv, sizeSec: Number(e.currentTarget.value) })),
            )}
          aria-label="Reverb size"
        />
        <span class="text-muted-foreground w-9 font-mono tabular-nums">{rv.sizeSec.toFixed(1)}s</span>
      </label>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        Tone
        <input
          type="range" min="500" max="16000" step="100" class="accent-foreground w-24"
          value={rv.dampHz}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeReverb({ ...rv, dampHz: Number(e.currentTarget.value) })),
            )}
          aria-label="Reverb tone"
        />
      </label>
    {:else if unit.kind === 'widener'}
      {@const wd = normalizeWidener(unit.widener)}
      <div class="flex gap-1">
        {#each WIDENER_PRESETS as p (p.id)}
          <button
            type="button"
            class="rounded-[var(--radius)] border-2 px-1.5 py-0.5 text-[11px] font-bold transition-colors {wd.rateHz ===
            p.settings.rateHz && wd.width === p.settings.width
              ? 'border-foreground bg-foreground text-background'
              : 'border-foreground/25 bg-background hover:border-foreground/50'}"
            onclick={() => updateBus(bus.id, (b) => setEffectSettings(b, unit.id, p.settings))}
          >
            {p.label}
          </button>
        {/each}
      </div>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        Width
        <input
          type="range" min="0" max="2" step="0.05" class="accent-foreground w-24"
          value={wd.width}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeWidener({ ...wd, width: Number(e.currentTarget.value) })),
            )}
          aria-label="Stereo width"
        />
        <span class="text-muted-foreground w-8 font-mono tabular-nums">{wd.width.toFixed(2)}</span>
      </label>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        Speed
        <input
          type="range" min="0.02" max="8" step="0.02" class="accent-foreground w-20"
          value={wd.rateHz}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeWidener({ ...wd, rateHz: Number(e.currentTarget.value) })),
            )}
          aria-label="Widener speed"
        />
      </label>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        Depth
        <input
          type="range" min="0" max="1" step="0.02" class="accent-foreground w-20"
          value={wd.depth}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeWidener({ ...wd, depth: Number(e.currentTarget.value) })),
            )}
          aria-label="Widener depth"
        />
      </label>
      <label
        class="inline-flex items-center gap-1.5 text-[11px] font-bold"
        title="Everything below this stays mono and centred, so the kick and the bass keep their punch"
      >
        Keep lows mono
        <input
          type="range" min="20" max="2000" step="10" class="accent-[var(--studio-orange)] w-24"
          value={wd.monoBelowHz}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeWidener({ ...wd, monoBelowHz: Number(e.currentTarget.value) })),
            )}
          aria-label="Keep lows mono below"
        />
        <span class="text-muted-foreground w-12 font-mono tabular-nums">
          {Math.round(wd.monoBelowHz)}Hz
        </span>
      </label>
    {:else}
      {@const dl = normalizeDelay(unit.delay)}
      <div class="flex gap-1">
        {#each DELAY_PRESETS as p (p.id)}
          <button
            type="button"
            class="rounded-[var(--radius)] border-2 px-1.5 py-0.5 text-[11px] font-bold transition-colors {dl.timeSec ===
            p.settings.timeSec
              ? 'border-foreground bg-foreground text-background'
              : 'border-foreground/25 bg-background hover:border-foreground/50'}"
            onclick={() => updateBus(bus.id, (b) => setEffectSettings(b, unit.id, p.settings))}
          >
            {p.label}
          </button>
        {/each}
      </div>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        Time
        <input
          type="range" min="0.02" max="2" step="0.01" class="accent-foreground w-24"
          value={dl.timeSec}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeDelay({ ...dl, timeSec: Number(e.currentTarget.value) })),
            )}
          aria-label="Delay time"
        />
        <span class="text-muted-foreground w-10 font-mono tabular-nums">{dl.timeSec.toFixed(2)}s</span>
      </label>
      <label class="inline-flex items-center gap-1.5 text-[11px] font-bold">
        Repeats
        <input
          type="range" min="0" max="0.9" step="0.02" class="accent-foreground w-24"
          value={dl.feedback}
          oninput={(e) =>
            updateBus(bus.id, (b) =>
              setEffectSettings(b, unit.id, normalizeDelay({ ...dl, feedback: Number(e.currentTarget.value) })),
            )}
          aria-label="Delay feedback"
        />
      </label>
    {/if}
  </div>
{/snippet}
