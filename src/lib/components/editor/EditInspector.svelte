<script lang="ts">
  /**
   * Shell-owned CONTEXTUAL INSPECTOR for the Song Edit DAW layout.
   *
   * This is chrome, not an editor: it renders read-only, at-a-glance facts about
   * the current song + mode, derived purely from the `.smap` (`songMap`) and the
   * shell's cross-tab display state (transpose-aware key label, active draft,
   * chord-analysis status). The DEEP editing controls live in the mode's editor
   * component (TimelineWorkspace, CueEditor, LyricsEditor, MixerPanel, …); this
   * rail summarises the selection/mode and links attention to where the real
   * controls are. Nothing here mutates the song.
   *
   * Mirrors the approved version-2 "inspector IDE" prototype: a fixed mode
   * header, then song metadata + key/transpose, then mode-appropriate secondary
   * info, then a per-mode help footer.
   */
  import HelpHint from '$lib/components/HelpHint.svelte'
  import { inspectorPortal } from '$lib/components/editor/inspectorPortal.svelte'
  import { songMap } from '$lib/stores/songMap'
  import { audioSession } from '$lib/stores/audioSession'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import { formatTime } from '$lib/audio/formatTime'
  import { formatTransposeLabel } from '$lib/songmap/transposition'
  import {
    SlidersHorizontal,
    Grid3x3,
    Layers,
    Music,
    Megaphone,
    Type,
    ScrollText,
    Info,
    Check,
    Clock,
    RefreshCw,
    Music2,
    Tag,
    Palette,
    Hash,
  } from '@lucide/svelte'

  type EditMode = 'overview' | 'grid' | 'sections' | 'chords' | 'cue' | 'lyrics' | 'leadsheet'
  type ChromaStatus =
    | 'idle'
    | 'installing'
    | 'analyzing'
    | 'ready'
    | 'cached'
    | 'error'
    | 'unavailable'

  let {
    editMode,
    keyLabel = null,
    transposeSemitones = 0,
    activeDraftLabel = '',
    chordChromaStatus = 'idle',
  }: {
    editMode: EditMode
    keyLabel?: string | null
    transposeSemitones?: number
    activeDraftLabel?: string
    chordChromaStatus?: ChromaStatus
  } = $props()

  const MODE_ICON: Record<EditMode, typeof Grid3x3> = {
    overview: SlidersHorizontal,
    grid: Grid3x3,
    sections: Layers,
    chords: Music,
    cue: Megaphone,
    lyrics: Type,
    leadsheet: ScrollText,
  }
  const MODE_LABEL: Record<EditMode, string> = {
    overview: 'Overview',
    grid: 'Grid',
    sections: 'Sections',
    chords: 'Chords',
    cue: 'Cue',
    lyrics: 'Lyrics',
    leadsheet: 'Lead sheet',
  }
  const HeadIcon = $derived(MODE_ICON[editMode])

  const MODE_HELP: Record<EditMode, string> = {
    overview:
      'Every source and generated track is a lane in the mixer. Volume, mute and solo save with the song and stay aligned for playback and export.',
    grid: 'Bars and beats drive everything downstream. Select a bar in the grid to split, merge or change its beat count; the count-in and song-start anchor live there too.',
    sections:
      'Tag stretches of the song as intro / verse / chorus. Colours match the waveform bands, the pads and the exported setlist.',
    chords:
      'Place a chord on beat 1 of any bar. Harmony analysis proposes chords per section that you can accept in the grid.',
    cue: 'Per section, toggle a spoken cue and/or a count-in. Auto-generate reads each section name just before it starts.',
    lyrics:
      'Lyrics belong to the current draft. Save stores the text; fitting each word to the audio is a separate, optional step.',
    leadsheet:
      'A read-only performance view of the saved song map — sections, chords, key and timing. Print or export without touching the underlying data.',
  }

  // ── Derived song facts (read-only, straight from the .smap) ──────────────
  const sm = $derived($songMap)
  const barCount = $derived(sm?.timeline.bars.length ?? 0)
  const beatCount = $derived(sm?.timeline.beats.length ?? 0)
  const sectionCount = $derived(sm?.sections.length ?? 0)
  const chordCount = $derived(sm?.harmony.length ?? 0)
  const meterLabel = $derived.by(() => {
    const m = sm?.timeline.bars[0]?.meter
    return m ? `${m.numerator}/${m.denominator}` : '—'
  })
  const durationSec = $derived(
    sm?.audio?.durationSec ?? Math.max(0, $audioSession.endSec - $audioSession.startSec),
  )
  const bpmLabel = $derived(sm?.metadata.bpm != null ? `${Math.round(sm.metadata.bpm)} BPM` : '— BPM')
  const countInBeats = $derived(sm?.countInBeats ?? 0)
  const lyricWords = $derived(sm?.lyrics?.words ?? [])
  const lyricLineCount = $derived(
    sm?.lyrics?.sourceText
      ? sm.lyrics.sourceText.split('\n').filter((l) => l.trim().length > 0).length
      : new Set(lyricWords.map((w) => w.line)).size,
  )
  const lyricsAligned = $derived(!!sm?.lyrics?.alignedAt)
  const cueEnabledCount = $derived(
    (sm?.cueTracks ?? []).reduce((n, t) => n + t.events.filter((e) => e.enabled).length, 0),
  )
  const cueTotalCount = $derived(
    (sm?.cueTracks ?? []).reduce((n, t) => n + t.events.length, 0),
  )
  const spokenCountIn = $derived((sm?.cueTracks ?? []).some((t) => t.spokenCountIn))
  const cueVoice = $derived((sm?.cueTracks ?? []).find((t) => t.voiceId)?.voiceId ?? null)
  const sectionLegend = $derived(
    (sm?.sections ?? []).map((s) => ({
      id: s.id,
      label: s.label || s.kind,
      kind: s.kind,
      color: sectionKindColor(s.kind),
      from: s.barRange.startBarIndex + 1,
      to: s.barRange.endBarIndex + 1,
    })),
  )
  const updatedLabel = $derived.by(() => {
    const iso = sm?.metadata.updatedAt
    if (!iso) return null
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return null
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  })

  const chromaLabel = $derived.by(() => {
    switch (chordChromaStatus) {
      case 'installing':
        return 'Preparing analysis…'
      case 'analyzing':
        return 'Analyzing harmony…'
      case 'ready':
      case 'cached':
        return 'Analyzed'
      case 'error':
        return 'Analysis failed'
      case 'unavailable':
        return 'Desktop needed'
      default:
        return 'Not analyzed yet'
    }
  })
  const chromaBusy = $derived(chordChromaStatus === 'analyzing' || chordChromaStatus === 'installing')
</script>

<!-- ═══════════════ reusable inspector primitives ═══════════════ -->

{#snippet insHead(text: string)}
  <div
    class="border-foreground/12 text-muted-foreground flex items-center gap-1.5 border-b px-3 pt-3 pb-1.5 text-[10px] font-black uppercase tracking-widest"
  >
    {text}
  </div>
{/snippet}

{#snippet row(label: string, value: string, mono = true)}
  <div class="flex items-baseline justify-between gap-3 px-3 py-[3px]">
    <span class="text-muted-foreground shrink-0 text-[11px]">{label}</span>
    <span class="truncate text-right text-xs font-bold {mono ? 'font-mono tabular-nums' : ''}">{value}</span>
  </div>
{/snippet}

{#snippet chip(color: string, size = 'size-3')}
  <span class="{size} shrink-0 rounded-[2px] ring-1 ring-foreground/25" style="background-color: {color}"></span>
{/snippet}

{#snippet note(text: string)}
  <div class="text-muted-foreground flex items-start gap-2 px-3 py-2 text-[11px] leading-relaxed">
    <Info class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
    <span>{text}</span>
  </div>
{/snippet}

{#snippet keyTranspose()}
  {@render insHead('Key & transpose')}
  <div class="flex items-center gap-2 px-3 py-2">
    <span
      class="border-foreground bg-background inline-flex items-center rounded-[var(--radius)] border px-2 py-1 font-mono text-xs font-bold"
    >
      {keyLabel ?? '— key'}
    </span>
    <span class="text-muted-foreground text-[11px]">display</span>
    <span
      class="border-foreground/30 bg-background ml-auto inline-flex items-center gap-1 rounded-[var(--radius)] border px-2 py-0.5 font-mono text-[11px] font-black tabular-nums"
      title="Personal, local-only display transpose"
    >
      {formatTransposeLabel(transposeSemitones)}
    </span>
  </div>
  {#if transposeSemitones !== 0}
    {@render note('Chords and key are transposed for display only — a personal, local overlay. It never changes the shared song or the audio.')}
  {/if}
{/snippet}

<!-- ═══════════════ inspector body ═══════════════ -->

<div class="edit-inspector flex h-full min-h-0 w-full flex-col">
  <!-- mode header — same corner on every mode -->
  <div class="border-foreground/12 flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
    <HeadIcon class="size-4 shrink-0" aria-hidden="true" />
    <span class="text-xs font-black uppercase tracking-widest">{MODE_LABEL[editMode]}</span>
    <span class="text-muted-foreground ml-auto font-mono text-[10px] uppercase">Inspector</span>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if sm}
      <!-- ───── OVERVIEW: song metadata + key/transpose + draft ───── -->
      {#if editMode === 'overview'}
        {@render insHead('Song')}
        {@render row('Title', sm.metadata.title || 'Untitled song', false)}
        {@render row('Artist', sm.metadata.artist || '—', false)}
        {@render row('Tempo', bpmLabel)}
        {@render row('Time signature', meterLabel)}
        {@render row('Duration', formatTime(durationSec))}
        {@render row('Bars / sections', `${barCount} / ${sectionCount}`)}
        {@render keyTranspose()}
        {@render insHead('Draft')}
        {@render row('Active', activeDraftLabel || 'Main', false)}
        {#if updatedLabel}{@render row('Updated', updatedLabel)}{/if}
      {/if}

      <!-- ───── GRID: bar/beat facts + count-in ───── -->
      {#if editMode === 'grid'}
        {@render insHead('Timeline')}
        {@render row('Bars', String(barCount))}
        {@render row('Beats', String(beatCount))}
        {@render row('Meter', meterLabel)}
        {@render row('Tempo', bpmLabel)}
        {@render row('Duration', formatTime(durationSec))}
        {@render insHead('Count-in & song start')}
        {@render row('Count-in', countInBeats > 0 ? `${countInBeats} beats` : 'Off')}
        {@render row('Spoken count-in', spokenCountIn ? 'On' : 'Off')}
        {@render note('Select a bar in the grid to split, merge or change its beats. Undo / redo apply here (Cmd/Ctrl+Z).')}
      {/if}

      <!-- ───── SECTIONS: arrangement summary + colour legend ───── -->
      {#if editMode === 'sections'}
        {@render insHead('Arrangement')}
        {@render row('Sections', String(sectionCount))}
        {@render row('Bars', String(barCount))}
        {@render row('Duration', formatTime(durationSec))}
        {@render insHead('Sections')}
        <div class="flex flex-col gap-1 px-3 py-2">
          {#each sectionLegend as s (s.id)}
            <div class="flex items-center gap-2">
              {@render chip(s.color, 'size-3')}
              <span class="truncate text-[11px] font-bold uppercase tracking-wide">{s.label}</span>
              <span class="text-muted-foreground ml-auto font-mono text-[10px] tabular-nums">{s.from}–{s.to}</span>
            </div>
          {/each}
          {#if sectionLegend.length === 0}
            <span class="text-muted-foreground text-[11px]">No sections yet — tag bars in the grid.</span>
          {/if}
        </div>
      {/if}

      <!-- ───── CHORDS: portalled edit controls + key/transpose + analysis ───── -->
      {#if editMode === 'chords'}
        <!-- Deep chord controls + song-key picker, DEFINED in TimelineWorkspace
             (so they keep its state/handlers) but rendered here in the rail. -->
        {#if inspectorPortal.extra}
          {@const Extra = inspectorPortal.extra}
          <div class="px-3 pt-2">
            {@render Extra()}
          </div>
        {/if}
        {@render keyTranspose()}
        {@render insHead('Chords')}
        {@render row('Chords placed', String(chordCount))}
        {@render row('Bars', String(barCount))}
        {@render insHead('Harmony analysis')}
        <div class="flex items-center gap-2 px-3 py-2">
          <RefreshCw class="text-muted-foreground size-3.5 {chromaBusy ? 'animate-spin' : ''}" aria-hidden="true" />
          <span class="text-xs font-bold">{chromaLabel}</span>
        </div>
        {@render note('Analysis proposes a chord per section from the audio. Accept suggestions on a bar in the grid.')}
      {/if}

      <!-- ───── CUE: spoken cues + voice ───── -->
      {#if editMode === 'cue'}
        {@render insHead('Cues')}
        {@render row('Spoken cues', `${cueEnabledCount} / ${cueTotalCount}`)}
        {@render row('Count-in', countInBeats > 0 ? `${countInBeats} beats` : 'Off')}
        {@render row('Spoken count-in', spokenCountIn ? 'On' : 'Off')}
        {#if cueVoice}{@render row('Voice', cueVoice)}{/if}
        {@render note('Each spoken cue is read a set number of beats before its section begins. Toggle cues and auto-generate in the cue editor.')}
      {/if}

      <!-- ───── LYRICS: draft + alignment status ───── -->
      {#if editMode === 'lyrics'}
        {@render insHead('Lyrics')}
        {@render row('Draft', activeDraftLabel || 'Main', false)}
        {@render row('Lines', String(lyricLineCount))}
        {@render row('Words', String(lyricWords.length))}
        <div class="flex items-center gap-2 px-3 py-2">
          {#if lyricsAligned}
            <Check class="size-3.5 text-[color:var(--studio-orange)]" aria-hidden="true" />
            <span class="text-xs font-bold">Fitted to song</span>
          {:else}
            <Clock class="text-muted-foreground size-3.5" aria-hidden="true" />
            <span class="text-xs font-bold">Not fitted yet</span>
          {/if}
        </div>
        {@render note('Lyrics belong to the current draft. Paste text in the editor, then optionally fit each word to the audio.')}
      {/if}

      <!-- ───── LEAD SHEET: read-only chart facts + colours ───── -->
      {#if editMode === 'leadsheet'}
        {@render insHead('Lead sheet')}
        {@render row('Key', keyLabel ?? '—')}
        {@render row('Tempo', bpmLabel)}
        {@render row('Time signature', meterLabel)}
        {@render row('Sections', String(sectionCount))}
        {@render row('Bars', String(barCount))}
        {@render insHead('Section colours')}
        <div class="grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-2">
          {#each sectionLegend as s (s.id)}
            <div class="flex items-center gap-1.5">
              {@render chip(s.color, 'size-2.5')}
              <span class="truncate text-[11px] font-bold">{s.label}</span>
            </div>
          {/each}
        </div>
        {@render note('A read-only performance chart derived from the saved song map. Print or export from the lead-sheet panel.')}
      {/if}
    {/if}
  </div>

  <!-- per-mode help footer — always last, same place every mode -->
  <div class="border-foreground/12 flex shrink-0 items-center gap-1.5 border-t px-3 py-2.5">
    <span class="text-muted-foreground flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
      {#if editMode === 'overview'}<SlidersHorizontal class="size-3.5" aria-hidden="true" />Mixer{/if}
      {#if editMode === 'grid'}<Hash class="size-3.5" aria-hidden="true" />Bars &amp; beats{/if}
      {#if editMode === 'sections'}<Tag class="size-3.5" aria-hidden="true" />Sections{/if}
      {#if editMode === 'chords'}<Music2 class="size-3.5" aria-hidden="true" />Chords{/if}
      {#if editMode === 'cue'}<Megaphone class="size-3.5" aria-hidden="true" />Cues{/if}
      {#if editMode === 'lyrics'}<Type class="size-3.5" aria-hidden="true" />Lyrics{/if}
      {#if editMode === 'leadsheet'}<Palette class="size-3.5" aria-hidden="true" />Chart{/if}
    </span>
    <HelpHint class="ml-auto" side="left" label={`${MODE_LABEL[editMode]} help`} text={MODE_HELP[editMode]} />
  </div>
</div>

<style>
  /* Cards inside the brutalist frame pick up the panel fill (matches /edit). */
  .edit-inspector :global(.border-2.border-foreground.bg-card) {
    background: var(--card);
  }
</style>
