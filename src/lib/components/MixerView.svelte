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
  import { Button } from '$lib/components/ui/button'
  import MixerTrackLane from '$lib/components/MixerTrackLane.svelte'
  import MixerStageWaveform from '$lib/components/MixerStageWaveform.svelte'
  import { Pause, Play, Square } from '@lucide/svelte'
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
    type MixerSnapshot,
    type MixerTrack,
  } from '$lib/audio/mixerEngine'
  import { ensureProjectPitchShiftCache, readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { refreshProjectInfo, selectBestStemSet } from '$lib/project/commit'
  import { renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
  import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import { audioSession } from '$lib/stores/audioSession'
  import { project as projectStore, type ProjectStoreState } from '$lib/stores/project'
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
  // Audio pitch-shift via Rubber Band (high quality). Dev: `brew install
  // rubberband` (resolved off PATH). Packaged builds need a licensed binary in
  // desktop/native/bin/rubberband/<platform>/ or BARBRO_RUBBERBAND — without it
  // the sidecar reports unavailable and the UI degrades to "chords & key only".
  // Chord/key transpose is display-derived and always works.
  const transposeAudioEnabled: boolean = true

  /**
   * Bump `reloadSignal` from the parent to force a full re-scan + re-load of
   * lanes (e.g. after the Overview "Play cues" toggle renders/removes the cue
   * WAV). Changing it re-runs `reload()`; the initial value is ignored so mount
   * doesn't double-load.
   */
  let { reloadSignal = 0 } = $props<{ reloadSignal?: number }>()

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
  let repeatSectionEnabled = $state(false)
  let repeatSectionId = $state<string | null>(null)
  let repeatSeekGuard = false

  let engine: MixerEngine | null = null
  let snapshot = $state<MixerSnapshot>({ state: 'stopped', positionSec: 0, durationSec: 0 })
  let mixerDurationSec = $state(0)
  let lanes = $state<LaneView[]>([])
  const mixerCanPlay = $derived(!loading && !loadError && lanes.length > 0)

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
    if (forKey === 'cue' || forKey === 'click') return 0
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
  const chordApproachViews = $derived.by<ChordApproachView[]>(() => {
    const approachWindowSec = CHORD_APPROACH_WINDOW_SEC
    const now = snapshot.positionSec
    return chordTimelineSegments
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
        }
      })
      .filter((seg) => seg.widthPct > 0.2)
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

  async function maybeLoadTransposedProjectBlob(
    ps: ProjectStoreState,
    srcSubpath: string | null | undefined,
    fallback: () => Promise<Blob | null>,
  ): Promise<Blob | null> {
    if (!transposeAudioEnabled || transposeSemitones === 0) return await fallback()
    if (!ps.osPath || !ps.activeSongFolder || !srcSubpath) {
      throw new Error('Transpose audio needs project audio on disk.')
    }
    const cache = await ensureProjectPitchShiftCache(
      ps.osPath,
      ps.activeSongFolder,
      srcSubpath,
      transposeSemitones,
    )
    if (!cache.ok) throw new Error(cache.error)
    const shifted = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, cache.relPath)
    if (!shifted.ok) throw new Error(shifted.error)
    return shifted.blob
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

    if (plan.length === 0) {
      loadError = 'No audio tracks found. Render stems or a cue track first.'
      loading = false
      return
    }

    let done = 0
    for (const p of plan) {
      loadingMsg = `Loading ${p.label}… (${done + 1} / ${plan.length})`
      try {
        const blob =
          p.transposeSrcSubpath !== undefined
            ? await maybeLoadTransposedProjectBlob(ps, p.transposeSrcSubpath, p.loader)
            : await p.loader()
        if (!blob) continue
        let buf = await decodeBlob(engine, blob)
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
    loading = false
  }

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

  function toggleRepeatSection() {
    if (repeatSectionEnabled) {
      repeatSectionEnabled = false
      repeatSectionId = null
      return
    }
    if (!currentSectionRange) return
    repeatSectionId = currentSectionRange.id
    repeatSectionEnabled = true
  }

  function handleTransportUpdate(s: MixerSnapshot) {
    snapshot = s
    if (Math.abs(mixerDurationSec - s.durationSec) > 1e-4) {
      mixerDurationSec = s.durationSec
    }
    if (!engine || !repeatSectionEnabled || repeatSeekGuard || s.state !== 'playing') return
    const range = repeatSectionRange
    if (!range || range.endSec - range.startSec < 0.1) return
    if (s.positionSec >= range.endSec - 0.035) {
      repeatSeekGuard = true
      engine.seek(range.startSec)
      window.setTimeout(() => {
        repeatSeekGuard = false
      }, 120)
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
  })

  // Parent-driven reload — only used when a NEW lane must appear (e.g. the
  // Overview toggle just rendered the cue WAV). Skips the initial value so
  // mount's own load isn't duplicated.
  let lastReloadSignal = untrack(() => reloadSignal)
  let lastTransposeForReload = untrack(() => transposeSemitones)
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
</script>

<div class="border-foreground bg-background border-2 px-3 py-3 space-y-3">
  <!-- Transport bar -->
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
      onclick={onStop}
      disabled={!mixerCanPlay}
      aria-label="Stop"
    >
      <Square class="size-3.5" aria-hidden="true" />
    </Button>
    <div class="font-mono text-sm tabular-nums">
      {fmtTime(snapshot.positionSec)} / {fmtTime(snapshot.durationSec)}
    </div>
    <label
      class="border-foreground bg-background inline-flex h-8 items-center gap-2 rounded-[var(--radius)] border-2 px-2 text-xs font-bold"
      title="Show a minimal band playback view"
    >
      <input type="checkbox" bind:checked={playbackMode} class="accent-foreground size-3.5" />
      Playback mode
    </label>
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

  {#if loadError}
    <p class="text-destructive text-sm" role="status">{loadError}</p>
  {:else if loading}
    <p class="text-muted-foreground text-sm">{loadingMsg}</p>
  {/if}

  {#if playbackMode}
    <section class="space-y-4 py-2" aria-label="Playback mode">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-foreground truncate text-3xl font-black leading-none sm:text-4xl">{songTitle}</h2>
          <div class="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm tabular-nums">
            <span>{songKeyLabel}</span>
            <span>{songBpmLabel}</span>
            {#if currentSectionRange}<span>{currentSectionRange.label}</span>{/if}
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
        </div>
      </div>

      <div class="grid gap-3 lg:grid-cols-[minmax(12rem,18rem)_1fr] lg:items-stretch">
        <div class="bg-background ring-foreground/10 rounded-[var(--radius)] p-3 ring-1">
          <div class="text-muted-foreground text-xs font-black uppercase">{currentChordHeading}</div>
          <div class="mt-1 truncate font-mono text-6xl leading-none font-black tabular-nums sm:text-7xl">
            {currentChordLabel}
          </div>
          <div class="bg-foreground/10 mt-3 h-3 overflow-hidden rounded-full">
            <div
              class="bg-primary h-full rounded-full transition-[width] duration-100 ease-linear"
              style={`width: ${currentChordProgressPct}%`}
            ></div>
          </div>
          <div class="text-muted-foreground mt-1 font-mono text-xs tabular-nums">
            {currentChordRemainingLabel} left
          </div>
        </div>

        <div class="bg-muted/70 ring-foreground/10 rounded-[var(--radius)] p-3 ring-1">
          <div class="flex items-center justify-between gap-3">
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
            class="bg-background/70 ring-foreground/10 relative mt-2 h-24 overflow-hidden rounded-[var(--radius)] ring-1"
            aria-label="Upcoming chord approach lane"
          >
            <div
              class="bg-foreground/15 pointer-events-none absolute bottom-0 top-0 w-px"
              style="left: 33%"
            ></div>
            <div
              class="bg-foreground/15 pointer-events-none absolute bottom-0 top-0 w-px"
              style="left: 66%"
            ></div>

            {#if chordApproachViews.length === 0}
              <div class="text-muted-foreground flex h-full items-center justify-center text-sm font-bold">
                End
              </div>
            {:else}
              {#each chordApproachViews as seg (seg.id)}
                <div
                  class="absolute top-1/2 h-12 -translate-y-1/2 transition-[left,width,opacity] duration-100 ease-linear"
                  style={`left: ${seg.leftPct}%; width: ${seg.widthPct}%; opacity: ${seg.opacity}; z-index: ${seg.active ? 4 : seg.id === nextChordView?.id ? 3 : 1};`}
                  title={`${seg.label} in ${seg.startsInLabel}`}
                >
                  <div
                    class="ring-foreground/10 flex h-full flex-col justify-center overflow-hidden rounded-[var(--radius)] px-2 shadow-sm ring-1 {seg.active
                      ? 'bg-primary text-primary-foreground ring-primary/20'
                      : seg.id === nextChordView?.id
                        ? 'bg-primary/20 text-foreground ring-primary/40'
                      : 'bg-background/95 text-foreground'}"
                  >
                    <div class="truncate font-mono text-lg leading-none font-black tabular-nums">{seg.label}</div>
                    <div
                      class="font-mono text-[10px] tabular-nums {seg.active
                        ? 'text-primary-foreground/80'
                        : 'text-muted-foreground'}"
                    >
                      {seg.startsInLabel}
                    </div>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>

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
