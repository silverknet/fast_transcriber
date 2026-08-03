<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { get } from 'svelte/store'
  import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Drum,
    Pause,
    Play,
    Radio,
    RotateCcw,
    Scissors,
    SlidersHorizontal,
    Sparkles,
    Volume2,
    VolumeX,
    Waves,
  } from '@lucide/svelte'
  import { readProjectSong, readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { decodeSmapBytes } from '$lib/songmap/smapFile'
  import { audioSession } from '$lib/stores/audioSession'
  import { project as projectStore } from '$lib/stores/project'
  import { songMap as activeSongMap } from '$lib/stores/songMap'
  import type { Bar, ChordSymbol, DrumClass, SongMap } from '$lib/songmap/types'
  import { chordVoicingMidi, formatChordSymbol, resolveChordAtEachBeat } from '$lib/chords'
  import { DRUM_KIT_SAMPLE_RATE, loadDrumKit } from '$lib/audio/drumKits'
  import {
    computeVisualBlockPeaksFromChannels,
    drawBlockPeaksToCanvas,
    normalizeBlockPeaks,
    waveformBlockBucketCount,
  } from '$lib/audio/waveformBlocks'

  type SnapMode = 'bar' | 'beat' | 'free'
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
    echoWet: GainNode
    endingBus: GainNode
    master: GainNode
  }

  const ENDING_OPTIONS: EndingOption[] = [
    { id: 'cut', name: 'Clean cut', description: 'Tight stop on the selected point.' },
    { id: 'hit', name: 'Band hit', description: 'Mute the track and land kick, crash and chord.' },
    { id: 'fill-hit', name: 'Fill + hit', description: 'Build through the previous bar, then land together.' },
    { id: 'echo', name: 'Echo throw', description: 'Catch the last fragment and let it repeat into silence.' },
    { id: 'filter', name: 'Filter dive', description: 'Close the music down before a sharp final cut.' },
    { id: 'fade', name: 'Fade out', description: 'A controlled musical fade ending at the marker.' },
  ]

  const PREVIEW_BAR_OPTIONS = [1, 2, 4, 8]
  const FILL_BAR_OPTIONS = [0.5, 1, 2]
  const FADE_BAR_OPTIONS = [1, 2, 4, 8]

  let audioElement: HTMLAudioElement
  let waveformHost: HTMLDivElement
  let waveformCanvas: HTMLCanvasElement
  let graph: AudioGraph | null = null
  let decodedAudio: AudioBuffer | null = null
  let objectUrl: string | null = null
  let resizeObserver: ResizeObserver | null = null
  let projectUnsubscribe: (() => void) | null = null
  let positionRaf = 0
  let drawRaf = 0
  let previewToken = 0
  let loadToken = 0
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let finishTimer: ReturnType<typeof setTimeout> | null = null
  const scheduledSources = new Set<AudioScheduledSourceNode>()
  const drumBuffers = new Map<DrumClass, AudioBuffer>()

  let projectSongs = $state<SongOption[]>([])
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

  let snapMode = $state<SnapMode>('beat')
  let endingStyle = $state<EndingStyle>('fill-hit')
  let endingChordMode = $state<EndingChordMode>('tonic')
  let previewBars = $state(4)
  let outputLevel = $state(0.82)
  let cutSoftnessMs = $state(28)
  let fillBars = $state(1)
  let fillIntensity = $state(0.68)
  let hitLevel = $state(0.78)
  let crashLevel = $state(0.58)
  let chordLevel = $state(0.48)
  let endingTailSec = $state(3.2)
  let echoAmount = $state(0.62)
  let echoFeedback = $state(0.48)
  let echoDivision = $state<EchoDivision>('dotted-eighth')
  let filterBars = $state(2)
  let filterFloorHz = $state(320)
  let filterResonance = $state(5)
  let fadeBars = $state(4)

  const trimDurationSec = $derived(Math.max(0, trimEndSec - trimStartSec))
  const selectedBeat = $derived.by(() => nearestBeat(selectedPointSec, beatPoints))
  const selectedBar = $derived.by(() => {
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
    const beatLabel = beat ? `Beat ${beat.indexInBar + 1}` : 'Free point'
    return `Bar ${bar.index + 1}, ${beatLabel}`
  })
  const selectedBarPosition = $derived(selectedBar ? bars.findIndex((bar) => bar.id === selectedBar.id) : -1)
  const previewStartSec = $derived.by(() => {
    if (bars.length === 0 || selectedBarPosition < 0) {
      const fallback = selectedPointSec - previewBars * averageBarDuration()
      return clamp(fallback, trimStartSec, selectedPointSec)
    }
    const startIndex = Math.max(0, selectedBarPosition - previewBars)
    return clamp(bars[startIndex]?.startSec ?? trimStartSec, trimStartSec, selectedPointSec)
  })
  const markerPct = $derived(
    trimDurationSec > 0 ? clamp(((selectedPointSec - trimStartSec) / trimDurationSec) * 100, 0, 100) : 0,
  )
  const playheadPct = $derived(
    trimDurationSec > 0 ? clamp(((positionSec - trimStartSec) / trimDurationSec) * 100, 0, 100) : 0,
  )
  const styleOption = $derived(ENDING_OPTIONS.find((option) => option.id === endingStyle) ?? ENDING_OPTIONS[0])
  const styleUsesHit = $derived(endingStyle === 'hit' || endingStyle === 'fill-hit')
  const effectiveTailSec = $derived.by(() => {
    if (endingStyle === 'hit' || endingStyle === 'fill-hit') return endingTailSec
    if (endingStyle === 'echo') return Math.max(1.5, endingTailSec)
    if (endingStyle === 'filter') return 0.45
    return 0.18
  })

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }

  function fmtTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '0:00.0'
    const minutes = Math.floor(value / 60)
    const seconds = value - minutes * 60
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
  }

  function nearestBeat(timeSec: number, points: BeatPoint[]): BeatPoint | null {
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

  function selectablePoints(mode = snapMode): BeatPoint[] {
    return mode === 'bar' ? beatPoints.filter((point) => point.downbeat) : beatPoints
  }

  function setSelectedPoint(rawTimeSec: number): void {
    stopPreview(false)
    const raw = clamp(rawTimeSec, trimStartSec, trimEndSec)
    if (snapMode === 'free') {
      selectedPointSec = raw
      positionSec = raw
      return
    }
    const point = nearestBeat(raw, selectablePoints())
    selectedPointSec = point?.timeSec ?? raw
    positionSec = selectedPointSec
  }

  function changeSnapMode(next: SnapMode): void {
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
    const current = nearestBeat(selectedPointSec, points)
    const index = current ? points.findIndex((point) => point.id === current.id) : 0
    const next = points[clamp(index + direction, 0, points.length - 1)]
    if (next) setSelectedPoint(next.timeSec)
  }

  function selectBar(barId: string): void {
    const point = beatPoints.find((beat) => beat.barId === barId && beat.downbeat)
    const bar = bars.find((candidate) => candidate.id === barId)
    setSelectedPoint(point?.timeSec ?? bar?.startSec ?? selectedPointSec)
  }

  function selectBeat(beatId: string): void {
    const point = beatPoints.find((beat) => beat.id === beatId)
    if (point) setSelectedPoint(point.timeSec)
  }

  function setPointFromWaveform(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement) || trimDurationSec <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    setSelectedPoint(trimStartSec + fraction * trimDurationSec)
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

  function queueWaveformDraw(): void {
    if (drawRaf) cancelAnimationFrame(drawRaf)
    drawRaf = requestAnimationFrame(() => {
      drawRaf = 0
      drawWaveform()
    })
  }

  function drawWaveform(): void {
    if (!waveformCanvas || !waveformHost) return
    const width = Math.max(2, Math.floor(waveformHost.clientWidth))
    const height = Math.max(2, Math.floor(waveformHost.clientHeight))
    const buffer = decodedAudio

    if (!buffer || trimDurationSec <= 0) {
      drawBlockPeaksToCanvas(waveformCanvas, new Float32Array(4), width, height, '#191919')
      return
    }

    const frameStart = clamp(Math.floor(trimStartSec * buffer.sampleRate), 0, buffer.length - 1)
    const frameEnd = clamp(Math.ceil(trimEndSec * buffer.sampleRate), frameStart + 1, buffer.length)
    const raw = computeVisualBlockPeaksFromChannels(
      buffer.getChannelData(0),
      buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null,
      frameStart,
      frameEnd,
      waveformBlockBucketCount(width),
    )
    drawBlockPeaksToCanvas(waveformCanvas, normalizeBlockPeaks(raw), width, height, '#181818')

    const canvasContext = waveformCanvas.getContext('2d')
    if (!canvasContext) return
    canvasContext.save()
    for (const point of beatPoints) {
      if (point.timeSec < trimStartSec || point.timeSec > trimEndSec) continue
      const x = ((point.timeSec - trimStartSec) / trimDurationSec) * width
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
    const echoWet = ctx.createGain()
    echoWet.gain.value = 0
    const endingBus = ctx.createGain()
    endingBus.gain.value = 1
    const master = ctx.createGain()
    master.gain.value = outputLevel

    source.connect(filter)
    filter.connect(songGain)
    songGain.connect(master)
    filter.connect(echoSend)
    echoSend.connect(delay)
    delay.connect(echoWet)
    echoWet.connect(master)
    delay.connect(feedback)
    feedback.connect(delay)
    endingBus.connect(master)
    master.connect(ctx.destination)

    graph = { ctx, source, filter, songGain, echoSend, delay, feedback, echoWet, endingBus, master }
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
    setAudioParam(current.feedback.gain, echoFeedback, now)
    setAudioParam(current.echoWet.gain, 0, now)
    setAudioParam(current.master.gain, outputLevel, now)
  }

  function stopScheduledSources(): void {
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
    if (finishTimer) clearTimeout(finishTimer)
    endTimer = null
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

  async function prepareDrumBuffers(current: AudioGraph): Promise<void> {
    if (drumBuffers.size > 0) return
    const kit = await loadDrumKit('acoustic')
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

  function midiFrequency(note: number): number {
    return 440 * 2 ** ((note - 69) / 12)
  }

  function scheduleFinalChord(current: AudioGraph, chord: ChordSymbol, at: number): void {
    const notes = chordVoicingMidi(chord)
    if (notes.length === 0 || chordLevel <= 0) return
    const voiceNotes = [Math.max(28, notes[0]! - 12), ...notes]
    const chordFilter = current.ctx.createBiquadFilter()
    chordFilter.type = 'lowpass'
    chordFilter.frequency.setValueAtTime(3600, at)
    chordFilter.frequency.exponentialRampToValueAtTime(850, at + Math.max(0.5, endingTailSec))
    chordFilter.Q.value = 0.8
    const envelope = current.ctx.createGain()
    const perVoice = clamp(chordLevel / Math.sqrt(voiceNotes.length), 0.015, 0.42)
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(perVoice, at + 0.028)
    envelope.gain.setValueAtTime(perVoice, at + 0.16)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + endingTailSec)
    chordFilter.connect(envelope)
    envelope.connect(current.endingBus)

    voiceNotes.forEach((note, index) => {
      const oscillator = current.ctx.createOscillator()
      oscillator.type = index === 0 ? 'sine' : index % 2 === 0 ? 'triangle' : 'sawtooth'
      oscillator.frequency.value = midiFrequency(note)
      oscillator.detune.value = index % 2 === 0 ? -2.5 : 2.5
      oscillator.connect(chordFilter)
      oscillator.start(at)
      oscillator.stop(at + endingTailSec + 0.05)
      trackScheduledSource(oscillator)
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
      if (endingChord) scheduleFinalChord(current, endingChord, atEnd)
      return
    }

    if (endingStyle === 'echo') {
      const throwStart = Math.max(now, atEnd - averageBeatDuration())
      current.delay.delayTime.setValueAtTime(echoDelaySeconds(), now)
      current.feedback.gain.setValueAtTime(clamp(echoFeedback, 0.05, 0.82), now)
      current.echoWet.gain.setValueAtTime(0.8, now)
      current.echoSend.gain.setValueAtTime(0, throwStart)
      current.echoSend.gain.linearRampToValueAtTime(echoAmount, atEnd - 0.025)
      scheduleSongCut(current, atEnd, 20)
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

  async function previewEnding(): Promise<void> {
    if (previewing) {
      stopPreview()
      return
    }
    if (!audioElement?.src || trimDurationSec <= 0) {
      error = 'Load a project song before previewing an ending.'
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
      scheduleEnding(current, atEnd)
      startPositionLoop()

      endTimer = setTimeout(() => {
        if (token !== previewToken) return
        audioElement.pause()
        audioElement.currentTime = selectedPointSec
        positionSec = selectedPointSec
        tailing = effectiveTailSec > 0.25
      }, Math.max(1, Math.round(secondsUntilEnd * 1000)))

      finishTimer = setTimeout(
        () => {
          if (token !== previewToken) return
          stopPositionLoop()
          previewing = false
          tailing = false
          resetGraphAutomation()
        },
        Math.max(1, Math.round((secondsUntilEnd + effectiveTailSec + 0.08) * 1000)),
      )
    } catch (cause) {
      if (token !== previewToken) return
      stopPreview(false)
      error = cause instanceof Error ? cause.message : 'Could not preview this ending.'
    } finally {
      if (token === previewToken) preparing = false
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
    const barById = new Map(map.timeline.bars.map((bar) => [bar.id, bar]))
    beatPoints = [...map.timeline.beats]
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
      .filter((beat) => beat.timeSec >= trimStartSec - 0.01 && beat.timeSec <= trimEndSec + 0.01)
      .sort((a, b) => a.timeSec - b.timeSec)

    sourceLabel = label
    sourceDetail = detail
    const defaultPoint = [...beatPoints]
      .reverse()
      .find((point) => point.downbeat && point.timeSec < trimEndSec - 0.15)
    selectedPointSec = defaultPoint?.timeSec ?? Math.max(trimStartSec, trimEndSec - averageBarDuration())
    positionSec = selectedPointSec
    audioElement.currentTime = selectedPointSec
    endingChordMode = map.metadata.keyDetail ? 'tonic' : 'song'
    await tick()
    queueWaveformDraw()
  }

  async function loadProjectSong(songId: string): Promise<void> {
    const token = ++loadToken
    selectedSongId = songId
    loading = true
    error = ''
    stopPreview(false)
    try {
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
      if (token !== loadToken) return

      const title = map.metadata.title?.trim() || entry.folder
      await installSongAudio(
        blob,
        map,
        title,
        `${map.timeline.bars.length} bars, ${map.timeline.beats.length} beats, ${Math.round(map.metadata.bpm ?? 0) || '--'} BPM`,
      )
      if (token !== loadToken) return
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

    let initialSelectionMade = false
    let requestedSongId = ''
    try {
      requestedSongId = new URL(window.location.href).searchParams.get('song') ?? ''
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
      if (initialSelectionMade || projectSongs.length === 0 || !snapshot.osPath) return
      initialSelectionMade = true
      const initialId = projectSongs.some((song) => song.id === requestedSongId)
        ? requestedSongId
        : snapshot.activeSongId && projectSongs.some((song) => song.id === snapshot.activeSongId)
          ? snapshot.activeSongId
          : projectSongs[0]!.id
      void loadProjectSong(initialId)
    })

    const snapshot = get(projectStore)
    if (!snapshot.osPath && get(audioSession).file && get(activeSongMap)) {
      initialSelectionMade = true
      void loadActiveBrowserSong()
    }
  })

  onDestroy(() => {
    stopPreview(false)
    projectUnsubscribe?.()
    resizeObserver?.disconnect()
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown)
      if (drawRaf) cancelAnimationFrame(drawRaf)
    }
    revokeAudioUrl()
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
  <title>Ending Lab - BarBro</title>
</svelte:head>

<audio bind:this={audioElement} preload="auto"></audio>

<main class="ending-lab">
  <header class="lab-header">
    <a class="back-link" href="/project">
      <ArrowLeft aria-hidden="true" />
      Project
    </a>
    <div class="title-block">
      <span>Arrangement experiment</span>
      <h1>Ending Lab</h1>
    </div>
    <span class="read-only">Read-only experiment</span>
  </header>

  <section class="source-bar" aria-label="Song source">
    <div class="source-name">
      <span>Song</span>
      <strong>{loading ? 'Loading song...' : sourceLabel}</strong>
      <small>{sourceDetail}</small>
    </div>
    {#if projectSongs.length > 0}
      <label class="song-picker">
        <span>Project song</span>
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

    <div
      bind:this={waveformHost}
      class="waveform"
      role="slider"
      tabindex="0"
      aria-label="Choose ending point"
      aria-valuemin={trimStartSec}
      aria-valuemax={trimEndSec}
      aria-valuenow={selectedPointSec}
      aria-valuetext={selectedPointLabel}
      onpointerdown={setPointFromWaveform}
      onkeydown={waveformKeydown}
    >
      <canvas bind:this={waveformCanvas}></canvas>
      <div class="preview-range" style={`left: ${playheadPct}%; right: ${100 - markerPct}%`}></div>
      {#if previewing}
        <div class="playhead" style={`left: ${playheadPct}%`}></div>
      {/if}
      <div class="end-marker" style={`left: ${markerPct}%`}>
        <span>End</span>
      </div>
    </div>

    <div class="point-toolbar">
      <div class="segmented" aria-label="Ending point snap mode">
        <button class:active={snapMode === 'bar'} onclick={() => changeSnapMode('bar')}>Bar</button>
        <button class:active={snapMode === 'beat'} onclick={() => changeSnapMode('beat')}>Beat</button>
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

      {#if bars.length > 0}
        <label class="compact-select">
          <span>Bar</span>
          <select value={selectedBar?.id ?? ''} onchange={(event) => selectBar(event.currentTarget.value)}>
            {#each bars as bar (bar.id)}
              <option value={bar.id}>{bar.index + 1}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if selectedBarBeats.length > 0}
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

  <section class="preview-bar" aria-label="Ending preview">
    <button
      class="preview-button"
      onclick={() => void previewEnding()}
      disabled={loading || preparing || !loadedMap}
      aria-label={previewing ? 'Stop ending preview' : 'Preview ending'}
    >
      {#if previewing}
        <Pause aria-hidden="true" />
        Stop
      {:else}
        <Play aria-hidden="true" />
        {preparing ? 'Preparing...' : 'Preview ending'}
      {/if}
    </button>
    <button class="reset-button" onclick={() => stopPreview()} aria-label="Reset preview" title="Reset preview">
      <RotateCcw aria-hidden="true" />
    </button>
    <div class="preview-time">
      <strong>{tailing ? 'TAIL' : fmtTime(positionSec)}</strong>
      <span>from {fmtTime(previewStartSec)} to {fmtTime(selectedPointSec)}</span>
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
        <div class="control-grid">
          <label>
            <span>Throw amount</span>
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
            <span>Feedback</span>
            <input
              type="range"
              min="0.05"
              max="0.82"
              step="0.01"
              value={echoFeedback}
              oninput={(event) => (echoFeedback = Number(event.currentTarget.value))}
            />
            <output>{Math.round(echoFeedback * 100)}%</output>
          </label>
          <label>
            <span>Echo tail</span>
            <input
              type="range"
              min="1.5"
              max="8"
              step="0.1"
              value={endingTailSec}
              oninput={(event) => (endingTailSec = Number(event.currentTarget.value))}
            />
            <output>{endingTailSec.toFixed(1)} s</output>
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
            {styleOption.name}{endingChord && styleUsesHit ? ` on ${endingChordLabel}` : ''}{effectiveTailSec > 0.3
              ? `, ${effectiveTailSec.toFixed(1)} s tail`
              : ''}
          </small>
        </div>
      </footer>
    </section>
  </div>
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
  .preview-bar,
  .ending-workspace {
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

  .read-only {
    border: 1px solid color-mix(in oklch, var(--lab-ink) 30%, transparent);
    border-radius: 999px;
    padding: 0.35rem 0.65rem;
    font-size: 0.65rem;
    font-weight: 900;
    text-transform: uppercase;
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
    background: white;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.55);
    pointer-events: none;
  }

  .end-marker {
    position: absolute;
    inset-block: 0;
    width: 4px;
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
  .chord-choice strong {
    font-size: 0.76rem;
    font-weight: 950;
    text-transform: uppercase;
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
    grid-template-columns: minmax(6.5rem, auto) 1fr 3.8rem;
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

  @media (max-width: 980px) {
    .source-bar {
      grid-template-columns: 1fr 1fr;
    }

    .source-name {
      grid-column: 1 / -1;
    }

    .waveform {
      height: 10rem;
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

    .read-only {
      display: none;
    }

    .source-bar,
    .ending-workspace {
      grid-template-columns: 1fr;
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
      grid-template-columns: 6rem 1fr 3.4rem;
    }
  }
</style>
