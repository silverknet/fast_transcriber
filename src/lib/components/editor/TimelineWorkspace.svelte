<script lang="ts">
  import { browser } from '$app/environment'
  import { untrack } from 'svelte'
  import { get } from 'svelte/store'
  import WaveformPlayer from '$lib/components/WaveformPlayer.svelte'
  import EditSectionToolbar from '$lib/components/EditSectionToolbar.svelte'
  import SectionSuggestionBanner from '$lib/components/SectionSuggestionBanner.svelte'
  import ChordAutoFillBanner from '$lib/components/ChordAutoFillBanner.svelte'
  import ChordRadialQuickSelect from '$lib/components/ChordRadialQuickSelect.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Layers, Wand2 } from '@lucide/svelte'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import type { PlaybackControllerLike } from '$lib/audio/transport.svelte'
  import { audioSession } from '$lib/stores/audioSession'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import {
    beginPatchBatch,
    canRedo,
    canUndo,
    endPatchBatch,
    patchSongMap,
    redoSongMap,
    songMap,
    undoSongMap,
  } from '$lib/stores/songMap'
  import { newId } from '$lib/songmap/factory'
  import {
    applyBarGridAction,
    resetTimelineToOriginal,
    timelineMatchesOriginal,
    type BarGridAction,
  } from '$lib/songmap/timelineEdit'
  import {
    analyzeDownbeatsViaDesktop,
    getSectionsSetupStatus,
    setupSectionsDeps,
    suggestSectionBordersViaDesktop,
  } from '$lib/client/desktopBridge'
  import { trimAudioFileToWav } from '$lib/audio/trimAudio'
  import { beatsToSongMap } from '$lib/analysis/beatsToSongMap'
  import { reanalyzeShape, reanalyzeWithHarmony } from '$lib/songmap/reanalyze'
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
  import { proposeChordSuggestions, type ChordSuggestion } from '$lib/chords/suggestFromChroma'
  import { chordSuggestionVisibilityState } from '$lib/chords/suggestionVisibility'
  import {
    formatChordSymbol,
    parseChordClipboard,
    resolveChordAtEachBeat,
    serializeChordClipboard,
    songKeyPreferFlats,
    transposeChord,
  } from '$lib/chords'
  import {
    transposeChordForDisplay,
    transposeChordForStorage,
    transposeSongKey,
  } from '$lib/songmap/transposition'
  import {
    clearHarmonyAtBeat,
    upsertHarmonyAtBeat,
    setBarChordDivision,
    setBarFractionChord,
    barChordDivision,
  } from '$lib/songmap/harmonyEdit'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import { computeCountIn } from '$lib/audio/computeCountIn'
  import { effectiveCountInBeats } from '$lib/songmap/countIn'
  import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
  import {
    applyChordAutoFill,
    proposeChordAutoFillCandidates,
    type ChordAutoFillProposal,
  } from '$lib/chords/autoFill'
  import { parseChordSheet } from '$lib/chords/sheet/parseChordSheet'
  import { applySheetImport, prepareSheetImport } from '$lib/chords/sheet/importAsDraft'
  import { pruneSelections } from '$lib/editor/liveEditGuards'
  import { ensureAudioFingerprint } from '$lib/audio/importedAudio'
  import type {
    Accidental,
    ChordSymbol,
    NoteName,
    Section,
    SectionKind,
    SongKey,
    SongMap,
  } from '$lib/songmap/types'

  type EditMode = 'overview' | 'grid' | 'sections' | 'chords' | 'cue' | 'lyrics' | 'leadsheet'
  type AnalysisStatus =
    | 'idle'
    | 'installing'
    | 'analyzing'
    | 'ready'
    | 'cached'
    | 'error'
    | 'unavailable'

  // The grid / sections / chords timeline workspace, extracted from the editor
  // page. The shell owns the always-visible key + transpose + chroma subsystem
  // (the header reads it in every mode), so those flow IN as read-only props /
  // callbacks; everything selection- and timeline-edit-shaped lives here.
  let {
    editMode,
    playbackController,
    transposeSemitones,
    displayedSongKey,
    activeDraftLabel,
    keyDraft,
    chordChromaStatus,
    chordChromaError,
    draftMsg,
    playbackAudioBufferOverride,
    applyKeyPatch,
    onRetryChroma,
    beatEditError = $bindable(''),
    audioElement = $bindable(null),
  }: {
    editMode: EditMode
    playbackController: PlaybackControllerLike
    transposeSemitones: number
    displayedSongKey: SongKey | null
    activeDraftLabel: string
    keyDraft: SongKey
    chordChromaStatus: AnalysisStatus
    chordChromaError: string | null
    draftMsg: string
    playbackAudioBufferOverride: AudioBuffer | null | undefined
    applyKeyPatch: (next: SongKey) => void
    onRetryChroma: () => void
    beatEditError?: string
    audioElement?: HTMLAudioElement | null
  } = $props()

  // ── Workspace-local copies of the key-hint helpers. They read only $songMap
  // (+ the applyKeyPatch prop), so the shell keeps its own `detectedKey` for the
  // header's key label and we don't cross-wire the two. ──
  function currentAudioFingerprint(sm: SongMap | null): string | null {
    if (sm?.audio?.sha256) return sm.audio.sha256
    const f = $audioSession.file
    if (f) return `${f.name}:${f.size}`
    if (sm?.audio?.fileName) return `${sm.audio.fileName}:${Math.round(sm.audio.durationSec ?? 0)}`
    return null
  }
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
  function acceptDetectedKey() {
    const dk = detectedKey
    if (!dk) return
    applyKeyPatch({
      root: dk.root,
      ...(dk.accidental ? { accidental: dk.accidental } : {}),
      mode: dk.mode,
    })
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

  /**
   * Re-run beat detection on the current audio + trim. When the new
   * grid has the same beat AND bar count as the old one, chords and
   * sections survive (chord beatIds are re-anchored by sorted-time
   * position; sections are bar.index-positional). When the counts
   * differ, the user is warned before chords + sections are dropped.
   *
   * Available even when `timeline.original` is absent (legacy projects)
   * — re-analyzing populates it as a side effect, which is the
   * intended way to enable "Reset to analyzed" for those projects.
   */
  let reanalyzeBusy = $state(false)
  let reanalyzeError = $state('')

  async function reanalyzeGrid(): Promise<void> {
    if (reanalyzeBusy) return
    const sm = get(songMap)
    const file = get(audioSession).file
    if (!sm || !file) {
      reanalyzeError = 'No audio loaded.'
      return
    }
    const trim = sm.audio?.trim
    if (!trim || !(trim.endSec > trim.startSec)) {
      reanalyzeError = 'Trim is missing or empty. Set it in the Grid tab first.'
      return
    }
    reanalyzeBusy = true
    reanalyzeError = ''
    try {
      const { file: trimmedWav } = await trimAudioFileToWav(file, trim.startSec, trim.endSec)
      const r = await analyzeDownbeatsViaDesktop(trimmedWav)
      if (!r.ok) {
        throw new Error(r.error ?? 'Analyzer returned no beats.')
      }
      const fresh = beatsToSongMap({
        filename: trimmedWav.name,
        durationSec: Math.max(0, trim.endSec - trim.startSec),
        mimeType: trimmedWav.type || 'audio/wav',
        beats: r.beats,
      })
      const shape = reanalyzeShape(sm, fresh.timeline.bars, fresh.timeline.beats)
      if (shape === 'mismatch') {
        const oldB = sm.timeline.beats.length
        const newB = fresh.timeline.beats.length
        const oldBars = sm.timeline.bars.length
        const newBars = fresh.timeline.bars.length
        const lostChords = sm.harmony.length
        const lostSections = sm.sections.length
        const proceed = confirm(
          `Re-analysis returned a different grid (${newB} beats / ${newBars} bars; you had ${oldB} / ${oldBars}).\n\n` +
            `${lostChords} chord${lostChords === 1 ? '' : 's'} and ${lostSections} section${lostSections === 1 ? '' : 's'} ` +
            `can't be matched and will be removed.\n\nContinue?`,
        )
        if (!proceed) return
      }
      const out = reanalyzeWithHarmony(sm, fresh.timeline.bars, fresh.timeline.beats)
      const p = patchSongMap(() => out.map)
      if (!p.ok) {
        reanalyzeError = p.errors.join('; ')
      }
    } catch (e) {
      reanalyzeError = e instanceof Error ? e.message : String(e)
    } finally {
      reanalyzeBusy = false
    }
  }

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
      audioBordersError = 'BarBro Desktop is not reachable.'
      return
    }

    // Make sure the librosa venv exists. If not, install it inline — no UI
    // prompt — and then continue into analysis. Mirrors how stems setup
    // works the first time the user enters that view.
    const setup = await getSectionsSetupStatus()
    if (!setup) {
      audioBordersStatus = 'unavailable'
      audioBordersError = 'Could not check analysis setup.'
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
  /**
   * Pure UI toggle (NOT business logic): the chord auto-fill banner is a
   * low-frequency feature, so it stays collapsed behind a small icon in the
   * chord toolbar and only expands in place when the user clicks it. Default
   * collapsed; takes no vertical space until opened.
   */
  let showAutoFill = $state(false)

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

  /**
   * Persist a trim-handle drag from the waveform into the SongMap (the root
   * of truth) + audio session. Fired once on drag-release via
   * `WaveformPlayer.onSelectionCommit`, so it makes one undo entry, not one
   * per pixel.
   *
   * Scoped to the pre-analysis state (`bars.length === 0`). Once a grid
   * exists, bars/beats are stored in song-relative (post-trim) time; moving
   * the trim window would shift the audio under a fixed grid and desync them.
   * Re-trimming an analyzed song is the job of "Re-analyze grid", which
   * re-detects beats against the new trim — not a silent handle drag.
   */
  function handleTrimCommit(start: number, end: number) {
    const sm = get(songMap)
    if (!sm?.audio || !(end > start)) return
    if (sm.timeline.bars.length > 0) return
    patchSongMap((m) =>
      m.audio ? { ...m, audio: { ...m.audio, trim: { startSec: start, endSec: end } } } : m,
    )
    audioSession.update((s) => ({ ...s, startSec: start, endSec: end }))
  }

  // Trim selection is BUFFER-time; the adapter converts to the transport's
  // song-time range so `play()` clamps to the same window.
  $effect(() => {
    playbackController.rangeStart = rangeStart
    playbackController.rangeEnd = rangeEnd
  })

  let timelineToolbarTitle = $derived(
    editMode === 'grid' ? 'Grid' : editMode === 'sections' ? 'Sections' : 'Chords',
  )
  let timelineToolbarHelp = $derived(
    editMode === 'grid'
      ? 'Edit bars and beats in the strip above the waveform. Add or remove bars at the ends, wheel to change beats per bar, and drag a bar edge to adjust timing.'
      : editMode === 'sections'
        ? 'Drag on the bar strip, or use Shift+click / Cmd/Ctrl+click, to select a range. Pick a section type to tag it.'
        : 'Select beats on the chord strip, double-click/tap to edit, and press Space to play from the selected beat. Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste chords.',
  )

  const NOTE_NAMES: NoteName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

  let selectedBeatId = $state<string | null>(null)
  let chordsSelectionBeatIds = $state<string[]>([])
  let showChordSuggestions = $state(true)
  let finishedChordSectionIds = $state<string[]>([])
  let reopenedChordSectionIds = $state<string[]>([])
  let chordContextMenu = $state<{ x: number; y: number } | null>(null)
  /** Chord UI: nested radial quick select (`ChordRadialQuickSelect.svelte`; legacy: `ChordPickerPopover.svelte`, `ChordMarkingMenu.svelte`) */
  let chordPickerOpen = $state(false)
  let chordAnchorX = $state(0)
  let chordAnchorY = $state(0)
  // Type-to-search: the first typed char that opens the picker straight into
  // its search panel (empty = open the normal radial view).
  let chordSearchInitialQuery = $state('')

  function sectionDisplayLabel(section: Section, ordinal?: number): string {
    const defaultLabel = defaultSectionLabel(section.kind)
    const explicitLabel = section.label?.trim()
    const base = explicitLabel || defaultLabel
    const hasCustomLabel =
      !!explicitLabel && explicitLabel.toLowerCase() !== defaultLabel.toLowerCase()
    return ordinal === undefined || hasCustomLabel ? base : `${base} ${ordinal}`
  }

  function sectionForBeatId(sm: SongMap, beatId: string | null | undefined): Section | null {
    if (!beatId) return null
    const beat = sm.timeline.beats.find((b) => b.id === beatId)
    if (!beat) return null
    const bar = sm.timeline.bars.find((b) => b.id === beat.barId)
    if (!bar) return null
    return (
      sm.sections.find(
        (s) =>
          bar.index >= s.barRange.startBarIndex &&
          bar.index <= s.barRange.endBarIndex,
      ) ?? null
    )
  }

  /** Strip labels only on beats with an explicit harmony row (no carry-forward repeat). */
  let chordLabelByBeatId = $derived.by(() => {
    const sm = $songMap
    if (!sm) return {} as Record<string, string>
    const key = displayedSongKey
    const preferFlats = key ? songKeyPreferFlats(key) : false
    const out: Record<string, string> = {}
    for (const h of sm.harmony) {
      if (!h.beatId) continue
      const chord = transposeChordForDisplay(h.chord, transposeSemitones, key ?? undefined)
      out[h.beatId] = formatChordSymbol(chord, { preferFlats })
    }
    return out
  })

  /** Playback/overview labels carry the last defined chord forward until the next change. */
  let playbackChordLabelByBeatId = $derived.by(() => {
    const sm = $songMap
    if (!sm) return {} as Record<string, string>
    const key = displayedSongKey
    const preferFlats = key ? songKeyPreferFlats(key) : false
    const resolved = resolveChordAtEachBeat(sm)
    const out: Record<string, string> = {}
    for (const [beatId, chord] of resolved) {
      if (!chord) continue
      const displayed = transposeChordForDisplay(chord, transposeSemitones, key ?? undefined)
      out[beatId] = formatChordSymbol(displayed, { preferFlats })
    }
    return out
  })

  /**
   * Per-bar chord suggestions derived from cached chroma. Pure function;
   * recomputes when songMap mutates (key change, section edits, beats edits,
   * or new chroma from the analyzer). Suggestions only show in un-chorded
   * space, so analyzer ghosts do not compete with user-entered chord spans.
   */
  const rawChordSuggestions = $derived(proposeChordSuggestions($songMap))

  const chordSuggestionVisibility = $derived.by(() => {
    const sm = $songMap
    return sm ? chordSuggestionVisibilityState(sm) : null
  })

  const currentChordSection = $derived.by<Section | null>(() => {
    const sm = $songMap
    if (!sm) return null
    const beatId = selectedBeatId ?? chordsSelectionBeatIds[0] ?? null
    return sectionForBeatId(sm, beatId)
  })

  // ── Off-grid chords (edge case): N even chords across the focused bar ──────
  const chordEditorBar = $derived.by(() => {
    const sm = $songMap
    const bid = selectedBeatId ?? chordsSelectionBeatIds[0] ?? null
    if (!sm || !bid) return null
    const beat = sm.timeline.beats.find((b) => b.id === bid)
    return beat ? (sm.timeline.bars.find((b) => b.id === beat.barId) ?? null) : null
  })
  const chordBarDivision = $derived.by(() => {
    const sm = $songMap
    const bar = chordEditorBar
    return sm && bar ? barChordDivision(sm, bar.id) : 0
  })

  /** barId → its off-grid fraction chords (label + fraction), for the strip. */
  const chordFractionByBar = $derived.by(() => {
    const sm = $songMap
    const out: Record<string, { fraction: number; label: string }[]> = {}
    if (!sm) return out
    const key = displayedSongKey
    const preferFlats = key ? songKeyPreferFlats(key) : false
    for (const h of sm.harmony) {
      if (h.barFraction == null) continue
      const disp = transposeChordForDisplay(h.chord, transposeSemitones, key ?? undefined)
      ;(out[h.barId] ??= []).push({ fraction: h.barFraction, label: formatChordSymbol(disp, { preferFlats }) })
    }
    for (const arr of Object.values(out)) arr.sort((a, b) => a.fraction - b.fraction)
    return out
  })

  /** The SELECTED off-grid slot (mirrors selectedBeatId for the beat grid).
   *  Chord edits + delete target this slot when set. */
  let selectedFraction = $state<{ barId: string; fraction: number } | null>(null)
  /** `barId:fraction` key of the selected slot, for the strip highlight. */
  const selectedFractionKey = $derived(
    selectedFraction ? `${selectedFraction.barId}:${selectedFraction.fraction.toFixed(4)}` : null,
  )

  // Drop selection ids that no longer exist after a song change — chiefly a LIVE
  // remote edit (or a local structural edit) that removed/replaced beats or bars.
  // `$effect` writing into non-reactive selection sinks; only writes what changed.
  $effect(() => {
    const sm = $songMap
    if (!sm) return
    const changes = pruneSelections(
      sm,
      untrack(() => ({
        selectedBeatId,
        chordsSelectionBeatIds,
        sectionsSelectionBarIds,
        selectedFraction,
      })),
    )
    untrack(() => {
      if (changes.selectedBeatId !== undefined) selectedBeatId = changes.selectedBeatId
      if (changes.chordsSelectionBeatIds !== undefined) chordsSelectionBeatIds = changes.chordsSelectionBeatIds
      if (changes.sectionsSelectionBarIds !== undefined) sectionsSelectionBarIds = changes.sectionsSelectionBarIds
      if (changes.selectedFraction !== undefined) selectedFraction = changes.selectedFraction
    })
  })

  /** Single-click an off-grid slot → select it (like clicking a beat). */
  function onChordFractionSelect(detail: { barId: string; fraction: number }) {
    selectedFraction = { barId: detail.barId, fraction: detail.fraction }
    selectedBeatId = null
    chordsSelectionBeatIds = []
  }

  /** Divide (n>=2) or un-divide (n<2) the focused bar's chords. */
  function divideChordBar(n: number) {
    const bar = chordEditorBar
    if (!bar) return
    chordContextMenu = null
    patchSongMap((m) => {
      const seed = m.harmony.find((h) => h.barId === bar.id)?.chord ?? {
        root: 'C' as const,
        displayRaw: 'C',
      }
      const r = setBarChordDivision(m, bar.id, n, seed, newId)
      return r.ok ? r.map : m
    })
    selectedFraction = null
  }

  /** Strip click on a divided bar's slot → open the normal chord picker for it. */
  function onChordFractionInteract(detail: {
    barId: string
    fraction: number
    clientX: number
    clientY: number
  }) {
    selectedFraction = { barId: detail.barId, fraction: detail.fraction }
    selectedBeatId = null
    chordsSelectionBeatIds = []
    chordAnchorX = detail.clientX
    chordAnchorY = detail.clientY
    chordPickerOpen = true
  }

  // Selecting a beat clears any selected off-grid slot (and vice versa) — the
  // two selections are mutually exclusive.
  $effect(() => {
    if (selectedBeatId || chordsSelectionBeatIds.length > 0) selectedFraction = null
  })

  /** Revert the given bar's off-grid division back to normal beat chords. */
  function revertBarToBeats(barId: string) {
    patchSongMap((m) => {
      const r = setBarChordDivision(m, barId, 1, { root: 'C', displayRaw: 'C' }, newId)
      return r.ok ? r.map : m
    })
    selectedFraction = null
  }

  // Delete / Backspace clears the selection: an off-grid slot's whole division
  // reverts to beats; selected beats have their chords cleared.
  $effect(() => {
    if (!browser || editMode !== 'chords') return
    const fn = (e: KeyboardEvent) => {
      // Only skip when actually typing in a text field (the slot is a <button>,
      // so `blocksChordGlobalShortcut` would wrongly swallow Delete on it).
      const el = e.target
      if (
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      ) {
        return
      }
      if (chordPickerOpen) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedFraction) {
        e.preventDefault()
        revertBarToBeats(selectedFraction.barId)
      } else if (selectedChordTargetBeatIds().length > 0) {
        e.preventDefault()
        clearChordAtBeat()
      }
    }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  })

  const autoFinishedChordSectionIds = $derived.by(() => {
    return chordSuggestionVisibility
      ? [...chordSuggestionVisibility.coveredFromStartSectionIds]
      : ([] as string[])
  })

  const suppressedChordSectionIds = $derived.by(() => {
    const reopened = new Set(reopenedChordSectionIds)
    return new Set(
      [...finishedChordSectionIds, ...autoFinishedChordSectionIds].filter((id) => !reopened.has(id)),
    )
  })

  const currentChordSectionDone = $derived(
    currentChordSection ? suppressedChordSectionIds.has(currentChordSection.id) : false,
  )

  const chordSuggestions = $derived.by(() => {
    if (!showChordSuggestions) return new Map<string, ChordSuggestion>()
    const sm = $songMap
    if (!sm) return new Map(rawChordSuggestions)
    const filtered = new Map(rawChordSuggestions)
    for (const [beatId] of rawChordSuggestions) {
      if (chordSuggestionVisibility?.coveredBeatIds.has(beatId)) {
        filtered.delete(beatId)
        continue
      }
      const section = sectionForBeatId(sm, beatId)
      if (section && suppressedChordSectionIds.has(section.id)) filtered.delete(beatId)
    }
    return filtered
  })

  $effect(() => {
    const sm = $songMap
    if (!sm) return
    const validIds = new Set(sm.sections.map((s) => s.id))
    const nextFinished = finishedChordSectionIds.filter((id) => validIds.has(id))
    if (
      nextFinished.length !== finishedChordSectionIds.length ||
      nextFinished.some((id, index) => id !== finishedChordSectionIds[index])
    ) {
      finishedChordSectionIds = nextFinished
    }
    const nextReopened = reopenedChordSectionIds.filter((id) => validIds.has(id))
    if (
      nextReopened.length !== reopenedChordSectionIds.length ||
      nextReopened.some((id, index) => id !== reopenedChordSectionIds[index])
    ) {
      reopenedChordSectionIds = nextReopened
    }
  })

  const currentSectionSuggestionEntries = $derived.by(() => {
    const section = currentChordSection
    if (!section) return [] as Array<[string, ChordSuggestion]>
    return [...chordSuggestions.entries()].filter(
      ([, sug]) =>
        sug.barIndex >= section.barRange.startBarIndex &&
        sug.barIndex <= section.barRange.endBarIndex,
    )
  })

  /** Map shape consumed by TimelineBeatGrid for ghost rendering. */
  const chordSuggestionByBeatId = $derived.by(() => {
    const out: Record<string, { label: string; confidence: number }> = {}
    const sm = $songMap
    const key = displayedSongKey
    const preferFlats = key ? songKeyPreferFlats(key) : false
    for (const [beatId, sug] of chordSuggestions) {
      const chord = transposeChordForDisplay(sug.chord, transposeSemitones, key ?? undefined)
      out[beatId] = {
        label: formatChordSymbol(chord, { preferFlats }),
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
    const key = displayedSongKey
    return {
      primary: {
        chord: transposeChordForDisplay(sug.chord, transposeSemitones, key ?? undefined),
        confidenceLabel: label,
      },
      alternatives: sug.alternatives.map((chord) =>
        transposeChordForDisplay(chord, transposeSemitones, key ?? undefined),
      ),
    }
  })

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
    const explicitByBeat = new Map(sm.harmony.filter((h) => h.beatId).map((h) => [h.beatId!, h.chord]))
    const key = displayedSongKey
    const chords = ids.map((id, index) => {
      const chord = explicitByBeat.get(id) ?? (index === 0 ? resolved.get(id) : null)
      return chord ? transposeChordForDisplay(chord, transposeSemitones, key ?? undefined) : null
    })
    if (!chords.some(Boolean)) {
      beatEditError = 'Selection has no chord changes to copy'
      return
    }
    const text = serializeChordClipboard(chords)
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        beatEditError = ''
      })
      .catch(() => {
        beatEditError = 'Could not copy chords to the clipboard'
      })
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
    let pastedCount = 0
    for (let i = 0; i < chords.length; i++) {
      const beat = sorted[anchorIdx + i]
      if (!beat) break
      const c = chords[i]
      if (c === null) continue
      const sourceChord = transposeChordForStorage(c, transposeSemitones, sm.metadata.keyDetail)
      const out = upsertHarmonyAtBeat(map, beat.id, sourceChord, newId)
      if (!out.ok) {
        beatEditError = out.error
        return
      }
      map = out.map
      pastedCount += 1
    }
    if (pastedCount === 0) {
      beatEditError = 'Clipboard has no chord changes to paste'
      return
    }
    const p = patchSongMap(() => map)
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  function handleAcceptCurrentSectionSuggestions() {
    const sm = get(songMap)
    const section = currentChordSection
    if (!sm || !section || currentSectionSuggestionEntries.length === 0) return
    let map = sm
    for (const [beatId, suggestion] of currentSectionSuggestionEntries) {
      const out = upsertHarmonyAtBeat(map, beatId, suggestion.chord, newId)
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
      finishedChordSectionIds = [...new Set([...finishedChordSectionIds, section.id])]
      reopenedChordSectionIds = reopenedChordSectionIds.filter((id) => id !== section.id)
    }
  }

  function toggleCurrentChordSectionDone() {
    const section = currentChordSection
    if (!section) return
    if (currentChordSectionDone) {
      finishedChordSectionIds = finishedChordSectionIds.filter((id) => id !== section.id)
      reopenedChordSectionIds = [...new Set([...reopenedChordSectionIds, section.id])]
    } else {
      finishedChordSectionIds = [...finishedChordSectionIds, section.id]
      reopenedChordSectionIds = reopenedChordSectionIds.filter((id) => id !== section.id)
    }
  }

  function commitChord(chord: ChordSymbol) {
    const sm = get(songMap)
    if (!sm) return
    const sourceChord = transposeChordForStorage(chord, transposeSemitones, sm.metadata.keyDetail)
    // Off-grid slot selected → set that fraction chord and we're done.
    if (selectedFraction) {
      const p = patchSongMap((m) => setBarFractionChord(m, selectedFraction!.barId, selectedFraction!.fraction, sourceChord))
      if (!p.ok) beatEditError = p.errors.join('; ')
      else {
        beatEditError = ''
        chordPickerOpen = false
      }
      return
    }
    const targets = selectedChordTargetBeatIds()
    if (targets.length === 0) return
    let map = sm
    for (const beatId of targets) {
      const out = upsertHarmonyAtBeat(map, beatId, sourceChord, newId)
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
    // Clearing an off-grid slot reverts the whole bar back to the beat grid.
    if (selectedFraction) {
      const barId = selectedFraction.barId
      const p = patchSongMap((m) => {
        const r = setBarChordDivision(m, barId, 1, { root: 'C', displayRaw: 'C' }, newId)
        return r.ok ? r.map : m
      })
      if (!p.ok) beatEditError = p.errors.join('; ')
      else {
        beatEditError = ''
        selectedFraction = null
        chordPickerOpen = false
      }
      return
    }
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
  let chordPickerSongKey = $derived((displayedSongKey ?? $songMap?.metadata.keyDetail ?? keyDraft) as SongKey)

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
      if (!selectedBeatId && !selectedFraction) return
      if (!isChordOpenKey(e)) return
      e.preventDefault()
      chordSearchInitialQuery = e.key // jump straight into search, pre-filled
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
      const key = e.key.toLowerCase()
      if (key === 'c') {
        e.preventDefault()
        copyChordsSelection()
      } else if (key === 'v') {
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
      chordContextMenu = null
      selectedBeatId = null
      chordsSelectionBeatIds = []
    }
  })

  function onChordBeatInteract(detail: { clientX: number; clientY: number }) {
    chordContextMenu = null
    selectedFraction = null // editing a normal beat, not an off-grid slot
    chordSearchInitialQuery = '' // double-tap opens the radial view, not search
    chordAnchorX = detail.clientX
    chordAnchorY = detail.clientY
    chordPickerOpen = true
  }

  function onChordContextMenu(detail: { clientX: number; clientY: number }) {
    chordPickerOpen = false
    chordContextMenu = { x: detail.clientX, y: detail.clientY }
  }

  function chordContextMenuStyle(): string {
    if (!chordContextMenu) return ''
    const left = browser
      ? Math.max(8, Math.min(chordContextMenu.x, window.innerWidth - 216))
      : chordContextMenu.x
    const top = browser
      ? Math.max(8, Math.min(chordContextMenu.y, window.innerHeight - 300))
      : chordContextMenu.y
    return `left: ${left}px; top: ${top}px;`
  }

  function closeChordContextMenu() {
    chordContextMenu = null
  }

  function copyChordsFromContextMenu() {
    copyChordsSelection()
    closeChordContextMenu()
  }

  function pasteChordsFromContextMenu() {
    void pasteChordsFromClipboard()
    closeChordContextMenu()
  }

  function clearChordsFromContextMenu() {
    clearChordAtBeat()
    closeChordContextMenu()
  }

  function acceptSectionSuggestionsFromContextMenu() {
    handleAcceptCurrentSectionSuggestions()
    closeChordContextMenu()
  }

  function toggleSectionDoneFromContextMenu() {
    toggleCurrentChordSectionDone()
    closeChordContextMenu()
  }

  // ── Select-all + transpose the chord selection (context-menu actions) ──────
  let anyChordsPresent = $derived($songMap?.harmony?.some((h) => !!h.beatId) ?? false)

  function selectAllChordBeats() {
    const sm = get(songMap)
    if (!sm) return
    const withChords = new Set(sm.harmony.filter((h) => h.beatId).map((h) => h.beatId!))
    if (withChords.size === 0) return
    chordsSelectionBeatIds = sortBeatsByTime(sm.timeline.beats)
      .filter((b) => withChords.has(b.id))
      .map((b) => b.id)
    selectedBeatId = null
  }

  /**
   * Transpose the STORED chords at the selected beats by `delta` semitones — a
   * real edit to the chord data (distinct from the display-only global
   * transpose). Chords are re-spelled for the key `delta` semitones away.
   */
  function transposeSelectedChords(delta: number) {
    const sm = get(songMap)
    if (!sm) return
    const ids = new Set(selectedChordTargetBeatIds())
    if (ids.size === 0) return
    const shiftedKey = sm.metadata.keyDetail ? transposeSongKey(sm.metadata.keyDetail, delta) : null
    const preferFlats = shiftedKey ? songKeyPreferFlats(shiftedKey) : false
    let changed = false
    const p = patchSongMap((m) => ({
      ...m,
      harmony: m.harmony.map((h) => {
        if (!h.beatId || !ids.has(h.beatId)) return h
        changed = true
        return { ...h, chord: transposeChord(h.chord, delta, preferFlats) }
      }),
    }))
    if (!changed) {
      beatEditError = 'Selection has no chords to transpose'
      return
    }
    beatEditError = p.ok ? '' : p.errors.join('; ')
  }

  function selectAllChordsFromContextMenu() {
    selectAllChordBeats()
    // Keep the menu open so the fresh selection can be transposed right away.
  }

  function transposeSelectedFromContextMenu(delta: number) {
    transposeSelectedChords(delta)
    // Keep the menu open for repeated ± nudges.
  }

  /** Drag-move: shift the selected chords by `delta` beats (timeline order). */
  function onChordsMove(detail: { delta: number }) {
    const sm = get(songMap)
    if (!sm || detail.delta === 0) return
    const sorted = sortBeatsByTime(sm.timeline.beats)
    const idToIndex = new Map(sorted.map((b, i) => [b.id, i]))
    const targets = selectedChordTargetBeatIds()
    if (targets.length === 0) return
    const explicitByBeat = new Map(sm.harmony.filter((h) => h.beatId).map((h) => [h.beatId!, h.chord]))
    const moves: Array<{ from: string; to: string; chord: (typeof sm.harmony)[number]['chord'] }> = []
    for (const beatId of targets) {
      const chord = explicitByBeat.get(beatId)
      if (!chord) continue
      const idx = idToIndex.get(beatId)
      if (idx == null) continue
      const targetIdx = idx + detail.delta
      if (targetIdx < 0 || targetIdx >= sorted.length) return // out of bounds — abort the whole move
      moves.push({ from: beatId, to: sorted[targetIdx].id, chord })
    }
    if (moves.length === 0) return
    // Clear all sources first, then place at targets — avoids self-collision
    // within the moving selection.
    let map = sm
    for (const m of moves) map = clearHarmonyAtBeat(map, m.from)
    for (const m of moves) {
      const out = upsertHarmonyAtBeat(map, m.to, m.chord, newId)
      if (!out.ok) {
        beatEditError = out.error
        return
      }
      map = out.map
    }
    const p = patchSongMap(() => map)
    if (!p.ok) {
      beatEditError = p.errors.join('; ')
      return
    }
    beatEditError = ''
    chordsSelectionBeatIds = moves.map((m) => m.to)
    selectedBeatId = null
  }

  /**
   * Section navigator: copy a source section's chords onto a target section's
   * bars, aligned by position within the section (source bar N → target bar N)
   * and beat-in-bar, overwriting the target's existing chords. Great for a
   * repeated part — fill verse 2 from verse 1 in one click.
   */
  function onSectionFill(detail: { targetSectionId: string; sourceSectionId: string }) {
    const sm = get(songMap)
    if (!sm) return
    const src = sm.sections.find((s) => s.id === detail.sourceSectionId)
    const tgt = sm.sections.find((s) => s.id === detail.targetSectionId)
    if (!src || !tgt) return
    const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]))
    const beatById = new Map(sm.timeline.beats.map((b) => [b.id, b]))
    const sectionBars = (startIdx: number, endIdx: number) => {
      const out: typeof sm.timeline.bars = []
      for (let i = startIdx; i <= endIdx; i++) {
        const b = barByIndex.get(i)
        if (b) out.push(b)
      }
      return out
    }
    const srcBars = sectionBars(src.barRange.startBarIndex, src.barRange.endBarIndex)
    const tgtBars = sectionBars(tgt.barRange.startBarIndex, tgt.barRange.endBarIndex)
    if (srcBars.length === 0 || tgtBars.length === 0) return
    const srcRelByBarId = new Map(srcBars.map((b, i) => [b.id, i]))
    const tgtBeatIds = new Set(tgtBars.flatMap((b) => b.beatIds))
    let map = sm
    // 1) clear the target section's existing chords (overwrite)
    for (const h of sm.harmony) {
      if (h.beatId && tgtBeatIds.has(h.beatId)) map = clearHarmonyAtBeat(map, h.beatId)
    }
    // 2) copy each source chord to the target's matching bar + beat-in-bar
    let placed = 0
    for (const h of sm.harmony) {
      if (!h.barId || !h.beatId) continue
      const rel = srcRelByBarId.get(h.barId)
      if (rel == null) continue
      const beat = beatById.get(h.beatId)
      const tgtBar = tgtBars[rel]
      if (!beat || !tgtBar) continue
      const tgtBeatId = tgtBar.beatIds[beat.indexInBar] ?? tgtBar.beatIds[0]
      if (!tgtBeatId) continue
      const out = upsertHarmonyAtBeat(map, tgtBeatId, h.chord, newId)
      if (!out.ok) {
        beatEditError = out.error
        return
      }
      map = out.map
      placed++
    }
    if (placed === 0) {
      beatEditError = 'That section has no chords to copy'
      return
    }
    const p = patchSongMap(() => map)
    if (!p.ok) {
      beatEditError = p.errors.join('; ')
      return
    }
    beatEditError = ''
  }

  $effect(() => {
    if (!browser || !chordContextMenu) return
    const close = () => {
      chordContextMenu = null
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  })

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

  /** Chord-sheet import dialog (opened from the chords tab). */
  let sheetImportOpen = $state(false)

  // ── Chord inspector (debug): the stored truth, row by row ────────────────
  // Lets the user verify what's IN the song against what the grid draws —
  // when placement looks wrong, this splits "bad data" from "bad rendering".
  let chordInspectorOpen = $state(false)
  /** beatId → origin from the LAST import in this session (plan-only info). */
  let lastImportOrigins = $state<Map<string, string>>(new Map())
  const chordInspectorRows = $derived.by(() => {
    const sm = $songMap
    if (!sm) return []
    const beatsById = new Map(sm.timeline.beats.map((b) => [b.id, b]))
    const barsById = new Map(sm.timeline.bars.map((b) => [b.id, b]))
    return [...sm.harmony]
      .sort((a, b) => a.startSec - b.startSec)
      .map((h) => {
        const beat = h.beatId ? beatsById.get(h.beatId) : undefined
        const bar = beat ? barsById.get(beat.barId) : undefined
        const origin = h.beatId ? lastImportOrigins.get(h.beatId) : undefined
        return {
          id: h.id,
          symbol: h.chord.displayRaw,
          barIndex: bar?.index ?? null,
          beatInBar: beat ? beat.indexInBar + 1 : null,
          timeSec: beat?.timeSec ?? h.startSec,
          origin:
            origin === 'word'
              ? 'from a sung word'
              : origin === 'estimated'
                ? 'estimated'
                : origin === 'spread'
                  ? 'filled in'
                  : '',
        }
      })
  })

  function formatInspectorTime(t: number): string {
    const m = Math.floor(t / 60)
    const s = t - m * 60
    return `${m}:${s.toFixed(2).padStart(5, '0')}`
  }

  let chordInspectorCopied = $state(false)
  async function copyChordInspector() {
    const header = '#\tbar.beat\ttime\tchord\tplaced'
    const lines = chordInspectorRows.map(
      (r, i) =>
        `${i + 1}\t${r.barIndex !== null ? `${r.barIndex + 1}.${r.beatInBar}` : '—'}\t${formatInspectorTime(r.timeSec)}\t${r.symbol}\t${r.origin}`,
    )
    const text = [`draft: ${activeDraftLabel} · ${chordInspectorRows.length} chords`, header, ...lines].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      chordInspectorCopied = true
      setTimeout(() => (chordInspectorCopied = false), 2000)
    } catch {
      /* clipboard unavailable — selection copy still works */
    }
  }

  // ── "Import chord sheet" (Chords tab): its own paste box, independent of
  // the lyrics. Sheet lyric lines fuzzy-match against the stored fitted
  // lyrics, so a lazy UG sheet (skipped repeats, "Chorus x2") still anchors.
  let chordSheetDraft = $state('')
  const chordSheetParsed = $derived(parseChordSheet(chordSheetDraft))
  let chordsPlaceBusy = $state(false)
  let chordsPlaceMsg = $state('')
  let chordsPlaceErr = $state('')

  function placeChordsFromSheet() {
    if (chordsPlaceBusy) return
    chordsPlaceErr = ''
    chordsPlaceMsg = ''
    const sm = get(songMap)
    if (!sm) return
    const sheet = parseChordSheet(chordSheetDraft)
    // Chords onto the grid, sections derived from where they landed, both as
    // one draft — see `importAsDraft.ts` for why that order is load-bearing.
    const prep = prepareSheetImport(sheet, sm, newId)
    if (!prep.ok) {
      chordsPlaceErr = prep.error
      return
    }
    const hadChords = sm.harmony.length > 0
    const hadSections = sm.sections.length > 0
    chordsPlaceBusy = true
    try {
      beginPatchBatch()
      try {
        const addedSections = prep.prepared.sections.length

        // Never destroy existing work: the current sections, chords and lyrics
        // are preserved as a draft you can switch back to.
        const applyRes = patchSongMap((m) => applySheetImport(m, prep.prepared, newId))
        if (!applyRes.ok) {
          chordsPlaceErr = applyRes.errors.join('; ')
          return
        }
        lastImportOrigins = new Map(prep.prepared.plan.placements.map((p) => [p.beatId, p.origin]))
        const { stats } = prep.prepared.plan
        const parts = [`Placed ${stats.placed} chord${stats.placed === 1 ? '' : 's'}`]
        if (stats.estimated > 0) parts.push(`${stats.estimated} by estimate`)
        if (stats.collisions > 0) parts.push(`${stats.collisions} overlapped`)
        if (stats.unplaceable > 0) parts.push(`${stats.unplaceable} skipped`)
        chordsPlaceMsg =
          parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')}).` : `${parts[0]}.`
        if (stats.totalLines > 0) {
          chordsPlaceMsg += ` Matched ${stats.matchedLines} of ${stats.totalLines} sheet lines to your lyrics.`
        }
        if (addedSections > 0) {
          chordsPlaceMsg += ` Added ${addedSections} section${addedSections === 1 ? '' : 's'}.`
        }
        chordsPlaceMsg += ` This is now the “${activeDraftLabel}” draft.`
        if (hadChords || hadSections) {
          chordsPlaceMsg += ' Your previous version is kept as its own draft — switch back any time.'
        }
      } finally {
        endPatchBatch()
      }
    } finally {
      chordsPlaceBusy = false
    }
  }
</script>


{#if $songMap}
  {@const sm = $songMap}
  <!-- Height-filling column: the Edit-timeline surface grows to FILL the
       workspace; the grid-only History + Metronome controls sit below as
       compact, non-growing rows so nothing pushes the page into a scroll. -->
  <div class="flex h-full min-h-0 w-full flex-1 flex-col gap-3">
    {#if editMode === 'grid' || editMode === 'sections' || editMode === 'chords'}
      <section class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto" aria-label="Edit timeline">
        <EditSectionToolbar title={timelineToolbarTitle} helpText={timelineToolbarHelp}>
          {#snippet primary()}
            <span class="font-mono tabular-nums">{sm.timeline.bars.length} bars</span>
            <span class="font-mono tabular-nums">{sm.timeline.beats.length} beats</span>
            {#if editMode === 'sections' || editMode === 'chords'}
              <span class="text-muted-foreground">{activeDraftLabel}</span>
            {/if}
          {/snippet}
        </EditSectionToolbar>
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
          <!-- ── Chords toolbar: one row instead of three stacked blocks.
               Drafts moved up next to the song title — they cover chords,
               sections AND lyrics, so they don't belong to one tab. ── -->
          <EditSectionToolbar
            title="Chord controls"
            compact
            helpText="Suggestions can be accepted for the selected section or hidden once the section is finished."
          >
            {#snippet primary()}
              <Button
                variant="outline"
                size="sm"
                class="h-7 border-2 px-2 text-xs font-bold"
                onclick={() => (sheetImportOpen = true)}
                title="Paste a chord sheet — its chords and sections land as a new draft"
              >
                Sheet
              </Button>

              <Button
                variant="outline"
                size="sm"
                class="h-7 border-2 px-2 text-xs font-bold {chordInspectorOpen ? 'bg-foreground text-background' : ''}"
                onclick={() => (chordInspectorOpen = !chordInspectorOpen)}
                title="Show every stored chord with its exact bar, beat and time — for checking what you see against what's saved"
              >
                Inspect
              </Button>

              <!-- Auto-fill: a low-frequency helper. Show a small icon ONLY when a
                   suggestion is available; clicking expands the banner in place. -->
              {#if activeAutoFill}
                <Button
                  variant="outline"
                  size="icon"
                  class="size-7 border-2 {showAutoFill ? 'bg-foreground text-background' : ''}"
                  onclick={() => (showAutoFill = !showAutoFill)}
                  aria-pressed={showAutoFill}
                  title="A chord auto-fill suggestion is available — copy chords from a matching section"
                  aria-label="Chord auto-fill suggestion"
                >
                  <Wand2 class="size-3.5" aria-hidden="true" />
                </Button>
              {/if}

              <span class="border-foreground/30 mx-1 h-5 border-l" aria-hidden="true"></span>

              <label class="inline-flex items-center gap-2 font-bold">
                <input type="checkbox" bind:checked={showChordSuggestions} class="accent-foreground size-3.5" />
                Suggestions
              </label>
              <span class="text-muted-foreground">
                {currentChordSection
                  ? sectionDisplayLabel(currentChordSection)
                  : 'Select a beat in a section'}
              </span>
              {#if currentChordSection && currentChordSectionDone}
                <span class="text-muted-foreground font-mono text-[10px] font-bold uppercase">done</span>
              {/if}
              <button
                type="button"
                class="text-foreground disabled:text-muted-foreground underline-offset-2 hover:underline disabled:no-underline"
                onclick={handleAcceptCurrentSectionSuggestions}
                disabled={!currentChordSection || currentSectionSuggestionEntries.length === 0}
                title="Write every visible suggestion in the selected section"
              >
                Use section suggestions ({currentSectionSuggestionEntries.length})
              </button>
              <button
                type="button"
                class="text-foreground disabled:text-muted-foreground underline-offset-2 hover:underline disabled:no-underline"
                onclick={toggleCurrentChordSectionDone}
                disabled={!currentChordSection}
                title={currentChordSectionDone
                  ? 'Show chord suggestions in this section again'
                  : 'Hide chord suggestions in this section'}
              >
                {currentChordSectionDone ? 'Show section suggestions' : 'Finish section'}
              </button>
            {/snippet}
          </EditSectionToolbar>
          {#if chordsPlaceErr || chordsPlaceMsg || draftMsg}
            <p
              class="mb-3 px-1 text-xs {chordsPlaceErr ? 'text-destructive' : 'text-muted-foreground'}"
              role="status"
            >
              {chordsPlaceErr || chordsPlaceMsg || draftMsg}
            </p>
          {/if}

          {#if chordInspectorOpen}
            <!-- The stored truth, row by row: compare against the grid/waveform.
                 Bar and beat are 1-based here to match what a musician counts. -->
            <div class="border-foreground/15 mb-3 border text-xs">
              <div class="border-foreground/15 text-muted-foreground flex flex-wrap items-center gap-x-3 border-b px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider">
                <span>Stored chords · {chordInspectorRows.length}</span>
                <span>draft: {activeDraftLabel}</span>
                <span class="normal-case">bar.beat is 1-based · time is the beat’s position in the song audio</span>
                <button
                  type="button"
                  class="border-foreground hover:bg-foreground hover:text-background ml-auto border px-1.5 py-0.5 normal-case"
                  onclick={() => void copyChordInspector()}
                >
                  {chordInspectorCopied ? 'Copied ✓' : 'Copy all'}
                </button>
              </div>
              <div class="max-h-64 overflow-auto">
                <table class="w-full font-mono text-[11px] tabular-nums">
                  <thead>
                    <tr class="text-muted-foreground text-left">
                      <th class="px-2 py-0.5 font-bold">#</th>
                      <th class="px-2 py-0.5 font-bold">bar.beat</th>
                      <th class="px-2 py-0.5 font-bold">time</th>
                      <th class="px-2 py-0.5 font-bold">chord</th>
                      <th class="px-2 py-0.5 font-bold">placed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each chordInspectorRows as row, ri (row.id)}
                      <tr class="odd:bg-muted/40">
                        <td class="text-muted-foreground px-2 py-0.5">{ri + 1}</td>
                        <td class="px-2 py-0.5">
                          {row.barIndex !== null ? `${row.barIndex + 1}.${row.beatInBar}` : '—'}
                        </td>
                        <td class="px-2 py-0.5">{formatInspectorTime(row.timeSec)}</td>
                        <td class="px-2 py-0.5 font-bold">{row.symbol}</td>
                        <td class="text-muted-foreground px-2 py-0.5">{row.origin}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                {#if chordInspectorRows.length === 0}
                  <p class="text-muted-foreground px-2 py-2 italic">No chords on the active track.</p>
                {/if}
              </div>
            </div>
          {/if}


          <!-- Collapsed by default; the Wand toggle in the toolbar expands it in
               place. Only mounts when open AND a suggestion exists, so it takes
               near-zero vertical space the rest of the time. -->
          {#if showAutoFill && activeAutoFill}
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
          {/if}
          <div data-song-key-picker>
            <EditSectionToolbar
              title="Song key"
              compact
              secondaryVisible={!!((showKeyHint && detectedKey) ||
                chordChromaStatus === 'analyzing' ||
                chordChromaStatus === 'installing' ||
                (chordChromaStatus === 'error' && chordChromaError))}
              helpText="Set the source song key used for display, transposed labels, suggestions, and exports. Detection is only a helper; the saved key is what matters."
            >
              {#snippet primary()}
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
              {/snippet}
              {#snippet secondary()}
                {#if showKeyHint && detectedKey}
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
                {:else if chordChromaStatus === 'analyzing' || chordChromaStatus === 'installing'}
                  <span class="text-muted-foreground text-xs italic">
                    ✨ {chordChromaStatus === 'installing'
                      ? 'Installing harmony analyzer...'
                      : 'Analyzing harmony to suggest a key...'}
                  </span>
                {:else if chordChromaStatus === 'error' && chordChromaError}
                  <span class="text-destructive text-xs">⚠ Key detection failed: {chordChromaError}</span>
                  <button
                    type="button"
                    class="border-destructive ml-auto border-2 px-2 py-0.5 text-[11px] font-bold"
                    onclick={() => onRetryChroma()}
                  >
                    Retry
                  </button>
                {/if}
              {/snippet}
            </EditSectionToolbar>
          </div>
        {/if}
        <WaveformPlayer
          file={$audioSession.file}
          bind:rangeStart
          bind:rangeEnd
          onSelectionCommit={handleTrimCommit}
          bind:ready={waveformReady}
          variant="editor"
          hideTransportButtons

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
          onAudioDecoded={(buf) => patchSongMap((m) => ensureAudioFingerprint(m, buf))}
          sectionsInstallProgress={sectionsInstallProgress}
          bind:sectionsSelectionBarIds
          bind:chordsSelectionBeatIds
          chordLabelByBeatId={chordLabelByBeatId}
          currentChordLabelByBeatId={playbackChordLabelByBeatId}
          chordSuggestionByBeatId={chordSuggestionByBeatId}
          bind:selectedBeatId
          onChordBeatInteract={onChordBeatInteract}
          onChordFractionSelect={onChordFractionSelect}
          onChordFractionInteract={onChordFractionInteract}
          chordFractionByBar={chordFractionByBar}
          selectedFractionKey={selectedFractionKey}
          onChordContextMenu={onChordContextMenu}
          onChordsMove={onChordsMove}
          onSectionFill={onSectionFill}
          bind:audioElement={audioElement}
          playbackAudioBufferOverride={playbackAudioBufferOverride}
          countInTicks={editMode === 'grid' ? countInTicksForGrid : []}
          songStartBarIndex={songStartBarIndex}
          onSetStartBar={editMode === 'grid' ? setStartBar : undefined}
          controller={playbackController}
        />
        {#if beatEditError}
          <p class="text-destructive mt-2 text-xs" role="status">{beatEditError}</p>
        {/if}
      </section>
      <!-- Radial menu stays outside container ancestors for stable fixed-position clientX/Y alignment. -->
      {#if editMode === 'chords' && $songMap}
        {#if chordContextMenu}
          <div
            class="bg-popover text-popover-foreground border-foreground/15 fixed z-[90] w-52 rounded-[var(--radius)] border p-1 text-sm shadow-lg"
            style={chordContextMenuStyle()}
            role="menu"
            tabindex="-1"
            aria-label="Chord actions"
            onpointerdown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              class="hover:bg-muted flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left disabled:opacity-40"
              role="menuitem"
              disabled={selectedChordTargetBeatIds().length === 0}
              onclick={copyChordsFromContextMenu}
            >
              <span>Copy chords</span>
              <span class="text-muted-foreground font-mono text-[10px]">Ctrl/⌘C</span>
            </button>
            <button
              type="button"
              class="hover:bg-muted flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left disabled:opacity-40"
              role="menuitem"
              disabled={!chordPasteAnchorBeatId()}
              onclick={pasteChordsFromContextMenu}
            >
              <span>Paste chords here</span>
              <span class="text-muted-foreground font-mono text-[10px]">Ctrl/⌘V</span>
            </button>
            <button
              type="button"
              class="hover:bg-muted w-full rounded-[var(--radius)] px-2 py-1.5 text-left disabled:opacity-40"
              role="menuitem"
              disabled={selectedChordTargetBeatIds().length === 0}
              onclick={clearChordsFromContextMenu}
            >
              Clear selected chords
            </button>
            <div class="bg-border/70 my-1 h-px"></div>
            <button
              type="button"
              class="hover:bg-muted flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left disabled:opacity-40"
              role="menuitem"
              disabled={!anyChordsPresent}
              onclick={selectAllChordsFromContextMenu}
            >
              <span>Select all chords</span>
              {#if selectedChordTargetBeatIds().length > 0}
                <span class="text-muted-foreground font-mono text-[10px]">
                  {selectedChordTargetBeatIds().length}
                </span>
              {/if}
            </button>
            <div class="bg-border/70 my-1 h-px"></div>
            <div class="text-muted-foreground px-2 pt-1 text-[10px] font-bold uppercase tracking-wide">
              {chordEditorBar ? `Bar ${chordEditorBar.index + 1}: chords across bar` : 'Chords across bar'}
            </div>
            <div class="flex items-center gap-1 px-2 pb-1.5 pt-1">
              {#each [1, 3, 5, 6] as n (n)}
                <button
                  type="button"
                  role="menuitem"
                  class="flex-1 rounded-[var(--radius)] border px-1.5 py-1 text-xs font-bold disabled:opacity-40 {(n === 1
                    ? chordBarDivision === 0
                    : chordBarDivision === n)
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-foreground/30 hover:bg-muted'}"
                  disabled={!chordEditorBar}
                  onclick={() => divideChordBar(n)}
                  title={n === 1 ? 'Chords on the beat (normal)' : `${n} chords evenly across this bar`}
                >
                  {n === 1 ? 'Beats' : `÷${n}`}
                </button>
              {/each}
            </div>
            <div class="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5">
              <span class={selectedChordTargetBeatIds().length === 0 ? 'opacity-40' : ''}>
                Transpose selected
              </span>
              <span class="inline-flex items-center gap-1">
                <button
                  type="button"
                  class="border-foreground/30 hover:bg-foreground hover:text-background inline-flex size-6 items-center justify-center rounded-[var(--radius)] border font-mono text-sm font-black leading-none disabled:opacity-40"
                  role="menuitem"
                  disabled={selectedChordTargetBeatIds().length === 0}
                  onclick={() => transposeSelectedFromContextMenu(-1)}
                  aria-label="Transpose selected chords down a semitone"
                  title="Down a semitone"
                >
                  −
                </button>
                <button
                  type="button"
                  class="border-foreground/30 hover:bg-foreground hover:text-background inline-flex size-6 items-center justify-center rounded-[var(--radius)] border font-mono text-sm font-black leading-none disabled:opacity-40"
                  role="menuitem"
                  disabled={selectedChordTargetBeatIds().length === 0}
                  onclick={() => transposeSelectedFromContextMenu(1)}
                  aria-label="Transpose selected chords up a semitone"
                  title="Up a semitone"
                >
                  +
                </button>
              </span>
            </div>
            <div class="bg-border/70 my-1 h-px"></div>
            <button
              type="button"
              class="hover:bg-muted w-full rounded-[var(--radius)] px-2 py-1.5 text-left disabled:opacity-40"
              role="menuitem"
              disabled={!currentChordSection || currentSectionSuggestionEntries.length === 0}
              onclick={acceptSectionSuggestionsFromContextMenu}
            >
              Use section suggestions ({currentSectionSuggestionEntries.length})
            </button>
            <button
              type="button"
              class="hover:bg-muted w-full rounded-[var(--radius)] px-2 py-1.5 text-left disabled:opacity-40"
              role="menuitem"
              disabled={!currentChordSection}
              onclick={toggleSectionDoneFromContextMenu}
            >
              {currentChordSectionDone ? 'Show section suggestions' : 'Finish section'}
            </button>
          </div>
        {/if}
        <ChordRadialQuickSelect
          bind:open={chordPickerOpen}
          anchorX={chordAnchorX}
          anchorY={chordAnchorY}
          songKey={chordPickerSongKey}
          selectedBeatId={selectedBeatId}
          suggestion={activeBeatSuggestion}
          initialSearchQuery={chordSearchInitialQuery}
          onCommit={commitChord}
          onClearChord={clearChordAtBeat}
        />
      {/if}
    {/if}
    {#if editMode === 'grid' && sm.timeline.beats.length > 0}
      <section class="w-full shrink-0" aria-label="Edit history">
        <EditSectionToolbar
          title="History"
          compact
          helpText="Cmd/Ctrl+Z undoes timeline edits. Hold Shift to redo. Reset restores the saved analyzed grid; re-analyze detects bars and beats again from the current audio."
        >
          {#snippet primary()}
            <button
              type="button"
              onclick={undoSongMap}
              disabled={!$canUndo}
              title="Undo (Cmd/Ctrl+Z)"
              class="border-foreground hover:bg-foreground hover:text-background disabled:opacity-40 disabled:hover:bg-background disabled:hover:text-foreground border-2 px-3 py-1 text-sm font-bold"
            >
              Undo
            </button>
            <button
              type="button"
              onclick={redoSongMap}
              disabled={!$canRedo}
              title="Redo (Cmd/Ctrl+Shift+Z)"
              class="border-foreground hover:bg-foreground hover:text-background disabled:opacity-40 disabled:hover:bg-background disabled:hover:text-foreground border-2 px-3 py-1 text-sm font-bold"
            >
              Redo
            </button>
            <span class="text-muted-foreground mx-1 text-xs">·</span>
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
                Erases ALL bar and beat edits.
              </span>
            {:else}
              <button
                type="button"
                onclick={startResetGridConfirm}
                disabled={resetGridDisabled}
                title={sm.timeline.original
                  ? 'Restore to the originally analyzed grid'
                  : 'Re-analyze the song to enable. Old projects don’t have a snapshot of the analyzed grid.'}
                class="border-foreground hover:bg-foreground hover:text-background disabled:opacity-40 disabled:hover:bg-background disabled:hover:text-foreground border-2 px-3 py-1 text-sm"
              >
                Reset to analyzed
              </button>
              <button
                type="button"
                onclick={reanalyzeGrid}
                disabled={reanalyzeBusy || !$audioSession.file}
                title="Detect bars and beats again. You’ll be warned before chords or sections are cleared."
                class="border-foreground hover:bg-foreground hover:text-background disabled:opacity-40 disabled:hover:bg-background disabled:hover:text-foreground border-2 px-3 py-1 text-sm"
              >
                {reanalyzeBusy ? 'Re-analyzing...' : 'Re-analyze grid'}
              </button>
            {/if}
          {/snippet}
        </EditSectionToolbar>
        {#if reanalyzeError}
          <p class="text-destructive mt-2 text-xs" role="status">{reanalyzeError}</p>
        {/if}
      </section>
    {/if}
    {#if editMode === 'grid' && sm.timeline.beats.length > 0}
      <section class="w-full shrink-0" aria-label="Metronome">
        <EditSectionToolbar
          title="Metronome"
          compact
          helpText="Count-in adds clicks before playback starts. Start at beat sets the song-start anchor; moving it later lets earlier beats play under the count-in, for example a drum fill before the downbeat."
        />

        <!-- Compact two-up strip so the metronome controls don't eat height. -->
        <div class="flex flex-col gap-2 sm:flex-row">
        <fieldset class="border-foreground/15 min-w-0 flex-1 rounded-[var(--radius)] border px-2.5 py-1.5">
          <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Count-in beats</legend>
          <div class="flex flex-wrap gap-3 pt-0.5">
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
          <p class="text-muted-foreground mt-1 font-mono text-xs tabular-nums" role="status">
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

        <fieldset class="border-foreground/15 min-w-0 flex-1 rounded-[var(--radius)] border px-2.5 py-1.5">
          <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Start at beat</legend>
          <div class="flex flex-wrap items-center gap-3 pt-0.5">
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
        </fieldset>
        </div>

        <!-- "Play with click" toggle + Click / Song volume sliders
             moved to a compact strip directly under the WaveformPlayer
             where the play button lives. See the grid-mode toolbar
             block above. -->
      </section>
    {/if}
    <!-- Import a chord sheet. The import lands as a new draft; the draft
         switcher lives next to the song title. -->
    <Dialog open={sheetImportOpen} onOpenChange={(v: boolean) => (sheetImportOpen = v)}>
      <DialogContent class="flex max-w-2xl flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Layers class="size-4" aria-hidden="true" />
            Import chord sheet
          </DialogTitle>
          <DialogDescription>
            The sheet's chords and sections land together as a new draft. Your current
            draft is kept — switch back from the draft picker by the song title.
          </DialogDescription>
        </DialogHeader>

        <div class="border-foreground bg-muted flex flex-wrap items-center gap-2 border-2 px-2 py-1.5 text-xs">
          <span class="border-foreground bg-foreground text-background border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase">Now editing</span>
          <span class="font-bold">{activeDraftLabel}</span>
          <span class="text-muted-foreground">
            {$songMap?.harmony.length ?? 0} chords · {$songMap?.sections.length ?? 0} sections
          </span>
        </div>

        <textarea
          bind:value={chordSheetDraft}
          rows="8"
          placeholder={'Paste a chord sheet (chords above the words, Ultimate Guitar style).\nFor instrumental lines, (x2) repeats the line and | pipes | group chords into one bar.'}
          class="border-foreground bg-background max-h-[35vh] w-full resize-y border-2 px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none"
          spellcheck="false"
        ></textarea>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span class="text-muted-foreground">
            {#if chordSheetParsed.chordCount > 0}
              Detected {chordSheetParsed.chordCount} chords in
              {chordSheetParsed.sections.length} section{chordSheetParsed.sections.length === 1 ? '' : 's'}.
            {:else if chordSheetDraft.trim()}
              No chord lines detected yet — is this a chords-over-lyrics sheet?
            {:else}
              Works best after the lyrics are fitted to the song.
            {/if}
          </span>
        </div>
        {#if chordsPlaceErr}
          <p class="text-destructive text-xs">{chordsPlaceErr}</p>
        {/if}
        {#if chordsPlaceMsg}
          <p class="text-muted-foreground text-xs" role="status">{chordsPlaceMsg}</p>
        {/if}
        <DialogFooter class="gap-2">
          <Button variant="outline" class="border-2 text-xs font-bold" onclick={() => (sheetImportOpen = false)}>
            Close
          </Button>
          <Button
            class="border-2 text-xs font-bold"
            onclick={placeChordsFromSheet}
            disabled={chordsPlaceBusy || chordSheetParsed.chordCount === 0}
          >
            {chordsPlaceBusy ? 'Placing…' : 'Place chords on the grid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
{/if}
