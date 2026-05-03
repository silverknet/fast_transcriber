<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import WaveformPlayer from '$lib/components/WaveformPlayer.svelte'
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
  import { beatsToClickPoints, playMetronomeClick } from '$lib/audio/debugClickTrack'
  import { newId } from '$lib/songmap/factory'
  import { clearHarmonyAtBeat, upsertHarmonyAtBeat } from '$lib/songmap/harmonyEdit'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import { setSectionForBarRange } from '$lib/songmap/sectionEdit'
  import { applyBarGridAction, type BarGridAction } from '$lib/songmap/timelineEdit'
  import type { Accidental, Bar, ChordSymbol, NoteName, SectionKind, SongKey } from '$lib/songmap/types'
  import { clearFullAppSongState } from '$lib/stores/restorableSong'
  import { audioSession } from '$lib/stores/audioSession'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { ArrowLeft, Music, Pause, Play } from '@lucide/svelte'

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

  function handleApplySectionTag(kind: SectionKind) {
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
    const out = setSectionForBarRange(sm, start, end, kind, newId)
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
  let editMode = $state<'grid' | 'sections' | 'chords'>('grid')

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
    const file = $audioSession.file
    if (!file) {
      objectUrl = null
      playingBarId = null
      preview = null
      clickWithSongActive = false
      stopPreviewLoop()
      stopClickLoop()
      audioEl?.pause()
      return
    }
    const url = URL.createObjectURL(file)
    objectUrl = url
    return () => {
      stopPreviewLoop()
      stopClickLoop()
      audioEl?.pause()
      URL.revokeObjectURL(url)
    }
  })

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

  async function toggleSongWithClick() {
    const sm = get(songMap)
    const el = audioEl
    if (!el || !objectUrl || !sm?.timeline.beats.length) return

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

  onDestroy(() => {
    stopPreviewLoop()
    stopClickLoop()
    audioEl?.pause()
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
          <p class="text-muted-foreground mt-0.5 text-sm">
            {sm.metadata.title}
            <span class="text-muted-foreground/80 font-mono text-xs tabular-nums">
              · {sm.metadata.bpm != null ? `${Math.round(sm.metadata.bpm)} BPM` : '— BPM'}
            </span>
          </p>
        </div>
      </div>

      <div
        class="border-foreground bg-muted inline-grid grid-cols-3 gap-0 self-start overflow-hidden border-2 sm:self-auto"
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
      </div>
    </header>

    {#if editMode === 'grid' || editMode === 'sections' || editMode === 'chords'}
      <section
        class="brutalist-shadow border-foreground bg-background w-full border-2 p-3 sm:p-4 md:p-5"
        aria-label="Edit timeline"
      >
        {#if editMode === 'grid'}
          <p class="text-muted-foreground mb-3 text-xs leading-relaxed sm:mb-4">
            Edit bars and beats in the strip above the waveform (equal spacing per bar). Add or remove bars at the ends of
            the timeline; wheel on the strip changes beats per bar when a bar is selected.
          </p>
        {:else if editMode === 'sections'}
          <p class="text-muted-foreground mb-3 text-xs leading-relaxed sm:mb-4">
            Drag across the bar strip to select a range, or Shift+click / ⌘/Ctrl+click. Section colors and names match
            tags below. Choose a type and tag the selection; overlapping ranges are replaced. Zoom is shared with Grid.
          </p>
        {:else}
          <p class="text-muted-foreground mb-3 text-xs leading-relaxed sm:mb-4">
            Drag across the chord strip or Shift+click / ⌘/Ctrl+click to select beats. Click a beat (no modifiers) for the radial
            menu: common chords are one tap; hover or tap a category for more; hold a chord ~1s for slash bass; Search for
            anything else. ⌘/Ctrl+C copies the resolved (sounding) chord on each selected beat;
            ⌘/Ctrl+V pastes in order starting at the earliest selected beat. Only beats with an explicit chord show a
            label—later beats inherit until the next change. Song key drives spelling and families, not transposition: harmony
            is stored as absolute chord symbols.
          </p>
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
