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
  import { Button } from '$lib/components/ui/button'
  import LiveHardwareStrip from '$lib/components/LiveHardwareStrip.svelte'
  import MixerTrackLane from '$lib/components/MixerTrackLane.svelte'
  import MixerStageWaveform from '$lib/components/MixerStageWaveform.svelte'
  import { Pause, Play, Repeat1, RotateCcw, Square, X } from '@lucide/svelte'
  import {
    formatChordSymbol,
    formatSongKeyLabel,
    resolveChordAtEachBeat,
    songKeyPreferFlats,
  } from '$lib/chords'
  import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
  import { computeCountIn } from '$lib/audio/computeCountIn'
  import { effectiveCountInBeats } from '$lib/songmap/countIn'
  import {
    bufferWithPrepend,
    MixerEngine,
    type MixerInsert,
    type MixerSnapshot,
    type MixerTrack,
  } from '$lib/audio/mixerEngine'
  import {
    bufferRmsDb,
    buildMasterChain,
    buildStemChain,
    stemKindForLaneKey,
  } from '$lib/audio/mastering'
  import { pitchShiftAudioBuffer } from '$lib/audio/clientPitchShift'
  import { readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { loadProjectDrumKit } from '$lib/client/projectDrumKit'
  import { loadProjectSongIntoEditor, refreshProjectInfo, selectBestStemSet } from '$lib/project/commit'
  import { renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
  import { renderBassTrackWavBlob } from '$lib/audio/renderBassTrack'
  import { renderDrumTrackWavBlob } from '$lib/audio/renderDrumTrack'
  import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import { audioSession } from '$lib/stores/audioSession'
  import { project as projectStore } from '$lib/stores/project'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import {
    effectiveTransposeSemitones,
    transposeChordForDisplay,
    transposeSongKey,
  } from '$lib/songmap/transposition'
  import type { MixState, MixTrackState } from '$lib/songmap/types'
  import { RefreshCw } from '@lucide/svelte'

  /** Lane palette — distinct hues so tracks are easy to tell apart. */
  const LANE_COLORS = [
    '#0ea5e9', // sky (original)
    '#f43f5e', // rose (vocals)
    '#a855f7', // purple (drums)
    '#22c55e', // emerald (bass)
    '#eab308', // yellow (other / guitar)
    '#06b6d4', // cyan (fx / extra stems)
    '#f97316', // orange (cue)
  ]
  // Audio pitch-shift runs CLIENT-SIDE via signalsmith-stretch (MIT, WASM) —
  // free to ship, no sidecar dependency. See $lib/audio/clientPitchShift.
  const transposeAudioEnabled: boolean = true

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
  } = $props<{
    reloadSignal?: number
    initialPlaybackMode?: boolean
    lockPlaybackMode?: boolean
    liveMode?: boolean
  }>()

  /** What we hand to MixerTrackLane for rendering. */
  interface LaneView {
    key: string
    label: string
    color: string
    buffer: AudioBuffer | null
    volume: number
    muted: boolean
    soloed: boolean
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
  let playbackMode = $state(false)
  let initialPlaybackModeSeeded = false
  // The playback stage is a fixed overlay, but the app navbar/context bar sit in
  // their own stacking context above the editor — so the stage fills the area
  // BELOW the chrome (measured) rather than fighting z-index with the navbar.
  let chromeInsetPx = $state(0)
  let repeatSectionEnabled = $state(false)
  let repeatSectionId = $state<string | null>(null)
  let repeatSeekGuard = false
  let replayOnceSectionId = $state<string | null>(null)
  let replayOnceConsumed = $state(false)
  let projectSongSwitching = $state(false)

  let engine: MixerEngine | null = null
  let snapshot = $state<MixerSnapshot>({ state: 'stopped', positionSec: 0, durationSec: 0 })
  let mixerDurationSec = $state(0)
  let lanes = $state<LaneView[]>([])
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
  let showBand = $state(lsBool('barbro::mixer::band'))
  let showRig = $state(lsBool('barbro::mixer::rig'))
  function toggleBand(): void {
    showBand = !showBand
    setLsBool('barbro::mixer::band', showBand)
    void reload() // add/remove the generated lanes
  }
  function toggleRig(): void {
    showRig = !showRig
    setLsBool('barbro::mixer::rig', showRig)
  }

  /** Pull the current saved state for one track-key from songMap. */
  function savedFor(key: string): MixTrackState | undefined {
    return $songMap?.mixState?.tracks.find((t) => t.key === key)
  }

  function nextColor(): string {
    return LANE_COLORS[lanes.length % LANE_COLORS.length]!
  }

  function syncLanesFromEngine() {
    if (!engine) return
    lanes = engine.listTracks().map((t, i) => ({
      key: t.key,
      label: t.label,
      color: LANE_COLORS[i % LANE_COLORS.length]!,
      buffer: t.buffer,
      volume: t.volume,
      muted: t.muted,
      soloed: t.soloed,
    }))
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
    if (forKey === 'cue' || forKey === 'click' || forKey === 'drums-gen' || forKey === 'bass-gen') return 0
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
  const transposeSemitones = $derived(effectiveTransposeSemitones($songMap))
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
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i]!
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
  const currentChordHeading = $derived(snapshot.state === 'playing' ? 'Playing chord' : 'Current chord')

  const sectionTimelineRanges = $derived.by<SectionTimelineRange[]>(() => {
    const sm = $songMap
    const durationSec = mixerDurationSec
    if (!sm || !sm.sections?.length || !sm.timeline.bars.length || !(durationSec > 0)) return []
    const offset = mixerSongOffsetSec
    const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]))
    const out: SectionTimelineRange[] = []
    sm.sections.forEach((section, i) => {
      const startBar = barByIndex.get(section.barRange.startBarIndex)
      const endBar = barByIndex.get(section.barRange.endBarIndex)
      if (!startBar || !endBar) return
      const startSec = clamp(startBar.startSec + offset, 0, durationSec)
      const endSec = clamp(endBar.endSec + offset, 0, durationSec)
      if (endSec <= startSec) return
      out.push({
        id: section.id,
        label: section.label,
        startSec,
        endSec,
        index: i,
      })
    })
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
    return lanes.map((lane) => {
      const inRange = !!lane.buffer && snapshot.positionSec < lane.buffer.duration - 0.02
      const audible =
        snapshot.state === 'playing' &&
        inRange &&
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

  /** Sticky active word: the last word of the current line that has started. */
  function activeWordIndex(line: LyricLineView, t: number): number {
    let idx = -1
    for (let i = 0; i < line.words.length; i++) {
      if (line.words[i]!.startSec <= t) idx = i
      else break
    }
    return idx
  }

  /**
   * Song sections mapped onto the mixer timeline as fractions [0..1]. Uses the
   * SAME silence offset the stems/original get (`computePrepend('original')`)
   * so the bands line up with the waveforms. Display-only — the shaded bands
   * are groundwork for future per-section stem control.
   */
  const sectionBands = $derived.by<
    { startFrac: number; endFrac: number; label: string; index: number }[]
  >(() => {
    const dur = mixerDurationSec
    if (dur <= 0) return []
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
    return sectionTimelineRanges.map((section) => ({
      startFrac: clamp01(section.startSec / dur),
      endFrac: clamp01(section.endSec / dur),
      label: section.label,
      index: section.index,
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

  function sourceAudioSubpath(sm: NonNullable<typeof $songMap>): string | null {
    if (sm.audio?.originalPath) return sm.audio.originalPath
    if (sm.audio?.fileName) return `audio/${sm.audio.fileName}`
    return null
  }

  async function loadAndRegisterTracks() {
    if (!engine) return
    const sm = get(songMap)
    const ps = get(projectStore)
    const sess = get(audioSession)

    type Plan = {
      key: string
      label: string
      loader: () => Promise<Blob | null>
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
            loader: async () =>
              await fetchCloudAudioBlob({
                sidecarReachable: reachable,
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

    // Cue track (speech). Present whenever a rendered WAV exists on disk.
    // Whether you HEAR it is a local mute (mixState, per-machine) — the Overview
    // "Play cues" toggle drives that mute, never the shared `enabled` field, so
    // toggling never causes a cloud conflict or a full reload.
    const cueTrackPath = primaryCueTrack?.renderExport?.relativePath
    if (cueTrackPath) {
      plan.push({
        key: 'cue',
        label: primaryCueTrack?.name ? `Cue · ${primaryCueTrack.name}` : 'Cue',
        loader: async () => {
          if (!ps.osPath || !ps.activeSongFolder) return null
          const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, cueTrackPath)
          return r.ok ? r.blob : null
        },
      })
    }

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
        loader: async () => {
          const cacheIsFresh = !!sm.clickExport && !!folderMeta?.hasClickTrack
          if (cacheIsFresh && ps.osPath && ps.activeSongFolder) {
            const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, 'cue/click-track.wav')
            if (r.ok) return r.blob
          }
          // Stale or missing — synthesize fresh from the current SongMap.
          // Pure DSP, no TTS, fast (~100 ms).
          try {
            const r = await renderCueTrackWavBlob(sm, {
              includeSpeech: false,
              includeClicks: true,
              cueTrack: primaryCueTrack,
            })
            return r.blob
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

    // BarBro's generated bass track — same contract as the drums lane. No
    // `transposeSrcSubpath`: when the song is transposed we shift the NOTES
    // and re-synthesize — exact pitch, no stretch artifacts — so the loaded
    // buffer must not be pitch-shifted again. The saved render is at written
    // pitch and only trusted untransposed.
    if (showBand && sm && sm.bassMidi && sm.bassMidi.events.length > 0) {
      const bmRel = sm.bassMidi.renderExport?.relativePath
      const bassSemis = transposeAudioEnabled ? transposeSemitones : 0
      plan.push({
        key: 'bass-gen',
        label: 'BarBro Bass',
        loader: async () => {
          if (bassSemis === 0 && bmRel && ps.osPath && ps.activeSongFolder) {
            const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, bmRel)
            if (r.ok) return r.blob
          }
          try {
            const r = await renderBassTrackWavBlob(sm, { transposeSemitones: bassSemis })
            return r.blob
          } catch {
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

    let done = 0
    for (const p of plan) {
      loadingMsg = `Loading ${p.label}… (${done + 1} / ${plan.length})`
      try {
        const blob = await p.loader()
        if (!blob) continue
        let buf = await decodeBlob(engine, blob)
        // Client-side transpose (signalsmith-stretch, MIT): shift the decoded
        // musical lanes in-browser. Cue/click lanes never set
        // `transposeSrcSubpath`, so speech and clicks stay unshifted.
        if (transposeAudioEnabled && transposeSemitones !== 0 && p.transposeSrcSubpath !== undefined) {
          loadingMsg = `Transposing ${p.label}… (${done + 1} / ${plan.length})`
          buf = await pitchShiftAudioBuffer(buf, transposeSemitones)
        }
        const pre = computePrepend(p.key)
        if (pre > 0) buf = bufferWithPrepend(engine.ac, buf, pre)
        const saved = savedFor(p.key)
        const track: MixerTrack = {
          key: p.key,
          label: p.label,
          buffer: buf,
          volume: saved?.volume ?? 1,
          muted: !!saved?.muted,
          soloed: !!saved?.soloed,
        }
        engine.setTrack(track)
        syncLanesFromEngine()
      } catch (e) {
        console.warn('Failed to load', p.key, e)
        if (transposeAudioEnabled && transposeSemitones !== 0 && p.transposeSrcSubpath !== undefined) {
          const msg = e instanceof Error ? e.message : String(e)
          loadError = `Could not render transposed ${p.label}: ${msg}`
        }
      }
      done++
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

  function applyProjectSound() {
    if (!engine) return
    const saved = get(projectStore).data?.mastering
    const cfg = soundBypassed ? undefined : saved
    const wasPlaying = snapshot.state === 'playing'
    const pos = snapshot.positionSec
    engine.setMasterChain(cfg ? buildMasterChain(engine.ac, cfg) : null)
    for (const t of engine.listTracks()) {
      const kind = stemKindForLaneKey(t.key)
      let insert: MixerInsert | undefined
      if (cfg?.enabled && kind) {
        let rms = laneRms.get(t.buffer)
        if (rms === undefined) {
          rms = bufferRmsDb(t.buffer)
          laneRms.set(t.buffer, rms)
        }
        insert = buildStemChain(engine.ac, kind, cfg, rms) ?? undefined
      }
      engine.setTrack({ ...t, insert })
    }
    syncLanesFromEngine()
    lastAppliedSoundJson = JSON.stringify(saved ?? null)
    if (wasPlaying) void engine.play(pos)
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
      const tracks: MixTrackState[] = engine.listTracks().map((t) => {
        const entry: MixTrackState = { key: t.key, volume: t.volume }
        if (t.muted) entry.muted = true
        if (t.soloed) entry.soloed = true
        return entry
      })
      const next: MixState = { tracks }
      patchSongMap((m) => ({ ...m, mixState: next }))
    }, 800)
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

  function onPlayPause() {
    if (!mixerCanPlay) return
    if (!engine) return
    if (snapshot.state === 'playing') engine.pause()
    else void engine.play()
  }

  function onStop() {
    if (!engine) return
    engine.stop()
  }

  function onRestartSong() {
    if (!mixerCanPlay || !engine) return
    replayOnceSectionId = null
    replayOnceConsumed = false
    if (snapshot.state === 'playing') {
      engine.seek(0)
    } else {
      void engine.play(0)
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
      loadingMsg = `Loading ${target.title}…`
      onStop()
      await loadProjectSongIntoEditor(target.id)
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
    window.setTimeout(() => {
      repeatSeekGuard = false
    }, 120)
  }

  function handleTransportUpdate(s: MixerSnapshot) {
    snapshot = s
    if (Math.abs(mixerDurationSec - s.durationSec) > 1e-4) {
      mixerDurationSec = s.durationSec
    }
    if (!engine || repeatSeekGuard || s.state !== 'playing') return

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
  async function syncAndLoad() {
    loading = true
    loadError = null
    loadingMsg = 'Scanning project…'
    try {
      await refreshProjectInfo()
    } catch {
      /* sidecar offline — fall through with whatever's cached */
    }
    await loadAndRegisterTracks()
  }

  async function reload() {
    if (!engine) return
    // Wipe existing tracks + buffers so re-loading is a clean slate.
    for (const t of engine.listTracks()) engine.removeTrack(t.key)
    syncLanesFromEngine()
    await syncAndLoad()
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
      await reload()
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
    void reload()
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

  onMount(() => {
    engine = new MixerEngine()
    engine.onUpdate(handleTransportUpdate)
    void syncAndLoad()
  })

  onDestroy(() => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    void engine?.dispose()
    engine = null
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

  // Spacebar toggles play/pause while the playback stage is open (unless typing).
  $effect(() => {
    if (liveMode || !playbackMode || typeof window === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      e.stopPropagation()
      if (mixerCanPlay) onPlayPause()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
</script>

<div
  class={liveMode
    ? 'min-h-full space-y-3 bg-transparent px-0 py-0'
    : playbackMode
      ? 'fixed bottom-0 left-0 right-0 z-[100] flex flex-col gap-3 overflow-hidden px-4 py-4 sm:px-8'
      : 'border-foreground bg-background space-y-3 border-2 px-3 py-3'}
  style={playbackMode && !liveMode
    ? `top: ${chromeInsetPx}px; background-color: var(--background); background-image: repeating-linear-gradient(90deg, color-mix(in oklch, var(--foreground) 4%, transparent) 0 1px, transparent 1px 42px), repeating-linear-gradient(0deg, color-mix(in oklch, var(--foreground) 3%, transparent) 0 1px, transparent 1px 42px); background-position: 0 ${-(chromeInsetPx % 42)}px;`
    : undefined}
>
  <!-- Transport bar — full controls in overview only; playback mode uses a clean header. -->
  {#if !playbackMode}
  <div class="border-foreground/30 flex flex-wrap items-center gap-2 border-b-2 pb-2">
    <Button
      variant="default"
      size="sm"
      class="h-9 w-9 p-0"
      onclick={onPlayPause}
      disabled={!mixerCanPlay}
      aria-label={snapshot.state === 'playing' ? 'Pause' : 'Play'}
    >
      {#if snapshot.state === 'playing'}
        <Pause class="size-4" aria-hidden="true" />
      {:else}
        <Play class="size-4" aria-hidden="true" />
      {/if}
    </Button>
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
    <Button
      variant="outline"
      size="sm"
      class="h-9 w-9 p-0"
      onclick={onStop}
      disabled={!mixerCanPlay}
      aria-label="Stop"
    >
      <Square class="size-3.5" aria-hidden="true" />
    </Button>
    <Button
      variant={replayOnceSectionRange ? 'default' : 'outline'}
      size="sm"
      class="h-8 gap-1.5"
      onclick={replayCurrentSectionOnce}
      disabled={!currentSectionRange}
      title={replayOnceSectionRange
        ? replayOnceConsumed
          ? `Replaying ${replayOnceSectionRange.label} one time`
          : `Will replay ${replayOnceSectionRange.label} once at the end`
        : currentSectionRange
          ? `Replay ${currentSectionRange.label} once`
          : 'No section at the playhead'}
    >
      <Repeat1 class="size-3.5" aria-hidden="true" />
      {replayOnceButtonLabel}
    </Button>
    <div class="font-mono text-sm tabular-nums">
      {fmtTime(snapshot.positionSec)} / {fmtTime(snapshot.durationSec)}
    </div>
    {#if !lockPlaybackMode}
      <label
        class="text-foreground inline-flex h-8 items-center gap-2 rounded-[var(--radius)] px-2.5 text-xs font-bold shadow-sm"
        style="background: linear-gradient(120deg, color-mix(in oklch, var(--studio-orange) 32%, var(--background)) 0%, color-mix(in oklch, var(--studio-orange-soft) 46%, var(--background)) 55%, color-mix(in oklch, var(--studio-orange) 28%, var(--background)) 100%);"
        title="Show a minimal band playback view"
      >
        <input type="checkbox" bind:checked={playbackMode} class="accent-foreground size-3.5" />
        Playback mode
      </label>
    {/if}
    <!-- Declutter toggles: generated Band + live-rig hardware are off by default. -->
    <button
      type="button"
      class="inline-flex h-8 items-center rounded-[var(--radius)] border-2 px-2 text-xs font-bold transition-colors {showBand
        ? 'border-foreground bg-foreground text-background'
        : 'border-foreground/40 bg-background text-muted-foreground'}"
      onclick={toggleBand}
      aria-pressed={showBand}
      title="Show/hide the generated BarBro Band (drums + bass)"
    >
      Band
    </button>
    <button
      type="button"
      class="inline-flex h-8 items-center rounded-[var(--radius)] border-2 px-2 text-xs font-bold transition-colors {showRig
        ? 'border-foreground bg-foreground text-background'
        : 'border-foreground/40 bg-background text-muted-foreground'}"
      onclick={toggleRig}
      aria-pressed={showRig}
      title="Show/hide the live-rig controls (XR18 mixer / APC Key 25)"
    >
      Live rig
    </button>
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
    <Button
      variant={repeatSectionEnabled ? 'default' : 'outline'}
      size="sm"
      class="h-8"
      onclick={toggleRepeatSection}
      disabled={!repeatSectionEnabled && !currentSectionRange}
      title={repeatSectionEnabled && repeatSectionRange
        ? `Repeating ${repeatSectionRange.label}`
        : currentSectionRange
          ? `Repeat ${currentSectionRange.label}`
          : 'No section at the playhead'}
    >
      {repeatSectionButtonLabel}
    </Button>
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

  {#if playbackMode}
    <section class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden" aria-label="Playback mode">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="border-foreground bg-foreground text-background inline-flex size-12 shrink-0 items-center justify-center rounded-full border-2 shadow-md transition-transform hover:scale-105 disabled:opacity-40"
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
            onclick={onRestartSong}
            disabled={!mixerCanPlay}
            aria-label="Restart song"
            title="Restart song"
          >
            <RotateCcw class="size-4" aria-hidden="true" />
          </button>
          <div class="min-w-0">
            <h2 class="text-foreground truncate text-2xl font-black leading-none sm:text-3xl">{songTitle}</h2>
            <div class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm tabular-nums">
              <span class="text-foreground font-black">
                {fmtTime(snapshot.positionSec)} / {fmtTime(snapshot.durationSec)}
              </span>
              <span>{songKeyLabel}</span>
              <span>{songBpmLabel}</span>
              {#if currentSectionRange}<span>{currentSectionRange.label}</span>{/if}
            </div>
          </div>
        </div>
        <div class="flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {#each laneLights as light (light.key)}
            <button
              type="button"
              class="ring-foreground/10 inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[11px] font-black ring-1 transition-colors {light.active
                ? 'bg-foreground text-background'
                : 'bg-muted/70 text-muted-foreground'}"
              onclick={() => onToggleMuted(light.key)}
              title={light.muted ? `Unmute ${light.label}` : `Mute ${light.label}`}
              aria-pressed={!light.muted}
            >
              <span
                class="size-2.5 rounded-full"
                style={`background: ${light.active ? light.color : 'color-mix(in oklch, var(--foreground) 25%, transparent)'}`}
              ></span>
              {light.label}
            </button>
          {/each}
          <button
            type="button"
            class="border-foreground/50 text-foreground hover:bg-foreground hover:text-background ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border-2 px-2.5 text-xs font-black uppercase transition-colors"
            onclick={() => (playbackMode = false)}
            title="Exit playback mode"
          >
            <X class="size-3.5" aria-hidden="true" />
            Exit
          </button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
        <!-- Current chord — centered toward the middle, big but not overwhelming. -->
        <div class="flex flex-col items-center text-center">
          <div class="text-muted-foreground text-xs font-black uppercase tracking-wider">{currentChordHeading}</div>
          <div class="font-mono text-7xl leading-none font-black tabular-nums sm:text-8xl">
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
        <div class="w-full max-w-4xl">
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
          <div
            class="border-foreground/20 relative mt-2 h-24 overflow-hidden rounded-[var(--radius)] border-2"
            style="background: color-mix(in oklch, var(--foreground) 6%, var(--background));"
            aria-label="Upcoming chord approach lane"
          >
            <!-- Faint time gridlines -->
            <div class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px" style="left: 33%"></div>
            <div class="bg-foreground/10 pointer-events-none absolute bottom-0 top-0 w-px" style="left: 66%"></div>

            <!-- Hit zone + playhead at the left edge: chords fire when they slide into it. -->
            <div
              class="pointer-events-none absolute inset-y-0 left-0 w-[12%]"
              style="background: linear-gradient(90deg, color-mix(in oklch, var(--studio-orange) 28%, transparent), transparent);"
            ></div>
            <div
              class="pointer-events-none absolute inset-y-0 left-0 z-[5] w-1"
              style="background: var(--studio-orange); box-shadow: 0 0 12px 1px color-mix(in oklch, var(--studio-orange) 75%, transparent);"
            ></div>
            <div
              class="pointer-events-none absolute bottom-0.5 left-2 z-[6] text-[9px] font-black uppercase tracking-wider"
              style="color: var(--studio-orange);"
            >
              Now
            </div>

            {#if chordApproachViews.length === 0}
              <div class="text-muted-foreground flex h-full items-center justify-center text-sm font-bold">
                End
              </div>
            {:else}
              {#each chordApproachViews as seg (seg.id)}
                <div
                  class="absolute h-7 overflow-hidden rounded-[var(--radius)] transition-[left,top,width,opacity] duration-100 ease-linear {seg.active
                    ? ''
                    : 'min-w-[3.5rem]'}"
                  style={`left: ${seg.leftPct}%; top: ${seg.row * 30 + 3}px; width: ${seg.widthPct}%; opacity: ${seg.opacity}; z-index: ${seg.active ? 4 : seg.id === nextChordView?.id ? 3 : 1};`}
                  title={`${seg.label} in ${seg.startsInLabel}`}
                >
                  <div
                    class="flex h-full items-center justify-center overflow-hidden rounded-[var(--radius)] border-2 px-1.5 shadow-sm {seg.active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-foreground'}"
                    style={seg.active
                      ? ''
                      : seg.id === nextChordView?.id
                        ? 'background: color-mix(in oklch, var(--studio-orange) 88%, white); border-color: var(--studio-orange); color: var(--studio-ink);'
                        : 'background: var(--background); border-color: color-mix(in oklch, var(--foreground) 32%, transparent);'}
                  >
                    <span class="whitespace-nowrap font-mono text-sm leading-none font-black tabular-nums">{seg.label}</span>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>

      {#if lyricLines.length > 0}
        {@const prev = currentLyricIdx > 0 ? lyricLines[currentLyricIdx - 1] : null}
        {@const cur = currentLyricIdx >= 0 ? lyricLines[currentLyricIdx] : null}
        {@const next = lyricLines[currentLyricIdx + 1] ?? null}
        {@const activeIdx = cur ? activeWordIndex(cur, lyricsSongTime) : -1}
        <div
          class="flex shrink-0 flex-col items-center gap-1 px-4 py-2 text-center"
          aria-label="Lyrics"
          aria-live="polite"
        >
          <div class="text-muted-foreground/70 min-h-5 truncate text-sm">
            {prev ? prev.words.map((w) => w.text).join(' ') : ' '}
          </div>
          <div class="min-h-10 text-2xl font-black leading-snug sm:text-3xl">
            {#if cur}
              {#each cur.words as w, wi (wi)}<span
                  class={wi === activeIdx
                    ? 'bg-primary text-primary-foreground rounded px-1'
                    : wi < activeIdx
                      ? 'text-foreground/60'
                      : activeIdx === -1
                        ? 'text-foreground/70'
                        : 'text-foreground'}
                >{w.text}</span
                >{#if wi < cur.words.length - 1}{' '}{/if}{/each}
            {:else if next}
              <span class="text-muted-foreground">{next.words.map((w) => w.text).join(' ')}</span>
            {/if}
          </div>
          <div class="text-muted-foreground min-h-5 truncate text-sm">
            {cur && next ? next.words.map((w) => w.text).join(' ') : ' '}
          </div>
        </div>
      {/if}

      <MixerStageWaveform
        buffer={stageWaveformLane?.buffer ?? null}
        color={stageWaveformLane?.color ?? '#f97316'}
        positionSec={snapshot.positionSec}
        durationSec={snapshot.durationSec}
        {sectionBands}
        onSeekFraction={onSeekFraction}
      />
    </section>
  {:else if lanes.length > 0}
    <div class="flex flex-col gap-1.5">
      {#each lanes as lane, i (lane.key)}
        <MixerTrackLane
          label={lane.label}
          buffer={lane.buffer}
          volume={lane.volume}
          muted={lane.muted}
          soloed={lane.soloed}
          color={lane.color}
          positionSec={snapshot.positionSec}
          durationSec={snapshot.durationSec}
          {sectionBands}
          showSectionLabels={i === 0}
          onVolumeChange={(v) => onVolume(lane.key, v)}
          onToggleMuted={() => onToggleMuted(lane.key)}
          onToggleSoloed={() => onToggleSoloed(lane.key)}
          onSeekFraction={onSeekFraction}
        />
      {/each}
    </div>
  {/if}
</div>
