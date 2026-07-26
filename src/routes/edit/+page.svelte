<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { onDestroy, onMount, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import LeadSheetPanel from '$lib/components/editor/LeadSheetPanel.svelte'
  import TimelineWorkspace from '$lib/components/editor/TimelineWorkspace.svelte'
  import TransportBar from '$lib/components/editor/TransportBar.svelte'
  import LyricsEditor from '$lib/components/editor/LyricsEditor.svelte'
  import MixerPanel from '$lib/components/editor/MixerPanel.svelte'
  import CueEditor from '$lib/components/editor/CueEditor.svelte'
  import EditInspector from '$lib/components/editor/EditInspector.svelte'
  import DebugSharedWaveform from '$lib/components/DebugSharedWaveform.svelte'
  import { cueRender } from '$lib/audio/cueRender.svelte'
  import RelinkAudioBanner from '$lib/components/RelinkAudioBanner.svelte'
  import RecordingMismatchBanner from '$lib/components/RecordingMismatchBanner.svelte'
  import SongDraftsDialog from '$lib/components/SongDraftsDialog.svelte'
  import { Button } from '$lib/components/ui/button'
  import { formatSongKeyLabel } from '$lib/chords'
  import {
    clampTransposeSemitones,
    formatTransposeLabel,
    transposeSongKey,
  } from '$lib/songmap/transposition'
  import { transport } from '$lib/audio/transport.svelte'
  import { readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { pitchShiftAudioBuffer } from '$lib/audio/clientPitchShift'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project as projectStore } from '$lib/stores/project'
  import { newId } from '$lib/songmap/factory'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import {
    getSectionsSetupStatus,
    setupSectionsDeps,
    analyzeChordChromaViaDesktop,
    analyzeChordChromaViaDesktopWithStem,
  } from '$lib/client/desktopBridge'
  import { tonicIntToNote } from '$lib/chords/keyDetect'
  import { CHORD_ANALYZER_VERSION } from '$lib/chords/suggestFromChroma'
  import {
    activeDraftName,
    addDraftAndActivate,
    deleteDraft,
    duplicateActiveDraft,
    ensureActiveDraftIdentity,
    listDrafts,
    renameDraft,
    switchToDraft,
  } from '$lib/songmap/drafts'
  import { selectBestStemSet } from '$lib/project/commit'
  import type { Bar, SongKey, SongMap } from '$lib/songmap/types'
  import { clearFullAppSongState } from '$lib/stores/restorableSong'
  import { audioSession } from '$lib/stores/audioSession'
  import { patchSongMap, redoSongMap, songMap, undoSongMap } from '$lib/stores/songMap'
  import {
    ArrowLeft,
    FileText,
    Layers,
    LayoutGrid,
    Mic,
    Music4,
    Pause,
    Pencil,
    Play,
    RefreshCw,
    Rows3,
    SlidersHorizontal,
    Type,
  } from '@lucide/svelte'

  /** Half-open bar interval [start, end) — match `audioTransport` end clamp */
  const END_EPS = 0.028

  const previewBars = 5

  let beatEditError = $state('')

  /**
   * Global Cmd/Ctrl+Z undo + Cmd/Ctrl+Shift+Z (or Cmd/Ctrl+Y) redo.
   * Registered once via `onMount`; teardown runs in `onDestroy`. The
   * handler ignores key events that originated in an editable field
   * (text inputs, contentEditable, the chord picker) so we don't fight
   * native browser undo while the user is typing.
   */
  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (isEditableTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoSongMap()
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        redoSongMap()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // The shared cue-render lens owns the desktop Piper readiness poll; start it
  // once while the editor is mounted (Overview + Cue both read `piperCueReady`).
  onMount(() => {
    cueRender.startPiperPoll()
    return () => cueRender.stopPiperPoll()
  })

  function confirmBackToImport() {
    const ok = confirm(
      'Leave the editor and go to the import page?\n\nThis song only lives in this tab until you save or export it. If you continue without saving, you can lose your work.',
    )
    if (!ok) return
    document.cookie = 'barbro_session=; Max-Age=0; Path=/; SameSite=Lax'
    clearFullAppSongState()
    void goto('/')
  }


  /** Fingerprint used to invalidate cached hints when audio changes. */
  function currentAudioFingerprint(sm: SongMap | null): string | null {
    if (sm?.audio?.sha256) return sm.audio.sha256
    const f = $audioSession.file
    if (f) return `${f.name}:${f.size}`
    if (sm?.audio?.fileName) return `${sm.audio.fileName}:${Math.round(sm.audio.durationSec ?? 0)}`
    return null
  }

  /**
   * Per-beat chroma + song-level key detection — cached in
   * `songMap.chordHints`. Same pattern as `sectionBorderHints` above:
   * fingerprint + analyzer version keyed cache that auto-invalidates and
   * runs once on first chords-mode entry.
   *
   * The raw `beatChroma` is the foundation for future per-beat chord
   * suggestions and modulation detection; for now we only surface the
   * derived `detectedKey` next to the manual key picker.
   *
   * Keep `CHORD_ANALYZER_VERSION` in sync with `ANALYZER_VERSION` inside
   * `desktop/native/python/sections/chord_chroma.py`.
   */
  // v1: cosine similarity (margin too tight, almost everything fell below floor).
  // v2: Pearson correlation + lower floor + 1/f weighting + bass cut.
  // v3: stem-aware input — when demucs "other" stem is on disk, the
  //     analyzer reads the harmonic stem instead of the full mix.
  //     Strips drum + vocal bleed; biggest single accuracy unlock.
  // v4: flat weighting + 100–2000 Hz band (the 1/f bass weighting was
  //     mis-detecting keys/chords). Version lives in suggestFromChroma so
  //     the matcher can refuse stale chroma.

  let chordChromaStatus = $state<
    'idle' | 'installing' | 'analyzing' | 'ready' | 'cached' | 'error' | 'unavailable'
  >('idle')
  let chordChromaError = $state<string | null>(null)
  let chordChromaAutoFilledForFingerprint = $state<string | null>(null)

  function hasFreshChordHints(sm: SongMap | null): boolean {
    const h = sm?.chordHints
    if (!h) return false
    if (h.analyzerVersion !== CHORD_ANALYZER_VERSION) return false
    if (h.beatChroma.length !== sm.timeline.beats.length) return false
    const fp = currentAudioFingerprint(sm)
    return !fp || h.audioFingerprint === fp
  }

  /**
   * Absolute on-disk path to this song's harmonic stem (demucs "other"),
   * or null when no project context / no stems / no "other" file. Used
   * by the chord-chroma analyzer to skip the full-mix path when a clean
   * harmonic signal is available.
   *
   * Matches `other.wav` or `other.mp3` from the best stem preset on
   * disk. Demucs always names the melodic-harmonic stem "other".
   */
  function resolveOtherStemAbsPath(): string | null {
    const ps = get(projectStore)
    if (!ps.osPath || !ps.activeSongFolder) return null
    const meta = ps.metadataByFolder[ps.activeSongFolder]
    const best = selectBestStemSet(meta)
    if (!best) return null
    const otherFile = best.files.find((f) => /^other\.(wav|mp3)$/i.test(f))
    if (!otherFile) return null
    return `${ps.osPath}/${ps.activeSongFolder}/${best.pathPrefix}${otherFile}`
  }

  async function runChordChromaAnalysis(force = false) {
    const sm = get(songMap)
    const file = get(audioSession).file
    if (!sm || !file || sm.timeline.beats.length === 0) return
    if (!force && hasFreshChordHints(sm)) {
      chordChromaStatus = 'cached'
      return
    }
    if (!$desktopCompanionStatus.reachable) {
      chordChromaStatus = 'unavailable'
      chordChromaError = 'BarBro Desktop is not reachable.'
      return
    }

    // Reuse the sections venv setup pipeline — same numpy + librosa deps.
    const setup = await getSectionsSetupStatus()
    if (!setup) {
      chordChromaStatus = 'unavailable'
      chordChromaError = 'Could not check harmony setup.'
      return
    }
    if (!setup.ready) {
      chordChromaStatus = 'installing'
      chordChromaError = null
      const installOut = await setupSectionsDeps((ev) => {
        if (ev.type === 'error') chordChromaError = ev.msg
      })
      if (!installOut.ok) {
        chordChromaStatus = 'error'
        chordChromaError = installOut.error
        return
      }
    }

    chordChromaStatus = 'analyzing'
    chordChromaError = null
    try {
      // `beat.timeSec` is song-relative (post-trim); the analyzer reads
      // the untrimmed audio file, so add trim offset to align beat
      // timestamps with file frames.
      const trimOffset = sm.audio?.trim?.startSec ?? 0
      const beats = sortBeatsByTime(sm.timeline.beats).map((b) => ({
        startSec: b.timeSec + trimOffset,
      }))

      // Prefer the demucs "other" stem if it's on disk for this song.
      // Strips drum/vocal/bass bleed → much cleaner chroma. Falls back
      // to the full-mix WAV when no project context or no stems exist.
      const otherStemPath = resolveOtherStemAbsPath()
      const out = otherStemPath
        ? await analyzeChordChromaViaDesktopWithStem(otherStemPath, beats)
        : await analyzeChordChromaViaDesktop(file, beats)
      if (out.ok) {
        const fp = currentAudioFingerprint(sm) ?? 'unknown'
        const detected = out.detectedKey
          ? (() => {
              const note = tonicIntToNote(out.detectedKey.tonic, out.detectedKey.mode)
              return {
                root: note.root,
                ...(note.accidental ? { accidental: note.accidental } : {}),
                mode: out.detectedKey.mode,
                confidence: out.detectedKey.confidence,
              }
            })()
          : null
        patchSongMap((cur) => ({
          ...cur,
          chordHints: {
            beatChroma: out.beatChroma,
            detectedKey: detected,
            audioFingerprint: fp,
            generatedAt: new Date().toISOString(),
            analyzerVersion: CHORD_ANALYZER_VERSION,
            analyzerSource: otherStemPath ? 'stems-other' : 'mix',
          },
        }))
        chordChromaStatus = 'ready'
      } else {
        chordChromaStatus = 'error'
        chordChromaError = out.error
      }
    } catch (e) {
      chordChromaStatus = 'error'
      chordChromaError = e instanceof Error ? e.message : String(e)
    }
  }

  // Auto-trigger on entering chords mode. Same lazy-migration pattern as the
  // section-border analysis above — old songs analyze once on first visit.
  $effect(() => {
    if (editMode === 'chords') {
      void runChordChromaAnalysis(false)
    }
  })

  /** Derived: the detected key from the cached chord hints, or null. */
  const detectedKey = $derived($songMap?.chordHints?.detectedKey ?? null)

  /** Key label for the header: the manual key if set, else the detected key. */
  // Personal, LOCAL-only song transpose — a per-viewer display overlay (e.g.
  // "+2 because my piano is transposed"). It is NOT part of the shared `.smap`
  // source of truth: it never syncs and never rewrites stored chords. The
  // source of truth is the chords AS STORED — what you see at transpose 0 —
  // which everyone shares; edit those (chord picker / select → transpose) to
  // change the song for everyone. The offset is remembered per song locally.
  let personalTransposeSemitones = $state(0)
  function personalTransposeStorageKey(): string {
    return `barbro::xpose::${$projectStore.activeSongId ?? 'standalone'}::${get(songMap)?.metadata.title ?? ''}`
  }
  // Load the personal offset when the ACTIVE SONG changes (keyed off songId so
  // ordinary edits don't reset it). Seed once from any legacy stored transpose
  // for back-compat, after which the offset lives purely local.
  $effect(() => {
    const songId = $projectStore.activeSongId ?? 'standalone'
    if (!browser) return
    const title = untrack(() => get(songMap))?.metadata.title ?? ''
    const key = `barbro::xpose::${songId}::${title}`
    let val = 0
    try {
      const raw = localStorage.getItem(key)
      val = clampTransposeSemitones(
        raw != null ? Number(raw) : (untrack(() => get(songMap))?.transpose?.baseSemitones ?? 0),
      )
    } catch {
      /* private mode */
    }
    personalTransposeSemitones = val
  })
  const transposeSemitones = $derived(clampTransposeSemitones(personalTransposeSemitones))
  const displayedSongKey = $derived.by(() => {
    const kd = $songMap?.metadata.keyDetail
    return kd ? transposeSongKey(kd, transposeSemitones) : null
  })
  const keyLabel = $derived.by(() => {
    if (displayedSongKey) return formatSongKeyLabel(displayedSongKey)
    const dk = detectedKey
    if (dk) {
      return formatSongKeyLabel(
        transposeSongKey({ root: dk.root, accidental: dk.accidental, mode: dk.mode }, transposeSemitones),
      )
    }
    return null
  })

  function setTransposeBase(semitones: number) {
    const next = clampTransposeSemitones(semitones)
    if (next === transposeSemitones) return
    // Display-only, personal, local: no source-of-truth change, no sync, and no
    // audio re-render — so it never disturbs playback. Just persist the offset.
    if (browser) {
      try {
        const key = personalTransposeStorageKey()
        if (next === 0) localStorage.removeItem(key)
        else localStorage.setItem(key, String(next))
      } catch {
        /* private mode */
      }
    }
    personalTransposeSemitones = next
  }

  /**
   * Cold-start auto-fill: if the user hasn't set a key yet and the
   * detection is high-confidence, silently fill the picker so the chord
   * tab "just knows" the key without an extra click. Tracked per
   * fingerprint so we don't re-apply it after the user manually changes
   * keys back to undefined (rare but real).
   */
  $effect(() => {
    if (editMode !== 'chords') return
    const sm = $songMap
    if (!sm) return
    const dk = detectedKey
    if (!dk || dk.confidence < 0.15) return
    if (sm.metadata.keyDetail) return // user (or a previous auto-fill) already set it
    const fp = sm.chordHints?.audioFingerprint ?? null
    if (!fp || chordChromaAutoFilledForFingerprint === fp) return
    chordChromaAutoFilledForFingerprint = fp
    applyKeyPatch({
      root: dk.root,
      ...(dk.accidental ? { accidental: dk.accidental } : {}),
      mode: dk.mode,
    })
  })
  /**
   * Force a fresh key detection from the audio and OVERWRITE the current key.
   * The normal auto-fill only sets the key when it's empty (it never corrects
   * an already-set one), so old songs keep a stale/wrong key forever. This
   * re-runs the chroma analyzer (bypassing the cache) and applies whatever it
   * detects.
   */
  let redetectingKey = $state(false)
  async function redetectKey() {
    if (redetectingKey) return
    redetectingKey = true
    try {
      await runChordChromaAnalysis(true)
      const dk = detectedKey
      if (dk) {
        applyKeyPatch({
          root: dk.root,
          ...(dk.accidental ? { accidental: dk.accidental } : {}),
          mode: dk.mode,
        })
      }
    } finally {
      redetectingKey = false
    }
  }

  /** Main workspace mode. */
  type EditMode = 'overview' | 'grid' | 'sections' | 'chords' | 'cue' | 'lyrics' | 'leadsheet'
  let editMode = $state<EditMode>('overview')

  /**
   * Command-bar mode switch. Grouped so each segment wraps as a unit on narrow
   * widths — mix · the timeline family · the performance docs. A single
   * `role="tablist"` still wraps all seven `role="tab"` buttons (the group
   * `<div>`s are presentational), so the a11y contract is unchanged.
   */
  const MODE_GROUPS: { id: EditMode; label: string }[][] = [
    [{ id: 'overview', label: 'Overview' }],
    [
      { id: 'grid', label: 'Grid' },
      { id: 'sections', label: 'Sections' },
      { id: 'chords', label: 'Chords' },
    ],
    [
      { id: 'cue', label: 'Cue' },
      { id: 'lyrics', label: 'Lyrics' },
      { id: 'leadsheet', label: 'Lead sheet' },
    ],
  ]

  /** Per-mode glyph for the segmented switch (matches the DAW prototypes). */
  const MODE_ICON: Record<EditMode, typeof Play> = {
    overview: SlidersHorizontal,
    grid: LayoutGrid,
    sections: Rows3,
    chords: Music4,
    cue: Mic,
    lyrics: Type,
    leadsheet: FileText,
  }

  let keyDraft = $state<SongKey>({ root: 'C', mode: 'major' })

  $effect(() => {
    const sm = $songMap
    const kd = sm?.metadata.keyDetail
    keyDraft = kd ? { ...kd } : { root: 'C', mode: 'major' }
  })

  let editingTitle = $state(false)
  let titleDraft = $state('')

  function startTitleEdit() {
    titleDraft = get(songMap)?.metadata.title ?? ''
    editingTitle = true
  }

  function commitTitleEdit() {
    editingTitle = false
    const t = titleDraft.trim()
    if (!t) return
    const sm = get(songMap)
    if (!sm || t === sm.metadata.title) return
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, title: t } }))
  }

  let editingArtist = $state(false)
  let artistDraft = $state('')

  function startArtistEdit() {
    artistDraft = get(songMap)?.metadata.artist ?? ''
    editingArtist = true
  }

  function commitArtistEdit() {
    editingArtist = false
    const a = artistDraft.trim()
    const sm = get(songMap)
    // Empty clears the field; unchanged is a no-op so we don't dirty the sync.
    if (!sm || a === (sm.metadata.artist ?? '')) return
    patchSongMap((m) => ({ ...m, metadata: { ...m.metadata, artist: a || undefined } }))
  }

  function focusOnMount(el: HTMLElement) {
    el.focus()
    if (el instanceof HTMLInputElement) el.select()
  }

  function applyKeyPatch(next: SongKey) {
    const sm = get(songMap)
    if (!sm) return
    keyDraft = next
    const p = patchSongMap((m) => ({
      ...m,
      metadata: { ...m.metadata, keyDetail: next, key: formatSongKeyLabel(next) },
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  let objectUrl = $state<string | null>(null)
  let audioEl = $state<HTMLAudioElement | null>(null)
  let playingBarId = $state<string | null>(null)
  let preview = $state<{ start: number; end: number; barId: string } | null>(null)
  let rafId = 0

  /**
   * Live playback now runs through the module-singleton `UnifiedTransport` — ONE
   * decode, ONE clock, shared across every editing mode so a single play button
   * keeps the song playing continuously as the user switches tabs. `WaveformPlayer`
   * still drives a `PlaybackController`-shaped surface; `transport.playbackAdapter`
   * is that surface (click loop, count-in, range auto-stop, volumes, click/song
   * knobs) mapped onto the transport in BUFFER-time. The persistent transport bar
   * below the tabs drives the same singleton. Grid/sections/chords behave exactly
   * as before, but audio + position now persist into cue/lyrics/leadsheet.
   */
  const playbackController = transport.playbackAdapter

  // ── Persistent waveform SPINE (shell-owned navigation overview) ──────────
  // ONE shared waveform sits under the command bar. It shows on the
  // non-timeline modes (Overview / Cue / Lyrics / Lead sheet); on Grid /
  // Sections / Chords the `TimelineWorkspace` renders its OWN editing
  // waveform, so the shell spine is hidden there — exactly one waveform per
  // tab. Its zoom/scroll window lives in shell state, so it survives every
  // mode switch (zoom into a section, switch tabs, same view when you return).
  //
  // The spine is a navigational overview: it assumes uniform bars and file-time
  // (= song-time when trim is 0, the common case). Frame-accurate editing lives
  // in the TimelineWorkspace waveform, which reads the real per-bar geometry.
  let spineViewStart = $state(0)
  let spineViewEnd = $state(0)
  const TIMELINE_MODES = new Set<EditMode>(['grid', 'sections', 'chords'])
  const showSpine = $derived(!TIMELINE_MODES.has(editMode))
  const spineBarCount = $derived($songMap?.timeline.bars.length ?? 0)
  const spineDurationSec = $derived(
    $songMap?.audio?.durationSec ?? Math.max(1, $audioSession.endSec - $audioSession.startSec),
  )
  const spineSections = $derived(
    ($songMap?.sections ?? []).map((s) => ({
      kind: s.kind,
      label: s.label || s.kind,
      from: s.barRange.startBarIndex + 1,
      to: s.barRange.endBarIndex + 1,
    })),
  )
  // Live playhead in file/buffer time; the adapter getter reads the transport's
  // reactive position so this updates every frame during playback.
  const spinePlayheadSec = $derived(playbackController.currentTime)
  // Seed the window to the whole song once its duration is known; user zoom
  // (which leaves viewEnd > viewStart) is never clobbered afterwards.
  $effect(() => {
    const d = spineDurationSec
    if (d > 0 && spineViewEnd <= spineViewStart) {
      spineViewStart = 0
      spineViewEnd = d
    }
  })
  // Audio pitch-shift is DISABLED for now: the client-side shift
  // (signalsmith-stretch) doesn't sound good enough to ship. Transpose stays a
  // chords-&-key-only feature; playback keeps the original audio. Flip back to
  // true to re-enable the pitch-shifted audio path (all wiring is intact).
  const transposeAudioEnabled: boolean = false
  let transposeAudioStatus = $state<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  let transposeAudioError = $state('')
  let transposePlaybackBuffer = $state<AudioBuffer | null>(null)
  let transposeAudioGeneration = 0
  let transposePlaybackResume = $state<{ wasPlaying: boolean; timeSec: number } | null>(null)

  function captureTransposePlaybackResume(): { wasPlaying: boolean; timeSec: number } {
    const snapshot = {
      wasPlaying: playbackController.isPlaying,
      timeSec: playbackController.currentTime,
    }
    if (snapshot.wasPlaying) playbackController.pause()
    transposePlaybackResume = snapshot
    return snapshot
  }

  // Restore the per-device click sync calibration from localStorage —
  // it's a property of the audio output chain (speakers / Bluetooth /
  // USB interface), not the song, so it persists across reloads.
  const CLICK_OFFSET_STORAGE_KEY = 'barbro:clickOffsetSec'
  if (browser) {
    try {
      const raw = localStorage.getItem(CLICK_OFFSET_STORAGE_KEY)
      if (raw !== null) {
        const v = Number(raw)
        if (Number.isFinite(v) && Math.abs(v) <= 0.5) {
          playbackController.clickOffsetSec = v
        }
      }
    } catch {
      /* ignore localStorage errors (Safari private mode, etc.) */
    }
  }
  $effect(() => {
    if (!browser) return
    const v = playbackController.clickOffsetSec
    try {
      localStorage.setItem(CLICK_OFFSET_STORAGE_KEY, String(v))
    } catch {
      /* ignore */
    }
  })

  // Feed the transport reactively. It derives the ONE media-time offset
  // (`plan.trimStartSec`) from the SongMap itself, so — unlike the old
  // controller — there's no separate `mediaTimeOffsetSec` wiring to keep in sync.
  $effect(() => {
    transport.configure($songMap ?? null)
  })

  // ONE decode of the full uploaded reference file, shared by the waveform peaks,
  // the click/count-in engine and (next step) the mixer + live route.
  $effect(() => {
    void transport.loadFile($audioSession.file)
  })

  // Overview owns playback via `MixerView`'s own engine this step, so keep the
  // shared transport paused there to avoid two engines sounding at once.
  // TODO(M1b-next): fold mixer+live onto the shared transport.
  $effect(() => {
    if (editMode === 'overview') transport.pause()
  })

  async function decodePlaybackBlob(blob: Blob): Promise<AudioBuffer> {
    const ac = new AudioContext()
    try {
      return await ac.decodeAudioData(await blob.arrayBuffer())
    } finally {
      void ac.close().catch(() => {})
    }
  }

  function sourceAudioSubpath(sm: SongMap): string | null {
    if (sm.audio?.originalPath) return sm.audio.originalPath
    if (sm.audio?.fileName) return `audio/${sm.audio.fileName}`
    return null
  }

  $effect(() => {
    const sm = $songMap
    const ps = $projectStore
    const semitones = transposeSemitones
    transposeAudioGeneration += 1
    const generation = transposeAudioGeneration

    if (!transposeAudioEnabled || semitones === 0) {
      transposePlaybackBuffer = null
      transposeAudioStatus = 'idle'
      transposeAudioError = ''
      return
    }

    if (!sm || !ps.osPath || !ps.activeSongFolder) {
      transposePlaybackBuffer = null
      transposeAudioStatus = 'error'
      transposeAudioError = 'Transpose audio needs a project song on disk.'
      return
    }
    const srcSubpath = sourceAudioSubpath(sm)
    if (!srcSubpath) {
      transposePlaybackBuffer = null
      transposeAudioStatus = 'error'
      transposeAudioError = 'Transpose audio needs a linked source file.'
      return
    }

    transposePlaybackBuffer = null
    transposeAudioStatus = 'rendering'
    transposeAudioError = ''

    void (async () => {
      try {
        // Client-side shift (signalsmith-stretch, MIT): decode the source once
        // (cached per file), then render the shifted buffer in-browser. No
        // sidecar round-trip; per-semitone results are cached inside
        // pitchShiftAudioBuffer, so revisiting a shift is instant.
        const original = await transposeSourceBufferCached(
          ps.osPath!,
          ps.activeSongFolder!,
          srcSubpath,
        )
        if (generation !== transposeAudioGeneration) return
        const buffer = await pitchShiftAudioBuffer(original, semitones)
        if (generation !== transposeAudioGeneration) return
        transposePlaybackBuffer = buffer
        transposeAudioStatus = 'ready'
      } catch (e) {
        if (generation !== transposeAudioGeneration) return
        transposePlaybackBuffer = null
        transposeAudioStatus = 'error'
        transposeAudioError = e instanceof Error ? e.message : String(e)
      }
    })()
  })

  /**
   * Decoded transpose source, cached by project/song/file so changing the
   * semitone amount doesn't re-read + re-decode the audio. A failed decode
   * clears the cache entry so the next attempt retries.
   */
  let transposeSrcKey = ''
  let transposeSrcPromise: Promise<AudioBuffer> | null = null
  function transposeSourceBufferCached(
    osPath: string,
    folder: string,
    subpath: string,
  ): Promise<AudioBuffer> {
    const key = `${osPath}::${folder}::${subpath}`
    if (transposeSrcKey !== key || !transposeSrcPromise) {
      transposeSrcKey = key
      const p = (async () => {
        const r = await readProjectSongAsset(osPath, folder, subpath)
        if (!r.ok) throw new Error(r.error)
        return await decodePlaybackBlob(r.blob)
      })()
      p.catch(() => {
        if (transposeSrcKey === key) {
          transposeSrcPromise = null
          transposeSrcKey = ''
        }
      })
      transposeSrcPromise = p
    }
    return transposeSrcPromise
  }

  $effect(() => {
    const pending = transposePlaybackResume
    if (!pending) return
    const readyForPlayback =
      transposeSemitones === 0 || (transposeAudioStatus === 'ready' && transposePlaybackBuffer !== null)
    if (!readyForPlayback) return
    transposePlaybackResume = null
    const resumeAt = pending.timeSec
    const shouldPlay = pending.wasPlaying
    queueMicrotask(() => {
      playbackController.seek(resumeAt)
      if (shouldPlay) playbackController.play()
    })
  })

  // The transport is a module singleton that must survive mount/unmount and the
  // /edit ↔ /project/playback route change, so we do NOT dispose it here. Just
  // stop any audio when leaving the editor.
  onDestroy(() => {
    transport.pause()
  })

  /**
   * Main `<audio>` blob URL. `$derived($audioSession.file)` still re-fired when the session *object*
   * was replaced on trim sync, revoking URLs and breaking the audio element — so we key off the
   * `File` reference via an explicit store subscription instead.
   */
  let lastMainFileForObjectUrl: File | null = null

  function applyMainAudioFromSession() {
    const f = get(audioSession).file
    if (!f) {
      lastMainFileForObjectUrl = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = null
      playingBarId = null
      preview = null
      stopPreviewLoop()
      audioEl?.pause()
      return
    }
    if (f === lastMainFileForObjectUrl && objectUrl) return

    if (objectUrl) URL.revokeObjectURL(objectUrl)
    audioEl?.pause()
    lastMainFileForObjectUrl = f
    objectUrl = URL.createObjectURL(f)
  }

  if (browser) applyMainAudioFromSession()

  onMount(() => audioSession.subscribe(applyMainAudioFromSession))

  function beatsForBar(barId: string) {
    const sm = get(songMap)
    if (!sm) return []
    return sm.timeline.beats.filter((b) => b.barId === barId)
  }

  function stopPreviewLoop() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  // The Debug-tools "Play bar X" preview uses `audioEl` (bound to
  // WaveformPlayer's <audio>) and self-stops via `previewTick`'s
  // own paused-check on each rAF. WaveformPlayer drives its own click
  // loop internally; no play/pause listener wiring needed here.

  function previewTick() {
    const el = audioEl
    const p = preview
    if (!el || !p) {
      stopPreviewLoop()
      return
    }
    if (el.paused) {
      stopPreviewLoop()
      return
    }
    if (el.currentTime >= p.end - END_EPS) {
      el.pause()
      el.currentTime = p.start
      playingBarId = null
      preview = null
      stopPreviewLoop()
      return
    }
    rafId = requestAnimationFrame(previewTick)
  }

  async function playBarOnly(bar: Bar) {
    const el = audioEl
    if (!el || !objectUrl) return
    const start = bar.startSec
    const end = bar.endSec
    if (!(end > start)) return

    if (playingBarId === bar.id && !el.paused) {
      el.pause()
      playingBarId = null
      preview = null
      stopPreviewLoop()
      return
    }

    el.pause()
    stopPreviewLoop()
    playingBarId = bar.id
    preview = { start, end, barId: bar.id }
    el.currentTime = start
    try {
      await el.play()
    } catch {
      playingBarId = null
      preview = null
      return
    }
    rafId = requestAnimationFrame(previewTick)
  }


  /** "13:04" / "yesterday" — so the layer picker shows WHICH import is which. */
  function layerAgeLabel(iso: string | undefined): string {
    if (!iso) return ''
    const then = new Date(iso).getTime()
    if (!Number.isFinite(then)) return ''
    const mins = Math.round((Date.now() - then) / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const d = new Date(iso)
    const today = new Date()
    const sameDay = d.toDateString() === today.toDateString()
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  /** Explicit created date for a draft row (e.g. "Jul 23, 2026"); '' when unknown. */
  function draftCreatedLabel(iso: string | undefined): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return ''
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
  }
  /** Full timestamp for the row's hover tooltip. */
  function draftCreatedTitle(iso: string | undefined): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return ''
    return `Created ${d.toLocaleString()}`
  }

  // ── Song drafts: sections + chords + lyrics as ONE switchable unit ───────
  // The ACTIVE draft's content is sm.sections / sm.harmony / sm.lyrics; stored
  // drafts live in sm.drafts. Switching swaps all three at once, so a draft can
  // never end up with one song's chords over another's sections. The selected
  // draft is what live mode plays and what the .als exports.
  let draftMenuOpen = $state(false)
  let draftMsg = $state('')
  const draftRows = $derived($songMap ? listDrafts($songMap) : [])
  const activeDraftLabel = $derived($songMap ? activeDraftName($songMap) : '')

  /** Chord + section counts for a draft row, for the switcher subtitle. */
  function draftCounts(id: string, active: boolean): string {
    const sm = $songMap
    if (!sm) return ''
    const d = active ? sm : sm.drafts?.find((x) => x.id === id)
    if (!d) return ''
    const chords = d.harmony.length
    const sections = d.sections.length
    const words = d.lyrics?.words.length ?? 0
    const parts = [
      `${chords} ${chords === 1 ? 'chord' : 'chords'}`,
      `${sections} ${sections === 1 ? 'section' : 'sections'}`,
    ]
    if (words > 0) parts.push('lyrics')
    return parts.join(' · ')
  }

  /** Rows for the drafts dialog — presentation only; the dialog stays dumb. */
  const draftDialogRows = $derived(
    draftRows.map((row) => {
      // The active draft's createdAt lives on the SongMap (`activeDraftCreatedAt`),
      // not in the stored-draft record `listDrafts` returns for it.
      const createdAtIso = row.active ? $songMap?.activeDraftCreatedAt : row.createdAt
      return {
        id: row.id,
        name: row.name,
        active: row.active,
        counts: draftCounts(row.id, row.active),
        age: layerAgeLabel(createdAtIso),
        created: draftCreatedLabel(createdAtIso),
        createdTitle: draftCreatedTitle(createdAtIso),
      }
    }),
  )

  function useDraft(id: string) {
    draftMsg = ''
    const prev = activeDraftLabel
    const res = patchSongMap((m) => {
      const r = switchToDraft(ensureActiveDraftIdentity(m, newId), id, newId)
      return r.ok ? r.map : m
    })
    // Stay open: the picker is a radio list, so the user should see the
    // selection move to the row they clicked.
    if (res.ok) draftMsg = `Switched to “${activeDraftLabel}” — “${prev}” is kept.`
  }

  function newDraftFromCurrent() {
    draftMsg = ''
    patchSongMap((m) =>
      duplicateActiveDraft(ensureActiveDraftIdentity(m, newId), `${activeDraftName(m)} copy`, newId),
    )
    draftMenuOpen = false
    draftMsg = `Created “${activeDraftLabel}”. Edits here won't touch the draft you copied it from.`
  }

  function newEmptyDraft() {
    draftMsg = ''
    patchSongMap((m) =>
      addDraftAndActivate(
        ensureActiveDraftIdentity(m, newId),
        { sections: [], harmony: [], lyrics: undefined },
        'New draft',
        newId,
      ),
    )
    draftMenuOpen = false
    draftMsg = `Created “${activeDraftLabel}” — empty sections, chords and lyrics.`
  }

  function renameDraftRow(id: string, currentName: string) {
    const next = window.prompt('Draft name', currentName)
    if (next === null) return
    patchSongMap((m) => renameDraft(m, id, next))
    draftMsg = ''
  }

  function deleteDraftRow(id: string, name: string) {
    const counts = draftCounts(id, false)
    if (!window.confirm(`Delete the draft “${name}” (${counts})? The draft you're on now stays.`)) {
      return
    }
    patchSongMap((m) => deleteDraft(m, id))
    draftMsg = `Deleted “${name}”.`
  }




  onDestroy(() => {
    stopPreviewLoop()
    audioEl?.pause()
  })
</script>

<!--
  Fixed-height, non-scrolling editor shell. `.app-scroll` (the layout's bounded
  scroll region) hands us a definite height; `h-full min-h-0` makes this shell
  exactly fill it and never overflow, so `.app-scroll` itself stays put. The
  command bar is `shrink-0` (always pinned); the content region below is
  `flex-1 min-h-0 overflow-y-auto`, so the ACTIVE editor panel scrolls WITHIN
  the shell instead of growing the page. Every flex ancestor down to that
  scroll container carries `min-h-0` — drop one and a tall panel pushes the
  page instead of scrolling.
-->
<main
  class="edit-page relative z-10 flex h-full min-h-0 w-full max-w-none flex-col px-2 pt-3 sm:px-3"
>
  {#if !browser}
    <div class="min-h-[50vh]" aria-hidden="true"></div>
  {:else if $songMap && !$audioSession.file && $audioSession.missingReason === 'file-not-found' && !$audioSession.missingAudioIgnored}
    <!-- SongMap loaded but audio missing on disk — relink flow.
         "Ignore for this session" sets `missingAudioIgnored`, after
         which we fall through to the audio-free editor below so the
         user can keep editing chord chart / sections / metadata. -->
    <RelinkAudioBanner />
    <div
      class="brutalist-shadow border-foreground bg-background mx-auto my-auto w-full max-w-md border-2 p-8 text-center"
    >
      <p class="text-muted-foreground text-sm">
        Locate the audio file for <span class="text-foreground font-semibold">{$songMap.metadata.title}</span>
        to continue editing.
      </p>
      <Button type="button" variant="secondary" class="mt-6 gap-2" onclick={() => goto('/project')}>
        <ArrowLeft class="size-4" aria-hidden="true" />
        Back to project
      </Button>
    </div>
  {:else if $songMap && !$audioSession.file && $audioSession.missingReason === 'cloud-audio-unavailable'}
    <!-- Browser-cloud (Collab) mode: the song loaded fine but its compressed
         cloud audio couldn't be obtained. NOT a dead-end — the chart is editable;
         the fix for audio is Studio mode (open the project from disk). -->
    <div
      class="brutalist-shadow border-foreground bg-background mx-auto my-auto w-full max-w-md border-2 p-8 text-center"
    >
      <p class="text-foreground text-sm font-semibold">Audio isn't available here</p>
      <p class="text-muted-foreground mt-2 text-sm">
        <span class="text-foreground font-semibold">{$songMap.metadata.title}</span> opened in Collab (cloud)
        mode, but its audio couldn't be loaded. Open this project from disk in Studio mode (the desktop app)
        for HD audio + stems — you can still edit chords, sections and lyrics here.
      </p>
      <Button type="button" variant="secondary" class="mt-6 gap-2" onclick={() => goto('/project')}>
        <ArrowLeft class="size-4" aria-hidden="true" />
        Back to project
      </Button>
    </div>
  {:else if !$audioSession.file || !$songMap}
    <div
      class="brutalist-shadow border-foreground bg-background mx-auto my-auto w-full max-w-md border-2 p-8 text-center"
    >
      <p class="text-muted-foreground text-sm">No analyzed clip in session.</p>
      <Button type="button" variant="secondary" class="mt-6 gap-2" onclick={() => goto('/')}>
        <ArrowLeft class="size-4" aria-hidden="true" />
        Back to import
      </Button>
    </div>
  {:else if $audioSession.file && $songMap}
    {@const sm = $songMap}
    <!-- Audio is present, but is it the SAME RECORDING everyone else is on?
         Silent unless it definitely isn't — a different file format or quality
         of the same master never triggers it. -->
    <RecordingMismatchBanner />

    <!-- ── Compact DAW command bar. Song identity, live metadata, transport and
         the mode switch, condensed into ONE framed cluster over the background
         (a <div>, not a <header>, so it never picks up removed studio-box rules).
         The composed editor panels below keep their own framing; the shell no
         longer boxes them a second time. ── -->
    <div class="command-bar border-foreground bg-card brutalist-shadow-sm w-full shrink-0 border-2">
      <!-- Row A: identity · live metadata · transport (reads as one cluster) -->
      <div class="border-foreground/15 flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 px-3 py-2">
        <!-- Song identity: title (click-to-edit) + rename + draft switcher, artist beneath. -->
        <div class="flex min-w-0 flex-col gap-0.5">
          {#if editingTitle}
            <input
              class="border-foreground bg-background text-foreground w-full min-w-0 max-w-xs border-b-2 px-0.5 text-lg font-bold leading-tight tracking-tight outline-none"
              bind:value={titleDraft}
              onblur={commitTitleEdit}
              onkeydown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } else if (e.key === 'Escape') { editingTitle = false } }}
              use:focusOnMount
            />
          {:else}
            <h1 class="flex min-w-0 items-center gap-1.5 text-lg font-bold leading-tight tracking-tight">
              <!-- `min-w-0` lets `truncate` shrink the title below its content
                   width so it never pushes the controls after it onto a new row. -->
              <span class="min-w-0 truncate">{sm.metadata.title || 'Untitled song'}</span>
              <button
                type="button"
                class="text-muted-foreground/50 hover:text-foreground shrink-0 transition-colors"
                onclick={startTitleEdit}
                aria-label="Rename song"
              >
                <Pencil class="size-3.5" />
              </button>

              <!-- ── Draft switcher. Song-level on purpose: a draft is the song's
                   sections + chords + lyrics together, so it can't sit inside one
                   editor tab. The selected draft is what the grid edits, what live
                   mode plays, and what the .als exports. ── -->
              <Button
                variant="outline"
                size="icon-xs"
                class="shrink-0 border-2"
                onclick={() => (draftMenuOpen = true)}
                aria-label={`Draft: ${activeDraftLabel}. Switch drafts`}
                title={`Draft: ${activeDraftLabel} — switch between this song's drafts`}
              >
                <Layers aria-hidden="true" />
              </Button>
            </h1>
          {/if}

          <!-- Artist — a grey subtitle right under the title, click-to-edit like
               the title. Part of `metadata`, so it syncs across collaborators. -->
          {#if editingArtist}
            <input
              class="text-muted-foreground/70 bg-background border-muted-foreground/40 w-full min-w-0 max-w-xs border-b px-0 text-xs leading-tight outline-none"
              bind:value={artistDraft}
              onblur={commitArtistEdit}
              onkeydown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } else if (e.key === 'Escape') { editingArtist = false } }}
              use:focusOnMount
              placeholder="Artist"
              aria-label="Artist"
            />
          {:else}
            <button
              type="button"
              class="block max-w-full truncate px-0 text-left text-xs leading-tight transition-colors hover:text-foreground {sm
                .metadata.artist
                ? 'text-muted-foreground/70'
                : 'text-muted-foreground/40 italic'}"
              onclick={startArtistEdit}
              title="Edit artist"
            >
              {sm.metadata.artist || 'Add artist'}
            </button>
          {/if}
        </div>

        <span class="bg-foreground/15 hidden h-8 w-px shrink-0 sm:block" aria-hidden="true"></span>

        <!-- Live metadata: BPM · key (+ re-detect) · personal transpose. -->
        <div
          class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums"
        >
          <span>{sm.metadata.bpm != null ? `${Math.round(sm.metadata.bpm)} BPM` : '— BPM'}</span>
          <span class="text-muted-foreground/40" aria-hidden="true">·</span>
          <span class="inline-flex items-center gap-1">
            {keyLabel ?? '— key'}
            <button
              type="button"
              class="text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-40"
              onclick={() => void redetectKey()}
              disabled={redetectingKey || chordChromaStatus === 'analyzing' || chordChromaStatus === 'installing'}
              title="Re-detect the key from the audio (overwrites the current key)"
              aria-label="Re-detect key"
            >
              <RefreshCw
                class="size-3 {redetectingKey || chordChromaStatus === 'analyzing' ? 'animate-spin' : ''}"
              />
            </button>
          </span>
          <span class="text-muted-foreground/40" aria-hidden="true">·</span>
          <span
            class="border-foreground/30 bg-background inline-flex items-center overflow-hidden rounded-[var(--radius)] border font-mono text-[11px] font-black"
            aria-label="Song transpose"
          >
            <button
              type="button"
              class="hover:bg-foreground hover:text-background px-2 py-0.5 transition-colors disabled:opacity-35"
              onclick={() => setTransposeBase(transposeSemitones - 1)}
              disabled={transposeSemitones <= -12}
              aria-label="Transpose down one semitone"
            >
              -1
            </button>
            <span class="border-foreground/20 min-w-9 border-x px-2 py-0.5 text-center">
              {formatTransposeLabel(transposeSemitones)}
            </span>
            <button
              type="button"
              class="hover:bg-foreground hover:text-background px-2 py-0.5 transition-colors disabled:opacity-35"
              onclick={() => setTransposeBase(transposeSemitones + 1)}
              disabled={transposeSemitones >= 12}
              aria-label="Transpose up one semitone"
            >
              +1
            </button>
            {#if transposeSemitones !== 0}
              <button
                type="button"
                class="hover:bg-foreground hover:text-background border-foreground/20 border-l px-2 py-0.5 transition-colors"
                onclick={() => setTransposeBase(0)}
                aria-label="Reset transpose"
              >
                reset
              </button>
            {/if}
          </span>
          {#if transposeSemitones !== 0}
            <span
              class="font-mono text-[10px] font-bold {transposeAudioEnabled && transposeAudioStatus === 'error'
                ? 'text-destructive'
                : 'text-muted-foreground'}"
              title={transposeAudioEnabled
                ? transposeAudioError || undefined
                : 'Chords and key are transposed for display. Pitch-shifting the audio is not available in this version.'}
            >
              {transposeAudioEnabled
                ? transposeAudioStatus === 'ready'
                  ? 'audio shifted'
                  : transposeAudioStatus === 'rendering'
                    ? 'preparing audio...'
                    : 'audio unavailable'
                : 'chords & key only'}
            </span>
          {/if}
        </div>

        <!-- Transport docks at the right of the command-bar cluster. It's its own
             component (own click loop / count-in / auto-stop) — the shell only
             positions it here; it wraps below on narrow widths. -->
        <div class="ml-auto min-w-0">
          <TransportBar {editMode} />
        </div>
      </div>

      <!-- Row B: compact segmented mode switch. ONE `role="tablist"` over three
           presentational groups; active = filled `bg-foreground text-background`. -->
      <div class="flex flex-wrap items-center gap-2 px-3 py-2" role="tablist" aria-label="Edit mode">
        {#each MODE_GROUPS as group, gi (gi)}
          <div class="border-foreground bg-card inline-flex overflow-hidden border-2">
            {#each group as m (m.id)}
              {@const Icon = MODE_ICON[m.id]}
              <button
                type="button"
                role="tab"
                aria-selected={editMode === m.id}
                class="border-foreground inline-flex h-7 items-center gap-1.5 border-r-2 px-2.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap transition-colors last:border-r-0 {editMode ===
                m.id
                  ? 'bg-foreground text-background'
                  : 'text-foreground hover:bg-foreground/10 active:bg-foreground/20'}"
                onclick={() => (editMode = m.id)}
              >
                <Icon class="size-3.5" aria-hidden="true" />
                {m.label}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </div>


    <!-- ── Persistent waveform SPINE. ONE shared waveform, directly under the
         command bar, on the non-timeline modes (Overview / Cue / Lyrics / Lead
         sheet). On Grid / Sections / Chords the `TimelineWorkspace` renders its
         OWN editing waveform, so the shell spine is hidden there — one waveform
         per tab. Its zoom/scroll window is shell state, so it persists across
         tab switches. `shrink-0` keeps it pinned under the command bar. ── -->
    {#if showSpine}
      <div class="edit-spine mt-3 shrink-0 px-1.5 pb-1">
        <DebugSharedWaveform
          bind:viewStart={spineViewStart}
          bind:viewEnd={spineViewEnd}
          sections={spineSections}
          bars={spineBarCount}
          durationSec={spineDurationSec}
          playheadSec={spinePlayheadSec}
        />
      </div>
    {/if}

    <!-- ── Main row: centre WORKSPACE (the active editor panel + the shell's
         always-on tail) beside a RIGHT contextual inspector rail. `flex-1
         min-h-0` claims the height left under the command bar + spine; each
         column carries `min-h-0` + its own `overflow-y-auto`, so a tall panel
         or a long inspector scrolls WITHIN its column instead of growing the
         page. The inspector is shell-owned chrome and hides on narrow widths. ── -->
    <div class="edit-main flex min-h-0 flex-1 gap-3 pt-3">
      <!-- Centre workspace. The active editor panel plus the shell's own tail
           (Timeline details, Back to import) share ONE bounded, internally-
           scrolling container. `overflow-x-hidden` guarantees no horizontal body
           scroll; the small `px`/`pb` leave room for the panels' hard shadows. -->
      <div
        class="edit-content flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden px-1.5 pt-1 pb-8"
      >
      {#if editMode === 'cue'}
        <CueEditor />
      {/if}

      {#if editMode === 'overview'}
        <MixerPanel {keyLabel} />
      {/if}

      {#if editMode === 'lyrics'}
        <LyricsEditor {activeDraftLabel} />
      {/if}

      {#if editMode === 'leadsheet'}
        <LeadSheetPanel />
      {/if}

      {#if editMode === 'grid' || editMode === 'sections' || editMode === 'chords'}
        <TimelineWorkspace
          {editMode}
          {playbackController}
          {transposeSemitones}
          {displayedSongKey}
          {activeDraftLabel}
          {keyDraft}
          {chordChromaStatus}
          {chordChromaError}
          {draftMsg}
          playbackAudioBufferOverride={transposeAudioEnabled && transposeSemitones !== 0
            ? transposePlaybackBuffer
            : undefined}
          {applyKeyPatch}
          onRetryChroma={() => void runChordChromaAnalysis(true)}
          bind:beatEditError
          bind:audioElement={audioEl}
        />
      {/if}

      <details class="group border-foreground bg-background border-2">
        <summary
          class="text-muted-foreground hover:text-foreground cursor-pointer list-none px-4 py-3 text-xs font-medium tracking-wide uppercase select-none marker:content-none [&::-webkit-details-marker]:hidden"
        >
          <span class="underline-offset-2 group-open:underline">Timeline details</span>
          <span class="text-muted-foreground/70 ml-2 font-normal normal-case">analysis preview and bar playback</span>
        </summary>
        <div class="border-foreground space-y-6 border-t-2 px-4 py-4">
          <dl class="text-foreground/90 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Bars</dt>
              <dd>{sm.timeline.bars.length}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Beats</dt>
              <dd>{sm.timeline.beats.length}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Duration</dt>
              <dd class="tabular-nums">
                {(sm.audio?.durationSec ?? Math.max(0, $audioSession.endSec - $audioSession.startSec)).toFixed(2)}s
              </dd>
            </div>
          </dl>

          {#if sm.timeline.bars.length > 0}
            <div>
              <p class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">First bars</p>
              <ul class="space-y-3 text-xs">
                {#each sm.timeline.bars.slice(0, previewBars) as bar (bar.id)}
                  <li class="border-foreground border-b-2 pb-3 font-mono last:border-0 last:pb-0">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <div>
                          Bar {bar.index} · {bar.startSec.toFixed(3)}–{bar.endSec.toFixed(3)}s · meter{' '}
                          {bar.meter.numerator}/{bar.meter.denominator}
                        </div>
                        <ul class="text-muted-foreground mt-1 pl-2">
                          {#each beatsForBar(bar.id) as bt (bt.id)}
                            <li>beat {bt.indexInBar} @ {bt.timeSec.toFixed(3)}s</li>
                          {/each}
                        </ul>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        class="shrink-0"
                        disabled={!$audioSession.file || !objectUrl}
                        title={playingBarId === bar.id ? 'Pause' : 'Play this bar only'}
                        aria-label={playingBarId === bar.id
                          ? `Pause bar ${bar.index}`
                          : `Play bar ${bar.index} only (${bar.startSec.toFixed(2)}–${bar.endSec.toFixed(2)}s)`}
                        onclick={() => playBarOnly(bar)}
                      >
                        {#if playingBarId === bar.id}
                          <Pause class="size-4" aria-hidden="true" />
                        {:else}
                          <Play class="size-4" aria-hidden="true" />
                        {/if}
                      </Button>
                    </div>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <p class="text-foreground/90 font-mono text-xs tabular-nums">
            {$audioSession.name}<br />
            <span class="text-muted-foreground">
              {$audioSession.startSec.toFixed(2)}s to {$audioSession.endSec.toFixed(2)}s
            </span>
          </p>

          <!-- The previously-rendered orphan <audio> here was the bug:
               two audio elements, two event sources, two volume targets.
               Removed. `audioEl` now binds to the WaveformPlayer's real
               <audio> via bind:audioElement above. -->

        </div>
      </details>

      <Button type="button" variant="outline" class="gap-2 self-start" onclick={confirmBackToImport}>
        <ArrowLeft class="size-4" aria-hidden="true" />
        Back to import
      </Button>
      </div>

      <!-- ── RIGHT contextual inspector rail. Shell-owned chrome: read-only,
           per-mode facts derived from `$songMap` + shell state, with the deep
           editing controls left to the mode's editor component. Its own
           `overflow-y-auto`; hidden below `xl` so narrow widths hand the
           workspace the full width. ── -->
      <aside
        class="edit-inspector-rail border-foreground bg-card brutalist-shadow-sm mt-1 mb-8 hidden w-[320px] shrink-0 flex-col overflow-hidden border-2 xl:flex"
        aria-label="Inspector"
      >
        <EditInspector
          {editMode}
          {keyLabel}
          {transposeSemitones}
          {activeDraftLabel}
          {chordChromaStatus}
        />
      </aside>
    </div>

    <!-- Song-level dialogs, at page level on purpose. They must NOT sit
         inside the header column: that column is `sm:items-end` against the
         tab toggle, so any height added there pushes the tabs down. Nor
         inside a tab block: the draft switcher is reachable from every tab,
         so its dialog has to be mounted on every tab. -->
    <!-- Drafts: switch, duplicate, rename, delete. One draft = one take
         on the song (sections + chords + lyrics). -->
    <SongDraftsDialog
      bind:open={draftMenuOpen}
      songTitle={sm.metadata.title || 'Untitled song'}
      rows={draftDialogRows}
      message={draftMsg}
      onUse={useDraft}
      onRename={renameDraftRow}
      onDelete={deleteDraftRow}
      onDuplicate={newDraftFromCurrent}
      onNewEmpty={newEmptyDraft}
    />


  {/if}
</main>

<style>
  /* The header + tab box + transport are now one self-styled command bar
     (`bg-card` applied directly), so the old studio-box overrides for the
     `grid-cols-7` tab box and the removed `.edit-page > header` are gone.
     What remains only re-tints the composed editor panels + shell boxes so
     their `bg-background` reads as a lifted card. */
  .edit-page :global(.brutalist-shadow.border-foreground.bg-background),
  .edit-page :global(details.border-foreground.bg-background) {
    background: var(--card);
  }

  .edit-page :global(fieldset.border-foreground) {
    background: color-mix(in oklch, var(--card) 84%, var(--muted));
  }

  /* The persistent spine reuses the interactive debug waveform. Its baked-in
     placeholder transport buttons (▶ ■) are non-functional here — the real
     transport lives in the command bar — so hide them to avoid a second, dead
     play control. The functional zoom + minimap navigation stay. */
  .edit-page :global(.edit-spine .swf-transport) {
    display: none;
  }
</style>
