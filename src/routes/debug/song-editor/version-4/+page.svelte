<script lang="ts">
  /**
   * Song Editor design prototype — VERSION 4: "Aligned-lane arrangement".
   *
   * A read-only DAW arrangement view. The whole song is a vertical stack of
   * horizontally TIME-ALIGNED lanes that share ONE ruler, zoom and scroll (a
   * single page-owned viewport, `viewStart`/`viewEnd`). A fixed left lane-header
   * column names each lane and holds its per-lane controls. The seven /edit
   * "tabs" become "which lane is focused" — the focused lane doubles in height
   * and exposes its inline editing tools.
   *
   * Everything is derived from the shared realistic fixture (a real SongMap).
   * Nothing here mutates the song; controls are visual only. Not shipped.
   */
  import type { Snippet } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import HelpHint from '$lib/components/HelpHint.svelte'
  import DebugSharedWaveform from '$lib/components/DebugSharedWaveform.svelte'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import {
    meta,
    sectionRows,
    barCells,
    lyricLines,
    waveformSections,
    mixerLanes,
    cueRows,
    EDIT_TABS,
    DURATION_SEC,
    fmtTime,
    type EditTabId,
  } from '$lib/debug/songEditorFixture'
  import {
    AudioWaveform,
    LayoutGrid,
    Rows3,
    Music,
    Type,
    Megaphone,
    SlidersHorizontal,
    ScrollText,
    Play,
    Square,
    Repeat1,
    RotateCcw,
    ZoomIn,
    ZoomOut,
    Maximize2,
    Eye,
    EyeOff,
    Layers,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    Plus,
    Flag,
    CornerDownRight,
  } from '@lucide/svelte'

  // ── Lane identity ─────────────────────────────────────────────────────
  const LANE_ICON: Record<EditTabId, typeof Music> = {
    overview: SlidersHorizontal,
    grid: LayoutGrid,
    sections: Rows3,
    chords: Music,
    cue: Megaphone,
    lyrics: Type,
    leadsheet: ScrollText,
  }
  const LANE_SUB: Record<EditTabId, string> = {
    overview: 'stems & levels',
    grid: 'bars & beats',
    sections: 'song structure',
    chords: 'chord per bar',
    cue: 'spoken markers',
    lyrics: 'timed phrases',
    leadsheet: 'read-only chart',
  }

  // ── Shared, page-owned viewport (seconds) — every lane projects from it ──
  const secPerBar = DURATION_SEC / meta.bars
  const MIN_WINDOW = 1.5
  // Start on a legible ~32-bar window (pre-chorus → chorus → verse 2) so the
  // aligned chords / lyrics / cues read immediately. Zoom out for the overview.
  let viewStart = $state(+(24 * secPerBar).toFixed(3))
  let viewEnd = $state(+(56 * secPerBar).toFixed(3))
  let playheadSec = $state(+(DURATION_SEC * 0.27).toFixed(3))

  // ── Focus + per-lane visibility (the "tabs" of this design) ───────────
  let focus = $state<EditTabId>('sections')
  const isFocus = (id: EditTabId) => focus === id
  const setFocus = (id: EditTabId) => (focus = id)

  let hidden = $state<Record<string, boolean>>({})
  const isHidden = (id: string) => !!hidden[id]
  const toggleHide = (id: string) => (hidden[id] = !hidden[id])

  // Stem levels — local copy so mute/solo toggles feel alive (visual only).
  let stems = $state(mixerLanes.map((l) => ({ ...l })))

  // ── Projection helpers (all reactive on the viewport) ─────────────────
  const win = $derived(Math.max(0.001, viewEnd - viewStart))
  const barsVisible = $derived(win / secPerBar)
  const xPct = (sec: number) => ((sec - viewStart) / win) * 100
  const inView = (a: number, b: number) => b > viewStart && a < viewEnd
  const clampL = (sec: number) => Math.max(viewStart, sec)
  const clampR = (sec: number) => Math.min(viewEnd, sec)

  const rulerStep = $derived(barsVisible > 64 ? 8 : barsVisible > 32 ? 4 : barsVisible > 12 ? 2 : 1)
  const showBeats = $derived(barsVisible <= 20)
  const showChords = $derived(barsVisible <= 56)

  const playheadInView = $derived(playheadSec >= viewStart && playheadSec <= viewEnd)
  const playheadBar = $derived(Math.min(meta.bars, Math.floor(playheadSec / secPerBar) + 1))
  const viewBarFrom = $derived(Math.floor(viewStart / secPerBar) + 1)
  const viewBarTo = $derived(Math.min(meta.bars, Math.ceil(viewEnd / secPerBar)))

  // Lyric phrase spans (each line runs until the next line begins).
  const lyricSpans = $derived(
    lyricLines.map((l, i) => ({
      ...l,
      endSec: lyricLines[i + 1]?.startSec ?? l.startSec + secPerBar * 2,
    })),
  )

  // ── Viewport actions (identical clamp to the shared waveform) ─────────
  function clampWin(a: number, b: number): [number, number] {
    let lo = a
    let hi = b
    if (hi - lo < MIN_WINDOW) hi = lo + MIN_WINDOW
    if (lo < 0) {
      hi -= lo
      lo = 0
    }
    if (hi > DURATION_SEC) {
      lo -= hi - DURATION_SEC
      hi = DURATION_SEC
    }
    return [Math.max(0, lo), Math.min(DURATION_SEC, hi)]
  }
  function zoomBy(f: number) {
    const c = (viewStart + viewEnd) / 2
    const w = win * f
    ;[viewStart, viewEnd] = clampWin(c - w / 2, c + w / 2)
  }
  const zoomIn = () => zoomBy(0.6)
  const zoomOut = () => zoomBy(1 / 0.6)
  const fitAll = () => ([viewStart, viewEnd] = [0, DURATION_SEC])

  // ── Ruler = the navigation surface (click / arrow keys seek playhead) ──
  function seek(e: MouseEvent) {
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const f = (e.clientX - r.left) / r.width
    playheadSec = +Math.max(0, Math.min(DURATION_SEC, viewStart + f * win)).toFixed(3)
  }
  function rulerKey(e: KeyboardEvent) {
    const beat = secPerBar / 4
    if (e.key === 'ArrowLeft') playheadSec = Math.max(0, playheadSec - beat)
    else if (e.key === 'ArrowRight') playheadSec = Math.min(DURATION_SEC, playheadSec + beat)
    else if (e.key === 'Home') playheadSec = 0
    else if (e.key === 'End') playheadSec = DURATION_SEC
    else return
    e.preventDefault()
  }

  // ── Deterministic mini-waveform (per stem), sampled across the viewport ──
  function peakFn(sec: number, seed: number): number {
    const s = Math.sin(sec * 0.8 + seed * 1.7) * Math.sin(sec * 0.19 + seed * 0.6 + 1.1)
    const env = 0.35 + 0.65 * Math.abs(Math.sin(sec * 0.045 + seed * 0.2))
    return Math.max(0.08, Math.min(1, 0.12 + 0.9 * Math.abs(s) * env))
  }
  function areaPath(seed: number, n = 130): string {
    const w = 1000
    const mid = 50
    const amp = 40
    const top: string[] = []
    const bot: string[] = []
    for (let i = 0; i < n; i++) {
      const sec = viewStart + (i / (n - 1)) * win
      const a = peakFn(sec, seed)
      const x = ((i / (n - 1)) * w).toFixed(1)
      top.push(`${x},${(mid - a * amp).toFixed(1)}`)
      bot.push(`${x},${(mid + a * amp).toFixed(1)}`)
    }
    return `M${top.join(' L')} L${bot.reverse().join(' L')} Z`
  }

  const SECTION_KINDS: string[] = ['intro', 'verse', 'preChorus', 'chorus', 'bridge', 'outro']
  const dbToFrac = (db: number) => Math.max(0, Math.min(1, (db + 24) / 24))
</script>

<svelte:head>
  <title>Song Editor · v4 Aligned lanes — BarBro lab</title>
</svelte:head>

<!-- ── Shared snippets ──────────────────────────────────────────────── -->

{#snippet ph()}
  {#if playheadInView}
    <div class="ph" style:left="{xPct(playheadSec)}%"></div>
  {/if}
{/snippet}

{#snippet sectionTint(alpha: number)}
  {#each sectionRows as s (s.id)}
    {@const a = (s.fromBar - 1) * secPerBar}
    {@const b = s.toBar * secPerBar}
    {#if inView(a, b)}
      <div
        class="tint"
        style:left="{xPct(clampL(a))}%"
        style:width="{xPct(clampR(b)) - xPct(clampL(a))}%"
        style:background={s.color}
        style:opacity={alpha}
      ></div>
    {/if}
  {/each}
{/snippet}

{#snippet hdr(id: EditTabId, controls?: Snippet)}
  {@const Icon = LANE_ICON[id]}
  <div class="lane-hdr {isFocus(id) ? 'is-focus' : ''} {isHidden(id) ? 'is-off' : ''}">
    <button type="button" class="lane-hdr-btn" onclick={() => setFocus(id)} aria-pressed={isFocus(id)}>
      <span class="lane-ic"><Icon class="size-3.5" aria-hidden="true" /></span>
      <span class="lane-lbl">
        <span class="lane-name">{EDIT_TABS.find((t) => t.id === id)?.label}</span>
        <span class="lane-sub">{LANE_SUB[id]}</span>
      </span>
    </button>
    <div class="lane-ctl">
      {#if controls}{@render controls()}{/if}
      <button
        type="button"
        class="ic-btn"
        title={isHidden(id) ? 'Show lane' : 'Hide lane'}
        aria-label={isHidden(id) ? 'Show lane' : 'Hide lane'}
        onclick={() => toggleHide(id)}
      >
        {#if isHidden(id)}<EyeOff class="size-3.5" aria-hidden="true" />{:else}<Eye class="size-3.5" aria-hidden="true" />{/if}
      </button>
    </div>
  </div>
{/snippet}

{#snippet hiddenBody()}
  <div class="lane-body body-off">lane hidden</div>
{/snippet}

{#snippet ovCtl()}
  <span class="grp-count">{stems.length}</span>
  {#if isFocus('overview')}
    <ChevronDown class="size-3.5" aria-hidden="true" />
  {:else}
    <ChevronRight class="size-3.5" aria-hidden="true" />
  {/if}
{/snippet}

<!-- ── Page ─────────────────────────────────────────────────────────── -->

<main class="v4">
  <!-- Compact transport / metadata / zoom top bar -->
  <div class="v4-top brutalist-shadow">
    <div class="v4-top-row">
      <div class="v4-transport">
        <Button size="sm" class="h-8 gap-1.5"><Play class="size-4" aria-hidden="true" />Play</Button>
        <Button variant="outline" size="sm" class="h-8 w-8 p-0" title="Stop"><Square class="size-3.5" aria-hidden="true" /></Button>
        <Button variant="outline" size="sm" class="h-8 w-8 p-0" title="Loop focused range"><Repeat1 class="size-3.5" aria-hidden="true" /></Button>
        <span class="v4-time">{fmtTime(playheadSec)}<span class="v4-dim"> / {meta.durationLabel}</span></span>
        <span class="v4-chipmono">bar {playheadBar}</span>
      </div>

      <div class="v4-song">
        <span class="v4-title font-display">{meta.title}</span>
        <Button variant="outline" size="icon-xs" class="border-2" title={`Draft: ${meta.draftLabel}`} aria-label={`Draft: ${meta.draftLabel}`}>
          <Layers aria-hidden="true" />
        </Button>
        <span class="v4-artist">{meta.artist}</span>
        <span class="v4-metaline">{meta.bpm} BPM <span class="v4-dot">·</span> {meta.keyLabel} <span class="v4-dot">·</span> {meta.timeSignature}</span>
        <span class="v4-transpose" aria-label="Song transpose">
          <span>-1</span><span class="mid">0</span><span>+1</span>
        </span>
      </div>

      <div class="v4-zoom">
        <span class="v4-view">bars {viewBarFrom}–{viewBarTo} · {barsVisible.toFixed(0)} in view</span>
        <Button variant="outline" size="sm" class="h-8 w-8 p-0" title="Zoom out" onclick={zoomOut}><ZoomOut class="size-4" aria-hidden="true" /></Button>
        <Button variant="outline" size="sm" class="h-8 w-8 p-0" title="Fit whole song" onclick={fitAll}><Maximize2 class="size-4" aria-hidden="true" /></Button>
        <Button variant="outline" size="sm" class="h-8 w-8 p-0" title="Zoom in" onclick={zoomIn}><ZoomIn class="size-4" aria-hidden="true" /></Button>
      </div>
    </div>

    <div class="v4-lanes-nav" role="tablist" aria-label="Focused lane">
      {#each EDIT_TABS as t (t.id)}
        {@const Icon = LANE_ICON[t.id]}
        <button
          type="button"
          role="tab"
          aria-selected={isFocus(t.id)}
          class="v4-chip {isFocus(t.id) ? 'is-on' : ''}"
          onclick={() => setFocus(t.id)}
        >
          <Icon class="size-3.5" aria-hidden="true" />
          {t.label}
        </button>
      {/each}
      <span class="v4-nav-help">
        <HelpHint
          label="Arrangement help"
          text="Every lane shares one ruler, zoom and scroll. Pick a lane to focus it — the focused lane doubles in height and reveals its editing tools. Audio, sections, chords, lyrics and cues all line up to the same bars, so their relationships read at a glance. Click the ruler (or use ← →) to move the playhead; drag the waveform to pan and scroll to zoom."
        />
      </span>
    </div>
  </div>

  <!-- The aligned-lane arrangement -->
  <div class="arrange brutalist-shadow">
    <!-- WAVEFORM LANE (the master; owns pan/zoom of the shared viewport) -->
    <div class="lane-hdr wave {isHidden('wave') ? 'is-off' : ''}">
      <div class="lane-hdr-btn static">
        <span class="lane-ic"><AudioWaveform class="size-3.5" aria-hidden="true" /></span>
        <span class="lane-lbl">
          <span class="lane-name">Audio</span>
          <span class="lane-sub">{meta.durationLabel} · master</span>
        </span>
      </div>
      <div class="lane-ctl">
        <button type="button" class="ic-btn" title={isHidden('wave') ? 'Show lane' : 'Hide lane'} aria-label="Toggle waveform" onclick={() => toggleHide('wave')}>
          {#if isHidden('wave')}<EyeOff class="size-3.5" aria-hidden="true" />{:else}<Eye class="size-3.5" aria-hidden="true" />{/if}
        </button>
      </div>
    </div>
    <div class="lane-body wave-body">
      {#if isHidden('wave')}
        {@render hiddenBody()}
      {:else}
        <DebugSharedWaveform
          bind:viewStart
          bind:viewEnd
          sections={waveformSections}
          bars={meta.bars}
          durationSec={DURATION_SEC}
          playheadSec={playheadSec}
        />
      {/if}
    </div>

    <!-- RULER (shared bar ruler + navigation surface) -->
    <div class="lane-hdr ruler-hdr">
      <div class="lane-hdr-btn static">
        <span class="lane-name dim">Ruler</span>
        <span class="lane-sub">click / ← →</span>
      </div>
    </div>
    <div
      class="lane-body ruler-body"
      role="slider"
      tabindex="0"
      aria-label="Playhead position"
      aria-valuemin={0}
      aria-valuemax={Math.round(DURATION_SEC)}
      aria-valuenow={Math.round(playheadSec)}
      aria-valuetext={`bar ${playheadBar}, ${fmtTime(playheadSec)}`}
      onclick={seek}
      onkeydown={rulerKey}
    >
      {#each barCells as b (b.number)}
        {#if inView(b.startSec, b.startSec + secPerBar) && (b.number - 1) % rulerStep === 0}
          <span class="ruler-tick" style:left="{xPct(b.startSec)}%">{b.number}</span>
        {/if}
      {/each}
      {#if playheadInView}
        <div class="ph ruler-ph" style:left="{xPct(playheadSec)}%"><span class="ph-handle"></span></div>
      {/if}
    </div>

    <!-- GRID LANE -->
    {@render hdr('grid')}
    {#if isHidden('grid')}
      {@render hiddenBody()}
    {:else}
      <div class="lane-body grid-body {isFocus('grid') ? 'is-focus' : ''}">
        {@render sectionTint(0.08)}
        {#each barCells as b (b.number)}
          {#if inView(b.startSec, b.startSec + secPerBar)}
            <div class="bar-line {b.isSectionStart ? 'is-sec' : ''}" style:left="{xPct(b.startSec)}%"></div>
            {#if showBeats}
              {#each [1, 2, 3] as k (k)}
                <div class="beat-tick" style:left="{xPct(b.startSec + (k * secPerBar) / 4)}%"></div>
              {/each}
            {/if}
            {#if (b.number - 1) % rulerStep === 0}
              <span class="bar-num" style:left="{xPct(b.startSec)}%">{b.number}</span>
            {/if}
          {/if}
        {/each}
        {@render ph()}
      </div>
    {/if}
    {#if isFocus('grid') && !isHidden('grid')}
      <div class="lane-tools">
        <div class="tools-head"><CornerDownRight class="size-3.5" aria-hidden="true" /> Grid tools <HelpHint label="Grid help" text="Split, merge and re-time bars and beats. Cmd/Ctrl+Z undoes; reset restores the analyzed grid. Count-in adds clicks before the song; start-at-beat sets the song-start anchor." /></div>
        <div class="tools-body">
          <div class="tgroup">
            <Button variant="outline" size="sm" class="text-xs">Undo</Button>
            <Button variant="outline" size="sm" class="text-xs" disabled>Redo</Button>
            <Button variant="outline" size="sm" class="text-xs">Reset to analyzed</Button>
            <Button variant="outline" size="sm" class="gap-1.5"><RefreshCw class="size-3.5" aria-hidden="true" />Re-analyze</Button>
          </div>
          <span class="tsep"></span>
          <fieldset class="tfield">
            <legend>Count-in</legend>
            {#each [0, 4, 8] as n (n)}
              <label><input type="radio" name="v4-ci" checked={n === 4} class="accent-foreground" /> {n === 0 ? 'Off' : `${n}`}</label>
            {/each}
          </fieldset>
          <fieldset class="tfield">
            <legend>Start at beat</legend>
            <input type="number" value="1" class="numin" aria-label="Song-start beat" />
            <span class="mono dim">bar 1 · 0.00 s</span>
          </fieldset>
          <span class="mono dim">4 clicks · 1.88 s count-in · {meta.bars * meta.beatsPerBar} beats total</span>
        </div>
      </div>
    {/if}

    <!-- SECTIONS LANE -->
    {@render hdr('sections')}
    {#if isHidden('sections')}
      {@render hiddenBody()}
    {:else}
      <div class="lane-body sec-body {isFocus('sections') ? 'is-focus' : ''}">
        {#each sectionRows as s (s.id)}
          {@const a = (s.fromBar - 1) * secPerBar}
          {@const b = s.toBar * secPerBar}
          {#if inView(a, b)}
            <div
              class="sec-block"
              style:left="{xPct(clampL(a))}%"
              style:width="{xPct(clampR(b)) - xPct(clampL(a))}%"
              style:--c={s.color}
            >
              <span class="sec-name">{s.label}</span>
              <span class="sec-bars">{s.fromBar}–{s.toBar}</span>
            </div>
          {/if}
        {/each}
        {@render ph()}
      </div>
    {/if}
    {#if isFocus('sections') && !isHidden('sections')}
      <div class="lane-tools">
        <div class="tools-head"><CornerDownRight class="size-3.5" aria-hidden="true" /> Section tools <HelpHint label="Sections help" text="Multi-select bars, then apply a section kind. Colours match the pads and the exported setlist." /></div>
        <div class="tools-body">
          <div class="tgroup pills">
            {#each SECTION_KINDS as k (k)}
              <span class="pill {k === 'chorus' ? 'is-on' : ''}"><span class="dot" style:background={sectionKindColor(k)}></span>{k}</span>
            {/each}
          </div>
          <Button size="sm" class="text-xs">Apply to selection</Button>
          <span class="tsep"></span>
          <div class="sec-list">
            {#each sectionRows as s (s.id)}
              <div class="sec-row">
                <span class="dot" style:background={s.color}></span>
                <span class="sec-row-name">{s.label}</span>
                <span class="mono dim">bars {s.fromBar}–{s.toBar}</span>
                <span class="mono dim">{s.bars}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- CHORDS LANE -->
    {@render hdr('chords')}
    {#if isHidden('chords')}
      {@render hiddenBody()}
    {:else}
      <div class="lane-body chord-body {isFocus('chords') ? 'is-focus' : ''}">
        {@render sectionTint(0.07)}
        {#each barCells as b (b.number)}
          {#if inView(b.startSec, b.startSec + secPerBar)}
            <div
              class="chord-cell {b.isSectionStart ? 'is-sec' : ''}"
              style:left="{xPct(b.startSec)}%"
              style:width="{xPct(b.startSec + secPerBar) - xPct(b.startSec)}%"
              style:--c={b.color}
            >
              {#if showChords}<span class="chord-lbl">{b.chord}</span>{/if}
            </div>
          {/if}
        {/each}
        {@render ph()}
      </div>
    {/if}
    {#if isFocus('chords') && !isHidden('chords')}
      <div class="lane-tools">
        <div class="tools-head"><CornerDownRight class="size-3.5" aria-hidden="true" /> Chord & key tools <HelpHint label="Chords help" text="Place a chord on any beat. Suggestions from the harmony analysis appear as ghosts you can accept per section." /></div>
        <div class="tools-body">
          <span class="klabel">Song key</span>
          <span class="keycell">G</span>
          <span class="keycell">natural</span>
          <span class="keycell">major</span>
          <span class="tsep"></span>
          <label class="tcheck"><input type="checkbox" checked class="accent-foreground" /> Suggestions</label>
          <span class="mono dim">Chorus · bars 33–48</span>
          <Button variant="outline" size="sm" class="text-xs">Use section suggestions (4)</Button>
          <Button variant="outline" size="sm" class="text-xs">Finish section</Button>
          <span class="tsep"></span>
          <Button variant="outline" size="sm" class="text-xs">Sheet</Button>
          <Button variant="outline" size="sm" class="text-xs">Inspect</Button>
        </div>
      </div>
    {/if}

    <!-- LYRICS LANE -->
    {@render hdr('lyrics')}
    {#if isHidden('lyrics')}
      {@render hiddenBody()}
    {:else}
      <div class="lane-body lyric-body {isFocus('lyrics') ? 'is-focus' : ''}">
        {@render sectionTint(0.05)}
        {#each lyricSpans as l (l.index)}
          {#if inView(l.startSec, l.endSec)}
            <div
              class="lyric-block {l.index % 2 === 0 ? 'aligned' : ''}"
              style:left="{xPct(clampL(l.startSec))}%"
              style:width="{Math.max(2, xPct(clampR(l.endSec)) - xPct(clampL(l.startSec)))}%"
              title={l.text}
            >
              <span class="lyric-t">{l.text}</span>
            </div>
          {/if}
        {/each}
        {@render ph()}
      </div>
    {/if}
    {#if isFocus('lyrics') && !isHidden('lyrics')}
      <div class="lane-tools">
        <div class="tools-head"><CornerDownRight class="size-3.5" aria-hidden="true" /> Lyrics <HelpHint label="Lyrics help" text="Lyrics belong to the current draft. Saving stores the text on this draft; timing each word to the audio is a separate step." /> <span class="ml-auto flex gap-2"><Button variant="outline" size="sm" class="text-xs">Save lyrics</Button><Button size="sm" class="text-xs">Fit to song</Button></span></div>
        <div class="tools-body lyric-tools">
          <textarea class="lyric-paste" rows="7" spellcheck="false">{lyricLines.map((l) => l.text).join('\n')}</textarea>
          <div class="lyric-preview">
            <div class="lyric-preview-head mono dim">Cleaned · {lyricLines.length} lines · aligned {Math.round((lyricLines.length / 2) * 10) / 10}k words</div>
            {#each lyricLines as l (l.index)}
              <div class="lyric-preview-row"><span class="mono dim">{l.timeLabel}</span><span>{l.text}</span></div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- CUE LANE -->
    {@render hdr('cue')}
    {#if isHidden('cue')}
      {@render hiddenBody()}
    {:else}
      <div class="lane-body cue-body {isFocus('cue') ? 'is-focus' : ''}">
        {@render sectionTint(0.05)}
        {#each cueRows as c (c.id)}
          {@const a = (c.fromBar - 1) * secPerBar}
          {#if inView(a, a + secPerBar)}
            <div class="cue-pin" style:left="{xPct(a)}%" style:--c={c.color}>
              <span class="cue-flag"><Flag class="size-3" aria-hidden="true" /></span>
              <span class="cue-text">
                {c.label}
                {#if c.countIn}<span class="cue-badge">count-in</span>{/if}
                {#if c.spoken}<span class="cue-badge on">spoken</span>{/if}
              </span>
            </div>
          {/if}
        {/each}
        {@render ph()}
      </div>
    {/if}
    {#if isFocus('cue') && !isHidden('cue')}
      <div class="lane-tools">
        <div class="tools-head"><CornerDownRight class="size-3.5" aria-hidden="true" /> Cue tools
          <span class="ml-auto flex items-center gap-1.5">
            <span class="perf on">Lead vox</span>
            <span class="perf">Guitar</span>
            <span class="perf"><Plus class="size-3" aria-hidden="true" />Add</span>
          </span>
        </div>
        <div class="tools-body cue-tools">
          <div class="cue-list">
            {#each cueRows as c (c.id)}
              <div class="cue-row">
                <span class="dot" style:background={c.color}></span>
                <span class="cue-row-name">{c.label}</span>
                <label class="tcheck"><input type="checkbox" checked={c.spoken} class="accent-foreground" /> Spoken</label>
                <label class="tcheck"><input type="checkbox" checked={c.countIn} class="accent-foreground" /> Count-in</label>
                <span class="mono dim ml-auto">{c.spoken ? `“${c.label}”` : '—'}</span>
              </div>
            {/each}
          </div>
          <Button size="sm" class="self-end">Auto-generate cues</Button>
        </div>
      </div>
    {/if}

    <!-- MIXER / STEMS GROUP (Overview) -->
    {@render hdr('overview', ovCtl)}
    {#if isHidden('overview')}
      {@render hiddenBody()}
    {:else}
      <div class="lane-body stem-summary {isFocus('overview') ? 'is-focus' : ''}">
        <svg class="stem-wave" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={areaPath(0)} />
        </svg>
        <span class="stem-summary-lbl mono">{stems.length} tracks · original + stems + BarBro band</span>
        {@render ph()}
      </div>
    {/if}
    {#if isFocus('overview') && !isHidden('overview')}
      <div class="lane-tools mixer-tools">
        <div class="tools-head"><CornerDownRight class="size-3.5" aria-hidden="true" /> Mixer <HelpHint label="Mixer help" text="Original audio, stems, and BarBro band tracks load as separate lanes. Volume, mute and solo save with the song; every lane stays aligned for playback and export." /></div>
        <div class="tools-body mixer-transport">
          <Button size="sm" class="h-8 w-8 p-0" aria-label="Play"><Play class="size-4" aria-hidden="true" /></Button>
          <Button variant="outline" size="sm" class="h-8 w-8 p-0" aria-label="Restart"><RotateCcw class="size-3.5" aria-hidden="true" /></Button>
          <Button variant="outline" size="sm" class="h-8 w-8 p-0" aria-label="Stop"><Square class="size-3.5" aria-hidden="true" /></Button>
          <Button variant="outline" size="sm" class="gap-1.5"><Repeat1 class="size-3.5" aria-hidden="true" />Replay 1×</Button>
          <label class="tcheck accented"><input type="checkbox" class="accent-foreground" /> Playback mode</label>
          <span class="perf">Band</span>
          <span class="perf">Live rig</span>
          <span class="mono dim ml-auto">{stems.filter((s) => s.muted).length} muted · {stems.filter((s) => s.solo).length} solo</span>
          <Button variant="outline" size="sm" class="gap-1.5"><RefreshCw class="size-3.5" aria-hidden="true" />Reload</Button>
        </div>
      </div>

      <!-- Individual stem lanes (aligned mini-waveforms) -->
      {#each stems as st, i (st.key)}
        <div class="lane-hdr stem-hdr">
          <div class="lane-hdr-btn static">
            <span class="dot" style:background={st.color}></span>
            <span class="lane-lbl"><span class="lane-name">{st.label}</span></span>
          </div>
          <div class="lane-ctl">
            <button type="button" class="ms-btn {st.muted ? 'on-m' : ''}" title="Mute" aria-pressed={st.muted} onclick={() => (stems[i].muted = !stems[i].muted)}>M</button>
            <button type="button" class="ms-btn {st.solo ? 'on-s' : ''}" title="Solo" aria-pressed={st.solo} onclick={() => (stems[i].solo = !stems[i].solo)}>S</button>
          </div>
        </div>
        <div class="lane-body stem-body {st.muted ? 'muted' : ''}">
          <input type="range" min="0" max="1" step="0.01" value={dbToFrac(st.db)} class="stem-vol accent-foreground" aria-label={`${st.label} volume`} />
          <span class="stem-db mono dim">{st.db} dB</span>
          <div class="stem-wave-wrap">
            <svg class="stem-wave" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              <path d={areaPath(i + 1)} style:fill={st.color} />
            </svg>
            {@render ph()}
          </div>
        </div>
      {/each}
    {/if}

    <!-- LEAD SHEET LANE -->
    {@render hdr('leadsheet')}
    {#if isHidden('leadsheet')}
      {@render hiddenBody()}
    {:else}
      <div class="lane-body chart-strip {isFocus('leadsheet') ? 'is-focus' : ''}">
        {#each sectionRows as s (s.id)}
          {@const a = (s.fromBar - 1) * secPerBar}
          {@const b = s.toBar * secPerBar}
          {#if inView(a, b)}
            <span class="chart-chip" style:left="{xPct(clampL(a))}%" style:--c={s.color}>{s.label}</span>
          {/if}
        {/each}
        <span class="chart-hint mono dim">read-only performance chart — focus to open</span>
        {@render ph()}
      </div>
    {/if}
    {#if isFocus('leadsheet') && !isHidden('leadsheet')}
      <div class="lane-tools">
        <div class="tools-head"><CornerDownRight class="size-3.5" aria-hidden="true" /> Lead sheet <HelpHint label="Lead sheet help" text="A read-only performance view of the current song map: sections, chords, key and timing all come from the saved editor data." /></div>
        <div class="chart">
          <div class="chart-title">
            <span class="chart-song font-display">{meta.title}</span>
            <span class="dim">{meta.artist}</span>
            <span class="mono dim ml-auto">{meta.keyLabel} · {meta.bpm} BPM · {meta.timeSignature}</span>
          </div>
          {#each sectionRows as s (s.id)}
            {@const cells = barCells.filter((b) => b.number >= s.fromBar && b.number <= s.toBar)}
            <div class="chart-sec">
              <div class="chart-sec-head">
                <span class="dot" style:background={s.color}></span>
                <span class="chart-sec-name">{s.label}</span>
                <span class="mono dim">bars {s.fromBar}–{s.toBar}</span>
              </div>
              <div class="chart-chords">
                {#each cells as c (c.number)}
                  <span class="chart-chord {c.number % 4 === 1 ? 'downbeat' : ''}">{c.chord}</span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <p class="v4-foot mono dim">
    Design prototype · v4 “Aligned-lane arrangement” — one shared viewport across every lane · read-only
  </p>
</main>

<style>
  .v4 {
    --hdr-w: 190px;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
    padding: 1.25rem 1rem 2.5rem;
    font-family: var(--font-sans);
  }

  /* ── Top bar ──────────────────────────────────────────────────────── */
  .v4-top {
    border: 2px solid var(--foreground);
    border-radius: var(--radius);
    background: var(--card);
    overflow: hidden;
  }
  .v4-top-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.1rem;
    padding: 0.55rem 0.75rem;
  }
  .v4-transport {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .v4-time {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    margin-left: 0.25rem;
  }
  .v4-dim {
    color: var(--muted-foreground);
    font-weight: 600;
  }
  .v4-chipmono {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--foreground);
    background: color-mix(in oklch, var(--studio-orange) 20%, transparent);
    border: 1px solid color-mix(in oklch, var(--studio-orange) 55%, transparent);
    border-radius: var(--radius);
    padding: 0.05rem 0.4rem;
  }
  .v4-song {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
    flex: 1 1 18rem;
    border-left: 2px solid color-mix(in oklch, var(--foreground) 15%, transparent);
    padding-left: 1rem;
  }
  .v4-title {
    font-size: 1.15rem;
    font-weight: 900;
    letter-spacing: -0.01em;
    line-height: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .v4-artist {
    color: var(--muted-foreground);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .v4-metaline {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .v4-dot {
    opacity: 0.4;
  }
  .v4-transpose {
    display: inline-flex;
    align-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in oklch, var(--foreground) 30%, transparent);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 900;
  }
  .v4-transpose span {
    padding: 0.1rem 0.45rem;
    color: var(--muted-foreground);
  }
  .v4-transpose .mid {
    border-inline: 1px solid color-mix(in oklch, var(--foreground) 20%, transparent);
    color: var(--foreground);
    min-width: 1.7rem;
    text-align: center;
  }
  .v4-zoom {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }
  .v4-view {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    margin-right: 0.15rem;
  }
  .v4-lanes-nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    border-top: 1px solid color-mix(in oklch, var(--foreground) 12%, transparent);
    background: color-mix(in oklch, var(--foreground) 4%, var(--card));
  }
  .v4-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.6rem;
    padding: 0 0.55rem;
    border: 2px solid color-mix(in oklch, var(--foreground) 25%, transparent);
    border-radius: var(--radius);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.72rem;
    font-weight: 800;
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s,
      transform 0.05s;
  }
  .v4-chip:hover {
    border-color: var(--foreground);
    background: var(--accent);
  }
  .v4-chip.is-on {
    background: var(--foreground);
    color: var(--background);
    border-color: var(--foreground);
  }
  .v4-nav-help {
    margin-left: auto;
    display: inline-flex;
  }

  /* ── Arrangement grid ─────────────────────────────────────────────── */
  .arrange {
    display: grid;
    grid-template-columns: var(--hdr-w) minmax(0, 1fr);
    align-items: stretch;
    border: 2px solid var(--foreground);
    border-radius: var(--radius);
    background: var(--card);
    overflow: hidden;
  }

  .lane-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    padding: 0.3rem 0.45rem 0.3rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklch, var(--foreground) 14%, transparent);
    border-right: 2px solid color-mix(in oklch, var(--foreground) 55%, transparent);
    background: color-mix(in oklch, var(--foreground) 5%, var(--card));
    min-width: 0;
  }
  .lane-hdr.wave {
    align-items: flex-start;
    padding-top: 0.5rem;
  }
  .lane-hdr.is-focus {
    background: color-mix(in oklch, var(--studio-orange) 12%, var(--card));
    box-shadow: inset 3px 0 0 var(--studio-orange);
  }
  .lane-hdr.is-off {
    opacity: 0.5;
  }
  .lane-hdr-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    flex: 1;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: var(--foreground);
  }
  .lane-hdr-btn.static {
    cursor: default;
  }
  .lane-ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    flex-shrink: 0;
    border-radius: var(--radius);
    background: color-mix(in oklch, var(--foreground) 10%, transparent);
  }
  .lane-lbl {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.05;
  }
  .lane-name {
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lane-name.dim {
    color: var(--muted-foreground);
    font-weight: 700;
  }
  .lane-sub {
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lane-ctl {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
  }
  .ic-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .ic-btn:hover {
    background: color-mix(in oklch, var(--foreground) 12%, transparent);
    color: var(--foreground);
  }
  .grp-count {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 900;
    padding: 0.02rem 0.32rem;
    border-radius: var(--radius);
    background: color-mix(in oklch, var(--foreground) 14%, transparent);
  }

  /* ── Lane bodies ──────────────────────────────────────────────────── */
  .lane-body {
    position: relative;
    overflow: hidden;
    min-height: 42px;
    border-bottom: 1px solid color-mix(in oklch, var(--foreground) 14%, transparent);
    background: color-mix(in oklch, var(--foreground) 2%, var(--background));
  }
  .lane-body.is-focus {
    min-height: 92px;
    background: color-mix(in oklch, var(--studio-orange) 5%, var(--background));
  }
  .body-off {
    display: flex;
    align-items: center;
    padding-left: 0.7rem;
    min-height: 28px;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
    background: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 6px,
      color-mix(in oklch, var(--foreground) 5%, transparent) 6px,
      color-mix(in oklch, var(--foreground) 5%, transparent) 12px
    );
  }
  .wave-body {
    min-height: 0;
    padding: 0.4rem 0.5rem;
    background: var(--card);
    overflow: visible;
  }

  .tint {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }

  /* Playhead line (drawn per-lane; segments align into one column) */
  .ph {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-1px);
    background: var(--studio-orange);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--studio-orange) 18%, transparent);
    pointer-events: none;
    z-index: 4;
  }

  /* ── Ruler ────────────────────────────────────────────────────────── */
  .ruler-hdr {
    min-height: 26px;
  }
  .ruler-body {
    min-height: 26px;
    background: var(--muted);
    cursor: text;
    outline: none;
  }
  .ruler-body:focus-visible {
    box-shadow: inset 0 0 0 2px var(--studio-orange);
  }
  .ruler-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding-left: 3px;
    border-left: 1px solid color-mix(in oklch, var(--foreground) 30%, transparent);
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 800;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .ruler-ph {
    z-index: 5;
  }
  .ph-handle {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 6px solid var(--studio-orange);
  }

  /* ── Grid lane ────────────────────────────────────────────────────── */
  .bar-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: color-mix(in oklch, var(--foreground) 22%, transparent);
  }
  .bar-line.is-sec {
    width: 2px;
    background: color-mix(in oklch, var(--foreground) 55%, transparent);
  }
  .beat-tick {
    position: absolute;
    bottom: 0;
    height: 40%;
    width: 1px;
    background: color-mix(in oklch, var(--foreground) 12%, transparent);
  }
  .bar-num {
    position: absolute;
    top: 2px;
    padding-left: 3px;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }

  /* ── Sections lane ────────────────────────────────────────────────── */
  .sec-body {
    background: color-mix(in oklch, var(--foreground) 3%, var(--background));
  }
  .sec-block {
    position: absolute;
    top: 4px;
    bottom: 4px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.05rem;
    padding: 0 0.4rem;
    overflow: hidden;
    border-left: 3px solid var(--c);
    border-radius: 2px;
    background: color-mix(in oklch, var(--c) 26%, var(--background));
  }
  .sec-name {
    font-size: 0.68rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--foreground);
  }
  .sec-bars {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 700;
    color: color-mix(in oklch, var(--foreground) 70%, transparent);
  }

  /* ── Chords lane ──────────────────────────────────────────────────── */
  .chord-cell {
    position: absolute;
    top: 3px;
    bottom: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-right: 1px solid color-mix(in oklch, var(--foreground) 10%, transparent);
  }
  .chord-cell.is-sec {
    border-left: 2px solid var(--c);
    background: color-mix(in oklch, var(--c) 12%, transparent);
  }
  .chord-lbl {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 800;
    color: var(--foreground);
  }
  .chord-cell.is-sec .chord-lbl {
    font-weight: 900;
  }

  /* ── Lyrics lane ──────────────────────────────────────────────────── */
  .lyric-block {
    position: absolute;
    top: 5px;
    bottom: 5px;
    display: flex;
    align-items: center;
    padding: 0 0.4rem;
    overflow: hidden;
    border-left: 2px solid color-mix(in oklch, var(--foreground) 35%, transparent);
    border-radius: 2px;
    background: color-mix(in oklch, var(--foreground) 7%, transparent);
  }
  .lyric-block.aligned {
    border-left-color: var(--studio-orange);
    background: color-mix(in oklch, var(--studio-orange) 10%, transparent);
  }
  .lyric-t {
    font-size: 0.7rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--foreground);
  }

  /* ── Cue lane ─────────────────────────────────────────────────────── */
  .cue-body {
    background: color-mix(in oklch, var(--foreground) 2%, var(--background));
  }
  .cue-pin {
    position: absolute;
    top: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding-left: 2px;
    border-left: 2px solid var(--c);
  }
  .cue-flag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--c);
  }
  .cue-text {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.64rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    white-space: nowrap;
    color: var(--foreground);
  }
  .cue-badge {
    font-family: var(--font-mono);
    font-size: 0.54rem;
    font-weight: 800;
    text-transform: none;
    letter-spacing: 0;
    padding: 0.02rem 0.28rem;
    border-radius: 2px;
    background: color-mix(in oklch, var(--foreground) 12%, transparent);
    color: var(--muted-foreground);
  }
  .cue-badge.on {
    background: color-mix(in oklch, var(--studio-orange) 24%, transparent);
    color: var(--foreground);
  }

  /* ── Stems / mixer ────────────────────────────────────────────────── */
  .stem-summary {
    display: flex;
    align-items: center;
  }
  .stem-summary-lbl {
    position: absolute;
    left: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.66rem;
    font-weight: 800;
    color: var(--muted-foreground);
    background: color-mix(in oklch, var(--background) 72%, transparent);
    padding: 0.05rem 0.35rem;
    border-radius: 2px;
    pointer-events: none;
  }
  .stem-wave {
    display: block;
    width: 100%;
    height: 100%;
  }
  .stem-summary .stem-wave path {
    fill: color-mix(in oklch, var(--foreground) 40%, transparent);
  }
  .stem-hdr {
    min-height: 34px;
    padding-left: 1.1rem;
  }
  .stem-hdr .dot {
    width: 0.7rem;
    height: 0.7rem;
  }
  .stem-body {
    min-height: 34px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.5rem;
    background: color-mix(in oklch, var(--foreground) 3%, var(--background));
  }
  .stem-body.muted {
    opacity: 0.5;
  }
  .stem-vol {
    width: 6rem;
    flex-shrink: 0;
  }
  .stem-db {
    width: 3.2rem;
    flex-shrink: 0;
    text-align: right;
  }
  .stem-wave-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 26px;
    overflow: hidden;
  }
  .stem-wave-wrap .stem-wave {
    opacity: 0.85;
  }
  .ms-btn {
    width: 1.4rem;
    height: 1.4rem;
    border: 1px solid color-mix(in oklch, var(--foreground) 30%, transparent);
    border-radius: var(--radius);
    background: var(--background);
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 900;
    color: var(--foreground);
    cursor: pointer;
  }
  .ms-btn.on-m {
    background: var(--foreground);
    color: var(--background);
    border-color: var(--foreground);
  }
  .ms-btn.on-s {
    background: var(--studio-orange);
    color: #1a1a1a;
    border-color: var(--studio-orange);
  }

  /* ── Lead sheet ───────────────────────────────────────────────────── */
  .chart-strip {
    display: flex;
    align-items: center;
  }
  .chart-chip {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    padding: 0.05rem 0.35rem;
    border-left: 3px solid var(--c);
    border-radius: 2px;
    background: color-mix(in oklch, var(--c) 20%, var(--background));
    font-size: 0.58rem;
    font-weight: 800;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--foreground);
  }
  .chart-hint {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.62rem;
    pointer-events: none;
    background: color-mix(in oklch, var(--background) 70%, transparent);
    padding: 0 0.3rem;
  }

  /* ── Focused-lane tool inspectors (full width) ────────────────────── */
  .lane-tools {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.65rem 0.85rem 0.8rem;
    border-bottom: 2px solid color-mix(in oklch, var(--foreground) 40%, transparent);
    border-left: 3px solid var(--studio-orange);
    background: color-mix(in oklch, var(--studio-orange) 6%, var(--card));
  }
  .tools-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.68rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted-foreground);
  }
  .tools-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.7rem;
  }
  .tsep {
    width: 1px;
    align-self: stretch;
    min-height: 1.4rem;
    background: color-mix(in oklch, var(--foreground) 20%, transparent);
  }
  .tgroup {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .tgroup.pills {
    gap: 0.3rem;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.5rem;
    border: 2px solid color-mix(in oklch, var(--foreground) 25%, transparent);
    border-radius: var(--radius);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: capitalize;
    cursor: pointer;
  }
  .pill.is-on {
    border-color: var(--foreground);
    background: var(--foreground);
    color: var(--background);
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    flex-shrink: 0;
    border-radius: 2px;
  }
  .pill.is-on .dot {
    outline: 1px solid var(--background);
  }
  .tfield {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid color-mix(in oklch, var(--foreground) 22%, transparent);
    border-radius: var(--radius);
    background: var(--background);
  }
  .tfield legend {
    float: none;
    padding: 0;
    font-size: 0.58rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted-foreground);
  }
  .tfield label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .numin {
    width: 3rem;
    padding: 0.05rem 0.35rem;
    border: 1px solid color-mix(in oklch, var(--foreground) 30%, transparent);
    border-radius: var(--radius);
    background: var(--background);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 700;
  }
  .tcheck {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    font-weight: 700;
  }
  .tcheck.accented {
    padding: 0.15rem 0.45rem;
    border-radius: var(--radius);
    background: color-mix(in oklch, var(--studio-orange) 22%, transparent);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .dim {
    color: var(--muted-foreground);
  }
  .klabel {
    font-size: 0.62rem;
    font-weight: 900;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .keycell {
    padding: 0.15rem 0.5rem;
    border: 2px solid color-mix(in oklch, var(--foreground) 30%, transparent);
    border-radius: var(--radius);
    background: var(--background);
    font-size: 0.72rem;
    font-weight: 700;
  }
  .perf {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.5rem;
    border: 2px solid color-mix(in oklch, var(--foreground) 35%, transparent);
    border-radius: var(--radius);
    font-size: 0.68rem;
    font-weight: 800;
    cursor: pointer;
  }
  .perf.on {
    background: var(--foreground);
    color: var(--background);
    border-color: var(--foreground);
  }

  .sec-list,
  .cue-list {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 100%;
    max-height: 8.5rem;
    overflow-y: auto;
    padding: 0.35rem;
    border: 1px solid color-mix(in oklch, var(--foreground) 18%, transparent);
    border-radius: var(--radius);
    background: var(--background);
  }
  .sec-row,
  .cue-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.2rem 0.35rem;
    font-size: 0.72rem;
  }
  .sec-row:hover,
  .cue-row:hover {
    background: color-mix(in oklch, var(--foreground) 6%, transparent);
  }
  .sec-row-name,
  .cue-row-name {
    font-weight: 800;
    min-width: 6rem;
  }

  .lyric-tools {
    align-items: stretch;
  }
  .lyric-paste {
    flex: 1 1 18rem;
    min-height: 8rem;
    resize: vertical;
    padding: 0.5rem 0.6rem;
    border: 2px solid color-mix(in oklch, var(--foreground) 40%, transparent);
    border-radius: var(--radius);
    background: var(--background);
    font-family: var(--font-mono);
    font-size: 0.74rem;
    line-height: 1.5;
  }
  .lyric-preview {
    flex: 1 1 18rem;
    min-height: 8rem;
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.4rem 0.5rem;
    border: 1px solid color-mix(in oklch, var(--foreground) 18%, transparent);
    border-radius: var(--radius);
    background: var(--muted);
  }
  .lyric-preview-head {
    font-size: 0.6rem;
    text-transform: uppercase;
    margin-bottom: 0.3rem;
  }
  .lyric-preview-row {
    display: flex;
    gap: 0.55rem;
    padding: 0.08rem 0;
    font-size: 0.74rem;
  }
  .lyric-preview-row .mono {
    width: 2.6rem;
    flex-shrink: 0;
    font-size: 0.62rem;
  }

  .cue-tools {
    flex-direction: column;
    align-items: stretch;
  }
  .mixer-transport {
    row-gap: 0.4rem;
  }

  /* ── Lead-sheet chart ─────────────────────────────────────────────── */
  .chart {
    padding: 0.7rem 0.9rem;
    border: 2px solid color-mix(in oklch, var(--foreground) 30%, transparent);
    border-radius: var(--radius);
    background: var(--background);
  }
  .chart-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding-bottom: 0.4rem;
    margin-bottom: 0.5rem;
    border-bottom: 2px solid color-mix(in oklch, var(--foreground) 20%, transparent);
  }
  .chart-song {
    font-size: 1.15rem;
    font-weight: 900;
    letter-spacing: -0.01em;
  }
  .chart-sec {
    padding: 0.3rem 0;
  }
  .chart-sec-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.15rem;
  }
  .chart-sec-name {
    font-size: 0.7rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .chart-chords {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.35rem;
    padding-left: 1rem;
  }
  .chart-chord {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted-foreground);
    min-width: 1.7rem;
  }
  .chart-chord.downbeat {
    color: var(--foreground);
    font-weight: 900;
  }

  .v4-foot {
    font-size: 0.62rem;
    text-align: center;
    letter-spacing: 0.02em;
  }

  @media (max-width: 760px) {
    .v4 {
      --hdr-w: 132px;
    }
    .v4-song {
      border-left: 0;
      padding-left: 0;
    }
    .lane-sub {
      display: none;
    }
  }
</style>
