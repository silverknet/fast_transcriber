<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import WaveformPlayer from '$lib/components/WaveformPlayer.svelte'
  import MixerView from '$lib/components/MixerView.svelte'
  import LeadSheet from '$lib/components/LeadSheet.svelte'
  import SectionSuggestionBanner from '$lib/components/SectionSuggestionBanner.svelte'
  import ChordAutoFillBanner from '$lib/components/ChordAutoFillBanner.svelte'
  import RelinkAudioBanner from '$lib/components/RelinkAudioBanner.svelte'
  import {
    applyChordAutoFill,
    proposeChordAutoFillCandidates,
    type ChordAutoFillProposal,
  } from '$lib/chords/autoFill'
  import ChordRadialQuickSelect from '$lib/components/ChordRadialQuickSelect.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    formatChordSymbol,
    formatSongKeyLabel,
    parseChordClipboard,
    resolveChordAtEachBeat,
    serializeChordClipboard,
    songKeyPreferFlats,
  } from '$lib/chords'
  import { beatsToClickPoints, playMetronomeClick, type BeatClickPoint } from '$lib/audio/debugClickTrack'
  import { computeCountIn } from '$lib/audio/computeCountIn'
  import {
    countInSpeechOutputTimes,
    resolvedSpokenIntroText,
    songStartBeat,
  } from '$lib/audio/cueTrackSpeechSchedule'
  import { effectiveCountInBeats } from '$lib/songmap/countIn'
  import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
  import { PlaybackController } from '$lib/audio/playbackController.svelte'
  import { buildSongCueMixWavBlob, mixTimelineClickPoints } from '$lib/audio/mixSongCuePreview'
  import { cueTrackTotalDurationSec, renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
  import { getPiperTtsSetupStatus } from '$lib/client/desktopBridge'
  import { writeProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { metadataLiteFromSongMap } from '$lib/project/commit'
  import { fingerprintCueTrackInputs } from '$lib/songmap/cueTrackFingerprint'
  import { safeExportBasename } from '$lib/songmap/persist'
  import { patchMetadataForFolder, project as projectStore } from '$lib/stores/project'
  import { newId } from '$lib/songmap/factory'
  import { clearHarmonyAtBeat, upsertHarmonyAtBeat } from '$lib/songmap/harmonyEdit'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import {
    defaultSectionLabel,
    resizeSectionBoundary,
    resizeSectionRange,
    setSectionForBarRange,
  } from '$lib/songmap/sectionEdit'
  import {
    predictNextSectionCandidates,
    type AudioBorderHint,
    type SectionSuggestion,
  } from '$lib/sections/predictNext'
  import {
    getSectionsSetupStatus,
    setupSectionsDeps,
    suggestSectionBordersViaDesktop,
    analyzeChordChromaViaDesktop,
  } from '$lib/client/desktopBridge'
  import { tonicIntToNote } from '$lib/chords/keyDetect'
  import { proposeChordSuggestions } from '$lib/chords/suggestFromChroma'
  import {
    applyBarGridAction,
    resetTimelineToOriginal,
    timelineMatchesOriginal,
    type BarGridAction,
  } from '$lib/songmap/timelineEdit'
  import type { Accidental, Bar, ChordSymbol, NoteName, SectionKind, SongKey, SongMap } from '$lib/songmap/types'
  import { clearFullAppSongState } from '$lib/stores/restorableSong'
  import { audioSession } from '$lib/stores/audioSession'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { ArrowLeft, Music, Pause, Pencil, Play } from '@lucide/svelte'

  /** Half-open bar interval [start, end) — match `audioTransport` end clamp */
  const END_EPS = 0.028

  const previewBars = 5

  let beatEditError = $state('')

  function confirmBackToImport() {
    const ok = confirm(
      'Leave the editor and go to the import page?\n\nThis project only lives in this tab until you export a .smap file. If you continue without exporting, you can lose your work.',
    )
    if (!ok) return
    document.cookie = 'barbro_session=; Max-Age=0; Path=/; SameSite=Lax'
    clearFullAppSongState()
    void goto('/')
  }

  function handleBarGridAction(action: BarGridAction) {
    const sm = get(songMap)
    if (!sm) return
    const out = applyBarGridAction(sm, action, newId)
    if (!out.ok) {
      beatEditError = out.error
      return
    }
    const p = patchSongMap(() => out.map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  // Two-step confirm for the grid-reset action — first click arms it,
  // second commits. Avoids a modal for a destructive-but-recoverable
  // change (the snapshot itself isn't deleted; user can re-edit and
  // reset again). When full undo/redo lands, this becomes a snackbar
  // with an Undo action.
  let resetGridConfirming = $state(false)
  let resetGridTimeoutId: ReturnType<typeof setTimeout> | null = null

  function startResetGridConfirm() {
    resetGridConfirming = true
    if (resetGridTimeoutId) clearTimeout(resetGridTimeoutId)
    // Auto-cancel after 4s so a stray click doesn't leave the UI armed.
    resetGridTimeoutId = setTimeout(() => {
      resetGridConfirming = false
      resetGridTimeoutId = null
    }, 4000)
  }

  function cancelResetGridConfirm() {
    resetGridConfirming = false
    if (resetGridTimeoutId) {
      clearTimeout(resetGridTimeoutId)
      resetGridTimeoutId = null
    }
  }

  function commitResetGrid() {
    cancelResetGridConfirm()
    const sm = get(songMap)
    if (!sm) return
    const out = resetTimelineToOriginal(sm)
    if (!out.ok) {
      beatEditError = out.error
      return
    }
    const p = patchSongMap(() => out.map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  // Reactive — when the live timeline differs from the snapshot, the
  // Reset button activates. Tracks `$songMap.timeline` because that's
  // what resetting actually changes.
  let resetGridDisabled = $derived(
    !$songMap || !$songMap.timeline.original || timelineMatchesOriginal($songMap),
  )

  let sectionsSelectionBarIds = $state<string[]>([])

  function handleApplySectionTag(kind: SectionKind, customLabel?: string) {
    const sm = get(songMap)
    if (!sm || sectionsSelectionBarIds.length === 0) return
    const byId = new Map(sm.timeline.bars.map((b) => [b.id, b]))
    const indices: number[] = []
    for (const id of sectionsSelectionBarIds) {
      const b = byId.get(id)
      if (b !== undefined) indices.push(b.index)
    }
    if (indices.length === 0) return
    const start = Math.min(...indices)
    const end = Math.max(...indices)
    const out = setSectionForBarRange(sm, start, end, kind, newId, customLabel)
    if (!out.ok) {
      beatEditError = out.error
      return
    }
    const p = patchSongMap(() => out.map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  /**
   * Suggestion lifecycle (multi-candidate):
   *   - `predictNextSectionCandidates` returns a ranked list of next-section
   *     suggestions; it re-derives whenever sections / audioBorders change.
   *   - `currentSuggestionIndex` cycles through *visible* (non-dismissed)
   *     candidates. Skip = increment. Wraps modulo length.
   *   - `dismissedSuggestionSigs` is a LIFO stack of dismissed signatures.
   *     Dismiss = push. Undo = pop. Accept clears it.
   *   - Song-state change (sections list mutates) shifts every signature's
   *     `lastEnd` field, so old dismissals naturally stop matching — no
   *     manual reset needed.
   */
  let dismissedSuggestionSigs = $state<string[]>([])
  let currentSuggestionIndex = $state(0)

  /**
   * Audio-derived section-border hints — cached in `songMap.sectionBorderHints`
   * so old `.smap` files migrate to having hints on first sections-mode entry,
   * and re-opening the same song reuses the cached result. Audio fingerprint
   * mismatch / `ANALYZER_VERSION` bump invalidates the cache and re-runs.
   *
   * Version 2: bars are now passed in **file-absolute** time (we add
   * `audio.trim.startSec` to `bar.startSec` before sending). Earlier runs
   * sent post-trim times against the full audio file, which produced
   * systematically offset borders. Bumping invalidates v1 hints.
   *
   * Version 3: feature set changed (dropped chroma_stft, added
   * spectral_bandwidth + spectral_rolloff) after librosa 0.11 + numpy 2.x
   * crashed natively on Apple Silicon. Bump invalidates v2 hints.
   *
   * Version 4: novelty algorithm rewritten (past-vs-future window comparison
   * instead of "this bar vs. previous chunk"); adaptive prominence
   * threshold replaces the fixed 0.15; snap-to-grid disabled. The v3
   * borders were systematically wrong because of those three things;
   * v4 invalidates them.
   *
   * Version 5: feature set changed from 5 correlated spectral stats
   * (rms / centroid / bandwidth / rolloff / flux) to MFCC-13 + RMS + flux.
   * MFCCs give a richer, more independent novelty signal — v4's curve was
   * dominated by a single outlier peak, suppressing real boundaries.
   * Threshold also loosened (ADAPTIVE_K 1.8 → 0.8).
   *
   * Version 6: added chroma_cqt (12-dim harmonic features) to catch
   * chord-progression changes that MFCC misses. Replaced MAD-based
   * threshold (which gave wildly inconsistent border counts — sometimes
   * 2, sometimes 30) with predictable top-N selection: target ~1 border
   * per 18 bars, clamped to [3, 12]. Bump invalidates v5 hints.
   *
   * Version 7: dropped chroma_cqt entirely — it crashed natively (SIGKILL)
   * on Apple Silicon, same as chroma_stft did. Both chroma paths are
   * unusable on macOS arm64 with this librosa/numpy stack. Sticking with
   * MFCC-13 + RMS + flux. Borders will be less accurate for harmonic-only
   * section changes but at least the analyzer doesn't die mid-run.
   */
  const ANALYZER_VERSION = 7

  let audioBordersStatus = $state<
    'idle' | 'installing' | 'analyzing' | 'ready' | 'cached' | 'error' | 'unavailable'
  >('idle')
  let audioBordersError = $state<string | null>(null)
  let showAudioBorders = $state(true)
  let sectionsInstallProgress = $state(0)

  /** Fingerprint used to invalidate cached hints when audio changes. */
  function currentAudioFingerprint(sm: SongMap | null): string | null {
    if (sm?.audio?.sha256) return sm.audio.sha256
    const f = $audioSession.file
    if (f) return `${f.name}:${f.size}`
    if (sm?.audio?.fileName) return `${sm.audio.fileName}:${Math.round(sm.audio.durationSec ?? 0)}`
    return null
  }

  /** Cached borders if the stored fingerprint + analyzer version still match. */
  const audioBorders = $derived.by<AudioBorderHint[]>(() => {
    const sm = $songMap
    if (!sm?.sectionBorderHints) return []
    const fp = currentAudioFingerprint(sm)
    const hints = sm.sectionBorderHints
    if (hints.analyzerVersion !== ANALYZER_VERSION) return []
    if (fp && hints.audioFingerprint !== fp) return []
    return hints.borders
  })

  /** True if the stored hints are valid for the current audio. */
  function hasFreshHints(sm: SongMap | null): boolean {
    if (!sm?.sectionBorderHints) return false
    const fp = currentAudioFingerprint(sm)
    return (
      sm.sectionBorderHints.analyzerVersion === ANALYZER_VERSION &&
      (!fp || sm.sectionBorderHints.audioFingerprint === fp)
    )
  }

  async function runSectionBorderAnalysis(force = false) {
    const sm = get(songMap)
    const file = get(audioSession).file
    if (!sm || !file || sm.timeline.bars.length < 6) return
    if (!force && hasFreshHints(sm)) {
      audioBordersStatus = 'cached'
      return
    }
    if (!$desktopCompanionStatus.reachable) {
      audioBordersStatus = 'unavailable'
      audioBordersError = 'Desktop sidecar is not reachable.'
      return
    }

    // Make sure the librosa venv exists. If not, install it inline — no UI
    // prompt — and then continue into analysis. Mirrors how stems setup
    // works the first time the user enters that view.
    const setup = await getSectionsSetupStatus()
    if (!setup) {
      audioBordersStatus = 'unavailable'
      audioBordersError = 'Could not query setup status from the sidecar.'
      return
    }
    if (!setup.ready) {
      audioBordersStatus = 'installing'
      audioBordersError = null
      sectionsInstallProgress = 0
      const installOut = await setupSectionsDeps((ev) => {
        if (ev.type === 'progress') sectionsInstallProgress = ev.overall
        else if (ev.type === 'error') audioBordersError = ev.msg
      })
      if (!installOut.ok) {
        audioBordersStatus = 'error'
        audioBordersError = installOut.error
        return
      }
      // Fall through to analysis.
    }

    audioBordersStatus = 'analyzing'
    audioBordersError = null
    try {
      // `bar.startSec` is **song-relative** (post-trim) but `file` is the
      // full reference audio. Add the trim offset so bar times line up with
      // the actual audio frames the sidecar will analyze. Without this,
      // every detected border is systematically off by `trim.startSec`.
      const trimOffset = sm.audio?.trim?.startSec ?? 0
      const bars = sm.timeline.bars
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((b) => ({ startSec: b.startSec + trimOffset }))
      const out = await suggestSectionBordersViaDesktop(file, bars)
      if (out.ok) {
        const fp = currentAudioFingerprint(sm) ?? 'unknown'
        patchSongMap((cur) => ({
          ...cur,
          sectionBorderHints: {
            borders: out.borders,
            audioFingerprint: fp,
            generatedAt: new Date().toISOString(),
            analyzerVersion: ANALYZER_VERSION,
          },
        }))
        audioBordersStatus = 'ready'
      } else {
        audioBordersStatus = 'error'
        audioBordersError = out.error
      }
    } catch (e) {
      audioBordersStatus = 'error'
      audioBordersError = e instanceof Error ? e.message : String(e)
    }
  }

  // Auto-trigger on entering sections mode. Uses cached hints when available,
  // so old songs migrate on first visit and subsequent visits skip the sidecar.
  $effect(() => {
    if (editMode === 'sections') {
      void runSectionBorderAnalysis(false)
    }
  })

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
  const CHORD_ANALYZER_VERSION = 2

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
      chordChromaError = 'Desktop sidecar is not reachable.'
      return
    }

    // Reuse the sections venv setup pipeline — same numpy + librosa deps.
    const setup = await getSectionsSetupStatus()
    if (!setup) {
      chordChromaStatus = 'unavailable'
      chordChromaError = 'Could not query setup status from the sidecar.'
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
      // `beat.timeSec` is song-relative (post-trim); the sidecar reads the
      // full untrimmed reference audio file. Add the trim offset so beat
      // times align with the actual audio frames.
      const trimOffset = sm.audio?.trim?.startSec ?? 0
      const beats = sortBeatsByTime(sm.timeline.beats).map((b) => ({
        startSec: b.timeSec + trimOffset,
      }))
      const out = await analyzeChordChromaViaDesktop(file, beats)
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

  /**
   * True when the existing key picker matches the detected key — so we
   * can hide the "Use" hint once it's been accepted (or the user picked
   * the same thing themselves).
   */
  const detectedKeyMatchesPicker = $derived.by(() => {
    const dk = detectedKey
    const kd = $songMap?.metadata.keyDetail
    if (!dk || !kd) return false
    return kd.root === dk.root && (kd.accidental ?? null) === (dk.accidental ?? null) && kd.mode === dk.mode
  })

  /** Show the inline detected-key hint row when we have something useful. */
  const showKeyHint = $derived(
    detectedKey !== null && detectedKey.confidence >= 0.05 && !detectedKeyMatchesPicker,
  )

  function confidenceLabel(c: number): string {
    if (c >= 0.15) return 'high confidence'
    if (c >= 0.08) return 'medium confidence'
    return 'low confidence'
  }

  function detectedKeyDisplayLabel(): string {
    const dk = detectedKey
    if (!dk) return ''
    const acc = dk.accidental === 'sharp' ? '♯' : dk.accidental === 'flat' ? '♭' : ''
    return `${dk.root}${acc} ${dk.mode}`
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

  function acceptDetectedKey() {
    const dk = detectedKey
    if (!dk) return
    applyKeyPatch({
      root: dk.root,
      ...(dk.accidental ? { accidental: dk.accidental } : {}),
      mode: dk.mode,
    })
  }

  function suggestionSig(sm: SongMap | null, sug: { kind: string; bars: number } | null): string | null {
    if (!sm || !sug || sm.sections.length === 0) return null
    const lastEnd = Math.max(...sm.sections.map((s) => s.barRange.endBarIndex))
    return `${sug.kind}:${sug.bars}:${lastEnd}`
  }

  /** Ranked list of next-section candidates (top 5 by combined score). */
  const sectionSuggestionCandidates = $derived.by<SectionSuggestion[]>(() => {
    const sm = $songMap
    if (!sm) return []
    return predictNextSectionCandidates(sm, {
      audioBorders: audioBorders.length > 0 ? audioBorders : undefined,
    })
  })

  /** Candidates the user hasn't dismissed in this round, in original rank order. */
  const visibleSuggestions = $derived.by<SectionSuggestion[]>(() => {
    const sm = $songMap
    const dismissed = new Set(dismissedSuggestionSigs)
    return sectionSuggestionCandidates.filter((c) => {
      const sig = suggestionSig(sm, c)
      return sig === null || !dismissed.has(sig)
    })
  })

  /** The currently-active candidate (what banner + ghost preview show). */
  const activeSuggestion = $derived<SectionSuggestion | null>(
    visibleSuggestions.length === 0
      ? null
      : visibleSuggestions[currentSuggestionIndex % visibleSuggestions.length] ?? null,
  )

  /** 1-based position of the active candidate within `visibleSuggestions`. */
  const activeSuggestionPosition = $derived(
    visibleSuggestions.length === 0
      ? 0
      : (currentSuggestionIndex % visibleSuggestions.length) + 1,
  )

  /** Inline ghost preview on the bar strip — same range that Accept would tag. */
  const sectionSuggestionPreview = $derived.by(() => {
    const sm = $songMap
    const sug = activeSuggestion
    if (!sm || !sug || sm.sections.length === 0) return null
    const lastEnd = Math.max(...sm.sections.map((s) => s.barRange.endBarIndex))
    const start = lastEnd + 1
    const end = start + sug.bars - 1
    if (end >= sm.timeline.bars.length) return null
    return {
      kind: sug.kind,
      label: defaultSectionLabel(sug.kind),
      startBarIndex: start,
      endBarIndex: end,
    }
  })

  function handleAcceptSectionSuggestion() {
    const sm = get(songMap)
    const sug = activeSuggestion
    if (!sm || !sug) return
    if (sm.sections.length === 0) return
    const lastEnd = Math.max(...sm.sections.map((s) => s.barRange.endBarIndex))
    const start = lastEnd + 1
    const end = start + sug.bars - 1
    const out = setSectionForBarRange(sm, start, end, sug.kind, newId)
    if (!out.ok) {
      beatEditError = out.error
      return
    }
    const p = patchSongMap(() => out.map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else {
      beatEditError = ''
      dismissedSuggestionSigs = []
      currentSuggestionIndex = 0
    }
  }

  function handleSkipSectionSuggestion() {
    if (visibleSuggestions.length <= 1) return
    currentSuggestionIndex =
      (currentSuggestionIndex + 1) % visibleSuggestions.length
  }

  function handleDismissSectionSuggestion() {
    const sm = get(songMap)
    const sug = activeSuggestion
    if (!sm || !sug) return
    const sig = suggestionSig(sm, sug)
    if (!sig) return
    dismissedSuggestionSigs = [...dismissedSuggestionSigs, sig]
    // After removing the current candidate, `visibleSuggestions` shrinks.
    // The svelte modulo wrap means currentSuggestionIndex still maps to a
    // valid next candidate without us touching it — except when we were
    // sitting on the *last* visible candidate. Clamp defensively.
    const nextLen = visibleSuggestions.length - 1
    if (nextLen > 0 && currentSuggestionIndex >= nextLen) {
      currentSuggestionIndex = 0
    }
  }

  function handleUndoDismissSectionSuggestion() {
    if (dismissedSuggestionSigs.length === 0) return
    dismissedSuggestionSigs = dismissedSuggestionSigs.slice(0, -1)
  }

  /**
   * Chord auto-fill lifecycle (same shape as section-suggestion above):
   *   - `chordAutoFillCandidates` re-derives from `$songMap` whenever
   *     sections or harmony change.
   *   - `dismissedAutoFillSigs` is a LIFO stack for undo.
   *   - Signature `${sourceSection.id}->${targetSection.id}` invalidates
   *     naturally as soon as the target fills up (proposal stops being
   *     generated when `fillCount = 0`), so explicit reset isn't needed.
   */
  let dismissedAutoFillSigs = $state<string[]>([])
  let currentAutoFillIndex = $state(0)

  function autoFillSig(proposal: ChordAutoFillProposal): string {
    return `${proposal.sourceSection.id}->${proposal.targetSection.id}`
  }

  const chordAutoFillCandidates = $derived<ChordAutoFillProposal[]>(
    $songMap ? proposeChordAutoFillCandidates($songMap) : [],
  )

  const visibleAutoFills = $derived<ChordAutoFillProposal[]>(
    chordAutoFillCandidates.filter((p) => !dismissedAutoFillSigs.includes(autoFillSig(p))),
  )

  const activeAutoFill = $derived<ChordAutoFillProposal | null>(
    visibleAutoFills.length === 0
      ? null
      : visibleAutoFills[currentAutoFillIndex % visibleAutoFills.length] ?? null,
  )

  const activeAutoFillPosition = $derived(
    visibleAutoFills.length === 0
      ? 0
      : (currentAutoFillIndex % visibleAutoFills.length) + 1,
  )

  function handleAcceptAutoFill() {
    const sm = get(songMap)
    const proposal = activeAutoFill
    if (!sm || !proposal) return
    const out = applyChordAutoFill(sm, proposal, newId)
    if (!out.ok) {
      beatEditError = out.error
      return
    }
    const p = patchSongMap(() => out.map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else {
      beatEditError = ''
      dismissedAutoFillSigs = []
      currentAutoFillIndex = 0
    }
  }

  function handleSkipAutoFill() {
    if (visibleAutoFills.length <= 1) return
    currentAutoFillIndex = (currentAutoFillIndex + 1) % visibleAutoFills.length
  }

  function handleDismissAutoFill() {
    const proposal = activeAutoFill
    if (!proposal) return
    dismissedAutoFillSigs = [...dismissedAutoFillSigs, autoFillSig(proposal)]
    const nextLen = visibleAutoFills.length - 1
    if (nextLen > 0 && currentAutoFillIndex >= nextLen) {
      currentAutoFillIndex = 0
    }
  }

  function handleUndoDismissAutoFill() {
    if (dismissedAutoFillSigs.length === 0) return
    dismissedAutoFillSigs = dismissedAutoFillSigs.slice(0, -1)
  }

  function handleResizeSection(sectionId: string, newStart: number, newEnd: number) {
    const sm = get(songMap)
    if (!sm) return
    const out = resizeSectionRange(sm, sectionId, newStart, newEnd)
    if (!out.ok) {
      beatEditError = out.error
      return
    }
    const p = patchSongMap(() => out.map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  function handleResizeBoundary(leftId: string, rightId: string, boundaryBarIndex: number) {
    const sm = get(songMap)
    if (!sm) return
    const out = resizeSectionBoundary(sm, leftId, rightId, boundaryBarIndex)
    if (!out.ok) {
      beatEditError = out.error
      return
    }
    const p = patchSongMap(() => out.map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  // Seed trim from SongMap so WaveformPlayer starts at the correct region in the full reference MP3
  let rangeStart = $state($audioSession.startSec ?? 0)
  let rangeEnd = $state($audioSession.endSec ?? 0)
  let waveformReady = $state(false)

  /** Main workspace mode. */
  let editMode = $state<'grid' | 'sections' | 'chords' | 'cue' | 'mix' | 'leadsheet'>('grid')

  const NOTE_NAMES: NoteName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

  let selectedBeatId = $state<string | null>(null)
  let chordsSelectionBeatIds = $state<string[]>([])
  /** Chord UI: nested radial quick select (`ChordRadialQuickSelect.svelte`; legacy: `ChordPickerPopover.svelte`, `ChordMarkingMenu.svelte`) */
  let chordPickerOpen = $state(false)
  let chordAnchorX = $state(0)
  let chordAnchorY = $state(0)

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

  function focusOnMount(el: HTMLElement) {
    el.focus()
    if (el instanceof HTMLInputElement) el.select()
  }

  /** Strip labels only on beats with an explicit harmony row (no carry-forward repeat). */
  let chordLabelByBeatId = $derived.by(() => {
    const sm = $songMap
    if (!sm) return {} as Record<string, string>
    const key = sm.metadata.keyDetail
    const preferFlats = key ? songKeyPreferFlats(key) : false
    const out: Record<string, string> = {}
    for (const h of sm.harmony) {
      if (!h.beatId) continue
      out[h.beatId] = formatChordSymbol(h.chord, { preferFlats })
    }
    return out
  })

  /**
   * Per-bar chord suggestions derived from cached chroma. Pure function;
   * recomputes when songMap mutates (key change, section edits, beats edits,
   * or new chroma from the analyzer). Bars whose downbeat already has a
   * user-placed chord are filtered out at render time in the strip (ghosts
   * only show when no real chord is present).
   */
  const chordSuggestions = $derived(proposeChordSuggestions($songMap))

  /** Map shape consumed by TimelineBeatGrid for ghost rendering. */
  const chordSuggestionByBeatId = $derived.by(() => {
    const out: Record<string, { label: string; confidence: number }> = {}
    const sm = $songMap
    const preferFlats = sm?.metadata.keyDetail ? songKeyPreferFlats(sm.metadata.keyDetail) : false
    for (const [beatId, sug] of chordSuggestions) {
      out[beatId] = {
        label: formatChordSymbol(sug.chord, { preferFlats }),
        confidence: sug.confidence,
      }
    }
    return out
  })

  /** Suggestion for the currently selected beat (radial-menu payload). */
  const activeBeatSuggestion = $derived.by(() => {
    if (!selectedBeatId) return null
    const sug = chordSuggestions.get(selectedBeatId)
    if (!sug) return null
    const label =
      sug.confidence >= 0.10 ? 'high conf' : sug.confidence >= 0.05 ? 'medium conf' : 'low conf'
    return {
      primary: { chord: sug.chord, confidenceLabel: label },
      alternatives: sug.alternatives,
    }
  })

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

  function selectedChordTargetBeatIds(): string[] {
    const sm = get(songMap)
    if (!sm) return []
    const sorted = sortBeatsByTime(sm.timeline.beats)
    if (chordsSelectionBeatIds.length > 0) {
      return sorted.filter((b) => chordsSelectionBeatIds.includes(b.id)).map((b) => b.id)
    }
    if (selectedBeatId) return [selectedBeatId]
    return []
  }

  /** Earliest selected beat in timeline order — paste starts here. */
  function chordPasteAnchorBeatId(): string | null {
    const ids = selectedChordTargetBeatIds()
    return ids[0] ?? null
  }

  function copyChordsSelection() {
    const sm = get(songMap)
    if (!sm) return
    const ids = selectedChordTargetBeatIds()
    if (ids.length === 0) return
    const resolved = resolveChordAtEachBeat(sm)
    const chords = ids.map((id) => resolved.get(id) ?? null)
    const text = serializeChordClipboard(chords)
    void navigator.clipboard.writeText(text).catch(() => {
      beatEditError = 'Could not copy chords to the clipboard'
    })
    beatEditError = ''
  }

  async function pasteChordsFromClipboard() {
    const sm = get(songMap)
    if (!sm) return
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      beatEditError = 'Could not read the clipboard'
      return
    }
    const chords = parseChordClipboard(text)
    if (!chords || chords.length === 0) return
    const sorted = sortBeatsByTime(sm.timeline.beats)
    const anchorId = chordPasteAnchorBeatId()
    if (!anchorId) {
      beatEditError = 'Select a beat to paste onto'
      return
    }
    const anchorIdx = sorted.findIndex((b) => b.id === anchorId)
    if (anchorIdx < 0) return

    let map = sm
    for (let i = 0; i < chords.length; i++) {
      const beat = sorted[anchorIdx + i]
      if (!beat) break
      const c = chords[i]
      if (c === null) map = clearHarmonyAtBeat(map, beat.id)
      else {
        const out = upsertHarmonyAtBeat(map, beat.id, c, newId)
        if (!out.ok) {
          beatEditError = out.error
          return
        }
        map = out.map
      }
    }
    const p = patchSongMap(() => map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  function commitChord(chord: ChordSymbol) {
    const sm = get(songMap)
    if (!sm) return
    const targets = selectedChordTargetBeatIds()
    if (targets.length === 0) return
    let map = sm
    for (const beatId of targets) {
      const out = upsertHarmonyAtBeat(map, beatId, chord, newId)
      if (!out.ok) {
        beatEditError = out.error
        return
      }
      map = out.map
    }
    const p = patchSongMap(() => map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else {
      beatEditError = ''
      chordPickerOpen = false
    }
  }

  function clearChordAtBeat() {
    const sm = get(songMap)
    if (!sm) return
    const targets = selectedChordTargetBeatIds()
    if (targets.length === 0) return
    let map = sm
    for (const beatId of targets) {
      map = clearHarmonyAtBeat(map, beatId)
    }
    const p = patchSongMap(() => map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else {
      beatEditError = ''
      chordPickerOpen = false
    }
  }

  /** Picker spelling + diatonic column; must track metadata so changing song key updates the column. */
  let chordPickerSongKey = $derived(($songMap?.metadata.keyDetail ?? keyDraft) as SongKey)

  function isChordOpenKey(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    if (e.key.length !== 1) return false
    const k = e.key
    return /[A-Ga-g#b]/.test(k) || k === '♭' || k === '♯'
  }

  function blocksChordGlobalShortcut(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('[data-chord-picker-root]')) return false
    if (target.closest('[data-chord-beat-picker]')) return false
    if (target.closest('[data-chord-search-panel]')) return false
    if (target.closest('[data-song-key-picker]')) return true
    if (target.closest('button, a, [role="tab"]')) return true
    if (target.closest('input[type="range"]')) return true
    return false
  }

  $effect(() => {
    if (!browser || editMode !== 'chords') return
    const fn = (e: KeyboardEvent) => {
      if (blocksChordGlobalShortcut(e.target)) return
      if (chordPickerOpen) return
      if (!selectedBeatId) return
      if (!isChordOpenKey(e)) return
      e.preventDefault()
      chordAnchorX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0
      chordAnchorY = typeof window !== 'undefined' ? Math.min(200, window.innerHeight * 0.22) : 0
      chordPickerOpen = true
    }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  })

  $effect(() => {
    if (!browser || editMode !== 'chords') return
    const fn = (e: KeyboardEvent) => {
      if (blocksChordGlobalShortcut(e.target)) return
      if (chordPickerOpen) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'c') {
        e.preventDefault()
        copyChordsSelection()
      } else if (e.key === 'v') {
        e.preventDefault()
        void pasteChordsFromClipboard()
      }
    }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  })

  $effect(() => {
    if (editMode !== 'chords') {
      chordPickerOpen = false
      selectedBeatId = null
      chordsSelectionBeatIds = []
    }
  })

  function onChordBeatInteract(detail: { clientX: number; clientY: number }) {
    chordAnchorX = detail.clientX
    chordAnchorY = detail.clientY
    chordPickerOpen = true
  }

  let objectUrl = $state<string | null>(null)
  let audioEl = $state<HTMLAudioElement | null>(null)
  /** Offline-rendered song + cue WAV for Cue-tab preview (separate from main reference player). */
  let mixPreviewUrl = $state<string | null>(null)
  let mixPreviewBusy = $state(false)
  let mixPreviewErr = $state('')
  let mixPreviewAudioEl = $state<HTMLAudioElement | null>(null)
  let mixPreviewClickOverlay = $state(false)
  let mixClickRaf = 0
  let mixNextClickIdx = 0
  let mixClickPoints: BeatClickPoint[] = []
  let playingBarId = $state<string | null>(null)
  let preview = $state<{ start: number; end: number; barId: string } | null>(null)
  let rafId = 0

  /**
   * Click + volume state. Bound to WaveformPlayer's $bindable props
   * (the toolbar UI). The click loop logic lives in WaveformPlayer
   * itself now — no more parent-side click loop, no more orphan
   * <audio> bridge, no more count-in pause/resume race.
   *
   * These are still declared here because (a) the Cue-mode mix
   * preview also reads `clickVolume` via the shared clickMaster, and
   * (b) keeping them as parent state makes the bind:propName wiring
   * round-trip naturally.
   */
  let playWithClick = $state(false)
  let clickVolume = $state(1.5)
  let songVolume = $state(1)
  // Shared click AudioContext / gain for Cue-mode mix preview only.
  // WaveformPlayer's grid-mode clicks now route through the
  // PlaybackController below.
  let clickCtx: AudioContext | undefined
  let clickMaster: GainNode | undefined

  $effect(() => {
    if (clickMaster) clickMaster.gain.value = clickVolume
  })

  /**
   * Centralised playback engine for the grid editor — single runtime
   * owner of the `<audio>` element + click loop + count-in pre-roll.
   * Everything observable about playback flows through this controller;
   * WaveformPlayer reads its `currentTime` / `isPlaying` and dispatches
   * `play()` / `pause()` / `stop()` / `seek()`. No more local click
   * loop or count-in pre-roll inside the component.
   *
   * State is fed in via `$effect`s — songMap, mediaTimeOffsetSec
   * (= `plan.trimStartSec` for grid mode, since the audio element plays
   * the full uploaded file), rangeStart/end, playWithClick, volumes —
   * so the controller's `$derived plan` and click-loop lifecycle stay
   * in lockstep with the `.smap`.
   */
  const playbackController = new PlaybackController()

  $effect(() => {
    playbackController.setSongMap($songMap ?? null)
  })

  $effect(() => {
    const sm = $songMap
    // Grid editor's audio src = full uploaded file → currentTime is
    // original-time → offset = `plan.trimStartSec`.
    playbackController.mediaTimeOffsetSec = sm
      ? songPlaybackPlan(sm)?.trimStartSec ?? 0
      : 0
  })

  $effect(() => {
    playbackController.rangeStart = rangeStart
    playbackController.rangeEnd = rangeEnd
  })

  // NOT syncing `playWithClick` into the controller — that keeps the
  // controller's click loop dormant while WaveformPlayer still owns
  // grid-mode clicks. Once Step 4 lands and the controller takes over,
  // un-comment this line and delete WaveformPlayer's local loop.
  // $effect(() => { playbackController.playWithClick = playWithClick })

  $effect(() => {
    playbackController.clickVolume = clickVolume
  })

  $effect(() => {
    playbackController.songVolume = songVolume
  })

  onDestroy(() => {
    playbackController.destroy()
  })

  $effect(() => {
    const u = mixPreviewUrl
    return () => {
      if (u) queueMicrotask(() => URL.revokeObjectURL(u))
    }
  })

  function stopMixClickLoop() {
    if (mixClickRaf) cancelAnimationFrame(mixClickRaf)
    mixClickRaf = 0
  }

  function pauseMixPreview() {
    stopMixClickLoop()
    mixPreviewAudioEl?.pause()
  }

  $effect(() => {
    if (!mixPreviewClickOverlay) stopMixClickLoop()
  })

  /**
   * Main `<audio>` blob URL. `$derived($audioSession.file)` still re-fired when the session *object*
   * was replaced on trim sync, revoking URLs and breaking the cue mix player — so we key off the
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
      mixPreviewUrl = null
      stopPreviewLoop()
      stopMixClickLoop()
      mixPreviewAudioEl?.pause()
      audioEl?.pause()
      return
    }
    if (f === lastMainFileForObjectUrl && objectUrl) return

    if (objectUrl) URL.revokeObjectURL(objectUrl)
    audioEl?.pause()
    lastMainFileForObjectUrl = f
    objectUrl = URL.createObjectURL(f)
    mixPreviewUrl = null
    stopMixClickLoop()
    mixPreviewAudioEl?.pause()
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

  function ensureClickGraph() {
    if (clickCtx && clickMaster) return
    const ctx = new AudioContext()
    const g = ctx.createGain()
    g.gain.value = clickVolume
    g.connect(ctx.destination)
    clickCtx = ctx
    clickMaster = g
  }

  // Grid-mode click loop lives inside `WaveformPlayer.svelte`. The
  // Cue-mode mix preview's click loop (`syncMixNextClickIdx` /
  // `runMixClickLoop` / etc. below) is separate and drives its own
  // AudioContext-scheduled clicks against `mixPreviewAudioEl`.

  function syncMixNextClickIdx(t: number) {
    mixNextClickIdx = mixClickPoints.findIndex((b) => b.timeSec >= t - 0.018)
    if (mixNextClickIdx < 0) mixNextClickIdx = mixClickPoints.length
  }

  function runMixClickLoop() {
    const el = mixPreviewAudioEl
    const ctx = clickCtx
    const dest = clickMaster
    if (!el || !ctx || !dest || !mixPreviewClickOverlay || el.paused) {
      stopMixClickLoop()
      return
    }

    const t = el.currentTime
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0

    while (mixNextClickIdx < mixClickPoints.length && mixClickPoints[mixNextClickIdx]!.timeSec <= t + 0.025) {
      const pt = mixClickPoints[mixNextClickIdx]!
      playMetronomeClick(ctx, dest, ctx.currentTime + 0.002, pt.downbeat)
      mixNextClickIdx++
    }

    if (dur > 0 && t >= dur - 0.04) {
      el.pause()
      stopMixClickLoop()
      return
    }

    mixClickRaf = requestAnimationFrame(runMixClickLoop)
  }

  function startMixClickLoopFromCurrentTime() {
    if (!mixPreviewClickOverlay || !mixPreviewAudioEl) return
    ensureClickGraph()
    void clickCtx?.resume()
    syncMixNextClickIdx(mixPreviewAudioEl.currentTime)
    stopMixClickLoop()
    mixClickRaf = requestAnimationFrame(runMixClickLoop)
  }

  function onMixPreviewPlay() {
    audioEl?.pause()
    if (!mixPreviewClickOverlay) return
    startMixClickLoopFromCurrentTime()
  }

  function onMixPreviewPause() {
    stopMixClickLoop()
  }

  function onMixPreviewEnded() {
    stopMixClickLoop()
  }

  // The Debug-tools "Play bar X" preview uses `audioEl` (bound to
  // WaveformPlayer's <audio>) and self-stops via `previewTick`'s
  // own paused-check on each rAF. No play/pause listener needed
  // here — WaveformPlayer drives its own click loop internally now.

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

    pauseMixPreview()

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

  // Cue tab: count-in is independent of `cues.mode` (top-level `countInBeats`).
  let cueCountInBeats = $derived.by(() => {
    const sm = $songMap
    if (!sm) return 0
    return effectiveCountInBeats(sm)
  })

  let cueCountInResult = $derived.by(() => {
    const sm = $songMap
    if (!sm || cueCountInBeats === 0) return null
    return computeCountIn(sm, cueCountInBeats)
  })

  function applyCueCountIn(beats: number) {
    const sm = get(songMap)
    if (!sm) return
    const next = Number.isInteger(beats) && beats > 0 ? beats : undefined
    const p = patchSongMap((m) => ({
      ...m,
      countInBeats: next,
      cues: {
        ...m.cues,
        // Top-level `countInBeats` is the authoritative source now. Clear the
        // legacy mirror so `effectiveCountInBeats`'s migration-window fallback
        // doesn't report a stale value when the user picks "Off".
        countInBeats: 0,
        mode: m.cues.mode === 'countIn' ? 'off' : m.cues.mode,
        prependSec: undefined,
      },
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  /**
   * Live preview of what the spoken cue will announce — fallback chain
   * is `cues.spokenIntroText.trim() ?? metadata.title.trim() ?? 'Untitled song'`.
   * Same helper the cue WAV renderer uses, so the user always sees the
   * exact text Piper will say.
   */
  let cueSpokenIntroPreview = $derived.by(() => {
    const sm = $songMap
    if (!sm) return 'Untitled song'
    return resolvedSpokenIntroText(sm)
  })

  /** Current override (empty when the user hasn't set one — falls back to title). */
  let cueSpokenIntroOverride = $derived($songMap?.cues.spokenIntroText ?? '')

  function applyCueSpokenIntroText(text: string) {
    const trimmed = text.trim()
    const p = patchSongMap((m) => ({
      ...m,
      cues: {
        ...m.cues,
        // Clear the field when the user empties it — that re-enables the
        // title fallback. Storing an empty string would not equal "use
        // default" semantically.
        spokenIntroText: trimmed.length > 0 ? trimmed : undefined,
      },
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  // Start-beat override: a 1-indexed position into `sortBeatsByTime(beats)`.
  // 1 = bar 1 beat 1 (default, no override stored). Higher values store
  // `startBeatId` so the song-start anchor moves N-1 beats into the song.
  let cueStartBeatTotal = $derived($songMap ? sortBeatsByTime($songMap.timeline.beats).length : 0)
  let cueStartBeatIndex = $derived.by(() => {
    const sm = $songMap
    if (!sm || !sm.startBeatId) return 1
    const sorted = sortBeatsByTime(sm.timeline.beats)
    const i = sorted.findIndex((b) => b.id === sm.startBeatId)
    return i >= 0 ? i + 1 : 1
  })
  let cueStartBeatInfo = $derived.by<null | { barIndex: number; indexInBar: number; timeSec: number }>(() => {
    const sm = $songMap
    if (!sm) return null
    const sorted = sortBeatsByTime(sm.timeline.beats)
    const beat = sorted[Math.max(0, cueStartBeatIndex - 1)]
    if (!beat) return null
    const bar = sm.timeline.bars.find((b) => b.id === beat.barId)
    return { barIndex: bar?.index ?? 0, indexInBar: beat.indexInBar, timeSec: beat.timeSec }
  })

  function applyStartBeat(oneIndexed: number) {
    const sm = get(songMap)
    if (!sm) return
    const sorted = sortBeatsByTime(sm.timeline.beats)
    if (sorted.length === 0) return
    const clamped = Math.min(Math.max(1, Math.floor(oneIndexed)), sorted.length)
    const next = clamped === 1 ? undefined : sorted[clamped - 1]!.id
    const p = patchSongMap((m) => ({ ...m, startBeatId: next }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  /**
   * Set the song-start anchor to the first beat (downbeat) of the
   * given bar. Called from the per-bar anchor icon in the grid strip.
   * Equivalent to `applyStartBeat(<position of bar.beat[0] in sorted
   * beats>)` — same one writer, same .smap field, same reactive
   * downstream (cue tab, count-in ghost ticks, click loop, Ableton
   * export).
   */
  function setStartBar(barIndex: number) {
    const sm = get(songMap)
    if (!sm) return
    const bar = sm.timeline.bars.find((b) => b.index === barIndex)
    if (!bar) return
    const sorted = sortBeatsByTime(sm.timeline.beats)
    const firstBeatOfBar = sorted.find((b) => b.barId === bar.id && b.indexInBar === 0)
    if (!firstBeatOfBar) return
    const oneIndexed = sorted.indexOf(firstBeatOfBar) + 1
    applyStartBeat(oneIndexed)
  }

  /**
   * Count-in ghost ticks rendered in the grid strip — derived from
   * `songPlaybackPlan(sm)` so the user instantly SEES count-in change
   * 4 → 8 as 4 new ticks appearing. Original-time so the strip can
   * paint them directly into the bar viewport.
   */
  let countInTicksForGrid = $derived.by(() => {
    const sm = $songMap
    if (!sm) return [] as { timeSec: number; downbeat: boolean }[]
    const plan = songPlaybackPlan(sm)
    if (!plan || plan.countInBeats === 0) return []
    // plan.clickPoints[].timeSec is trim-shifted; shift back to original-
    // time for the strip's viewport coords.
    return plan.clickPoints
      .filter((c) => c.isCountIn)
      .map((c) => ({
        timeSec: c.timeSec + plan.trimStartSec,
        downbeat: c.downbeat,
      }))
  })

  /** Current song-start bar index (0-based) for the per-bar anchor icon. */
  let songStartBarIndex = $derived(cueStartBeatInfo?.barIndex ?? 0)

  /**
   * Pre-roll silence the player needs before audio starts so all count-
   * in beats fit. > 0 → tight-trim: WaveformPlayer schedules count-in
   * via Web Audio and defers audio.play() by this much. 0 → natural
   * lead-in is enough; count-in fires inline. Sourced from the canonical
   * `songPlaybackPlan(sm).prependSec`.
   */
  let countInPrependSec = $derived.by(() => {
    const sm = $songMap
    if (!sm) return 0
    return songPlaybackPlan(sm)?.prependSec ?? 0
  })

  /** Original-time of bar 1 beat 1 / startBeatId. Drives the player's "are we at song start" check. */
  let firstDownbeatOriginalSec = $derived.by(() => {
    const sm = $songMap
    if (!sm) return null
    return songPlaybackPlan(sm)?.firstDownbeatOriginalSec ?? null
  })

  const CUE_TRACK_REL = 'cue/cue-track.wav'
  const CLICK_TRACK_REL = 'cue/click-track.wav'

  let cueGenBusy = $state(false)
  let cueGenErr = $state('')
  /** Piper venv + voice on disk (desktop beacon). Required to generate cue audio. */
  let piperCueReady = $state(false)
  /** Piper / desktop unavailable — clicks-only export. */
  let cueSpeechNote = $state('')
  /** Last blob from a successful generate in this tab (cleared when export record is dropped). */
  let lastCueDownloadBlob = $state<Blob | null>(null)
  /** Click-only WAV from the same render pass. Same alignment as cue. */
  let lastClickDownloadBlob = $state<Blob | null>(null)

  $effect(() => {
    if (!$songMap?.cueTrackExport) {
      lastCueDownloadBlob = null
      lastClickDownloadBlob = null
    }
  })

  $effect(() => {
    if (!browser || !$songMap || !$audioSession.file) return
    let cancelled = false
    const poll = async () => {
      const st = await getPiperTtsSetupStatus()
      if (!cancelled) piperCueReady = !!(st?.ready)
    }
    void poll()
    const id = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  })

  async function generateCueTrackWav() {
    const sm = get(songMap)
    if (!sm) return
    if (!piperCueReady) {
      cueGenErr = 'BarBro desktop with Piper is required — start the desktop app and finish Piper setup (see TTS debug page).'
      return
    }
    cueGenBusy = true
    cueGenErr = ''
    cueSpeechNote = ''
    lastCueDownloadBlob = null
    try {
      // Render cue (speech only) AND click (clicks only). The two files are
      // sample-aligned (same prelude/prepend math) but contain orthogonal
      // content — mixing them sums to the legacy "cue track" experience
      // without doubling the clicks. The cue file stops containing clicks
      // here; old cue files rendered before this split still have them
      // baked in and will need a fresh "Generate" press to separate.
      const cueRender = await renderCueTrackWavBlob(sm, { includeSpeech: true, includeClicks: false })
      const clickRender = await renderCueTrackWavBlob(sm, { includeSpeech: false, includeClicks: true })
      if (cueRender.speechSkippedReason) cueSpeechNote = cueRender.speechSkippedReason
      const dur = cueTrackTotalDurationSec(sm)
      if (dur == null) throw new Error('Could not derive cue duration from trim + beats')
      const fp = fingerprintCueTrackInputs(sm)
      const now = new Date().toISOString()
      let cueRelativePath: string | undefined
      let clickWritten = false

      const ps = get(projectStore)
      if (ps.editingMode === 'project-song' && ps.osPath && ps.activeSongFolder) {
        if (!get(desktopCompanionStatus).reachable) {
          cueGenErr = 'Desktop client unreachable — tracks were not saved to project. Cue WAV is still available via Download.'
        } else {
          const cueBytes = new Uint8Array(await cueRender.blob.arrayBuffer())
          const clickBytes = new Uint8Array(await clickRender.blob.arrayBuffer())
          const [cueWrite, clickWrite] = await Promise.all([
            writeProjectSongAsset(ps.osPath, ps.activeSongFolder, 'cue/cue-track.wav', cueBytes),
            writeProjectSongAsset(ps.osPath, ps.activeSongFolder, 'cue/click-track.wav', clickBytes),
          ])
          if (cueWrite.ok) {
            cueRelativePath = CUE_TRACK_REL
          } else {
            cueGenErr = `Could not write cue file: ${cueWrite.error}.`
          }
          if (clickWrite.ok) {
            clickWritten = true
          } else if (!cueGenErr) {
            cueGenErr = `Cue saved but click file failed: ${clickWrite.error}.`
          }
        }
      }

      // Both exports get an explicit `preludeOffsetSec` so consumers (like
      // the Ableton setlist export) can skip the silence + count-in head
      // of each WAV without re-deriving it from `sm.cues`. The renderer
      // returns the exact value it used; same number for both layers since
      // they share the prelude/prepend math.
      const cuePreludeOffsetSec = cueRender.preludeOffsetSec
      const clickPreludeOffsetSec = clickRender.preludeOffsetSec
      const p = patchSongMap((m) => ({
        ...m,
        cueTrackExport: {
          fingerprint: fp,
          durationSec: dur,
          sampleRate: 44100,
          generatedAt: now,
          preludeOffsetSec: cuePreludeOffsetSec,
          relativePath: cueRelativePath,
        },
        clickTrackExport: clickWritten
          ? {
              fingerprint: fp,
              durationSec: dur,
              sampleRate: 44100,
              generatedAt: now,
              preludeOffsetSec: clickPreludeOffsetSec,
              relativePath: 'cue/click-track.wav',
            }
          : m.clickTrackExport,
      }))
      if (!p.ok) {
        cueGenErr = p.errors.join('; ')
        return
      }
      lastCueDownloadBlob = cueRender.blob
      lastClickDownloadBlob = clickRender.blob
      const snap = get(projectStore)
      if ((cueRelativePath || clickWritten) && snap.activeSongFolder) {
        const fresh = get(songMap)
        if (fresh) {
          const existing = snap.metadataByFolder[snap.activeSongFolder] ?? { title: '' }
          patchMetadataForFolder(snap.activeSongFolder, {
            ...existing,
            ...metadataLiteFromSongMap(fresh),
            // Flip the on-disk flags right away so /project's badges + the
            // mixer pick up both files without needing a Refresh.
            hasCueTrack: cueRelativePath ? true : existing.hasCueTrack,
            hasClickTrack: clickWritten ? true : existing.hasClickTrack,
          })
        }
      }
    } catch (e) {
      cueGenErr = e instanceof Error ? e.message : String(e)
    } finally {
      cueGenBusy = false
    }
  }

  function downloadCueTrackFile() {
    const sm = get(songMap)
    if (!lastCueDownloadBlob || !sm) return
    pauseMixPreview()
    audioEl?.pause()
    const url = URL.createObjectURL(lastCueDownloadBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeExportBasename(sm.metadata.title)}-cue-track.wav`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadClickTrackFile() {
    const sm = get(songMap)
    if (!lastClickDownloadBlob || !sm) return
    pauseMixPreview()
    audioEl?.pause()
    const url = URL.createObjectURL(lastClickDownloadBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeExportBasename(sm.metadata.title)}-click-track.wav`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** Generate cue WAV (needs Piper). */
  let cueRenderGate = $derived.by((): { ok: boolean; reason: string } => {
    const sm = $songMap
    if (!sm) return { ok: false, reason: 'No song.' }
    if (!sm.timeline.beats.length) return { ok: false, reason: 'Need beats (Grid).' }
    if (!sm.audio?.trim || !(sm.audio.trim.endSec > sm.audio.trim.startSec)) {
      return { ok: false, reason: 'Need trim (Grid).' }
    }
    if (!piperCueReady) return { ok: false, reason: 'BarBro desktop + Piper required.' }
    return { ok: true, reason: '' }
  })

  /** Song+cue preview / mix — only this tab’s generated WAV blob (reload clears it). */
  let mixPreviewGate = $derived.by((): { ok: boolean; reason: string } => {
    const sm = $songMap
    if (!sm) return { ok: false, reason: 'No song.' }
    if (!sm.timeline.beats.length) return { ok: false, reason: 'Need beats (Grid).' }
    if (!sm.audio?.trim || !(sm.audio.trim.endSec > sm.audio.trim.startSec)) {
      return { ok: false, reason: 'Need trim (Grid).' }
    }
    if (!lastCueDownloadBlob) return { ok: false, reason: 'Generate cue track first (preview uses this tab’s WAV).' }
    return { ok: true, reason: '' }
  })

  async function prepareMixPreview() {
    const sm = get(songMap)
    const file = get(audioSession).file
    if (!sm || !file) {
      mixPreviewErr = 'No audio.'
      return
    }
    if (!mixPreviewGate.ok) {
      mixPreviewErr = mixPreviewGate.reason
      return
    }
    const trim = sm.audio?.trim
    if (!trim || !(trim.endSec > trim.startSec)) {
      mixPreviewErr = 'Need trim.'
      return
    }
    mixPreviewBusy = true
    mixPreviewErr = ''
    try {
      const cue = lastCueDownloadBlob
      if (!cue) {
        mixPreviewErr = 'Generate cue track first.'
        return
      }
      const blob = await buildSongCueMixWavBlob(sm, file, cue)
      mixPreviewUrl = URL.createObjectURL(blob)
      let prependSec = 0
      const countInBeats = effectiveCountInBeats(sm)
      if (countInBeats > 0) {
        const ci = computeCountIn(sm, countInBeats)
        if (ci) prependSec = ci.prependSec
      }
      mixClickPoints = mixTimelineClickPoints(sm, trim.startSec, trim.endSec, prependSec)
    } catch (e) {
      mixPreviewErr = e instanceof Error ? e.message : String(e)
    } finally {
      mixPreviewBusy = false
    }
  }

  onDestroy(() => {
    stopPreviewLoop()
    stopMixClickLoop()
    audioEl?.pause()
    mixPreviewAudioEl?.pause()
    void clickCtx?.close()
    clickCtx = undefined
    clickMaster = undefined
  })
</script>

<main
  class="relative z-10 flex min-h-dvh w-full max-w-none flex-col gap-6 px-2 py-8 sm:px-4 md:px-6 md:py-12 lg:px-8"
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
      class="brutalist-shadow border-foreground bg-background mx-auto w-full max-w-md border-2 p-8 text-center"
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
  {:else if !$audioSession.file || !$songMap}
    <div
      class="brutalist-shadow border-foreground bg-background mx-auto w-full max-w-md border-2 p-8 text-center"
    >
      <p class="text-muted-foreground text-sm">No analyzed clip in session.</p>
      <Button type="button" variant="secondary" class="mt-6 gap-2" onclick={() => goto('/')}>
        <ArrowLeft class="size-4" aria-hidden="true" />
        Back to import
      </Button>
    </div>
  {:else if $audioSession.file && $songMap}
    {@const sm = $songMap}

    <header
      class="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex items-center gap-3">
        <div
          class="brutalist-shadow-sm border-foreground bg-muted text-foreground inline-flex size-11 shrink-0 items-center justify-center border-2"
          aria-hidden="true"
        >
          <Music class="size-6" strokeWidth={2} />
        </div>
        <div>
          <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">BarBro</p>
          <h1 class="text-2xl font-semibold tracking-tight">Edit</h1>
          <p class="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-sm">
            {#if editingTitle}
              <input
                class="border-foreground bg-background text-foreground min-w-0 w-40 border-b px-0.5 text-sm outline-none"
                bind:value={titleDraft}
                onblur={commitTitleEdit}
                onkeydown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } else if (e.key === 'Escape') { editingTitle = false } }}
                use:focusOnMount
              />
            {:else}
              <span>{sm.metadata.title}</span>
              <button
                type="button"
                class="text-muted-foreground/50 hover:text-foreground transition-colors"
                onclick={startTitleEdit}
                aria-label="Rename song"
              >
                <Pencil class="size-3" />
              </button>
            {/if}
            <span class="text-muted-foreground/80 font-mono text-xs tabular-nums">
              · {sm.metadata.bpm != null ? `${Math.round(sm.metadata.bpm)} BPM` : '— BPM'}
            </span>
          </p>
        </div>
      </div>

      <div
        class="border-foreground bg-muted inline-grid grid-cols-6 gap-0 self-start overflow-hidden border-2 sm:self-auto"
        role="tablist"
        aria-label="Edit mode"
      >
        <Button
          type="button"
          role="tab"
          aria-selected={editMode === 'grid'}
          variant="ghost"
          size="sm"
          class="h-8 border-0 px-3 text-xs font-bold shadow-none transition-colors {editMode === 'grid'
            ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
            : 'bg-transparent text-foreground hover:bg-foreground/15 active:bg-foreground/25'}"
          onclick={() => (editMode = 'grid')}
        >
          Grid
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={editMode === 'sections'}
          variant="ghost"
          size="sm"
          class="h-8 border-0 px-3 text-xs font-bold shadow-none transition-colors {editMode === 'sections'
            ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
            : 'bg-transparent text-foreground hover:bg-foreground/15 active:bg-foreground/25'}"
          onclick={() => (editMode = 'sections')}
        >
          Sections
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={editMode === 'chords'}
          variant="ghost"
          size="sm"
          class="h-8 border-0 px-3 text-xs font-bold shadow-none transition-colors {editMode === 'chords'
            ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
            : 'bg-transparent text-foreground hover:bg-foreground/15 active:bg-foreground/25'}"
          onclick={() => (editMode = 'chords')}
        >
          Chords
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={editMode === 'cue'}
          variant="ghost"
          size="sm"
          class="h-8 border-0 px-3 text-xs font-bold shadow-none transition-colors {editMode === 'cue'
            ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
            : 'bg-transparent text-foreground hover:bg-foreground/15 active:bg-foreground/25'}"
          onclick={() => (editMode = 'cue')}
        >
          Cue
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={editMode === 'mix'}
          variant="ghost"
          size="sm"
          class="h-8 border-0 px-3 text-xs font-bold shadow-none transition-colors {editMode === 'mix'
            ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
            : 'bg-transparent text-foreground hover:bg-foreground/15 active:bg-foreground/25'}"
          onclick={() => (editMode = 'mix')}
        >
          Mix
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={editMode === 'leadsheet'}
          variant="ghost"
          size="sm"
          class="h-8 border-0 px-3 text-xs font-bold shadow-none transition-colors {editMode === 'leadsheet'
            ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
            : 'bg-transparent text-foreground hover:bg-foreground/15 active:bg-foreground/25'}"
          onclick={() => (editMode = 'leadsheet')}
        >
          Lead sheet
        </Button>
      </div>
    </header>


    {#if editMode === 'cue'}
      <section
        class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5"
        aria-label="Cue settings"
      >
        <details class="text-muted-foreground mb-3 text-xs">
          <summary
            class="hover:text-foreground cursor-pointer list-none font-medium select-none marker:content-none [&::-webkit-details-marker]:hidden"
          >
            <span class="underline-offset-2 group-open:underline">About the cue track</span>
          </summary>
          <p class="mt-2 leading-relaxed">
            The cue track is a rendered WAV that combines clicks with optional spoken cues (title,
            count-in numbers, section labels) for headphone monitoring. Click placement and count-in
            are controlled in the <strong>Grid</strong> tab; spoken cues will live here once the
            speech pipeline lands. The click and cue WAVs are auto-rendered on demand (mixer
            fallback, Ableton export) — there's no separate "generate" step.
          </p>
        </details>

        <div class="space-y-4">
          {#if cueCountInBeats > 0 && cueCountInResult}
            <dl class="border-foreground border-2 px-3 py-3 font-mono text-xs">
              <div class="flex justify-between gap-4 py-0.5">
                <dt class="text-muted-foreground">Count-in beats</dt>
                <dd class="tabular-nums">{cueCountInBeats}</dd>
              </div>
              <div class="flex justify-between gap-4 py-0.5">
                <dt class="text-muted-foreground">Beat duration (at start anchor)</dt>
                <dd class="tabular-nums">
                  {cueCountInResult.beatDurationSec.toFixed(3)} s
                  ({(60 / cueCountInResult.beatDurationSec).toFixed(1)} BPM)
                </dd>
              </div>
              <div class="flex justify-between gap-4 py-0.5">
                <dt class="text-muted-foreground">Song start (in trimmed audio)</dt>
                <dd class="tabular-nums">{cueCountInResult.effectiveFirstDownbeatSec.toFixed(3)} s</dd>
              </div>
              <div class="flex justify-between gap-4 border-t border-foreground/20 pt-1 mt-1">
                <dt class="text-foreground font-medium">Prepend before audio</dt>
                <dd class="tabular-nums font-medium">{cueCountInResult.prependSec.toFixed(3)} s</dd>
              </div>
            </dl>
          {:else}
            <p class="text-muted-foreground text-xs italic">No count-in. Pick one in the Grid tab to see timing details.</p>
          {/if}

          <fieldset class="border-foreground border-2 px-3 py-3">
            <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">
              Spoken intro
            </legend>
            <div class="flex flex-wrap items-center gap-3 pt-1">
              <input
                type="text"
                value={cueSpokenIntroOverride}
                placeholder={$songMap?.metadata.title ?? 'Untitled song'}
                onchange={(e) => applyCueSpokenIntroText((e.currentTarget as HTMLInputElement).value)}
                class="border-foreground bg-background min-w-0 flex-1 border-2 px-2 py-1 text-sm"
                aria-label="Spoken intro text"
                maxlength="120"
              />
            </div>
            <!-- Live readout so users know exactly what Piper will say. Pulls
                 from `resolvedSpokenIntroText(sm)` — the same helper the cue
                 WAV renderer uses, so what you see here matches what you'll
                 hear. -->
            <p class="text-muted-foreground mt-2 font-mono text-xs leading-relaxed" role="status">
              Will announce: <span class="text-foreground">"{cueSpokenIntroPreview}"</span>
              {#if !cueSpokenIntroOverride}
                <span class="text-muted-foreground/70"> (from song title)</span>
              {/if}
            </p>
            <p class="text-muted-foreground mt-2 text-xs leading-relaxed">
              Leave empty to use the song title. Set this when the title's punctuation /
              parentheses make Piper trip up, or when you want a shorter cue
              (e.g. "Valerie" while the title is "Valerie (Amy Winehouse cover)").
            </p>
          </fieldset>

          <p class="text-muted-foreground text-xs leading-relaxed">
            Use the <strong>Mix</strong> tab for full multi-track playback with click + stems.
          </p>
        </div>
      </section>
    {/if}

    {#if editMode === 'mix'}
      <section
        class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5"
        aria-label="Mixer"
      >
        <details class="text-muted-foreground mb-3 text-xs sm:mb-4">
          <summary
            class="hover:text-foreground cursor-pointer list-none font-medium select-none marker:content-none [&::-webkit-details-marker]:hidden"
          >
            <span class="underline-offset-2 group-open:underline">How the mixer works</span>
          </summary>
          <p class="mt-2 leading-relaxed">
            Each track on disk (original, stems, cue) loads as its own lane. Volume / mute (M) / solo (S)
            persist to <code>song.smap</code>. Stems and the original are virtually delayed so beat 1 lines up with
            the cue track's count-in — the same alignment your Ableton export uses. Click on a waveform to seek.
          </p>
        </details>
        <MixerView />
      </section>
    {/if}

    {#if editMode === 'leadsheet'}
      <section
        class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5"
        aria-label="Lead sheet"
      >
        {#if $songMap}
          <LeadSheet songMap={$songMap} />
        {:else}
          <p class="text-muted-foreground p-4 text-sm">Open a song to view its lead sheet.</p>
        {/if}
      </section>
    {/if}

    {#if editMode === 'grid' || editMode === 'sections' || editMode === 'chords'}
      <section
        class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5"
        aria-label="Edit timeline"
      >
        <details class="text-muted-foreground mb-3 text-xs sm:mb-4">
          <summary
            class="hover:text-foreground cursor-pointer list-none font-medium select-none marker:content-none [&::-webkit-details-marker]:hidden"
          >
            <span class="underline-offset-2 group-open:underline">How this tab works</span>
          </summary>
          <div class="mt-2 space-y-2 leading-relaxed">
            {#if editMode === 'grid'}
              <p>
                Edit bars and beats in the strip above the waveform. Add or remove bars at the ends; wheel on the strip
                changes beats per bar when a bar is selected. Drag the left or right edge of a bar to lengthen or shorten
                it in time; beats inside that bar stay evenly spaced (good for slight ritardandos).
              </p>
            {:else if editMode === 'sections'}
              <p>
                Drag on the bar strip or Shift+click / ⌘/Ctrl+click to select a range. Pick a section type and tag it;
                overlaps are replaced. Zoom matches Grid.
              </p>
            {:else}
              <p>
                Select beats on the chord strip (drag or Shift+click / ⌘/Ctrl+click). Click a beat for the radial menu.
                ⌘/Ctrl+C / V copy and paste resolved chords in beat order. Labels only on beats with explicit chords;
                others inherit. Song key affects spelling, not stored pitch.
              </p>
            {/if}
          </div>
        </details>
        {#if editMode === 'sections'}
          <SectionSuggestionBanner
            suggestion={activeSuggestion}
            index={activeSuggestionPosition}
            total={visibleSuggestions.length}
            dismissedCount={dismissedSuggestionSigs.length}
            onAccept={handleAcceptSectionSuggestion}
            onSkip={handleSkipSectionSuggestion}
            onDismiss={handleDismissSectionSuggestion}
            onUndoDismiss={handleUndoDismissSectionSuggestion}
          />
        {/if}
        {#if editMode === 'chords'}
          <ChordAutoFillBanner
            proposal={activeAutoFill}
            index={activeAutoFillPosition}
            total={visibleAutoFills.length}
            dismissedCount={dismissedAutoFillSigs.length}
            onAccept={handleAcceptAutoFill}
            onSkip={handleSkipAutoFill}
            onDismiss={handleDismissAutoFill}
            onUndoDismiss={handleUndoDismissAutoFill}
          />
          <div
            data-song-key-picker
            class="border-foreground bg-muted mb-4 flex flex-wrap items-center gap-2 border-2 px-3 py-2"
          >
            <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Song key</span>
            <select
              class="border-input bg-background text-foreground border-2 px-2 py-1 text-xs"
              value={keyDraft.root}
              onchange={(e) =>
                applyKeyPatch({ ...keyDraft, root: e.currentTarget.value as NoteName })}
            >
              {#each NOTE_NAMES as n (n)}
                <option value={n}>{n}</option>
              {/each}
            </select>
            <select
              class="border-input bg-background text-foreground border-2 px-2 py-1 text-xs"
              value={keyDraft.accidental ?? ''}
              onchange={(e) => {
                const v = e.currentTarget.value
                const accidental: Accidental | undefined =
                  v === '' ? undefined : (v as Accidental)
                applyKeyPatch({ ...keyDraft, accidental })
              }}
            >
              <option value="">natural</option>
              <option value="flat">♭</option>
              <option value="sharp">♯</option>
              <option value="natural">♮</option>
            </select>
            <select
              class="border-input bg-background text-foreground border-2 px-2 py-1 text-xs"
              value={keyDraft.mode}
              onchange={(e) =>
                applyKeyPatch({
                  ...keyDraft,
                  mode: e.currentTarget.value as SongKey['mode'],
                })}
            >
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
            {#if showKeyHint && detectedKey}
              <div class="flex w-full items-center gap-2 border-t border-foreground/10 pt-2">
                <span class="text-foreground/70 text-xs">✨</span>
                <span class="text-foreground/80 text-xs">
                  Detected:
                  <span class="font-semibold">{detectedKeyDisplayLabel()}</span>
                  <span class="text-muted-foreground">({confidenceLabel(detectedKey.confidence)})</span>
                </span>
                <button
                  type="button"
                  class="border-foreground bg-background hover:bg-foreground hover:text-background ml-auto border-2 px-2 py-0.5 text-[11px] font-bold"
                  onclick={acceptDetectedKey}
                >
                  Use
                </button>
              </div>
            {:else if chordChromaStatus === 'analyzing' || chordChromaStatus === 'installing'}
              <div class="text-muted-foreground flex w-full items-center gap-2 border-t border-foreground/10 pt-2 text-xs italic">
                <span>✨</span>
                <span>
                  {chordChromaStatus === 'installing'
                    ? 'Installing harmony analyzer…'
                    : 'Analyzing harmony to suggest a key…'}
                </span>
              </div>
            {:else if chordChromaStatus === 'error' && chordChromaError}
              <div class="text-destructive flex w-full items-center gap-2 border-t border-foreground/10 pt-2 text-xs">
                <span>⚠</span>
                <span>Key detection failed: {chordChromaError}</span>
                <button
                  type="button"
                  class="border-destructive ml-auto border-2 px-2 py-0.5 text-[11px] font-bold"
                  onclick={() => void runChordChromaAnalysis(true)}
                >
                  Retry
                </button>
              </div>
            {/if}
          </div>
        {/if}
        <WaveformPlayer
          file={$audioSession.file}
          bind:rangeStart
          bind:rangeEnd
          bind:ready={waveformReady}
          variant="editor"
          beatGrid={{ bars: sm.timeline.bars, beats: sm.timeline.beats }}
          beatGridEditable={true}
          timelineStripMode={editMode === 'sections'
            ? 'sections'
            : editMode === 'chords'
              ? 'chords'
              : 'grid'}
          mapSections={sm.sections}
          onBarGridAction={handleBarGridAction}
          onApplySectionTag={handleApplySectionTag}
          suggestionPreview={editMode === 'sections' ? sectionSuggestionPreview : null}
          onAcceptSuggestion={handleAcceptSectionSuggestion}
          onDismissSuggestion={handleDismissSectionSuggestion}
          onResizeSection={handleResizeSection}
          onResizeBoundary={handleResizeBoundary}
          audioBorderTicks={editMode === 'sections' && showAudioBorders ? audioBorders : []}
          audioBordersStatus={audioBordersStatus}
          audioBordersError={audioBordersError}
          bind:showAudioBorders
          onReanalyzeBorders={() => runSectionBorderAnalysis(true)}
          sectionsInstallProgress={sectionsInstallProgress}
          bind:sectionsSelectionBarIds
          bind:chordsSelectionBeatIds
          chordLabelByBeatId={chordLabelByBeatId}
          chordSuggestionByBeatId={chordSuggestionByBeatId}
          bind:selectedBeatId
          onChordBeatInteract={onChordBeatInteract}
          bind:audioElement={audioEl}
          bind:playWithClick
          bind:clickVolume
          bind:songVolume
          countInTicks={editMode === 'grid' ? countInTicksForGrid : []}
          songStartBarIndex={songStartBarIndex}
          onSetStartBar={editMode === 'grid' ? setStartBar : undefined}
          countInPrependSec={editMode === 'grid' ? countInPrependSec : 0}
          firstDownbeatOriginalSec={editMode === 'grid' ? firstDownbeatOriginalSec : null}
          controller={playbackController}
        />
        {#if beatEditError}
          <p class="text-destructive mt-2 text-xs" role="status">{beatEditError}</p>
        {/if}
      </section>
      <!-- Radial menu stays outside container ancestors for stable fixed-position clientX/Y alignment. -->
      {#if editMode === 'chords' && $songMap}
        <ChordRadialQuickSelect
          bind:open={chordPickerOpen}
          anchorX={chordAnchorX}
          anchorY={chordAnchorY}
          songKey={chordPickerSongKey}
          selectedBeatId={selectedBeatId}
          suggestion={activeBeatSuggestion}
          onCommit={commitChord}
          onClearChord={clearChordAtBeat}
        />
      {/if}
    {/if}

    {#if editMode === 'grid' && sm.timeline.beats.length > 0 && sm.timeline.original}
      <section
        class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5"
        aria-label="Grid edits"
      >
        <h2 class="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">Grid edits</h2>
        <div class="flex flex-wrap items-center gap-3">
          {#if resetGridConfirming}
            <button
              type="button"
              onclick={commitResetGrid}
              class="border-foreground bg-destructive text-destructive-foreground hover:bg-destructive/90 border-2 px-3 py-1 text-sm font-bold"
            >
              Yes, reset
            </button>
            <button
              type="button"
              onclick={cancelResetGridConfirm}
              class="border-foreground hover:bg-foreground hover:text-background border-2 px-3 py-1 text-sm"
            >
              Cancel
            </button>
            <span class="text-muted-foreground text-xs">
              This will erase your bar and beat edits.
            </span>
          {:else}
            <button
              type="button"
              onclick={startResetGridConfirm}
              disabled={resetGridDisabled}
              class="border-foreground hover:bg-foreground hover:text-background disabled:opacity-40 disabled:hover:bg-background disabled:hover:text-foreground border-2 px-3 py-1 text-sm"
            >
              Reset grid
            </button>
            <span class="text-muted-foreground text-xs">
              {#if resetGridDisabled}
                No edits to undo.
              {:else}
                Restore to the analyzed baseline.
              {/if}
            </span>
          {/if}
        </div>
      </section>
    {/if}

    {#if editMode === 'grid' && sm.timeline.beats.length > 0}
      <section
        class="brutalist-shadow border-foreground bg-background w-full space-y-4 border-2 p-3 sm:p-4 md:p-5"
        aria-label="Metronome"
      >
        <h2 class="text-muted-foreground text-xs font-medium uppercase tracking-wide">Metronome</h2>

        <fieldset class="border-foreground border-2 px-3 py-3">
          <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Count-in beats</legend>
          <div class="flex flex-wrap gap-3 pt-1">
            {#each [0, 4, 8] as n (n)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="gridCountInBeats"
                  value={n}
                  checked={cueCountInBeats === n}
                  onchange={() => applyCueCountIn(n)}
                  class="accent-foreground"
                />
                {n === 0 ? 'Off' : `${n} beats`}
              </label>
            {/each}
          </div>
          <!-- Live readout — confirms the toggle actually took effect and shows
               what the resulting pre-roll will sound like. -->
          <p class="text-muted-foreground mt-2 font-mono text-xs tabular-nums" role="status">
            {#if cueCountInBeats === 0}
              No count-in — playback starts immediately.
            {:else if cueCountInResult}
              {cueCountInBeats} clicks · {(cueCountInBeats * cueCountInResult.beatDurationSec).toFixed(2)}s before song start
              · {cueCountInResult.prependSec.toFixed(2)}s silence prepended
            {:else}
              {cueCountInBeats} beats configured · (analyze beats to compute duration)
            {/if}
          </p>
        </fieldset>

        <fieldset class="border-foreground border-2 px-3 py-3">
          <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Start at beat</legend>
          <div class="flex flex-wrap items-center gap-3 pt-1">
            <input
              type="number"
              min={1}
              max={Math.max(1, cueStartBeatTotal)}
              step={1}
              value={cueStartBeatIndex}
              onchange={(e) => applyStartBeat(Number((e.currentTarget as HTMLInputElement).value))}
              class="border-foreground bg-background w-24 border-2 px-2 py-1 text-sm tabular-nums"
              aria-label="Song-start beat (1-indexed)"
            />
            <span class="text-muted-foreground font-mono text-xs">
              {#if cueStartBeatInfo}
                Start: bar {cueStartBeatInfo.barIndex + 1} beat {cueStartBeatInfo.indexInBar + 1}
                ({cueStartBeatInfo.timeSec.toFixed(2)} s)
              {:else}
                No beats yet
              {/if}
            </span>
            {#if cueStartBeatIndex !== 1}
              <button
                type="button"
                onclick={() => applyStartBeat(1)}
                class="border-foreground hover:bg-foreground hover:text-background border-2 px-2 py-0.5 text-xs"
              >
                Reset to bar 1
              </button>
            {/if}
          </div>
          <p class="text-muted-foreground mt-2 text-xs leading-relaxed">
            The song-start anchor. Default is bar 1 beat 1. Move it later in the song to let
            earlier beats play under the count-in (e.g. a drum-fill leading into the downbeat).
          </p>
        </fieldset>

        <!-- "Play with click" toggle + Click / Song volume sliders
             moved to a compact strip directly under the WaveformPlayer
             where the play button lives. See the grid-mode toolbar
             block above. -->
      </section>
    {/if}

    <details class="group border-foreground bg-background border-2">
      <summary
        class="text-muted-foreground hover:text-foreground cursor-pointer list-none px-4 py-3 text-xs font-medium tracking-wide uppercase select-none marker:content-none [&::-webkit-details-marker]:hidden"
      >
        <span class="underline-offset-2 group-open:underline">Debug tools</span>
        <span class="text-muted-foreground/70 ml-2 font-normal normal-case">analysis preview, bar play, click track</span>
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
            <p class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">First bars (debug)</p>
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
  {/if}
</main>
