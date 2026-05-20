<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import WaveformPlayer from '$lib/components/WaveformPlayer.svelte'
  import MixerView from '$lib/components/MixerView.svelte'
  import LeadSheet from '$lib/components/LeadSheet.svelte'
  import SectionSuggestionBanner from '$lib/components/SectionSuggestionBanner.svelte'
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
  import { predictNextSection } from '$lib/sections/predictNext'
  import { applyBarGridAction, type BarGridAction } from '$lib/songmap/timelineEdit'
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
   * Suggestion lifecycle:
   *   - `predictNextSection` is purely derived from `$songMap` — it re-fires
   *     whenever sections / bars change.
   *   - Dismissals are local: the user clicking ✕ records the suggestion's
   *     signature (`kind:bars:lastEnd`). The derived `nextSectionSuggestion`
   *     filters out anything matching the dismissed sig, so the same
   *     suggestion doesn't reappear until the song state changes.
   *   - Accepting auto-clears `dismissedSuggestionSig` for the next round.
   */
  let dismissedSuggestionSig = $state<string | null>(null)

  function suggestionSig(sm: SongMap | null, sug: { kind: string; bars: number } | null): string | null {
    if (!sm || !sug || sm.sections.length === 0) return null
    const lastEnd = Math.max(...sm.sections.map((s) => s.barRange.endBarIndex))
    return `${sug.kind}:${sug.bars}:${lastEnd}`
  }

  const nextSectionSuggestion = $derived.by(() => {
    const sm = $songMap
    if (!sm) return null
    const raw = predictNextSection(sm)
    if (!raw) return null
    const sig = suggestionSig(sm, raw)
    if (sig && sig === dismissedSuggestionSig) return null
    return raw
  })

  /** Inline ghost preview on the bar strip — same range that Accept would tag. */
  const sectionSuggestionPreview = $derived.by(() => {
    const sm = $songMap
    const sug = nextSectionSuggestion
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
    const sug = nextSectionSuggestion
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
      dismissedSuggestionSig = null
    }
  }

  function handleDismissSectionSuggestion() {
    const sm = get(songMap)
    const sug = nextSectionSuggestion
    if (!sm || !sug) return
    dismissedSuggestionSig = suggestionSig(sm, sug)
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

  let clickWithSongActive = $state(false)
  let clickPoints = $state<{ timeSec: number; downbeat: boolean }[]>([])
  let clickLoopRaf = 0
  let nextClickIdx = 0
  let clickCtx: AudioContext | undefined
  let clickMaster: GainNode | undefined

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
      clickWithSongActive = false
      mixPreviewUrl = null
      stopPreviewLoop()
      stopClickLoop()
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
    g.gain.value = 1
    g.connect(ctx.destination)
    clickCtx = ctx
    clickMaster = g
  }

  function stopClickLoop() {
    if (clickLoopRaf) cancelAnimationFrame(clickLoopRaf)
    clickLoopRaf = 0
  }

  function syncNextClickIndex(t: number) {
    nextClickIdx = clickPoints.findIndex((b) => b.timeSec >= t - 0.018)
    if (nextClickIdx < 0) nextClickIdx = clickPoints.length
  }

  function runClickLoop() {
    const el = audioEl
    const ctx = clickCtx
    const dest = clickMaster
    if (!el || !ctx || !dest || !clickWithSongActive || el.paused) {
      stopClickLoop()
      return
    }

    const t = el.currentTime
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0

    while (nextClickIdx < clickPoints.length && clickPoints[nextClickIdx]!.timeSec <= t + 0.025) {
      const pt = clickPoints[nextClickIdx]!
      playMetronomeClick(ctx, dest, ctx.currentTime + 0.002, pt.downbeat)
      nextClickIdx++
    }

    if (dur > 0 && t >= dur - 0.04) {
      el.pause()
      clickWithSongActive = false
      stopClickLoop()
      return
    }

    clickLoopRaf = requestAnimationFrame(runClickLoop)
  }

  function startClickLoopFromCurrentTime() {
    if (!clickWithSongActive || !audioEl) return
    ensureClickGraph()
    void clickCtx?.resume()
    syncNextClickIndex(audioEl.currentTime)
    stopClickLoop()
    clickLoopRaf = requestAnimationFrame(runClickLoop)
  }

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
    clickWithSongActive = false
    stopClickLoop()
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

  async function toggleSongWithClick() {
    const sm = get(songMap)
    const el = audioEl
    if (!el || !objectUrl || !sm?.timeline.beats.length) return

    pauseMixPreview()

    ensureClickGraph()
    await clickCtx!.resume()

    if (clickWithSongActive) {
      if (!el.paused) {
        el.pause()
        stopClickLoop()
        return
      }
      try {
        await el.play()
      } catch {
        /* ignore */
      }
      return
    }

    stopPreviewLoop()
    preview = null
    playingBarId = null

    clickPoints = beatsToClickPoints(sm.timeline.beats)
    clickWithSongActive = true
    el.currentTime = 0
    syncNextClickIndex(0)
    try {
      await el.play()
    } catch {
      clickWithSongActive = false
      stopClickLoop()
    }
  }

  function onAudioPlay() {
    if (clickWithSongActive) startClickLoopFromCurrentTime()
  }

  function onAudioPause() {
    if (!preview) stopPreviewLoop()
    if (clickWithSongActive) stopClickLoop()
  }

  function onAudioEnded() {
    if (clickWithSongActive) {
      clickWithSongActive = false
      stopClickLoop()
    }
  }

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

    clickWithSongActive = false
    stopClickLoop()
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

  // Cue tab: derive current count-in selection from saved cues, compute result reactively
  let cueCountInBeats = $derived.by(() => {
    const sm = $songMap
    if (!sm) return 0
    return sm.cues.mode === 'countIn' ? sm.cues.countInBeats : 0
  })

  let cueCountInResult = $derived.by(() => {
    const sm = $songMap
    if (!sm || cueCountInBeats === 0) return null
    return computeCountIn(sm, cueCountInBeats)
  })

  function applyCueCountIn(beats: number) {
    const sm = get(songMap)
    if (!sm) return
    const result = beats > 0 ? computeCountIn(sm, beats) : null
    const p = patchSongMap((m) => ({
      ...m,
      cues: {
        ...m.cues,
        mode: beats > 0 ? 'countIn' : 'off',
        countInBeats: beats,
        prependSec: result?.prependSec,
      },
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

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

      // The cueTrackExport record only tracks the cue file (the one with
      // speech). The click file lives next to it and is discovered by the
      // sidecar's project info scan — no separate manifest entry needed.
      const p = patchSongMap((m) => ({
        ...m,
        cueTrackExport: {
          fingerprint: fp,
          durationSec: dur,
          sampleRate: 44100,
          generatedAt: now,
          relativePath: cueRelativePath,
        },
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
      if (sm.cues.mode === 'countIn' && sm.cues.countInBeats > 0) {
        const ci = computeCountIn(sm, sm.cues.countInBeats)
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
    stopClickLoop()
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
            <span class="underline-offset-2 group-open:underline">About count-in</span>
          </summary>
          <p class="mt-2 leading-relaxed">
            Set how many click beats before bar 1. Prepend is how much silence to add before stems in the
            DAW so everything lines up. The cue WAV leaves a short head at the top for the spoken title, then
            count-in clicks and numbers (pickup beats in the map are not double-clicked). Count numbers are rendered
            slightly fast so they sit tighter on the grid.
          </p>
        </details>

        <div class="space-y-4">
          <fieldset class="border-foreground border-2 px-3 py-3">
            <legend class="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Count-in beats</legend>
            <div class="flex flex-wrap gap-3 pt-1">
              {#each [0, 4, 8] as n (n)}
                <label class="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="countInBeats"
                    value={n}
                    checked={cueCountInBeats === n}
                    onchange={() => applyCueCountIn(n)}
                    class="accent-foreground"
                  />
                  {n === 0 ? 'Off' : `${n} beats`}
                </label>
              {/each}
            </div>
          </fieldset>

          {#if cueCountInBeats > 0}
            <dl class="border-foreground border-2 px-3 py-3 font-mono text-xs">
              <div class="flex justify-between gap-4 py-0.5">
                <dt class="text-muted-foreground">First downbeat (in trimmed audio)</dt>
                <dd class="tabular-nums">
                  {#if cueCountInResult}
                    {cueCountInResult.effectiveFirstDownbeatSec.toFixed(3)} s
                  {:else}
                    —
                  {/if}
                </dd>
              </div>
              <div class="flex justify-between gap-4 py-0.5">
                <dt class="text-muted-foreground">Beat duration</dt>
                <dd class="tabular-nums">
                  {#if cueCountInResult}
                    {cueCountInResult.beatDurationSec.toFixed(3)} s ({(60 / cueCountInResult.beatDurationSec).toFixed(1)} BPM)
                  {:else}
                    —
                  {/if}
                </dd>
              </div>
              <div class="flex justify-between gap-4 border-t border-foreground/20 pt-1 mt-1">
                <dt class="text-foreground font-medium">Prepend before file start</dt>
                <dd class="tabular-nums font-medium">
                  {#if cueCountInResult}
                    {cueCountInResult.prependSec.toFixed(3)} s
                  {:else}
                    —
                  {/if}
                </dd>
              </div>
            </dl>
          {/if}

          <div class="border-foreground space-y-3 border-2 px-3 py-3">
            <h3 class="text-muted-foreground text-xs font-medium uppercase tracking-wide">Cue track (click)</h3>
            <p class="text-muted-foreground text-xs leading-relaxed">
              Mono WAV, prepend + trim. Regenerate after trim/grid/count-in changes; <span class="font-mono">cue/</span> may overwrite.
            </p>
            {#if cueGenErr}
              <p class="text-destructive text-xs" role="status">{cueGenErr}</p>
            {/if}
            {#if cueSpeechNote}
              <p class="text-muted-foreground text-xs" role="status">{cueSpeechNote}</p>
            {/if}
            {#if $songMap?.cueTrackExport}
              <p class="text-muted-foreground font-mono text-xs" role="status">
                Last: {$songMap.cueTrackExport.durationSec.toFixed(3)} s @ {$songMap.cueTrackExport.sampleRate} Hz
                {#if $songMap.cueTrackExport.relativePath}
                  · {$songMap.cueTrackExport.relativePath}
                {/if}
              </p>
            {/if}
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                class=""
                disabled={cueGenBusy || !cueRenderGate.ok}
                title={!cueRenderGate.ok ? cueRenderGate.reason : undefined}
                onclick={() => void generateCueTrackWav()}
              >
                {cueGenBusy ? 'Rendering…' : 'Generate cue + click tracks'}
              </Button>
              <Button type="button" class="" variant="outline" disabled={!lastCueDownloadBlob} onclick={downloadCueTrackFile}>
                Download cue.wav
              </Button>
              <Button type="button" class="" variant="outline" disabled={!lastClickDownloadBlob} onclick={downloadClickTrackFile}>
                Download click.wav
              </Button>
            </div>
          </div>

          <div class="border-foreground flex flex-col gap-2 border-2 px-3 py-3">
            <p class="text-muted-foreground text-xs">Song + cue (mono). Optional extra clicks — off if cue already clicks.</p>
            {#if mixPreviewErr}
              <p class="text-destructive text-xs" role="status">{mixPreviewErr}</p>
            {:else if !mixPreviewGate.ok}
              <p class="text-muted-foreground text-xs" role="status">{mixPreviewGate.reason}</p>
            {/if}
            <label class="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" bind:checked={mixPreviewClickOverlay} class="accent-foreground shrink-0" />
              Extra clicks
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                class=""
                variant="secondary"
                disabled={cueGenBusy || mixPreviewBusy || !mixPreviewGate.ok}
                title={!mixPreviewGate.ok ? mixPreviewGate.reason : undefined}
                onclick={() => void prepareMixPreview()}
              >
                {mixPreviewBusy ? '…' : 'Build preview'}
              </Button>
            </div>
            {#if mixPreviewUrl}
              <audio
                bind:this={mixPreviewAudioEl}
                class="mt-1 w-full max-w-lg"
                controls
                src={mixPreviewUrl}
                onplay={onMixPreviewPlay}
                onpause={onMixPreviewPause}
                onended={onMixPreviewEnded}
              ></audio>
            {/if}
          </div>

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
            suggestion={nextSectionSuggestion}
            onAccept={handleAcceptSectionSuggestion}
          />
        {/if}
        {#if editMode === 'chords'}
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
          bind:sectionsSelectionBarIds
          bind:chordsSelectionBeatIds
          chordLabelByBeatId={chordLabelByBeatId}
          bind:selectedBeatId
          onChordBeatInteract={onChordBeatInteract}
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
          onCommit={commitChord}
          onClearChord={clearChordAtBeat}
        />
      {/if}
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

        {#if sm.timeline.beats.length > 0}
          <div>
            <p class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Transport (debug)</p>
            <Button
              type="button"
              variant="secondary"
              class="gap-2"
              disabled={!$audioSession.file || !objectUrl}
              title="Play the full clip with a metronome click on every beat (accent on bar downbeats)"
              onclick={toggleSongWithClick}
            >
              {#if clickWithSongActive && audioEl && !audioEl.paused}
                <Pause class="size-4" aria-hidden="true" />
                Pause song + click
              {:else if clickWithSongActive && audioEl?.paused}
                <Play class="size-4" aria-hidden="true" />
                Resume song + click
              {:else}
                <Play class="size-4" aria-hidden="true" />
                Play song + click track
              {/if}
            </Button>
            <p class="text-muted-foreground mt-2 text-[11px] leading-relaxed">
              Clicks follow detected beats: louder / higher = downbeat (beat 1 of each bar), softer = other beats.
            </p>
          </div>
        {/if}

        <p class="text-foreground/90 font-mono text-xs tabular-nums">
          {$audioSession.name}<br />
          <span class="text-muted-foreground">
            {$audioSession.startSec.toFixed(2)}s to {$audioSession.endSec.toFixed(2)}s
          </span>
        </p>

        {#if objectUrl}
          <audio
            bind:this={audioEl}
            src={objectUrl}
            class="sr-only"
            preload="auto"
            onplay={onAudioPlay}
            onpause={onAudioPause}
            onended={onAudioEnded}
          ></audio>
        {/if}
      </div>
    </details>

    <Button type="button" variant="outline" class="gap-2 self-start" onclick={confirmBackToImport}>
      <ArrowLeft class="size-4" aria-hidden="true" />
      Back to import
    </Button>
  {/if}
</main>
