<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { get } from 'svelte/store'
  import {
    ArrowLeft,
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    Drum,
    Pause,
    Play,
    Radio,
    RotateCcw,
    Save,
    Scissors,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    Volume2,
    VolumeX,
    Waves,
  } from '@lucide/svelte'
  import { readProjectSong, readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { decodeSmapBytes } from '$lib/songmap/smapFile'
  import { audioSession } from '$lib/stores/audioSession'
  import { project as projectStore } from '$lib/stores/project'
  import { removeProjectTransition, setProjectTransition } from '$lib/project/commit'
  import { parseProjectTransition } from '$lib/project/transitions'
  import type { ProjectTransitionRecipe } from '$lib/project/types'
  import { songMap as activeSongMap } from '$lib/stores/songMap'
  import type { Bar, ChordSymbol, DrumClass, SongMap } from '$lib/songmap/types'
  import {
    chordRootToPitchClass,
    chordVoicingMidi,
    formatChordSymbol,
    resolveChordAtEachBeat,
  } from '$lib/chords'
  import { DRUM_KIT_SAMPLE_RATE, loadDrumKit } from '$lib/audio/drumKits'
  import { KeysSynth, type SynthPatch } from '$lib/audio/keysSynth'
  import {
    computeVisualBlockPeaksFromChannels,
    drawBlockPeaksToCanvas,
    normalizeBlockPeaks,
    waveformBlockBucketCount,
  } from '$lib/audio/waveformBlocks'

  type SnapMode = 'bar' | 'beat' | 'tonic' | 'free'
  type StartSnapMode = 'bar' | 'beat' | 'free'
  type EndingStyle = 'cut' | 'hit' | 'fill-hit' | 'echo' | 'filter' | 'fade'
  type EndingChordMode = 'tonic' | 'song' | 'none'
  type EchoDivision = 'eighth' | 'dotted-eighth' | 'quarter'

  type BeatPoint = {
    id: string
    barId: string
    barIndex: number
    indexInBar: number
    timeSec: number
    downbeat: boolean
  }

  type SnapPoint = {
    id: string
    timeSec: number
    barId?: string
    beatId?: string
  }

  type SongOption = {
    id: string
    folder: string
    title: string
    bpm?: number
  }

  type EndingOption = {
    id: EndingStyle
    name: string
    description: string
  }

  type AudioGraph = {
    ctx: AudioContext
    source: MediaElementAudioSourceNode
    filter: BiquadFilterNode
    songGain: GainNode
    echoSend: GainNode
    delay: DelayNode
    feedback: GainNode
    echoFilter: BiquadFilterNode
    echoWet: GainNode
    echoReverbSend: GainNode
    echoReverbPredelay: DelayNode
    echoReverb: ConvolverNode
    echoReverbWet: GainNode
    endingBus: GainNode
    incomingGain: GainNode
    master: GainNode
    limiter: DynamicsCompressorNode
  }

  type LoadedProjectAudio = {
    blob: Blob
    map: SongMap
    title: string
    detail: string
  }

  type TimelineMark = {
    id: string
    leftPct: number
    label: string
  }

  const ENDING_OPTIONS: EndingOption[] = [
    { id: 'cut', name: 'Clean cut', description: 'Tight stop on the selected point.' },
    { id: 'hit', name: 'Band hit', description: 'Mute the track and land kick, crash and chord.' },
    { id: 'fill-hit', name: 'Fill + hit', description: 'Build through the previous bar, then land together.' },
    { id: 'echo', name: 'Echo throw', description: 'Build the last fragment, then carry its space into the next song.' },
    { id: 'filter', name: 'Filter dive', description: 'Close the music down before a sharp final cut.' },
    { id: 'fade', name: 'Fade out', description: 'A controlled musical fade ending at the marker.' },
  ]

  const PREVIEW_BAR_OPTIONS = [1, 2, 4, 8]
  const FILL_BAR_OPTIONS = [0.5, 1, 2]
  const FADE_BAR_OPTIONS = [1, 2, 4, 8]
  const TRANSITION_AFTER_SEC = 9
  const ZOOM_BAR_OPTIONS = [4, 8, 16, 32, 0] as const
  const FINALE_CHORD_PATCH: SynthPatch = {
    name: 'Dark finale',
    oscA: { type: 'triangle', level: 1, detune: -2 },
    oscB: { type: 'sine', level: 0.5, detune: 1201.5 },
    filter: { cutoffHz: 2200, resonance: 0.55, velToCutoff: 0.18 },
    lfo: { rateHz: 0.32, depth: 0.025 },
    env: { attack: 0.012, decay: 0.48, sustain: 0.26, release: 1.75 },
    gain: 0.34,
    fx: {
      chorus: 0.24,
      delayMix: 0.04,
      delayTime: 0.31,
      delayFeedback: 0.18,
      reverbMix: 0.42,
      reverbSize: 2.7,
      highpassHz: 42,
      reverbPredelay: 0.024,
      reverbDamp: 4100,
      drive: 0.16,
      shimmer: 0,
      analog: 0.42,
      phaser: 0,
      wah: 0,
    },
  }

  let audioElement: HTMLAudioElement
  let waveformHost: HTMLDivElement
  let waveformCanvas: HTMLCanvasElement
  let incomingWaveformHost: HTMLDivElement
  let incomingWaveformCanvas: HTMLCanvasElement
  let graph: AudioGraph | null = null
  let endingSynth: KeysSynth | null = null
  let decodedAudio: AudioBuffer | null = null
  let objectUrl: string | null = null
  let resizeObserver: ResizeObserver | null = null
  let projectUnsubscribe: (() => void) | null = null
  let positionRaf = 0
  let drawRaf = 0
  let previewToken = 0
  let loadToken = 0
  let incomingLoadToken = 0
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let incomingTimer: ReturnType<typeof setTimeout> | null = null
  let finishTimer: ReturnType<typeof setTimeout> | null = null
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null
  const scheduledSources = new Set<AudioScheduledSourceNode>()
  const drumBuffers = new Map<DrumClass, AudioBuffer>()

  let projectSongs = $state<SongOption[]>([])
  let savedTransitions = $state<ProjectTransitionRecipe[]>([])
  let projectWritable = $state(false)
  let appliedRecipeKey = ''
  let selectedSongId = $state('')
  let loadedMap = $state<SongMap | null>(null)
  let beatPoints = $state<BeatPoint[]>([])
  let bars = $state<Bar[]>([])
  let trimStartSec = $state(0)
  let trimEndSec = $state(0)
  let durationSec = $state(0)
  let selectedPointSec = $state(0)
  let positionSec = $state(0)
  let sourceLabel = $state('Waiting for a project song')
  let sourceDetail = $state('')
  let loading = $state(false)
  let preparing = $state(false)
  let previewing = $state(false)
  let tailing = $state(false)
  let error = $state('')

  let selectedIncomingSongId = $state('')
  let incomingMap = $state<SongMap | null>(null)
  let incomingAudio = $state<AudioBuffer | null>(null)
  let incomingBeatPoints = $state<BeatPoint[]>([])
  let incomingBars = $state<Bar[]>([])
  let incomingTrimStartSec = $state(0)
  let incomingTrimEndSec = $state(0)
  let incomingStartSec = $state(0)
  let incomingSourceLabel = $state('Choose the next project song')
  let incomingSourceDetail = $state('')
  let loadingIncoming = $state(false)
  let incomingPlaying = $state(false)
  let startSnapMode = $state<StartSnapMode>('bar')
  let outgoingViewBars = $state<number>(16)
  let outgoingViewStartBar = $state(0)
  let incomingViewBars = $state<number>(16)
  let incomingViewStartBar = $state(0)

  let snapMode = $state<SnapMode>('bar')
  let endingStyle = $state<EndingStyle>('echo')
  let endingChordMode = $state<EndingChordMode>('tonic')
  let previewBars = $state(4)
  let outputLevel = $state(0.82)
  let cutSoftnessMs = $state(28)
  let fillBars = $state(1)
  let fillIntensity = $state(0.68)
  let hitLevel = $state(0.78)
  let crashLevel = $state(0.58)
  let chordLevel = $state(0.48)
  let endingTailSec = $state(5.8)
  let echoAmount = $state(0.62)
  let echoFeedback = $state(0.96)
  let echoBuild = $state(0.53)
  let echoCaptureBeats = $state(0.75)
  let echoDryHoldBeats = $state(1.75)
  let echoWetLevel = $state(0.72)
  let echoToneHz = $state(5200)
  let echoBlendLevel = $state(0.72)
  let echoBlendLengthSec = $state(7.6)
  let echoDivision = $state<EchoDivision>('dotted-eighth')
  let transitionAirBeats = $state<number>(0)
  let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle')
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  let saveMessage = $state('')
  let filterBars = $state(2)
  let filterFloorHz = $state(320)
  let filterResonance = $state(5)
  let fadeBars = $state(4)

  const trimDurationSec = $derived(Math.max(0, trimEndSec - trimStartSec))
  const selectedBeat = $derived.by(() => nearestBeat(selectedPointSec, beatPoints))
  const selectedBar = $derived.by(() => {
    if (snapMode === 'bar' && bars.length > 0) {
      return nearestTimedPoint(
        selectedPointSec,
        bars.map((bar) => ({ ...bar, timeSec: bar.endSec })),
      )
    }
    const beat = selectedBeat
    if (beat) return bars.find((bar) => bar.id === beat.barId) ?? null
    return bars.find((bar) => selectedPointSec >= bar.startSec && selectedPointSec < bar.endSec) ?? null
  })
  const selectedBarBeats = $derived(
    selectedBar ? beatPoints.filter((beat) => beat.barId === selectedBar.id) : [],
  )
  const selectedSection = $derived.by(() => {
    const map = loadedMap
    const bar = selectedBar
    if (!map || !bar) return null
    return (
      map.sections.find(
        (section) =>
          bar.index >= section.barRange.startBarIndex && bar.index <= section.barRange.endBarIndex,
      ) ?? null
    )
  })
  const chordByBeat = $derived(loadedMap ? resolveChordAtEachBeat(loadedMap) : new Map<string, ChordSymbol | null>())
  const tonicSnapPoints = $derived.by<SnapPoint[]>(() => {
    const map = loadedMap
    const key = map?.metadata.keyDetail
    if (!map || !key) return []
    const tonicPitchClass = chordRootToPitchClass(key.root, key.accidental)
    const points = new Map<string, SnapPoint>()

    for (const beat of beatPoints) {
      const chord = chordByBeat.get(beat.id)
      if (!beat.downbeat || !chord || chord.noChord) continue
      if (chordRootToPitchClass(chord.root, chord.accidental) !== tonicPitchClass) continue
      points.set(beat.id, {
        id: `tonic-beat:${beat.id}`,
        timeSec: beat.timeSec,
        barId: beat.barId,
        beatId: beat.id,
      })
    }

    for (const event of map.harmony) {
      if (event.chord.noChord) continue
      if (chordRootToPitchClass(event.chord.root, event.chord.accidental) !== tonicPitchClass) continue
      const beat = event.beatId ? beatPoints.find((point) => point.id === event.beatId) : null
      const keyForPoint = beat?.id ?? `${event.barId}:${event.startSec.toFixed(4)}`
      points.set(keyForPoint, {
        id: `tonic-event:${event.id}`,
        timeSec: event.startSec,
        barId: event.barId,
        beatId: beat?.id,
      })
    }

    return [...points.values()]
      .filter((point) => point.timeSec >= trimStartSec - 0.01 && point.timeSec <= trimEndSec + 0.01)
      .sort((a, b) => a.timeSec - b.timeSec)
  })
  const selectedTonicPoint = $derived(nearestTimedPoint(selectedPointSec, tonicSnapPoints))
  const songChord = $derived.by<ChordSymbol | null>(() => {
    const beat = beatAtOrBefore(selectedPointSec, beatPoints)
    return beat ? (chordByBeat.get(beat.id) ?? null) : null
  })
  const tonicChord = $derived.by<ChordSymbol | null>(() => {
    const key = loadedMap?.metadata.keyDetail
    if (!key) return null
    return {
      root: key.root,
      accidental: key.accidental,
      quality: key.mode === 'minor' ? 'minor' : 'major',
      displayRaw: '',
    }
  })
  const endingChord = $derived(
    endingChordMode === 'none'
      ? null
      : endingChordMode === 'tonic'
        ? (tonicChord ?? songChord)
        : (songChord ?? tonicChord),
  )
  const endingChordLabel = $derived(
    endingChord ? formatChordSymbol(endingChord, { unicode: true }) : 'No generated chord',
  )
  const selectedPointLabel = $derived.by(() => {
    const beat = selectedBeat
    const bar = selectedBar
    if (!bar) return fmtTime(selectedPointSec)
    if (snapMode === 'bar') return `End of bar ${bar.index + 1}`
    if (snapMode === 'tonic') {
      const beatLabel = beat ? `Beat ${beat.indexInBar + 1}` : 'chord change'
      return `1 chord · Bar ${bar.index + 1}, ${beatLabel}`
    }
    const beatLabel = beat ? `Beat ${beat.indexInBar + 1}` : 'Free point'
    return `Bar ${bar.index + 1}, ${beatLabel}`
  })
  const selectedBarPosition = $derived(selectedBar ? bars.findIndex((bar) => bar.id === selectedBar.id) : -1)
  const previewStartSec = $derived.by(() => {
    if (bars.length === 0 || selectedBarPosition < 0) {
      const fallback = selectedPointSec - previewBars * averageBarDuration()
      return clamp(fallback, trimStartSec, selectedPointSec)
    }
    const offset = snapMode === 'bar' ? previewBars - 1 : previewBars
    const startIndex = Math.max(0, selectedBarPosition - offset)
    return clamp(bars[startIndex]?.startSec ?? trimStartSec, trimStartSec, selectedPointSec)
  })
  const outgoingVisibleBars = $derived(
    viewportBars(bars, outgoingViewStartBar, outgoingViewBars),
  )
  const outgoingViewStartSec = $derived(
    outgoingViewBars === 0 ? trimStartSec : (outgoingVisibleBars[0]?.startSec ?? trimStartSec),
  )
  const outgoingViewEndSec = $derived(
    outgoingViewBars === 0
      ? trimEndSec
      : (outgoingVisibleBars[outgoingVisibleBars.length - 1]?.endSec ?? trimEndSec),
  )
  const outgoingViewDurationSec = $derived(
    Math.max(0, outgoingViewEndSec - outgoingViewStartSec),
  )
  const markerPct = $derived(
    outgoingViewDurationSec > 0
      ? ((selectedPointSec - outgoingViewStartSec) / outgoingViewDurationSec) * 100
      : 0,
  )
  const markerVisible = $derived(markerPct >= 0 && markerPct <= 100)
  const echoThrowPointSec = $derived.by(() => {
    if (snapMode === 'bar') {
      const thirdBeat = selectedBarBeats.find((beat) => beat.indexInBar === 2)
      if (thirdBeat && thirdBeat.timeSec < selectedPointSec - 0.03) return thirdBeat.timeSec
    }
    return Math.max(trimStartSec, selectedPointSec - averageBeatDuration() * 2)
  })
  const echoThrowPct = $derived(
    outgoingViewDurationSec > 0
      ? ((echoThrowPointSec - outgoingViewStartSec) / outgoingViewDurationSec) * 100
      : 0,
  )
  const echoThrowVisible = $derived(echoThrowPct >= 0 && echoThrowPct <= 100)
  const playheadPct = $derived(
    outgoingViewDurationSec > 0
      ? ((positionSec - outgoingViewStartSec) / outgoingViewDurationSec) * 100
      : 0,
  )
  const playheadVisible = $derived(playheadPct >= 0 && playheadPct <= 100)
  const outgoingBarMarks = $derived(
    buildBarMarks(outgoingVisibleBars, outgoingViewStartSec, outgoingViewEndSec),
  )
  const outgoingBeatMarks = $derived(
    buildBeatMarks(
      beatPoints,
      outgoingVisibleBars,
      outgoingViewStartSec,
      outgoingViewEndSec,
    ),
  )
  const styleOption = $derived(ENDING_OPTIONS.find((option) => option.id === endingStyle) ?? ENDING_OPTIONS[0])
  const styleUsesHit = $derived(endingStyle === 'hit' || endingStyle === 'fill-hit')
  const effectiveTailSec = $derived.by(() => {
    if (endingStyle === 'hit' || endingStyle === 'fill-hit') return endingTailSec
    if (endingStyle === 'echo') return Math.max(1.5, endingTailSec)
    if (endingStyle === 'filter') return 0.45
    return 0.18
  })
  const incomingTrimDurationSec = $derived(Math.max(0, incomingTrimEndSec - incomingTrimStartSec))
  const incomingSelectedBeat = $derived.by(() => nearestBeat(incomingStartSec, incomingBeatPoints))
  const incomingSelectedBar = $derived.by(() => {
    if (startSnapMode === 'bar' && incomingBars.length > 0) {
      return nearestTimedPoint(
        incomingStartSec,
        incomingBars.map((bar) => ({ ...bar, timeSec: bar.startSec })),
      )
    }
    const beat = incomingSelectedBeat
    if (beat) return incomingBars.find((bar) => bar.id === beat.barId) ?? null
    return (
      incomingBars.find(
        (bar) => incomingStartSec >= bar.startSec && incomingStartSec < bar.endSec,
      ) ?? null
    )
  })
  const incomingSelectedBarBeats = $derived(
    incomingSelectedBar
      ? incomingBeatPoints.filter((beat) => beat.barId === incomingSelectedBar.id)
      : [],
  )
  const incomingSection = $derived.by(() => {
    const map = incomingMap
    const bar = incomingSelectedBar
    if (!map || !bar) return null
    return (
      map.sections.find(
        (section) =>
          bar.index >= section.barRange.startBarIndex && bar.index <= section.barRange.endBarIndex,
      ) ?? null
    )
  })
  const incomingStartLabel = $derived.by(() => {
    const bar = incomingSelectedBar
    const beat = incomingSelectedBeat
    if (!bar) return fmtTime(incomingStartSec)
    if (startSnapMode === 'bar') return `Start of bar ${bar.index + 1}`
    return `Bar ${bar.index + 1}, ${beat ? `Beat ${beat.indexInBar + 1}` : 'Free point'}`
  })
  const incomingVisibleBars = $derived(
    viewportBars(incomingBars, incomingViewStartBar, incomingViewBars),
  )
  const incomingViewStartSec = $derived(
    incomingViewBars === 0
      ? incomingTrimStartSec
      : (incomingVisibleBars[0]?.startSec ?? incomingTrimStartSec),
  )
  const incomingViewEndSec = $derived(
    incomingViewBars === 0
      ? incomingTrimEndSec
      : (incomingVisibleBars[incomingVisibleBars.length - 1]?.endSec ?? incomingTrimEndSec),
  )
  const incomingViewDurationSec = $derived(
    Math.max(0, incomingViewEndSec - incomingViewStartSec),
  )
  const incomingMarkerPct = $derived(
    incomingViewDurationSec > 0
      ? ((incomingStartSec - incomingViewStartSec) / incomingViewDurationSec) * 100
      : 0,
  )
  const incomingMarkerVisible = $derived(incomingMarkerPct >= 0 && incomingMarkerPct <= 100)
  const incomingBarMarks = $derived(
    buildBarMarks(incomingVisibleBars, incomingViewStartSec, incomingViewEndSec),
  )
  const incomingBeatMarks = $derived(
    buildBeatMarks(
      incomingBeatPoints,
      incomingVisibleBars,
      incomingViewStartSec,
      incomingViewEndSec,
    ),
  )
  const incomingSongOptions = $derived(projectSongs.filter((song) => song.id !== selectedSongId))
  const transitionReady = $derived(
    Boolean(loadedMap && incomingMap && incomingAudio && selectedSongId !== selectedIncomingSongId),
  )
  const canSaveTransition = $derived(
    transitionReady && endingStyle === 'echo' && projectWritable,
  )
  const transitionGapSec = $derived(transitionAirBeats * averageBeatDuration())
  const echoThrowLeadSec = $derived(Math.max(0.05, selectedPointSec - echoThrowPointSec))
  const echoCaptureDurationSec = $derived(
    clamp(averageBeatDuration() * echoCaptureBeats, 0.04, averageBeatDuration() * 2),
  )
  const echoEffectiveLengthSec = $derived(
    Math.max(endingTailSec, echoCaptureDurationSec + 0.1),
  )
  const echoTailAfterEndSec = $derived(
    endingStyle === 'echo'
      ? Math.max(0, echoEffectiveLengthSec - echoThrowLeadSec)
      : 0,
  )
  const incomingDelayAfterEndSec = $derived(echoTailAfterEndSec + transitionGapSec)
  const echoBuildLabel = $derived(
    echoBuild > 0.02
      ? `Build +${Math.round(echoBuild * 100)}%`
      : echoBuild < -0.02
        ? `Decay ${Math.round(Math.abs(echoBuild) * 100)}%`
        : 'Steady',
  )
  const transitionRecipeJson = $derived.by(() =>
    JSON.stringify(
      {
        schema: 'barbro.transition-recipe',
        version: 1,
        outgoing: {
          songId: selectedSongId,
          title: sourceLabel,
          endAnchor: {
            mode: snapMode,
            timeSec: rounded(selectedPointSec, 3),
            barNumber: selectedBar ? selectedBar.index + 1 : null,
            beatNumber: selectedBeat ? selectedBeat.indexInBar + 1 : null,
            label: selectedPointLabel,
          },
        },
        incoming: {
          songId: selectedIncomingSongId,
          title: incomingSourceLabel,
          startAnchor: {
            mode: startSnapMode,
            timeSec: rounded(incomingStartSec, 3),
            barNumber: incomingSelectedBar ? incomingSelectedBar.index + 1 : null,
            beatNumber: incomingSelectedBeat ? incomingSelectedBeat.indexInBar + 1 : null,
            label: incomingStartLabel,
          },
        },
        transition: {
          type: endingStyle,
          echo:
            endingStyle === 'echo'
              ? {
                  throwRule: 'beat-3-or-7',
                  throwTimeSec: rounded(echoThrowPointSec, 3),
                  delayDivision: echoDivision,
                  captureLengthBeats: echoCaptureBeats,
                  drySongHoldBeats: echoDryHoldBeats,
                  sendLevel: rounded(echoAmount, 3),
                  wetLevel: rounded(echoWetLevel, 3),
                  feedback: rounded(echoFeedback, 3),
                  repeatBuild: rounded(echoBuild, 3),
                  toneHz: echoToneHz,
                  tailLengthSec: rounded(endingTailSec, 2),
                  effectiveTailLengthSec: rounded(echoEffectiveLengthSec, 2),
                  blendReverbLevel: rounded(echoBlendLevel, 3),
                  blendReverbLengthSec: rounded(echoBlendLengthSec, 2),
                }
              : null,
          nextSongDelay: {
            measuredFrom: endingStyle === 'echo' ? 'echo-stop' : 'outgoing-end',
            beats: transitionAirBeats,
            secondsAtOutgoingTempo: rounded(transitionGapSec, 3),
            startOffsetAfterOutgoingEndSec: rounded(incomingDelayAfterEndSec, 3),
          },
        },
      },
      null,
      2,
    ),
  )

  function currentEchoRecipe(): ProjectTransitionRecipe | null {
    if (endingStyle !== 'echo' || !selectedSongId || !selectedIncomingSongId) return null
    return parseProjectTransition(JSON.parse(transitionRecipeJson))
  }

  function applySavedRecipeIfReady(): void {
    if (!loadedMap || !incomingMap) return
    const recipe = savedTransitions.find(
      (candidate) =>
        candidate.outgoing.songId === selectedSongId &&
        candidate.incoming.songId === selectedIncomingSongId,
    )
    if (!recipe) return
    const key = JSON.stringify(recipe)
    if (appliedRecipeKey === key) return
    appliedRecipeKey = key
    endingStyle = 'echo'
    snapMode = recipe.outgoing.endAnchor.mode
    selectedPointSec = clamp(recipe.outgoing.endAnchor.timeSec, trimStartSec, trimEndSec)
    positionSec = selectedPointSec
    startSnapMode = recipe.incoming.startAnchor.mode === 'tonic'
      ? 'bar'
      : recipe.incoming.startAnchor.mode
    incomingStartSec = clamp(
      recipe.incoming.startAnchor.timeSec,
      incomingTrimStartSec,
      incomingTrimEndSec,
    )
    const echo = recipe.transition.echo
    echoDivision = echo.delayDivision
    echoCaptureBeats = echo.captureLengthBeats
    echoDryHoldBeats = echo.drySongHoldBeats
    echoAmount = echo.sendLevel
    echoWetLevel = echo.wetLevel
    echoFeedback = echo.feedback
    echoBuild = echo.repeatBuild
    echoToneHz = echo.toneHz
    endingTailSec = echo.tailLengthSec
    echoBlendLevel = echo.blendReverbLevel
    echoBlendLengthSec = echo.blendReverbLengthSec
    transitionAirBeats = recipe.transition.nextSongDelay.beats
    keepOutgoingPointVisible(selectedPointSec, true)
    keepIncomingPointVisible(incomingStartSec, true)
    queueWaveformDraw()
  }

  /** Is a recipe saved for exactly this pair? Drives the Remove button. */
  const savedRecipeForPair = $derived(
    savedTransitions.find(
      (candidate) =>
        candidate.outgoing.songId === selectedSongId &&
        candidate.incoming.songId === selectedIncomingSongId,
    ) ?? null,
  )

  /**
   * Delete the saved transition for this outgoing song.
   *
   * `removeProjectTransition` has existed and worked since transitions shipped
   * and had NO caller anywhere in the app — a recipe could be created and
   * replaced but never removed, so an ending programmed by mistake was
   * permanent short of hand-editing the project file.
   */
  async function removeTransitionForLive(): Promise<void> {
    if (!selectedSongId) return
    saveStatus = 'saving'
    saveMessage = ''
    try {
      await removeProjectTransition(selectedSongId)
      // Let the pair be re-applied from scratch if the user saves again.
      appliedRecipeKey = ''
      saveStatus = 'idle'
      saveMessage = 'Removed. This song now ends normally and the next one is started by hand.'
    } catch (cause) {
      saveStatus = 'failed'
      saveMessage = cause instanceof Error ? cause.message : 'Could not remove the transition.'
    }
  }

  async function saveTransitionForLive(): Promise<void> {
    const recipe = currentEchoRecipe()
    if (!recipe) {
      saveStatus = 'failed'
      saveMessage = 'Only the Echo throw can be programmed for Live Mode in this version.'
      return
    }
    saveStatus = 'saving'
    saveMessage = ''
    try {
      await setProjectTransition(recipe)
      saveStatus = 'saved'
      saveMessage = `Live Mode will transition to ${recipe.incoming.title}.`
    } catch (cause) {
      saveStatus = 'failed'
      saveMessage = cause instanceof Error ? cause.message : 'Could not save the transition.'
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }

  function rounded(value: number, digits: number): number {
    const scale = 10 ** digits
    return Math.round(value * scale) / scale
  }

  function fmtTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '0:00.0'
    const minutes = Math.floor(value / 60)
    const seconds = value - minutes * 60
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
  }

  function viewportBars(allBars: Bar[], startIndex: number, count: number): Bar[] {
    if (count === 0) return allBars
    const safeStart = clamp(startIndex, 0, Math.max(0, allBars.length - count))
    return allBars.slice(safeStart, safeStart + count)
  }

  function buildBarMarks(visibleBars: Bar[], viewStartSec: number, viewEndSec: number): TimelineMark[] {
    const duration = viewEndSec - viewStartSec
    if (duration <= 0) return []
    const step = visibleBars.length <= 8 ? 1 : Math.ceil(visibleBars.length / 8)
    return visibleBars
      .filter((_, index) => index % step === 0)
      .map((bar) => ({
        id: `bar-mark:${bar.id}`,
        leftPct: clamp((((bar.startSec + bar.endSec) / 2 - viewStartSec) / duration) * 100, 0, 100),
        label: `Bar ${bar.index + 1}`,
      }))
  }

  function buildBeatMarks(
    points: BeatPoint[],
    visibleBars: Bar[],
    viewStartSec: number,
    viewEndSec: number,
  ): TimelineMark[] {
    if (visibleBars.length > 8) return []
    const duration = viewEndSec - viewStartSec
    if (duration <= 0) return []
    const visibleIds = new Set(visibleBars.map((bar) => bar.id))
    return points
      .filter(
        (point) =>
          visibleIds.has(point.barId) &&
          point.timeSec >= viewStartSec &&
          point.timeSec <= viewEndSec,
      )
      .map((point) => ({
        id: `beat-mark:${point.id}`,
        leftPct: clamp(((point.timeSec - viewStartSec) / duration) * 100, 0, 100),
        label: String(point.indexInBar + 1),
      }))
  }

  function viewportLabel(visibleBars: Bar[], allBars: Bar[], count: number): string {
    if (count === 0) return `All ${allBars.length} bars`
    const first = visibleBars[0]
    const last = visibleBars[visibleBars.length - 1]
    if (!first || !last) return 'No bars'
    return `Bars ${first.index + 1}-${last.index + 1}`
  }

  function centeredViewStart(barIndex: number, totalBars: number, count: number): number {
    if (count === 0) return 0
    return clamp(barIndex - Math.floor(count / 2), 0, Math.max(0, totalBars - count))
  }

  function outgoingBarPositionAt(timeSec: number): number {
    if (snapMode === 'bar') {
      const endingBar = bars.findIndex((bar) => Math.abs(bar.endSec - timeSec) < 0.03)
      if (endingBar >= 0) return endingBar
    }
    const containing = bars.findIndex(
      (bar) => timeSec >= bar.startSec - 0.01 && timeSec < bar.endSec - 0.01,
    )
    return containing >= 0 ? containing : Math.max(0, bars.length - 1)
  }

  function incomingBarPositionAt(timeSec: number): number {
    const startingBar = incomingBars.findIndex((bar) => Math.abs(bar.startSec - timeSec) < 0.03)
    if (startingBar >= 0) return startingBar
    const containing = incomingBars.findIndex(
      (bar) => timeSec >= bar.startSec - 0.01 && timeSec < bar.endSec - 0.01,
    )
    return containing >= 0 ? containing : Math.max(0, incomingBars.length - 1)
  }

  function keepOutgoingPointVisible(timeSec: number, center = false): void {
    if (outgoingViewBars === 0 || bars.length === 0) return
    const index = outgoingBarPositionAt(timeSec)
    const outside =
      index < outgoingViewStartBar || index >= outgoingViewStartBar + outgoingViewBars
    if (!center && !outside) return
    outgoingViewStartBar = centeredViewStart(index, bars.length, outgoingViewBars)
    queueWaveformDraw()
  }

  function keepIncomingPointVisible(timeSec: number, center = false): void {
    if (incomingViewBars === 0 || incomingBars.length === 0) return
    const index = incomingBarPositionAt(timeSec)
    const outside =
      index < incomingViewStartBar || index >= incomingViewStartBar + incomingViewBars
    if (!center && !outside) return
    incomingViewStartBar = centeredViewStart(index, incomingBars.length, incomingViewBars)
    queueWaveformDraw()
  }

  function setOutgoingZoom(count: number): void {
    outgoingViewBars = count
    outgoingViewStartBar = centeredViewStart(
      outgoingBarPositionAt(selectedPointSec),
      bars.length,
      count,
    )
    queueWaveformDraw()
  }

  function setIncomingZoom(count: number): void {
    incomingViewBars = count
    incomingViewStartBar = centeredViewStart(
      incomingBarPositionAt(incomingStartSec),
      incomingBars.length,
      count,
    )
    queueWaveformDraw()
  }

  function panOutgoing(direction: -1 | 1): void {
    if (outgoingViewBars === 0) return
    const amount = Math.max(1, Math.floor(outgoingViewBars / 2))
    outgoingViewStartBar = clamp(
      outgoingViewStartBar + direction * amount,
      0,
      Math.max(0, bars.length - outgoingViewBars),
    )
    queueWaveformDraw()
  }

  function panIncoming(direction: -1 | 1): void {
    if (incomingViewBars === 0) return
    const amount = Math.max(1, Math.floor(incomingViewBars / 2))
    incomingViewStartBar = clamp(
      incomingViewStartBar + direction * amount,
      0,
      Math.max(0, incomingBars.length - incomingViewBars),
    )
    queueWaveformDraw()
  }

  function nearestTimedPoint<T extends { timeSec: number }>(timeSec: number, points: T[]): T | null {
    if (points.length === 0) return null
    let best = points[0]!
    let distance = Math.abs(best.timeSec - timeSec)
    for (let i = 1; i < points.length; i++) {
      const point = points[i]!
      const nextDistance = Math.abs(point.timeSec - timeSec)
      if (nextDistance >= distance) continue
      best = point
      distance = nextDistance
    }
    return best
  }

  function nearestBeat(timeSec: number, points: BeatPoint[]): BeatPoint | null {
    return nearestTimedPoint(timeSec, points)
  }

  function beatAtOrBefore(timeSec: number, points: BeatPoint[]): BeatPoint | null {
    let found: BeatPoint | null = null
    for (const point of points) {
      if (point.timeSec > timeSec + 0.015) break
      found = point
    }
    return found
  }

  function averageBeatDuration(): number {
    if (beatPoints.length > 1) {
      const gaps = beatPoints
        .slice(1, Math.min(beatPoints.length, 33))
        .map((point, index) => point.timeSec - beatPoints[index]!.timeSec)
        .filter((gap) => gap > 0.15 && gap < 2)
        .sort((a, b) => a - b)
      if (gaps.length > 0) return gaps[Math.floor(gaps.length / 2)]!
    }
    return 60 / Math.max(40, loadedMap?.metadata.bpm ?? 120)
  }

  function averageBarDuration(): number {
    const bar = selectedBar
    if (bar && bar.endSec > bar.startSec) return bar.endSec - bar.startSec
    return averageBeatDuration() * 4
  }

  function selectablePoints(mode = snapMode): SnapPoint[] {
    if (mode === 'bar') {
      return bars
        .filter((bar) => bar.endSec >= trimStartSec && bar.endSec <= trimEndSec + 0.01)
        .map((bar) => ({ id: `bar-end:${bar.id}`, timeSec: bar.endSec, barId: bar.id }))
    }
    if (mode === 'tonic') return tonicSnapPoints
    return beatPoints.map((point) => ({ ...point, beatId: point.id }))
  }

  function setSelectedPoint(rawTimeSec: number): void {
    stopPreview(false)
    const raw = clamp(rawTimeSec, trimStartSec, trimEndSec)
    if (snapMode === 'free') {
      selectedPointSec = raw
      positionSec = raw
      keepOutgoingPointVisible(raw)
      return
    }
    const point = nearestTimedPoint(raw, selectablePoints())
    selectedPointSec = point?.timeSec ?? raw
    positionSec = selectedPointSec
    keepOutgoingPointVisible(selectedPointSec)
  }

  function changeSnapMode(next: SnapMode): void {
    if (next === 'tonic' && tonicSnapPoints.length === 0) return
    snapMode = next
    setSelectedPoint(selectedPointSec)
  }

  function stepPoint(direction: -1 | 1): void {
    if (snapMode === 'free') {
      setSelectedPoint(selectedPointSec + direction * 0.1)
      return
    }
    const points = selectablePoints()
    if (points.length === 0) return
    const current = nearestTimedPoint(selectedPointSec, points)
    const index = current ? points.findIndex((point) => point.id === current.id) : 0
    const next = points[clamp(index + direction, 0, points.length - 1)]
    if (next) setSelectedPoint(next.timeSec)
  }

  function selectBar(barId: string): void {
    const bar = bars.find((candidate) => candidate.id === barId)
    if (!bar) return
    if (snapMode === 'bar') {
      setSelectedPoint(bar.endSec)
      return
    }
    const point = beatPoints.find((beat) => beat.barId === barId && beat.downbeat)
    setSelectedPoint(point?.timeSec ?? bar.startSec)
  }

  function selectBeat(beatId: string): void {
    const point = beatPoints.find((beat) => beat.id === beatId)
    if (point) setSelectedPoint(point.timeSec)
  }

  function selectTonicPoint(pointId: string): void {
    const point = tonicSnapPoints.find((candidate) => candidate.id === pointId)
    if (point) setSelectedPoint(point.timeSec)
  }

  function tonicPointLabel(point: SnapPoint): string {
    const bar = bars.find((candidate) => candidate.id === point.barId)
    const beat = point.beatId ? beatPoints.find((candidate) => candidate.id === point.beatId) : null
    if (!bar) return fmtTime(point.timeSec)
    return `Bar ${bar.index + 1}${beat ? ` · Beat ${beat.indexInBar + 1}` : ''}`
  }

  function setPointFromWaveform(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement) || outgoingViewDurationSec <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    setSelectedPoint(outgoingViewStartSec + fraction * outgoingViewDurationSec)
  }

  function waveformKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      stepPoint(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      stepPoint(1)
    }
  }

  function incomingSelectablePoints(mode = startSnapMode): SnapPoint[] {
    if (mode === 'bar') {
      return incomingBars
        .filter(
          (bar) =>
            bar.startSec >= incomingTrimStartSec - 0.01 &&
            bar.startSec <= incomingTrimEndSec + 0.01,
        )
        .map((bar) => ({ id: `incoming-bar:${bar.id}`, timeSec: bar.startSec, barId: bar.id }))
    }
    return incomingBeatPoints.map((point) => ({ ...point, beatId: point.id }))
  }

  function setIncomingStart(rawTimeSec: number): void {
    stopPreview(false)
    const raw = clamp(rawTimeSec, incomingTrimStartSec, incomingTrimEndSec)
    if (startSnapMode === 'free') {
      incomingStartSec = raw
      keepIncomingPointVisible(raw)
      return
    }
    const point = nearestTimedPoint(raw, incomingSelectablePoints())
    incomingStartSec = point?.timeSec ?? raw
    keepIncomingPointVisible(incomingStartSec)
  }

  function changeStartSnapMode(next: StartSnapMode): void {
    startSnapMode = next
    setIncomingStart(incomingStartSec)
  }

  function stepIncomingStart(direction: -1 | 1): void {
    if (startSnapMode === 'free') {
      setIncomingStart(incomingStartSec + direction * 0.1)
      return
    }
    const points = incomingSelectablePoints()
    if (points.length === 0) return
    const current = nearestTimedPoint(incomingStartSec, points)
    const index = current ? points.findIndex((point) => point.id === current.id) : 0
    const next = points[clamp(index + direction, 0, points.length - 1)]
    if (next) setIncomingStart(next.timeSec)
  }

  function selectIncomingBar(barId: string): void {
    const bar = incomingBars.find((candidate) => candidate.id === barId)
    if (!bar) return
    if (startSnapMode === 'bar') {
      setIncomingStart(bar.startSec)
      return
    }
    const beat = incomingBeatPoints.find((point) => point.barId === barId && point.downbeat)
    setIncomingStart(beat?.timeSec ?? bar.startSec)
  }

  function selectIncomingBeat(beatId: string): void {
    const point = incomingBeatPoints.find((beat) => beat.id === beatId)
    if (point) setIncomingStart(point.timeSec)
  }

  function setIncomingStartFromWaveform(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement) || incomingViewDurationSec <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    setIncomingStart(incomingViewStartSec + fraction * incomingViewDurationSec)
  }

  function incomingWaveformKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      stepIncomingStart(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      stepIncomingStart(1)
    }
  }

  function queueWaveformDraw(): void {
    if (drawRaf) cancelAnimationFrame(drawRaf)
    drawRaf = requestAnimationFrame(() => {
      drawRaf = 0
      drawWaveform()
      drawIncomingWaveform()
    })
  }

  function drawWaveform(): void {
    drawSongWaveform(
      waveformCanvas,
      waveformHost,
      decodedAudio,
      outgoingViewStartSec,
      outgoingViewEndSec,
      beatPoints,
    )
  }

  function drawIncomingWaveform(): void {
    drawSongWaveform(
      incomingWaveformCanvas,
      incomingWaveformHost,
      incomingAudio,
      incomingViewStartSec,
      incomingViewEndSec,
      incomingBeatPoints,
    )
  }

  function drawSongWaveform(
    canvas: HTMLCanvasElement | undefined,
    host: HTMLDivElement | undefined,
    buffer: AudioBuffer | null,
    rangeStartSec: number,
    rangeEndSec: number,
    points: BeatPoint[],
  ): void {
    if (!canvas || !host) return
    const width = Math.max(2, Math.floor(host.clientWidth))
    const height = Math.max(2, Math.floor(host.clientHeight))
    const rangeDurationSec = Math.max(0, rangeEndSec - rangeStartSec)

    if (!buffer || rangeDurationSec <= 0) {
      drawBlockPeaksToCanvas(canvas, new Float32Array(4), width, height, '#191919')
      return
    }

    const frameStart = clamp(Math.floor(rangeStartSec * buffer.sampleRate), 0, buffer.length - 1)
    const frameEnd = clamp(Math.ceil(rangeEndSec * buffer.sampleRate), frameStart + 1, buffer.length)
    const raw = computeVisualBlockPeaksFromChannels(
      buffer.getChannelData(0),
      buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null,
      frameStart,
      frameEnd,
      waveformBlockBucketCount(width),
    )
    drawBlockPeaksToCanvas(canvas, normalizeBlockPeaks(raw), width, height, '#181818')

    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) return
    canvasContext.save()
    for (const point of points) {
      if (point.timeSec < rangeStartSec || point.timeSec > rangeEndSec) continue
      const x = ((point.timeSec - rangeStartSec) / rangeDurationSec) * width
      canvasContext.fillStyle = point.downbeat ? 'rgba(255,122,26,0.32)' : 'rgba(24,24,24,0.10)'
      canvasContext.fillRect(Math.round(x), 0, point.downbeat ? 2 : 1, height)
    }
    canvasContext.restore()
  }

  function revokeAudioUrl(): void {
    if (!objectUrl) return
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }

  function ensureGraph(): AudioGraph {
    if (graph) return graph
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const source = ctx.createMediaElementSource(audioElement)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 20_000
    filter.Q.value = 0.7
    const songGain = ctx.createGain()
    const echoSend = ctx.createGain()
    echoSend.gain.value = 0
    const delay = ctx.createDelay(2)
    delay.delayTime.value = 0.35
    const feedback = ctx.createGain()
    feedback.gain.value = echoFeedback
    const echoFilter = ctx.createBiquadFilter()
    echoFilter.type = 'lowpass'
    echoFilter.frequency.value = echoToneHz
    echoFilter.Q.value = 0.45
    const echoWet = ctx.createGain()
    echoWet.gain.value = 0
    const echoReverbSend = ctx.createGain()
    echoReverbSend.gain.value = 0
    const echoReverbPredelay = ctx.createDelay(0.2)
    echoReverbPredelay.delayTime.value = 0.024
    const echoReverb = ctx.createConvolver()
    const echoReverbWet = ctx.createGain()
    echoReverbWet.gain.value = 0
    const endingBus = ctx.createGain()
    endingBus.gain.value = 1
    const incomingGain = ctx.createGain()
    incomingGain.gain.value = 1
    const master = ctx.createGain()
    master.gain.value = outputLevel
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 5
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.18

    source.connect(filter)
    filter.connect(songGain)
    songGain.connect(master)
    filter.connect(echoSend)
    echoSend.connect(delay)
    delay.connect(echoFilter)
    echoFilter.connect(echoWet)
    echoWet.connect(master)
    echoFilter.connect(feedback)
    feedback.connect(delay)
    echoFilter.connect(echoReverbSend)
    echoReverbSend.connect(echoReverbPredelay)
    echoReverbPredelay.connect(echoReverb)
    echoReverb.connect(echoReverbWet)
    echoReverbWet.connect(master)
    endingBus.connect(master)
    incomingGain.connect(master)
    master.connect(limiter)
    limiter.connect(ctx.destination)

    endingSynth = new KeysSynth()
    endingSynth.setPatch(FINALE_CHORD_PATCH)
    endingSynth.setVolume(chordLevel)
    endingSynth.attachContext(ctx, { destination: endingBus, seed: 0x454e4421 })

    graph = {
      ctx,
      source,
      filter,
      songGain,
      echoSend,
      delay,
      feedback,
      echoFilter,
      echoWet,
      echoReverbSend,
      echoReverbPredelay,
      echoReverb,
      echoReverbWet,
      endingBus,
      incomingGain,
      master,
      limiter,
    }
    return graph
  }

  async function resumeGraph(): Promise<AudioGraph> {
    const next = ensureGraph()
    if (next.ctx.state !== 'running') await next.ctx.resume()
    return next
  }

  function setAudioParam(param: AudioParam, value: number, at: number): void {
    param.cancelScheduledValues(at)
    param.setValueAtTime(value, at)
  }

  function resetGraphAutomation(): void {
    const current = graph
    if (!current || current.ctx.state === 'closed') return
    const now = current.ctx.currentTime
    setAudioParam(current.songGain.gain, 1, now)
    setAudioParam(current.filter.frequency, 20_000, now)
    setAudioParam(current.filter.Q, 0.7, now)
    setAudioParam(current.echoSend.gain, 0, now)
    setAudioParam(current.feedback.gain, 0, now)
    setAudioParam(current.echoFilter.frequency, echoToneHz, now)
    setAudioParam(current.echoFilter.Q, 0.45, now)
    setAudioParam(current.echoWet.gain, 0, now)
    setAudioParam(current.echoReverbSend.gain, 0, now)
    setAudioParam(current.echoReverbWet.gain, 0, now)
    setAudioParam(current.incomingGain.gain, 1, now)
    setAudioParam(current.master.gain, outputLevel, now)
  }

  function stopScheduledSources(): void {
    endingSynth?.stopScheduled()
    for (const source of scheduledSources) {
      try {
        source.stop()
      } catch {
        // The source may already have ended.
      }
    }
    scheduledSources.clear()
  }

  function clearPreviewTimers(): void {
    if (endTimer) clearTimeout(endTimer)
    if (incomingTimer) clearTimeout(incomingTimer)
    if (finishTimer) clearTimeout(finishTimer)
    endTimer = null
    incomingTimer = null
    finishTimer = null
  }

  function stopPositionLoop(): void {
    if (positionRaf) cancelAnimationFrame(positionRaf)
    positionRaf = 0
  }

  function startPositionLoop(): void {
    stopPositionLoop()
    const update = () => {
      if (!previewing) {
        positionRaf = 0
        return
      }
      if (!tailing && audioElement) positionSec = audioElement.currentTime
      positionRaf = requestAnimationFrame(update)
    }
    positionRaf = requestAnimationFrame(update)
  }

  function stopPreview(restorePoint = true): void {
    previewToken += 1
    clearPreviewTimers()
    stopPositionLoop()
    stopScheduledSources()
    if (audioElement) audioElement.pause()
    resetGraphAutomation()
    previewing = false
    tailing = false
    incomingPlaying = false
    preparing = false
    if (restorePoint) {
      positionSec = selectedPointSec
      if (audioElement?.src) audioElement.currentTime = selectedPointSec
    }
  }

  function updateOutputLevel(value: number): void {
    outputLevel = value
    const current = graph
    if (!current) return
    const now = current.ctx.currentTime
    current.master.gain.cancelScheduledValues(now)
    current.master.gain.setTargetAtTime(value, now, 0.012)
  }

  async function copyTransitionRecipe(): Promise<void> {
    if (copyResetTimer) clearTimeout(copyResetTimer)
    try {
      await navigator.clipboard.writeText(transitionRecipeJson)
      copyStatus = 'copied'
    } catch {
      copyStatus = 'failed'
    }
    copyResetTimer = setTimeout(() => {
      copyStatus = 'idle'
      copyResetTimer = null
    }, 2200)
  }

  async function prepareDrumBuffers(current: AudioGraph): Promise<void> {
    if (drumBuffers.size > 0) return
    const kit = await loadDrumKit('tr707')
    for (const [kind, samples] of Object.entries(kit.voices) as [DrumClass, Float32Array][]) {
      const buffer = current.ctx.createBuffer(1, samples.length, DRUM_KIT_SAMPLE_RATE)
      buffer.getChannelData(0).set(samples)
      drumBuffers.set(kind, buffer)
    }
  }

  function trackScheduledSource(source: AudioScheduledSourceNode): void {
    scheduledSources.add(source)
    source.addEventListener('ended', () => scheduledSources.delete(source), { once: true })
  }

  function scheduleDrum(
    current: AudioGraph,
    kind: DrumClass,
    at: number,
    level: number,
    playbackRate = 1,
  ): void {
    const buffer = drumBuffers.get(kind)
    if (!buffer || at < current.ctx.currentTime - 0.02 || level <= 0) return
    const source = current.ctx.createBufferSource()
    const gain = current.ctx.createGain()
    source.buffer = buffer
    source.playbackRate.value = playbackRate
    gain.gain.value = clamp(level, 0, 1.25)
    source.connect(gain)
    gain.connect(current.endingBus)
    source.start(Math.max(current.ctx.currentTime + 0.004, at))
    trackScheduledSource(source)
  }

  function scheduleFinalChord(chord: ChordSymbol, at: number): void {
    const notes = chordVoicingMidi(chord)
    const synth = endingSynth
    if (!synth || notes.length === 0 || chordLevel <= 0) return
    const root = notes[0]!
    const voiceNotes = [Math.max(36, root - 12), ...notes.slice(0, 4)]
    const heldSec = Math.max(0.35, endingTailSec - FINALE_CHORD_PATCH.env.release)
    synth.setVolume(clamp(chordLevel * 0.9, 0, 0.72))
    voiceNotes.forEach((note, index) => {
      synth.scheduleNote(note, index === 0 ? 86 : 74 - index * 3, at + index * 0.006, heldSec)
    })
  }

  function scheduleFill(current: AudioGraph, atEnd: number): void {
    if (fillIntensity <= 0) return
    const seconds = Math.max(0.2, averageBarDuration() * fillBars)
    const fromSongTime = selectedPointSec - seconds
    const fillPoints = beatPoints.filter(
      (point) => point.timeSec >= fromSongTime - 0.01 && point.timeSec < selectedPointSec - 0.015,
    )
    const usable = fillPoints.slice(-Math.max(2, Math.ceil(fillPoints.length * (0.35 + fillIntensity * 0.65))))
    usable.forEach((point, index) => {
      const at = atEnd - (selectedPointSec - point.timeSec)
      const progress = usable.length <= 1 ? 1 : index / (usable.length - 1)
      const rate = 0.82 + progress * 0.62
      scheduleDrum(current, index === usable.length - 1 ? 'snare' : 'tom', at, 0.34 + fillIntensity * 0.46, rate)
      if (fillIntensity > 0.58 && index < usable.length - 1) {
        const next = usable[index + 1]
        if (next) {
          const midpoint = point.timeSec + (next.timeSec - point.timeSec) * 0.5
          scheduleDrum(
            current,
            progress > 0.65 ? 'snare' : 'tom',
            atEnd - (selectedPointSec - midpoint),
            0.22 + fillIntensity * 0.32,
            rate + 0.12,
          )
        }
      }
    })
  }

  function scheduleSongCut(current: AudioGraph, atEnd: number, softnessMs = cutSoftnessMs): void {
    const fadeSec = clamp(softnessMs / 1000, 0.008, 0.5)
    const start = Math.max(current.ctx.currentTime, atEnd - fadeSec)
    current.songGain.gain.setValueAtTime(1, start)
    current.songGain.gain.linearRampToValueAtTime(0, atEnd)
  }

  function echoDelaySeconds(): number {
    const beat = averageBeatDuration()
    if (echoDivision === 'eighth') return beat * 0.5
    if (echoDivision === 'dotted-eighth') return beat * 0.75
    return beat
  }

  function buildEchoBlendImpulse(
    context: AudioContext,
    lengthSec: number,
    toneHz: number,
  ): AudioBuffer {
    const duration = clamp(lengthSec, 0.35, 8)
    const frameCount = Math.max(1, Math.round(context.sampleRate * duration))
    const impulse = context.createBuffer(2, frameCount, context.sampleRate)
    const cutoff = clamp(toneHz, 700, 12_000)
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

  function scheduleEnding(current: AudioGraph, atEnd: number): void {
    const now = current.ctx.currentTime
    resetGraphAutomation()

    if (endingStyle === 'cut') {
      scheduleSongCut(current, atEnd)
      return
    }

    if (endingStyle === 'hit' || endingStyle === 'fill-hit') {
      if (endingStyle === 'fill-hit') scheduleFill(current, atEnd)
      scheduleSongCut(current, atEnd, 24)
      scheduleDrum(current, 'kick', atEnd, hitLevel)
      scheduleDrum(current, 'cymbal', atEnd, crashLevel)
      if (endingChord) scheduleFinalChord(endingChord, atEnd)
      return
    }

    if (endingStyle === 'echo') {
      const beatDuration = averageBeatDuration()
      const throwAt = Math.max(now + 0.006, atEnd - echoThrowLeadSec)
      const captureSec = echoCaptureDurationSec
      const captureEdgeSec = clamp(captureSec * 0.12, 0.012, 0.07)
      const captureEnd = throwAt + captureSec
      const dryCutAt = Math.min(atEnd, throwAt + beatDuration * echoDryHoldBeats)
      const tailEnd = throwAt + echoEffectiveLengthSec
      const stopRampAt = Math.max(throwAt + 0.04, tailEnd - 0.14)
      const feedbackStart = clamp(echoFeedback, 0.05, 0.96)
      const feedbackEnd =
        echoBuild > 0
          ? 1 + echoBuild * 0.075
          : clamp(feedbackStart * (1 + echoBuild * 0.75), 0.05, 0.96)
      const wetStart = clamp(echoWetLevel * (echoBuild > 0 ? 0.68 : 1), 0, 1.25)
      const wetEnd = clamp(echoWetLevel * (1 + echoBuild * 0.85), 0, 1.35)
      current.delay.delayTime.setValueAtTime(echoDelaySeconds(), now)
      current.echoReverb.buffer = buildEchoBlendImpulse(
        current.ctx,
        echoBlendLengthSec,
        echoToneHz,
      )
      current.feedback.gain.setValueAtTime(feedbackStart, throwAt)
      current.feedback.gain.linearRampToValueAtTime(feedbackEnd, stopRampAt)
      current.feedback.gain.linearRampToValueAtTime(0, tailEnd)
      current.echoFilter.frequency.setValueAtTime(clamp(echoToneHz, 600, 12_000), now)
      current.echoWet.gain.setValueAtTime(0, now)
      current.echoWet.gain.setValueAtTime(wetStart, throwAt)
      current.echoWet.gain.linearRampToValueAtTime(wetEnd, stopRampAt)
      current.echoWet.gain.linearRampToValueAtTime(0, tailEnd)
      current.echoReverbSend.gain.setValueAtTime(0, now)
      current.echoReverbSend.gain.setValueAtTime(1, throwAt)
      current.echoReverbSend.gain.setValueAtTime(1, stopRampAt)
      current.echoReverbSend.gain.linearRampToValueAtTime(0, tailEnd)
      current.echoReverbWet.gain.setValueAtTime(0, now)
      current.echoReverbWet.gain.setValueAtTime(clamp(echoBlendLevel, 0, 0.8), throwAt)
      current.echoSend.gain.setValueAtTime(0, Math.max(now, throwAt - captureEdgeSec))
      current.echoSend.gain.linearRampToValueAtTime(echoAmount, throwAt)
      current.echoSend.gain.setValueAtTime(echoAmount, Math.max(throwAt, captureEnd - captureEdgeSec))
      current.echoSend.gain.linearRampToValueAtTime(0, captureEnd)
      scheduleSongCut(current, dryCutAt, 45)
      return
    }

    if (endingStyle === 'filter') {
      const sweepStart = Math.max(now, atEnd - averageBarDuration() * filterBars)
      current.filter.Q.setValueAtTime(filterResonance, sweepStart)
      current.filter.frequency.setValueAtTime(18_000, sweepStart)
      current.filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFloorHz), atEnd)
      scheduleSongCut(current, atEnd, 45)
      return
    }

    const fadeStart = Math.max(now, atEnd - averageBarDuration() * fadeBars)
    current.songGain.gain.setValueAtTime(1, fadeStart)
    current.songGain.gain.exponentialRampToValueAtTime(0.0001, atEnd)
  }

  function scheduleIncomingSong(current: AudioGraph, atStart: number): void {
    const buffer = incomingAudio
    if (!buffer) throw new Error('Load the next song before previewing the transition.')
    const offset = clamp(incomingStartSec, incomingTrimStartSec, incomingTrimEndSec)
    const available = Math.max(0, Math.min(buffer.duration, incomingTrimEndSec) - offset)
    if (available <= 0.03) throw new Error('Move the next-song start point earlier.')

    const source = current.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(current.incomingGain)
    current.incomingGain.gain.setValueAtTime(0.0001, atStart)
    current.incomingGain.gain.linearRampToValueAtTime(1, atStart + 0.035)
    source.start(atStart, offset, Math.min(available, TRANSITION_AFTER_SEC + 0.4))
    trackScheduledSource(source)
  }

  async function previewEnding(): Promise<void> {
    if (previewing) {
      stopPreview()
      return
    }
    if (!audioElement?.src || trimDurationSec <= 0 || !transitionReady) {
      error = 'Load two different project songs before previewing the transition.'
      return
    }

    stopPreview(false)
    const token = ++previewToken
    preparing = true
    error = ''
    try {
      const current = await resumeGraph()
      if (styleUsesHit) await prepareDrumBuffers(current)
      if (token !== previewToken) return

      resetGraphAutomation()
      audioElement.currentTime = previewStartSec
      positionSec = previewStartSec
      await audioElement.play()
      if (token !== previewToken) {
        audioElement.pause()
        return
      }

      previewing = true
      tailing = false
      preparing = false
      const secondsUntilEnd = Math.max(0.03, selectedPointSec - audioElement.currentTime)
      const atEnd = current.ctx.currentTime + secondsUntilEnd
      const secondsUntilIncoming = secondsUntilEnd + incomingDelayAfterEndSec
      const atIncoming = current.ctx.currentTime + secondsUntilIncoming
      scheduleEnding(current, atEnd)
      scheduleIncomingSong(current, atIncoming)
      startPositionLoop()

      endTimer = setTimeout(() => {
        if (token !== previewToken) return
        audioElement.pause()
        audioElement.currentTime = selectedPointSec
        positionSec = selectedPointSec
        tailing = effectiveTailSec > 0.25
      }, Math.max(1, Math.round(secondsUntilEnd * 1000)))

      incomingTimer = setTimeout(
        () => {
          if (token !== previewToken) return
          incomingPlaying = true
        },
        Math.max(1, Math.round(secondsUntilIncoming * 1000)),
      )

      finishTimer = setTimeout(
        () => {
          if (token !== previewToken) return
          stopPositionLoop()
          stopScheduledSources()
          previewing = false
          tailing = false
          incomingPlaying = false
          resetGraphAutomation()
        },
        Math.max(
          1,
          Math.round((secondsUntilIncoming + TRANSITION_AFTER_SEC + 0.08) * 1000),
        ),
      )
    } catch (cause) {
      if (token !== previewToken) return
      stopPreview(false)
      error = cause instanceof Error ? cause.message : 'Could not preview this ending.'
    } finally {
      if (token === previewToken) preparing = false
    }
  }

  function beatPointsForMap(map: SongMap, rangeStartSec: number, rangeEndSec: number): BeatPoint[] {
    const barById = new Map(map.timeline.bars.map((bar) => [bar.id, bar]))
    return [...map.timeline.beats]
      .map((beat) => {
        const bar = barById.get(beat.barId)
        return {
          id: beat.id,
          barId: beat.barId,
          barIndex: bar?.index ?? 0,
          indexInBar: beat.indexInBar,
          timeSec: beat.timeSec,
          downbeat: beat.indexInBar === 0,
        }
      })
      .filter(
        (beat) => beat.timeSec >= rangeStartSec - 0.01 && beat.timeSec <= rangeEndSec + 0.01,
      )
      .sort((a, b) => a.timeSec - b.timeSec)
  }

  async function readProjectAudio(songId: string): Promise<LoadedProjectAudio> {
    const snapshot = get(projectStore)
    const entry = snapshot.data?.songs.find((song) => song.id === songId)
    if (!snapshot.osPath || !entry) throw new Error('This project song is not available from local disk.')

    const read = await readProjectSong(snapshot.osPath, entry.folder)
    if (!read.ok) throw new Error(read.error)
    const decoded = decodeSmapBytes(read.bytes)
    const map = decoded.project.songMap
    let blob = decoded.audioBlob ?? null
    if (!blob && map.audio?.originalPath) {
      const asset = await readProjectSongAsset(snapshot.osPath, entry.folder, map.audio.originalPath)
      if (!asset.ok) throw new Error(asset.error)
      blob = asset.blob
    }
    if (!blob) throw new Error('The song has no readable audio file.')

    return {
      blob,
      map,
      title: map.metadata.title?.trim() || entry.folder,
      detail: `${map.timeline.bars.length} bars, ${map.timeline.beats.length} beats, ${Math.round(map.metadata.bpm ?? 0) || '--'} BPM`,
    }
  }

  async function installSongAudio(blob: Blob, map: SongMap, label: string, detail: string): Promise<void> {
    stopPreview(false)
    revokeAudioUrl()
    objectUrl = URL.createObjectURL(blob)
    audioElement.src = objectUrl
    audioElement.load()

    const current = ensureGraph()
    decodedAudio = await current.ctx.decodeAudioData(await blob.arrayBuffer())
    loadedMap = map
    durationSec = decodedAudio.duration
    trimStartSec = clamp(map.audio?.trim?.startSec ?? 0, 0, durationSec)
    trimEndSec = clamp(map.audio?.trim?.endSec ?? durationSec, trimStartSec, durationSec)
    bars = [...map.timeline.bars]
      .filter((bar) => bar.endSec >= trimStartSec && bar.startSec <= trimEndSec)
      .sort((a, b) => a.index - b.index)
    beatPoints = beatPointsForMap(map, trimStartSec, trimEndSec)

    sourceLabel = label
    sourceDetail = detail
    snapMode = 'bar'
    const defaultBar = [...bars]
      .reverse()
      .find((bar) => bar.endSec <= trimEndSec + 0.01 && bar.endSec > trimStartSec + 0.15)
    selectedPointSec = clamp(defaultBar?.endSec ?? trimEndSec, trimStartSec, trimEndSec)
    positionSec = selectedPointSec
    outgoingViewBars = 16
    outgoingViewStartBar = centeredViewStart(
      outgoingBarPositionAt(selectedPointSec),
      bars.length,
      outgoingViewBars,
    )
    audioElement.currentTime = selectedPointSec
    endingChordMode = map.metadata.keyDetail ? 'tonic' : 'song'
    await tick()
    queueWaveformDraw()
  }

  function followingProjectSongId(songId: string): string {
    const index = projectSongs.findIndex((song) => song.id === songId)
    if (index >= 0) {
      const following = projectSongs.slice(index + 1).find((song) => song.id !== songId)
      if (following) return following.id
    }
    return projectSongs.find((song) => song.id !== songId)?.id ?? ''
  }

  async function loadProjectSong(songId: string): Promise<void> {
    const token = ++loadToken
    selectedSongId = songId
    loading = true
    error = ''
    stopPreview(false)
    try {
      const song = await readProjectAudio(songId)
      if (token !== loadToken) return

      await installSongAudio(song.blob, song.map, song.title, song.detail)
      if (token !== loadToken) return
      if (selectedIncomingSongId === songId) {
        const fallbackId = followingProjectSongId(songId)
        if (fallbackId) void loadIncomingProjectSong(fallbackId)
      }
      applySavedRecipeIfReady()
      try {
        const url = new URL(window.location.href)
        url.searchParams.set('song', songId)
        history.replaceState(history.state, '', url)
      } catch {
        // URL reflection is optional; the loaded song remains usable.
      }
    } catch (cause) {
      if (token !== loadToken) return
      loadedMap = null
      beatPoints = []
      bars = []
      decodedAudio = null
      error = cause instanceof Error ? cause.message : 'Could not load project audio.'
    } finally {
      if (token === loadToken) loading = false
    }
  }

  async function installIncomingSongAudio(song: LoadedProjectAudio): Promise<void> {
    const current = ensureGraph()
    const decoded = await current.ctx.decodeAudioData(await song.blob.arrayBuffer())
    incomingMap = song.map
    incomingAudio = decoded
    incomingTrimStartSec = clamp(song.map.audio?.trim?.startSec ?? 0, 0, decoded.duration)
    incomingTrimEndSec = clamp(
      song.map.audio?.trim?.endSec ?? decoded.duration,
      incomingTrimStartSec,
      decoded.duration,
    )
    incomingBars = [...song.map.timeline.bars]
      .filter(
        (bar) => bar.endSec >= incomingTrimStartSec && bar.startSec <= incomingTrimEndSec,
      )
      .sort((a, b) => a.index - b.index)
    incomingBeatPoints = beatPointsForMap(song.map, incomingTrimStartSec, incomingTrimEndSec)
    incomingSourceLabel = song.title
    incomingSourceDetail = song.detail
    startSnapMode = 'bar'
    const firstBar = incomingBars.find(
      (bar) =>
        bar.startSec >= incomingTrimStartSec - 0.01 &&
        bar.startSec < incomingTrimEndSec - 0.03,
    )
    const firstBeat = incomingBeatPoints.find((beat) => beat.downbeat)
    incomingStartSec = clamp(
      firstBar?.startSec ?? firstBeat?.timeSec ?? incomingTrimStartSec,
      incomingTrimStartSec,
      incomingTrimEndSec,
    )
    incomingViewBars = 16
    incomingViewStartBar = centeredViewStart(
      incomingBarPositionAt(incomingStartSec),
      incomingBars.length,
      incomingViewBars,
    )
    await tick()
    if (incomingWaveformHost) resizeObserver?.observe(incomingWaveformHost)
    queueWaveformDraw()
  }

  async function loadIncomingProjectSong(songId: string): Promise<void> {
    const token = ++incomingLoadToken
    selectedIncomingSongId = songId
    loadingIncoming = true
    error = ''
    stopPreview(false)
    try {
      if (songId === selectedSongId) throw new Error('Choose two different songs for a transition.')
      const song = await readProjectAudio(songId)
      if (token !== incomingLoadToken) return
      await installIncomingSongAudio(song)
      if (token !== incomingLoadToken) return
      applySavedRecipeIfReady()
      try {
        const url = new URL(window.location.href)
        url.searchParams.set('next', songId)
        history.replaceState(history.state, '', url)
      } catch {
        // URL reflection is optional; the decoded destination remains usable.
      }
    } catch (cause) {
      if (token !== incomingLoadToken) return
      incomingMap = null
      incomingAudio = null
      incomingBars = []
      incomingBeatPoints = []
      error = cause instanceof Error ? cause.message : 'Could not load the next project song.'
    } finally {
      if (token === incomingLoadToken) loadingIncoming = false
    }
  }

  async function loadActiveBrowserSong(): Promise<void> {
    const session = get(audioSession)
    const map = get(activeSongMap)
    if (!session.file || !map) return
    await installSongAudio(
      session.file,
      map,
      map.metadata.title?.trim() || session.name,
      `${map.timeline.bars.length} bars, ${map.timeline.beats.length} beats, browser audio`,
    )
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null
    if (target?.matches('input, select, textarea, button')) return
    if (event.code === 'Space') {
      event.preventDefault()
      void previewEnding()
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
    resizeObserver = new ResizeObserver(queueWaveformDraw)
    if (waveformHost) resizeObserver.observe(waveformHost)
    if (incomingWaveformHost) resizeObserver.observe(incomingWaveformHost)

    let initialSelectionMade = false
    let requestedSongId = ''
    let requestedIncomingSongId = ''
    try {
      const url = new URL(window.location.href)
      requestedSongId = url.searchParams.get('song') ?? ''
      requestedIncomingSongId = url.searchParams.get('next') ?? ''
    } catch {
      requestedSongId = ''
    }

    projectUnsubscribe = projectStore.subscribe((snapshot) => {
      projectSongs = (snapshot.data?.songs ?? []).map((entry) => ({
        id: entry.id,
        folder: entry.folder,
        title: snapshot.metadataByFolder[entry.folder]?.title?.trim() || entry.folder,
        bpm: snapshot.metadataByFolder[entry.folder]?.bpm,
      }))
      savedTransitions = snapshot.data?.transitions ?? []
      projectWritable = Boolean(snapshot.osPath)
      if (initialSelectionMade || projectSongs.length === 0 || !snapshot.osPath) return
      initialSelectionMade = true
      const initialId = projectSongs.some((song) => song.id === requestedSongId)
        ? requestedSongId
        : snapshot.activeSongId && projectSongs.some((song) => song.id === snapshot.activeSongId)
          ? snapshot.activeSongId
          : projectSongs[0]!.id
      void loadProjectSong(initialId)
      const incomingId = projectSongs.some(
        (song) => song.id === requestedIncomingSongId && song.id !== initialId,
      )
        ? requestedIncomingSongId
        : followingProjectSongId(initialId)
      if (incomingId) void loadIncomingProjectSong(incomingId)
    })

    const snapshot = get(projectStore)
    if (!snapshot.osPath && get(audioSession).file && get(activeSongMap)) {
      initialSelectionMade = true
      void loadActiveBrowserSong()
    }
  })

  onDestroy(() => {
    stopPreview(false)
    if (copyResetTimer) clearTimeout(copyResetTimer)
    projectUnsubscribe?.()
    resizeObserver?.disconnect()
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown)
      if (drawRaf) cancelAnimationFrame(drawRaf)
    }
    revokeAudioUrl()
    void endingSynth?.close()
    endingSynth = null
    try {
      graph?.source.disconnect()
      void graph?.ctx.close()
    } catch {
      // Already disconnected during navigation teardown.
    }
    graph = null
  })
</script>

<svelte:head>
  <title>Transition Lab - BarBro</title>
</svelte:head>

<audio bind:this={audioElement} preload="auto"></audio>

<main class="ending-lab">
  <header class="lab-header">
    <a class="back-link" href="/project">
      <ArrowLeft aria-hidden="true" />
      Project
    </a>
    <div class="title-block">
      <span>Setlist preparation</span>
      <h1>Transition Lab</h1>
    </div>
    <button
      class="save-live"
      onclick={() => void saveTransitionForLive()}
      disabled={!canSaveTransition || saveStatus === 'saving'}
      title={endingStyle !== 'echo' ? 'Choose Echo throw to save this transition' : undefined}
    >
      {#if saveStatus === 'saved'}<Check aria-hidden="true" />{:else}<Save aria-hidden="true" />{/if}
      {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved for Live' : 'Save for Live'}
    </button>
    {#if savedRecipeForPair}
      <button
        class="save-live"
        onclick={() => void removeTransitionForLive()}
        disabled={saveStatus === 'saving'}
        title="Delete this saved transition. The song will end normally again."
      >
        <Trash2 aria-hidden="true" />
        Remove
      </button>
    {/if}
  </header>

  {#if saveMessage}
    <p class:save-error={saveStatus === 'failed'} class="save-message" role="status">{saveMessage}</p>
  {/if}

  <section class="source-bar" aria-label="Song source">
    <div class="source-name">
      <span>From</span>
      <strong>{loading ? 'Loading song...' : sourceLabel}</strong>
      <small>{sourceDetail}</small>
    </div>
    {#if projectSongs.length > 0}
      <label class="song-picker">
        <span>Outgoing song</span>
        <select
          value={selectedSongId}
          onchange={(event) => void loadProjectSong(event.currentTarget.value)}
          disabled={loading || previewing}
        >
          {#each projectSongs as song (song.id)}
            <option value={song.id}>{song.title}{song.bpm ? ` - ${Math.round(song.bpm)} BPM` : ''}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="output-level">
      <span>Output</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={outputLevel}
        oninput={(event) => updateOutputLevel(Number(event.currentTarget.value))}
      />
      <output>{Math.round(outputLevel * 100)}%</output>
    </label>
  </section>

  {#if error}
    <p class="error-message" role="alert">{error}</p>
  {/if}

  <section class="timeline-section" aria-labelledby="ending-point-heading">
    <div class="section-title">
      <div>
        <span>Ending point</span>
        <h2 id="ending-point-heading">{selectedPointLabel}</h2>
      </div>
      <div class="point-context">
        <strong>{selectedSection?.label ?? 'Outside sections'}</strong>
        <span>{fmtTime(selectedPointSec)}</span>
      </div>
    </div>

    <div class="viewport-toolbar">
      <strong>{viewportLabel(outgoingVisibleBars, bars, outgoingViewBars)}</strong>
      <div class="viewport-pan">
        <button
          onclick={() => panOutgoing(-1)}
          disabled={outgoingViewBars === 0 || outgoingViewStartBar === 0}
          aria-label="Show earlier bars"
          title="Show earlier bars"><ChevronLeft aria-hidden="true" /></button
        >
        <button
          onclick={() => panOutgoing(1)}
          disabled={outgoingViewBars === 0 || outgoingViewStartBar + outgoingViewBars >= bars.length}
          aria-label="Show later bars"
          title="Show later bars"><ChevronRight aria-hidden="true" /></button
        >
      </div>
      <div class="segmented compact zoom-control" aria-label="Outgoing waveform zoom">
        {#each ZOOM_BAR_OPTIONS as count (count)}
          <button class:active={outgoingViewBars === count} onclick={() => setOutgoingZoom(count)}>
            {count === 0 ? 'All' : count}
          </button>
        {/each}
      </div>
      <span>bars shown</span>
    </div>

    <div
      bind:this={waveformHost}
      class="waveform"
      role="slider"
      tabindex="0"
      aria-label="Choose ending point"
      aria-valuemin={outgoingViewStartSec}
      aria-valuemax={outgoingViewEndSec}
      aria-valuenow={selectedPointSec}
      aria-valuetext={selectedPointLabel}
      onpointerdown={setPointFromWaveform}
      onkeydown={waveformKeydown}
    >
      <canvas bind:this={waveformCanvas}></canvas>
      <div class="bar-ruler" aria-hidden="true">
        {#each outgoingBarMarks as mark (mark.id)}
          <span style={`left: ${mark.leftPct}%`}>{mark.label}</span>
        {/each}
      </div>
      {#if outgoingBeatMarks.length > 0}
        <div class="beat-ruler" aria-hidden="true">
          {#each outgoingBeatMarks as mark (mark.id)}
            <span style={`left: ${mark.leftPct}%`}>{mark.label}</span>
          {/each}
        </div>
      {/if}
      {#if playheadVisible && markerVisible}
        <div class="preview-range" style={`left: ${playheadPct}%; right: ${100 - markerPct}%`}></div>
      {/if}
      {#if previewing && playheadVisible}
        <div class="playhead" style={`left: ${playheadPct}%`}></div>
      {/if}
      {#if endingStyle === 'echo' && echoThrowVisible}
        <div class="echo-marker" style={`left: ${echoThrowPct}%`}>
          <span>Throw 3 / 7</span>
        </div>
      {/if}
      {#if markerVisible}
        <div class="end-marker" class:edge-right={markerPct > 90} style={`left: ${markerPct}%`}>
          <span>{snapMode === 'tonic' ? '1 chord' : snapMode === 'bar' ? 'Bar end' : 'End'}</span>
        </div>
      {/if}
    </div>

    <div class="point-toolbar">
      <div class="segmented" aria-label="Ending point snap mode">
        <button class:active={snapMode === 'bar'} onclick={() => changeSnapMode('bar')}>Bar end</button>
        <button class:active={snapMode === 'beat'} onclick={() => changeSnapMode('beat')}>Beat</button>
        <button
          class:active={snapMode === 'tonic'}
          disabled={tonicSnapPoints.length === 0}
          title={tonicSnapPoints.length === 0 ? 'This song needs a key and chord track' : 'Snap to a detected 1 chord'}
          onclick={() => changeSnapMode('tonic')}>1 chord</button
        >
        <button class:active={snapMode === 'free'} onclick={() => changeSnapMode('free')}>Free</button>
      </div>

      <div class="stepper">
        <button onclick={() => stepPoint(-1)} aria-label="Previous ending point" title="Previous ending point">
          <ChevronLeft aria-hidden="true" />
        </button>
        <strong>{selectedPointLabel}</strong>
        <button onclick={() => stepPoint(1)} aria-label="Next ending point" title="Next ending point">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      {#if snapMode === 'tonic' && tonicSnapPoints.length > 0}
        <label class="compact-select tonic-select">
          <span>1 chord</span>
          <select
            value={selectedTonicPoint?.id ?? ''}
            onchange={(event) => selectTonicPoint(event.currentTarget.value)}
          >
            {#each tonicSnapPoints as point (point.id)}
              <option value={point.id}>{tonicPointLabel(point)}</option>
            {/each}
          </select>
        </label>
      {:else if bars.length > 0}
        <label class="compact-select">
          <span>{snapMode === 'bar' ? 'Ending after bar' : 'Bar'}</span>
          <select value={selectedBar?.id ?? ''} onchange={(event) => selectBar(event.currentTarget.value)}>
            {#each bars as bar (bar.id)}
              <option value={bar.id}>{bar.index + 1}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if snapMode !== 'bar' && snapMode !== 'tonic' && selectedBarBeats.length > 0}
        <label class="compact-select">
          <span>Beat</span>
          <select value={selectedBeat?.id ?? ''} onchange={(event) => selectBeat(event.currentTarget.value)}>
            {#each selectedBarBeats as beat (beat.id)}
              <option value={beat.id}>{beat.indexInBar + 1}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  </section>

  <section class="incoming-section" aria-labelledby="incoming-point-heading">
    <div class="incoming-header">
      <div class="section-title incoming-title">
        <div>
          <span>Into next song</span>
          <h2 id="incoming-point-heading">{incomingStartLabel}</h2>
        </div>
        <div class="point-context">
          <strong>{incomingSection?.label ?? 'Song opening'}</strong>
          <span>{fmtTime(incomingStartSec)}</span>
        </div>
      </div>
      {#if projectSongs.length > 1}
        <label class="destination-picker">
          <span>Destination</span>
          <select
            value={selectedIncomingSongId}
            onchange={(event) => void loadIncomingProjectSong(event.currentTarget.value)}
            disabled={loadingIncoming || previewing}
          >
            {#each incomingSongOptions as song (song.id)}
              <option value={song.id}>{song.title}{song.bpm ? ` - ${Math.round(song.bpm)} BPM` : ''}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>

    <div class="incoming-source-name">
      <strong>{loadingIncoming ? 'Loading next song...' : incomingSourceLabel}</strong>
      <small>{incomingSourceDetail}</small>
    </div>

    <div class="viewport-toolbar">
      <strong>{viewportLabel(incomingVisibleBars, incomingBars, incomingViewBars)}</strong>
      <div class="viewport-pan">
        <button
          onclick={() => panIncoming(-1)}
          disabled={incomingViewBars === 0 || incomingViewStartBar === 0}
          aria-label="Show earlier bars in next song"
          title="Show earlier bars"><ChevronLeft aria-hidden="true" /></button
        >
        <button
          onclick={() => panIncoming(1)}
          disabled={incomingViewBars === 0 || incomingViewStartBar + incomingViewBars >= incomingBars.length}
          aria-label="Show later bars in next song"
          title="Show later bars"><ChevronRight aria-hidden="true" /></button
        >
      </div>
      <div class="segmented compact zoom-control" aria-label="Next song waveform zoom">
        {#each ZOOM_BAR_OPTIONS as count (count)}
          <button class:active={incomingViewBars === count} onclick={() => setIncomingZoom(count)}>
            {count === 0 ? 'All' : count}
          </button>
        {/each}
      </div>
      <span>bars shown</span>
    </div>

    <div
      bind:this={incomingWaveformHost}
      class="waveform incoming-waveform"
      role="slider"
      tabindex="0"
      aria-label="Choose next song start point"
      aria-valuemin={incomingViewStartSec}
      aria-valuemax={incomingViewEndSec}
      aria-valuenow={incomingStartSec}
      aria-valuetext={incomingStartLabel}
      onpointerdown={setIncomingStartFromWaveform}
      onkeydown={incomingWaveformKeydown}
    >
      <canvas bind:this={incomingWaveformCanvas}></canvas>
      <div class="bar-ruler" aria-hidden="true">
        {#each incomingBarMarks as mark (mark.id)}
          <span style={`left: ${mark.leftPct}%`}>{mark.label}</span>
        {/each}
      </div>
      {#if incomingBeatMarks.length > 0}
        <div class="beat-ruler" aria-hidden="true">
          {#each incomingBeatMarks as mark (mark.id)}
            <span style={`left: ${mark.leftPct}%`}>{mark.label}</span>
          {/each}
        </div>
      {/if}
      {#if incomingMarkerVisible}
        <div
          class="start-marker"
          class:edge-right={incomingMarkerPct > 90}
          style={`left: ${incomingMarkerPct}%`}
        >
          <span>Start</span>
        </div>
      {/if}
    </div>

    <div class="point-toolbar incoming-toolbar">
      <div class="segmented" aria-label="Next song start snap mode">
        <button class:active={startSnapMode === 'bar'} onclick={() => changeStartSnapMode('bar')}>Bar start</button>
        <button class:active={startSnapMode === 'beat'} onclick={() => changeStartSnapMode('beat')}>Beat</button>
        <button class:active={startSnapMode === 'free'} onclick={() => changeStartSnapMode('free')}>Free</button>
      </div>

      <div class="stepper">
        <button onclick={() => stepIncomingStart(-1)} aria-label="Previous start point" title="Previous start point">
          <ChevronLeft aria-hidden="true" />
        </button>
        <strong>{incomingStartLabel}</strong>
        <button onclick={() => stepIncomingStart(1)} aria-label="Next start point" title="Next start point">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      {#if incomingBars.length > 0}
        <label class="compact-select">
          <span>Starting bar</span>
          <select
            value={incomingSelectedBar?.id ?? ''}
            onchange={(event) => selectIncomingBar(event.currentTarget.value)}
          >
            {#each incomingBars as bar (bar.id)}
              <option value={bar.id}>{bar.index + 1}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if startSnapMode !== 'bar' && incomingSelectedBarBeats.length > 0}
        <label class="compact-select">
          <span>Beat</span>
          <select
            value={incomingSelectedBeat?.id ?? ''}
            onchange={(event) => selectIncomingBeat(event.currentTarget.value)}
          >
            {#each incomingSelectedBarBeats as beat (beat.id)}
              <option value={beat.id}>{beat.indexInBar + 1}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  </section>

  <section class="preview-bar" aria-label="Transition preview">
    <button
      class="preview-button"
      onclick={() => void previewEnding()}
      disabled={loading || loadingIncoming || preparing || !transitionReady}
      aria-label={previewing ? 'Stop transition preview' : 'Preview transition'}
    >
      {#if previewing}
        <Pause aria-hidden="true" />
        Stop
      {:else}
        <Play aria-hidden="true" />
        {preparing ? 'Preparing...' : 'Preview transition'}
      {/if}
    </button>
    <button class="reset-button" onclick={() => stopPreview()} aria-label="Reset preview" title="Reset preview">
      <RotateCcw aria-hidden="true" />
    </button>
    <div class="preview-time">
      <strong>{incomingPlaying ? 'NEXT' : tailing ? 'TAIL' : fmtTime(positionSec)}</strong>
      <span>
        {incomingPlaying
          ? incomingSourceLabel
          : `from ${fmtTime(previewStartSec)} to ${fmtTime(selectedPointSec)}`}
      </span>
    </div>
    <div class="lead-selector">
      <span>Hear before</span>
      <div class="segmented compact" aria-label="Preview lead-in bars">
        {#each PREVIEW_BAR_OPTIONS as count (count)}
          <button class:active={previewBars === count} onclick={() => (previewBars = count)}>{count}</button>
        {/each}
      </div>
      <span>bars</span>
    </div>
    <span class="space-hint">Space</span>
  </section>

  <div class="ending-workspace">
    <nav class="ending-list" aria-label="Ending style">
      <div class="list-heading">
        <span>Ending recipe</span>
        <strong>{styleOption.name}</strong>
      </div>
      {#each ENDING_OPTIONS as option (option.id)}
        <button
          class:active={endingStyle === option.id}
          onclick={() => {
            stopPreview()
            endingStyle = option.id
          }}
          aria-pressed={endingStyle === option.id}
        >
          <span class="style-icon">
            {#if option.id === 'cut'}
              <Scissors aria-hidden="true" />
            {:else if option.id === 'hit'}
              <Drum aria-hidden="true" />
            {:else if option.id === 'fill-hit'}
              <Sparkles aria-hidden="true" />
            {:else if option.id === 'echo'}
              <Radio aria-hidden="true" />
            {:else if option.id === 'filter'}
              <SlidersHorizontal aria-hidden="true" />
            {:else}
              <Waves aria-hidden="true" />
            {/if}
          </span>
          <span>
            <strong>{option.name}</strong>
            <small>{option.description}</small>
          </span>
        </button>
      {/each}
    </nav>

    <section class="recipe-editor" aria-labelledby="recipe-heading">
      <header>
        <div>
          <span>Sound</span>
          <h2 id="recipe-heading">{styleOption.name}</h2>
        </div>
        <strong class="final-chord">{endingChordLabel}</strong>
      </header>

      {#if endingStyle === 'cut'}
        <div class="control-group">
          <div class="control-heading">
            <strong>Cut softness</strong>
            <output>{cutSoftnessMs} ms</output>
          </div>
          <input
            type="range"
            min="8"
            max="450"
            step="1"
            value={cutSoftnessMs}
            oninput={(event) => (cutSoftnessMs = Number(event.currentTarget.value))}
          />
          <p>Short is a tight band stop. Longer softens awkward source material without becoming a fade.</p>
        </div>
      {/if}

      {#if styleUsesHit}
        {#if endingStyle === 'fill-hit'}
          <div class="control-group split-control">
            <div>
              <div class="control-heading">
                <strong>Fill length</strong>
                <output>{fillBars} bar{fillBars === 1 ? '' : 's'}</output>
              </div>
              <div class="segmented" aria-label="Fill length">
                {#each FILL_BAR_OPTIONS as count (count)}
                  <button class:active={fillBars === count} onclick={() => (fillBars = count)}>{count}</button>
                {/each}
              </div>
            </div>
            <label>
              <span>Fill intensity</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={fillIntensity}
                oninput={(event) => (fillIntensity = Number(event.currentTarget.value))}
              />
              <output>{Math.round(fillIntensity * 100)}%</output>
            </label>
          </div>
        {/if}

        <div class="control-grid">
          <label>
            <span>Final kick</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={hitLevel}
              oninput={(event) => (hitLevel = Number(event.currentTarget.value))}
            />
            <output>{Math.round(hitLevel * 100)}%</output>
          </label>
          <label>
            <span>Crash</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={crashLevel}
              oninput={(event) => (crashLevel = Number(event.currentTarget.value))}
            />
            <output>{Math.round(crashLevel * 100)}%</output>
          </label>
          <label>
            <span>Chord</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={chordLevel}
              oninput={(event) => (chordLevel = Number(event.currentTarget.value))}
            />
            <output>{Math.round(chordLevel * 100)}%</output>
          </label>
          <label>
            <span>Ring out</span>
            <input
              type="range"
              min="0.6"
              max="7"
              step="0.1"
              value={endingTailSec}
              oninput={(event) => (endingTailSec = Number(event.currentTarget.value))}
            />
            <output>{endingTailSec.toFixed(1)} s</output>
          </label>
        </div>

        <div class="chord-choice">
          <div>
            <strong>Final harmony</strong>
            <small>The 1 chord is usually the strongest ending even when the source is cut elsewhere.</small>
          </div>
          <div class="segmented" aria-label="Final chord source">
            <button class:active={endingChordMode === 'tonic'} onclick={() => (endingChordMode = 'tonic')}>
              1 chord
            </button>
            <button class:active={endingChordMode === 'song'} onclick={() => (endingChordMode = 'song')}>
              Song chord
            </button>
            <button class:active={endingChordMode === 'none'} onclick={() => (endingChordMode = 'none')}>
              None
            </button>
          </div>
        </div>
      {/if}

      {#if endingStyle === 'echo'}
        <div class="choice-row echo-timing-row">
          <div>
            <strong>Throw point</strong>
            <small>Beat 3 of the final bar, or 7 in an eight-count.</small>
          </div>
          <output>3 / 7</output>
        </div>
        <div class="control-grid">
          <label>
            <span>Capture length</span>
            <input
              type="range"
              min="0.125"
              max="2"
              step="0.125"
              value={echoCaptureBeats}
              oninput={(event) => (echoCaptureBeats = Number(event.currentTarget.value))}
            />
            <output>{echoCaptureBeats} beats</output>
          </label>
          <label>
            <span>Dry song hold</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.125"
              value={echoDryHoldBeats}
              oninput={(event) => (echoDryHoldBeats = Number(event.currentTarget.value))}
            />
            <output>{echoDryHoldBeats} beats</output>
          </label>
          <label>
            <span>Throw level</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={echoAmount}
              oninput={(event) => (echoAmount = Number(event.currentTarget.value))}
            />
            <output>{Math.round(echoAmount * 100)}%</output>
          </label>
          <label>
            <span>Wet level</span>
            <input
              type="range"
              min="0"
              max="1.1"
              step="0.01"
              value={echoWetLevel}
              oninput={(event) => (echoWetLevel = Number(event.currentTarget.value))}
            />
            <output>{Math.round(echoWetLevel * 100)}%</output>
          </label>
          <label>
            <span>Sustain</span>
            <input
              type="range"
              min="0.2"
              max="0.96"
              step="0.01"
              value={echoFeedback}
              oninput={(event) => (echoFeedback = Number(event.currentTarget.value))}
            />
            <output>{Math.round(echoFeedback * 100)}%</output>
          </label>
          <label>
            <span>Repeat build</span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={echoBuild}
              oninput={(event) => (echoBuild = Number(event.currentTarget.value))}
            />
            <output>{echoBuildLabel}</output>
          </label>
          <label>
            <span>Echo length</span>
            <input
              type="range"
              min="0.8"
              max="10"
              step="0.1"
              value={endingTailSec}
              oninput={(event) => (endingTailSec = Number(event.currentTarget.value))}
            />
            <output>{endingTailSec.toFixed(1)} s</output>
          </label>
          <label>
            <span>Tone</span>
            <input
              type="range"
              min="600"
              max="12000"
              step="100"
              value={echoToneHz}
              oninput={(event) => (echoToneHz = Number(event.currentTarget.value))}
            />
            <output>{echoToneHz >= 1000 ? `${(echoToneHz / 1000).toFixed(1)}k` : echoToneHz} Hz</output>
          </label>
          <label>
            <span>Blend tail</span>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.01"
              value={echoBlendLevel}
              oninput={(event) => (echoBlendLevel = Number(event.currentTarget.value))}
            />
            <output>{Math.round(echoBlendLevel * 100)}%</output>
          </label>
          <label>
            <span>Blend length</span>
            <input
              type="range"
              min="0.35"
              max="8"
              step="0.05"
              value={echoBlendLengthSec}
              oninput={(event) => (echoBlendLengthSec = Number(event.currentTarget.value))}
            />
            <output>{echoBlendLengthSec.toFixed(2)} s</output>
          </label>
        </div>
        <div class="choice-row">
          <strong>Delay time</strong>
          <div class="segmented" aria-label="Echo division">
            <button class:active={echoDivision === 'eighth'} onclick={() => (echoDivision = 'eighth')}>1/8</button>
            <button
              class:active={echoDivision === 'dotted-eighth'}
              onclick={() => (echoDivision = 'dotted-eighth')}>1/8 dot</button
            >
            <button class:active={echoDivision === 'quarter'} onclick={() => (echoDivision = 'quarter')}>1/4</button>
          </div>
        </div>
        <div class="control-group handoff-control">
          <div class="control-heading">
            <strong>Gap before next song</strong>
            <output>
              {transitionAirBeats.toFixed(2)} beats · {transitionGapSec.toFixed(2)} s
            </output>
          </div>
          <input
            type="range"
            min="0"
            max="8"
            step="0.25"
            value={transitionAirBeats}
            aria-label="Gap before next song"
            oninput={(event) => (transitionAirBeats = Number(event.currentTarget.value))}
          />
          <p>The feedback stops first, but the blend tail remains audible across this gap and into the next song.</p>
        </div>
      {/if}

      {#if endingStyle === 'filter'}
        <div class="control-grid">
          <label>
            <span>Sweep length</span>
            <input
              type="range"
              min="0.5"
              max="8"
              step="0.5"
              value={filterBars}
              oninput={(event) => (filterBars = Number(event.currentTarget.value))}
            />
            <output>{filterBars} bars</output>
          </label>
          <label>
            <span>Filter floor</span>
            <input
              type="range"
              min="90"
              max="1200"
              step="10"
              value={filterFloorHz}
              oninput={(event) => (filterFloorHz = Number(event.currentTarget.value))}
            />
            <output>{filterFloorHz} Hz</output>
          </label>
          <label>
            <span>Resonance</span>
            <input
              type="range"
              min="0.7"
              max="15"
              step="0.1"
              value={filterResonance}
              oninput={(event) => (filterResonance = Number(event.currentTarget.value))}
            />
            <output>{filterResonance.toFixed(1)}</output>
          </label>
        </div>
      {/if}

      {#if endingStyle === 'fade'}
        <div class="control-group">
          <div class="control-heading">
            <strong>Fade length</strong>
            <output>{fadeBars} bars</output>
          </div>
          <div class="segmented wide" aria-label="Fade length">
            {#each FADE_BAR_OPTIONS as count (count)}
              <button class:active={fadeBars === count} onclick={() => (fadeBars = count)}>{count}</button>
            {/each}
          </div>
          <p>The fade reaches silence exactly at the selected ending point.</p>
        </div>
      {/if}

      <footer class="recipe-summary">
        <span>
          {#if endingStyle === 'cut'}<VolumeX aria-hidden="true" />{:else}<Volume2 aria-hidden="true" />{/if}
        </span>
        <div>
          <strong>{selectedPointLabel}</strong>
          <small>
            {#if endingStyle === 'echo'}
              Echo throw, {effectiveTailSec.toFixed(1)} s build + {echoBlendLengthSec.toFixed(1)} s blend
            {:else}
              {styleOption.name}{endingChord && styleUsesHit ? ` on ${endingChordLabel}` : ''}{effectiveTailSec > 0.3
                ? `, ${effectiveTailSec.toFixed(1)} s tail`
                : ''}
            {/if}
          </small>
        </div>
      </footer>
    </section>
  </div>

  <section class="recipe-output" aria-labelledby="recipe-output-heading">
    <header>
      <div>
        <span>Transition output</span>
        <h2 id="recipe-output-heading">Copyable recipe</h2>
      </div>
      <button class="copy-button" onclick={() => void copyTransitionRecipe()}>
        {#if copyStatus === 'copied'}
          <Check aria-hidden="true" />
          Copied
        {:else}
          <Copy aria-hidden="true" />
          Copy recipe
        {/if}
      </button>
    </header>
    <textarea
      readonly
      rows="18"
      value={transitionRecipeJson}
      aria-label="Transition recipe JSON"
      onfocus={(event) => event.currentTarget.select()}
    ></textarea>
    {#if copyStatus === 'failed'}
      <p class="copy-error" role="alert">Clipboard access failed. Select the JSON and copy it manually.</p>
    {/if}
  </section>
</main>

<style>
  :global(.app-scroll) {
    background: var(--studio-paper);
  }

  .ending-lab {
    --lab-ink: var(--studio-ink);
    --lab-paper: var(--studio-paper);
    --lab-panel: var(--studio-panel);
    min-height: 100%;
    background: var(--lab-paper);
    color: var(--lab-ink);
    padding: 1.25rem clamp(1rem, 3vw, 2.5rem) 3rem;
  }

  button,
  select,
  input {
    font: inherit;
  }

  button,
  select {
    color: inherit;
  }

  .lab-header,
  .source-bar,
  .timeline-section,
  .incoming-section,
  .preview-bar,
  .ending-workspace,
  .recipe-output {
    width: min(1500px, 100%);
    margin-inline: auto;
  }

  .lab-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: inherit;
    font-size: 0.75rem;
    font-weight: 900;
    text-decoration: none;
    text-transform: uppercase;
  }

  .back-link :global(svg),
  button :global(svg) {
    width: 1rem;
    height: 1rem;
  }

  .title-block {
    min-width: 0;
  }

  .title-block span,
  .source-name > span,
  .song-picker > span,
  .destination-picker > span,
  .output-level > span,
  .section-title span,
  .list-heading > span,
  .recipe-editor header span {
    color: color-mix(in oklch, var(--lab-ink) 58%, transparent);
    font-size: 0.64rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  h1,
  h2,
  strong,
  p {
    margin: 0;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    line-height: 1;
  }

  h2 {
    font-size: 1.15rem;
    line-height: 1.05;
  }

  .save-live {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid var(--lab-ink);
    border-radius: 5px;
    background: var(--studio-orange);
    padding: 0.5rem 0.75rem;
    font-size: 0.7rem;
    font-weight: 950;
    text-transform: uppercase;
    box-shadow: 2px 2px 0 var(--lab-ink);
    cursor: pointer;
  }

  .save-live:disabled {
    opacity: 0.42;
    cursor: not-allowed;
    box-shadow: none;
  }

  .save-message {
    width: min(1500px, 100%);
    margin: -0.35rem auto 0.7rem;
    color: color-mix(in oklch, var(--lab-ink) 70%, transparent);
    font-size: 0.75rem;
    font-weight: 800;
    text-align: right;
  }

  .save-message.save-error {
    color: #a61b1b;
  }

  .source-bar {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(14rem, 22rem) minmax(12rem, 18rem);
    align-items: center;
    gap: 1rem;
    border-block: 1px solid color-mix(in oklch, var(--lab-ink) 20%, transparent);
    padding-block: 0.7rem;
  }

  .source-name {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .source-name strong {
    overflow: hidden;
    font-size: 1rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-name small {
    color: color-mix(in oklch, var(--lab-ink) 58%, transparent);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .song-picker,
  .output-level {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.55rem;
  }

  .song-picker span {
    grid-column: 1;
  }

  .song-picker select {
    grid-column: 2 / -1;
  }

  select {
    min-width: 0;
    border: 1px solid color-mix(in oklch, var(--lab-ink) 34%, transparent);
    border-radius: 5px;
    background: var(--lab-panel);
    padding: 0.42rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 800;
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--studio-orange);
  }

  output {
    min-width: 3.4rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 800;
    text-align: right;
  }

  .error-message {
    width: min(1500px, 100%);
    margin: 0.75rem auto 0;
    border-left: 5px solid #dc2626;
    background: color-mix(in oklch, #dc2626 10%, var(--lab-panel));
    padding: 0.65rem 0.8rem;
    font-size: 0.8rem;
    font-weight: 800;
  }

  .timeline-section {
    margin-top: 1.1rem;
  }

  .incoming-section {
    margin-top: 1.25rem;
    border-top: 1px solid color-mix(in oklch, var(--lab-ink) 20%, transparent);
    padding-top: 1rem;
  }

  .incoming-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 25rem);
    align-items: end;
    gap: 1.25rem;
    margin-bottom: 0.45rem;
  }

  .incoming-title {
    margin-bottom: 0;
  }

  .destination-picker {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.55rem;
  }

  .incoming-source-name {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.65rem;
    margin-bottom: 0.45rem;
  }

  .incoming-source-name strong {
    overflow: hidden;
    font-size: 0.82rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .incoming-source-name small {
    color: color-mix(in oklch, var(--lab-ink) 56%, transparent);
    font-size: 0.66rem;
    font-weight: 700;
  }

  .section-title {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.55rem;
  }

  .section-title > div:first-child {
    display: grid;
    gap: 0.16rem;
  }

  .point-context {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    font-size: 0.75rem;
  }

  .point-context span {
    font-family: var(--font-mono);
  }

  .viewport-toolbar {
    display: flex;
    min-height: 2rem;
    align-items: center;
    justify-content: flex-end;
    gap: 0.45rem;
    margin-bottom: 0.35rem;
  }

  .viewport-toolbar > strong {
    margin-right: auto;
    font-family: var(--font-mono);
    font-size: 0.72rem;
  }

  .viewport-toolbar > span {
    color: color-mix(in oklch, var(--lab-ink) 54%, transparent);
    font-size: 0.62rem;
    font-weight: 850;
    text-transform: uppercase;
  }

  .viewport-pan {
    display: inline-flex;
    gap: 0.2rem;
  }

  .viewport-pan button {
    display: inline-grid;
    width: 1.8rem;
    height: 1.8rem;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: color-mix(in oklch, var(--lab-ink) 9%, transparent);
    cursor: pointer;
  }

  .viewport-pan button:disabled {
    cursor: default;
    opacity: 0.3;
  }

  .zoom-control button {
    min-width: 2.25rem;
  }

  .waveform {
    position: relative;
    height: 13rem;
    overflow: hidden;
    border: 2px solid var(--lab-ink);
    border-radius: 6px;
    background: var(--lab-panel);
    cursor: crosshair;
    outline: none;
    touch-action: none;
  }

  .waveform:focus-visible {
    box-shadow: 0 0 0 3px var(--studio-orange);
  }

  .waveform canvas {
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0.88;
  }

  .bar-ruler,
  .beat-ruler {
    position: absolute;
    inset-inline: 0;
    z-index: 2;
    pointer-events: none;
  }

  .bar-ruler {
    top: 0.42rem;
  }

  .beat-ruler {
    bottom: 0.38rem;
  }

  .bar-ruler span,
  .beat-ruler span {
    position: absolute;
    transform: translateX(-50%);
    border-radius: 3px;
    background: rgb(248 249 250 / 0.84);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.16);
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 950;
    line-height: 1;
    white-space: nowrap;
  }

  .bar-ruler span {
    padding: 0.2rem 0.28rem;
    text-transform: uppercase;
  }

  .beat-ruler span {
    min-width: 1rem;
    padding: 0.16rem;
    text-align: center;
  }

  .incoming-waveform {
    height: 8rem;
    border-color: color-mix(in oklch, var(--lab-ink) 72%, transparent);
  }

  .preview-range {
    position: absolute;
    inset-block: 0;
    min-width: 1px;
    background: color-mix(in oklch, var(--studio-orange) 14%, transparent);
    pointer-events: none;
  }

  .playhead {
    position: absolute;
    inset-block: 0;
    width: 2px;
    z-index: 3;
    background: white;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.55);
    pointer-events: none;
  }

  .end-marker {
    position: absolute;
    inset-block: 0;
    width: 4px;
    z-index: 3;
    background: var(--studio-orange);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.65);
    pointer-events: none;
  }

  .end-marker span {
    position: absolute;
    top: 0.5rem;
    left: 0.45rem;
    border-radius: 4px;
    background: var(--studio-orange);
    color: var(--studio-ink);
    padding: 0.25rem 0.45rem;
    font-size: 0.65rem;
    font-weight: 950;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .end-marker.edge-right,
  .start-marker.edge-right {
    transform: translateX(-100%);
  }

  .end-marker.edge-right span,
  .start-marker.edge-right span {
    right: 0.45rem;
    left: auto;
  }

  .start-marker {
    position: absolute;
    inset-block: 0;
    width: 4px;
    z-index: 3;
    background: var(--lab-ink);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.55);
    pointer-events: none;
  }

  .start-marker span {
    position: absolute;
    top: 0.5rem;
    left: 0.45rem;
    border-radius: 4px;
    background: var(--lab-ink);
    color: var(--lab-paper);
    padding: 0.25rem 0.45rem;
    font-size: 0.65rem;
    font-weight: 950;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .echo-marker {
    position: absolute;
    inset-block: 0;
    z-index: 3;
    width: 0;
    border-left: 2px dashed var(--lab-ink);
    pointer-events: none;
  }

  .echo-marker span {
    position: absolute;
    top: 2.15rem;
    left: 0.4rem;
    border-radius: 4px;
    background: var(--lab-ink);
    color: var(--lab-paper);
    padding: 0.24rem 0.4rem;
    font-size: 0.6rem;
    font-weight: 950;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .point-toolbar,
  .preview-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .point-toolbar {
    padding-top: 0.65rem;
  }

  .segmented {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid color-mix(in oklch, var(--lab-ink) 34%, transparent);
    border-radius: 5px;
    background: var(--lab-panel);
  }

  .segmented button {
    min-width: 3.1rem;
    border: 0;
    border-left: 1px solid color-mix(in oklch, var(--lab-ink) 22%, transparent);
    background: transparent;
    padding: 0.4rem 0.6rem;
    font-size: 0.68rem;
    font-weight: 900;
    cursor: pointer;
  }

  .segmented button:first-child {
    border-left: 0;
  }

  .segmented button.active {
    background: var(--lab-ink);
    color: var(--lab-paper);
  }

  .segmented button:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }

  .segmented.compact button {
    min-width: 2rem;
    padding-inline: 0.42rem;
  }

  .segmented.wide {
    width: 100%;
  }

  .segmented.wide button {
    flex: 1;
  }

  .stepper {
    display: inline-flex;
    min-width: 15rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .stepper button,
  .reset-button {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: color-mix(in oklch, var(--lab-ink) 9%, transparent);
    cursor: pointer;
  }

  .stepper strong {
    font-size: 0.72rem;
  }

  .compact-select {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  .compact-select + .compact-select {
    margin-left: 0;
  }

  .compact-select span {
    color: color-mix(in oklch, var(--lab-ink) 56%, transparent);
    font-size: 0.65rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .compact-select select {
    min-width: 4rem;
  }

  .preview-bar {
    margin-top: 1rem;
    border-block: 1px solid color-mix(in oklch, var(--lab-ink) 20%, transparent);
    padding-block: 0.65rem;
  }

  .preview-button {
    display: inline-flex;
    min-width: 10rem;
    height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 0;
    border-radius: 6px;
    background: var(--studio-orange);
    color: var(--studio-ink);
    box-shadow: 3px 3px 0 var(--lab-ink);
    font-size: 0.78rem;
    font-weight: 950;
    cursor: pointer;
  }

  .preview-button:active {
    transform: translate(2px, 2px);
    box-shadow: 1px 1px 0 var(--lab-ink);
  }

  .preview-button:disabled {
    cursor: wait;
    opacity: 0.5;
  }

  .preview-time {
    display: grid;
    min-width: 12rem;
    gap: 0.05rem;
  }

  .preview-time strong {
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  .preview-time span,
  .lead-selector > span,
  .space-hint {
    color: color-mix(in oklch, var(--lab-ink) 54%, transparent);
    font-size: 0.65rem;
    font-weight: 800;
  }

  .lead-selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  .space-hint {
    border: 1px solid color-mix(in oklch, var(--lab-ink) 24%, transparent);
    border-radius: 4px;
    padding: 0.24rem 0.4rem;
    font-family: var(--font-mono);
    text-transform: uppercase;
  }

  .ending-workspace {
    display: grid;
    grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr);
    min-height: 31rem;
    margin-top: 1rem;
    overflow: hidden;
    border: 1px solid color-mix(in oklch, var(--lab-ink) 24%, transparent);
    border-radius: 6px;
    background: var(--lab-panel);
    box-shadow: 0 5px 16px rgb(0 0 0 / 0.1);
  }

  .ending-list {
    border-right: 1px solid color-mix(in oklch, var(--lab-ink) 20%, transparent);
    background: color-mix(in oklch, var(--lab-panel) 74%, var(--lab-paper));
  }

  .list-heading {
    display: grid;
    gap: 0.15rem;
    border-bottom: 1px solid color-mix(in oklch, var(--lab-ink) 18%, transparent);
    padding: 0.85rem 1rem;
  }

  .ending-list > button {
    display: grid;
    width: 100%;
    grid-template-columns: 2rem 1fr;
    align-items: center;
    gap: 0.65rem;
    border: 0;
    border-bottom: 1px solid color-mix(in oklch, var(--lab-ink) 12%, transparent);
    background: transparent;
    padding: 0.75rem 0.9rem;
    text-align: left;
    cursor: pointer;
  }

  .ending-list > button:hover {
    background: color-mix(in oklch, var(--studio-orange) 10%, transparent);
  }

  .ending-list > button.active {
    background: var(--studio-orange);
    box-shadow: inset 5px 0 0 var(--lab-ink);
  }

  .style-icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 50%;
    background: color-mix(in oklch, var(--lab-ink) 10%, transparent);
  }

  .ending-list > button.active .style-icon {
    background: var(--lab-ink);
    color: var(--lab-paper);
  }

  .ending-list button > span:last-child {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .ending-list button strong {
    font-size: 0.78rem;
  }

  .ending-list button small {
    color: color-mix(in oklch, var(--lab-ink) 62%, transparent);
    font-size: 0.67rem;
    font-weight: 650;
    line-height: 1.25;
  }

  .recipe-editor {
    display: flex;
    min-width: 0;
    flex-direction: column;
    padding: 1rem 1.2rem;
  }

  .recipe-editor > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid color-mix(in oklch, var(--lab-ink) 18%, transparent);
    padding-bottom: 0.8rem;
  }

  .recipe-editor > header > div {
    display: grid;
    gap: 0.16rem;
  }

  .final-chord {
    font-family: var(--font-mono);
    font-size: 1.15rem;
  }

  .control-group,
  .control-grid,
  .choice-row,
  .chord-choice {
    border-bottom: 1px solid color-mix(in oklch, var(--lab-ink) 14%, transparent);
    padding-block: 1rem;
  }

  .control-heading,
  .choice-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.55rem;
  }

  .control-heading strong,
  .choice-row > strong,
  .choice-row > div:first-child strong,
  .chord-choice strong {
    font-size: 0.76rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .choice-row > div:first-child {
    display: grid;
    gap: 0.18rem;
  }

  .choice-row > div:first-child small {
    color: color-mix(in oklch, var(--lab-ink) 58%, transparent);
    font-size: 0.68rem;
    font-weight: 700;
  }

  .control-group > p {
    max-width: 62ch;
    margin-top: 0.55rem;
    color: color-mix(in oklch, var(--lab-ink) 62%, transparent);
    font-size: 0.72rem;
    font-weight: 650;
  }

  .split-control {
    display: grid;
    grid-template-columns: minmax(12rem, 0.8fr) minmax(16rem, 1.2fr);
    gap: 1.5rem;
  }

  .split-control label,
  .control-grid label {
    display: grid;
    grid-template-columns: minmax(6.5rem, auto) 1fr minmax(4.8rem, auto);
    align-items: center;
    gap: 0.75rem;
  }

  .split-control label span,
  .control-grid label span {
    font-size: 0.72rem;
    font-weight: 850;
  }

  .control-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem 1.5rem;
  }

  .chord-choice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .chord-choice > div:first-child {
    display: grid;
    gap: 0.2rem;
  }

  .chord-choice small {
    color: color-mix(in oklch, var(--lab-ink) 58%, transparent);
    font-size: 0.68rem;
    font-weight: 650;
  }

  .recipe-summary {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-top: auto;
    padding-top: 1rem;
  }

  .recipe-summary > span {
    display: grid;
    width: 2.2rem;
    height: 2.2rem;
    place-items: center;
    border-radius: 50%;
    background: var(--lab-ink);
    color: var(--lab-paper);
  }

  .recipe-summary :global(svg) {
    width: 1rem;
    height: 1rem;
  }

  .recipe-summary > div {
    display: grid;
    gap: 0.1rem;
  }

  .recipe-summary strong {
    font-size: 0.76rem;
  }

  .recipe-summary small {
    color: color-mix(in oklch, var(--lab-ink) 58%, transparent);
    font-size: 0.68rem;
    font-weight: 700;
  }

  .handoff-control output {
    width: auto;
    white-space: nowrap;
  }

  .recipe-output {
    margin-top: 1.25rem;
    border-top: 1px solid color-mix(in oklch, var(--lab-ink) 24%, transparent);
    padding-top: 1.1rem;
  }

  .recipe-output > header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
  }

  .recipe-output > header > div {
    display: grid;
    gap: 0.16rem;
  }

  .recipe-output > header span {
    color: color-mix(in oklch, var(--lab-ink) 58%, transparent);
    font-size: 0.64rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .copy-button {
    display: inline-flex;
    min-height: 2.2rem;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    border-radius: 5px;
    background: var(--lab-ink);
    color: var(--lab-paper);
    padding: 0.5rem 0.75rem;
    font-size: 0.72rem;
    font-weight: 900;
    cursor: pointer;
  }

  .recipe-output textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 19rem;
    margin-top: 0.7rem;
    resize: vertical;
    border: 1px solid color-mix(in oklch, var(--lab-ink) 34%, transparent);
    border-radius: 6px;
    background: var(--lab-panel);
    color: var(--lab-ink);
    padding: 0.8rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .copy-error {
    margin-top: 0.45rem;
    color: #b91c1c;
    font-size: 0.72rem;
    font-weight: 800;
  }

  @media (max-width: 980px) {
    .source-bar {
      grid-template-columns: 1fr 1fr;
    }

    .source-name {
      grid-column: 1 / -1;
    }

    .incoming-header {
      grid-template-columns: 1fr;
    }

    .waveform {
      height: 10rem;
    }

    .incoming-waveform {
      height: 7rem;
    }

    .ending-workspace {
      grid-template-columns: 14rem minmax(0, 1fr);
    }

    .control-grid,
    .split-control {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .ending-lab {
      padding-inline: 0.75rem;
    }

    .lab-header {
      grid-template-columns: auto 1fr;
    }

    .save-live {
      grid-column: 1 / -1;
      justify-self: stretch;
      justify-content: center;
    }

    .source-bar,
    .ending-workspace {
      grid-template-columns: 1fr;
    }

    .incoming-source-name {
      display: grid;
      gap: 0.1rem;
    }

    .viewport-toolbar {
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    .viewport-toolbar > strong {
      width: 100%;
      margin-right: 0;
    }

    .song-picker,
    .output-level {
      grid-template-columns: auto 1fr auto;
    }

    .point-toolbar,
    .preview-bar,
    .chord-choice {
      align-items: stretch;
      flex-wrap: wrap;
    }

    .compact-select {
      margin-left: 0;
    }

    .preview-time {
      min-width: 8rem;
    }

    .lead-selector {
      margin-left: 0;
    }

    .space-hint {
      display: none;
    }

    .ending-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      border-right: 0;
      border-bottom: 1px solid color-mix(in oklch, var(--lab-ink) 20%, transparent);
    }

    .list-heading {
      grid-column: 1 / -1;
    }

    .ending-list > button {
      grid-template-columns: 1.8rem 1fr;
      border-right: 1px solid color-mix(in oklch, var(--lab-ink) 12%, transparent);
    }

    .style-icon {
      width: 1.8rem;
      height: 1.8rem;
    }

    .control-grid label,
    .split-control label {
      grid-template-columns: 6rem 1fr minmax(4.4rem, auto);
    }

    .recipe-output > header {
      align-items: center;
    }
  }
</style>
