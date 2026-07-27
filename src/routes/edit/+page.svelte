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
  import HelpHint from '$lib/components/HelpHint.svelte'
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
    Check,
    Cloud,
    Disc3,
    Grid3x3,
    Layers,
    Megaphone,
    Music,
    Pause,
    Play,
    RefreshCw,
    ScrollText,
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

  /** Human labels for each mode — used by the rail buttons. */
  const MODE_LABEL: Record<EditMode, string> = {
    overview: 'Overview',
    grid: 'Grid',
    sections: 'Sections',
    chords: 'Chords',
    cue: 'Cue',
    lyrics: 'Lyrics',
    leadsheet: 'Lead sheet',
  }

  /**
   * Per-mode glyph for the LEFT mode rail — mirrors the approved version-2
   * "three-pane inspector IDE" prototype's icon set exactly.
   */
  const MODE_ICON: Record<EditMode, typeof Play> = {
    overview: SlidersHorizontal,
    grid: Grid3x3,
    sections: Layers,
    chords: Music,
    cue: Megaphone,
    lyrics: Type,
    leadsheet: ScrollText,
  }

  /**
   * Rail grouping — Mix / Timeline / Perform. A single `role="tablist"` wraps
   * all seven `role="tab"` buttons (the group-label `<div>`s are presentational),
   * so the a11y contract is unchanged from the old segmented switch.
   */
  const RAIL_GROUPS: { label: string; ids: EditMode[] }[] = [
    { label: 'Mix', ids: ['overview'] },
    { label: 'Timeline', ids: ['grid', 'sections', 'chords'] },
    { label: 'Perform', ids: ['cue', 'lyrics', 'leadsheet'] },
  ]

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

  // The shell-owned waveform SPINE was removed: Overview is just the mixer, and
  // Grid / Sections / Chords render their own editing waveform inside
  // `TimelineWorkspace`. There is no shell waveform anywhere in the three-pane
  // shell — exactly one waveform per tab, owned by the tab that needs it.
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
<div class="edit-page relative z-10 flex h-full min-h-0 w-full max-w-none flex-col">
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
    <!-- ── Three-pane editor shell (mirrors the approved version-2 "inspector
         IDE" prototype): a fixed LEFT mode rail, a TOP identity/transport strip,
         a centre WORKSPACE and a RIGHT contextual inspector. No page scroll —
         the rail, the workspace `<main>` and the inspector each scroll
         internally; every flex ancestor carries `min-h-0`. ── -->
    <div class="flex min-h-0 w-full flex-1 overflow-hidden bg-background text-foreground">
      <!-- ── LEFT: mode rail ─────────────────────────────────────────────── -->
      <nav
        class="border-foreground bg-card flex w-[88px] shrink-0 flex-col overflow-y-auto border-r-2"
        aria-label="Editor mode"
      >
        <!-- Rail header: active-draft monogram + label, aligned with the top
             strip. Doubles as the draft switcher — a draft is this song's
             sections + chords + lyrics together, so it's song-level, not per tab. -->
        <button
          type="button"
          onclick={() => (draftMenuOpen = true)}
          class="border-foreground/70 hover:bg-accent flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 border-b-2 px-1 transition-colors"
          aria-label={`Draft: ${activeDraftLabel || 'Main'}. Switch drafts`}
          title={`Draft: ${activeDraftLabel || 'Main'} — switch between this song's drafts`}
        >
          <span
            class="grid size-7 place-items-center rounded-[var(--radius)] border-2 border-foreground bg-[var(--studio-orange)] text-[#1a1a1a]"
          >
            <Disc3 class="size-4" aria-hidden="true" />
          </span>
          <span class="text-muted-foreground max-w-full truncate text-[9px] font-black uppercase tracking-wider">
            {activeDraftLabel || 'Main'}
          </span>
        </button>

        <!-- Seven modes as vertical icon+label buttons, grouped Mix / Timeline /
             Perform. ONE `role="tablist"` over presentational group labels;
             active = filled `bg-foreground text-background` + an orange accent. -->
        <div role="tablist" aria-orientation="vertical" aria-label="Edit mode" class="flex flex-col">
          {#each RAIL_GROUPS as g (g.label)}
            <div class="text-muted-foreground/70 px-2 pt-2.5 pb-1 text-[8px] font-black uppercase tracking-[0.15em]">
              {g.label}
            </div>
            {#each g.ids as id (id)}
              {@const Icon = MODE_ICON[id]}
              {@const active = editMode === id}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onclick={() => (editMode = id)}
                class="group relative mx-1.5 mb-1 flex flex-col items-center gap-1 rounded-[var(--radius)] px-1 py-2 text-center transition-colors {active
                  ? 'bg-foreground text-background'
                  : 'text-foreground hover:bg-accent'}"
              >
                {#if active}
                  <span class="absolute inset-y-1 -left-1.5 w-1 rounded-full bg-[var(--studio-orange)]"></span>
                {/if}
                <Icon class="size-5" aria-hidden="true" />
                <span class="text-[9.5px] font-bold leading-tight tracking-tight">{MODE_LABEL[id]}</span>
              </button>
            {/each}
          {/each}
        </div>

        <div class="mt-auto px-1.5 py-2">
          <HelpHint
            label="Editor layout help"
            text="Pick a mode on this rail. The centre workspace changes to match; the right inspector always shows details for the current mode. Grid, Sections and Chords keep their own waveform inside the workspace."
          />
        </div>
      </nav>

      <!-- ── RIGHT OF RAIL: top strip + (workspace | inspector) ───────────── -->
      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <!-- TOP STRIP: condensed identity · live metadata · transport · save/sync -->
        <div
          class="border-foreground flex h-14 shrink-0 items-center gap-3 border-b-2 px-3"
          style="background: color-mix(in oklch, var(--studio-orange) 6%, var(--muted));"
        >
          <!-- condensed song identity: title + artist, both click-to-edit -->
          <div class="flex min-w-0 max-w-[12rem] flex-col leading-none">
            {#if editingTitle}
              <input
                class="border-foreground bg-background text-foreground w-full min-w-0 border-b-2 px-0.5 text-sm font-black leading-tight tracking-tight outline-none"
                bind:value={titleDraft}
                onblur={commitTitleEdit}
                onkeydown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } else if (e.key === 'Escape') { editingTitle = false } }}
                use:focusOnMount
              />
            {:else}
              <button
                type="button"
                class="hover:text-foreground/80 truncate text-left text-sm font-black tracking-tight transition-colors"
                onclick={startTitleEdit}
                title="Rename song"
              >
                {sm.metadata.title || 'Untitled song'}
              </button>
            {/if}
            {#if editingArtist}
              <input
                class="text-muted-foreground/70 bg-background border-muted-foreground/40 w-full min-w-0 border-b px-0 text-[11px] leading-tight outline-none"
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
                class="truncate text-left text-[11px] leading-tight transition-colors hover:text-foreground {sm.metadata.artist
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/40 italic'}"
                onclick={startArtistEdit}
                title="Edit artist"
              >
                {sm.metadata.artist || 'Add artist'}
              </button>
            {/if}
          </div>

          <!-- live metadata cluster: BPM · key (+ re-detect) · personal transpose -->
          <div
            class="text-muted-foreground hidden items-center gap-x-2 font-mono text-[11px] tabular-nums xl:flex"
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
                class="hover:bg-foreground hover:text-background px-1.5 py-0.5 transition-colors disabled:opacity-35"
                onclick={() => setTransposeBase(transposeSemitones - 1)}
                disabled={transposeSemitones <= -12}
                aria-label="Transpose down one semitone"
              >
                -1
              </button>
              <span class="border-foreground/20 min-w-8 border-x px-1.5 py-0.5 text-center">
                {formatTransposeLabel(transposeSemitones)}
              </span>
              <button
                type="button"
                class="hover:bg-foreground hover:text-background px-1.5 py-0.5 transition-colors disabled:opacity-35"
                onclick={() => setTransposeBase(transposeSemitones + 1)}
                disabled={transposeSemitones >= 12}
                aria-label="Transpose up one semitone"
              >
                +1
              </button>
              {#if transposeSemitones !== 0}
                <button
                  type="button"
                  class="hover:bg-foreground hover:text-background border-foreground/20 border-l px-1.5 py-0.5 transition-colors"
                  onclick={() => setTransposeBase(0)}
                  aria-label="Reset transpose"
                >
                  reset
                </button>
              {/if}
            </span>
          </div>

          <div class="flex-1"></div>

          <!-- persistent transport — its own component (click loop / count-in /
               auto-stop); the shell only positions it here. -->
          <div class="min-w-0 shrink-0">
            <TransportBar {editMode} />
          </div>
        </div>

        <!-- ── WORKSPACE + INSPECTOR ──────────────────────────────────────── -->
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <!-- CENTRE workspace: a height-filling column. The active editor
               component grows to FILL (`flex-1 min-h-0`) so panels feel static
               and use the viewport they're given.
               `overflow-y-auto` is only a safety net — with typical content the
               panel fits and never scrolls. Overview is just the mixer (no
               waveform); Grid / Sections / Chords render their own editing
               waveform inside `TimelineWorkspace`. -->
          <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
              <!-- Advisory: silent unless the local audio is a different
                   recording than the one the song was shared with. -->
              <RecordingMismatchBanner />
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

            </div>
          </main>

          <!-- ── RIGHT: contextual inspector. Shell-owned chrome — read-only,
               per-mode facts derived from `$songMap` + shell state, with the deep
               editing controls left to the mode's editor component. Its header +
               spacing match version-2; the aside drops below `xl` so narrow
               widths hand the workspace the full width. ── -->
          <aside
            class="edit-inspector-rail border-foreground bg-card hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l-2 xl:flex"
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
      </div>
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
</div>

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
</style>
