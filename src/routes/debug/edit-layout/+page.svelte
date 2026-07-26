<script lang="ts">
  /**
   * Edit-mode LAYOUT STUDY (debug only — mock data, no real song/audio).
   *
   * Goal: the same information as today's /edit, but uniform and calm. The
   * current editor nests three border boxes per tab (heavy `border-2` +
   * brutalist-shadow panel → bordered `EditSectionToolbar` help bar → bordered
   * pills) and repeats it seven times with different internals, so it reads as
   * clutter and never feels like one system.
   *
   * The direction here keeps the studio identity — Space Grotesk / Arial Black,
   * the #ff7a1a orange, ink-on-paper, ONE hard-shadow hero — but spends borders
   * far more sparingly: structure comes from whitespace, type hierarchy, fills
   * and single hairlines instead of stacked boxes. The help "?" and the actions
   * live inline on one baseline; no reserved help paragraph, no header box.
   *
   * Toggle "Old headers" to A/B the exact thing that prompted this.
   */
  import { sectionKindColor } from '$lib/songmap/sectionColors'

  type TabId = 'grid' | 'sections' | 'chords' | 'lyrics'
  let tab = $state<TabId>('sections')
  let showOld = $state(false)
  let openHelp = $state<string | null>(null)

  const TABS: { id: TabId; label: string }[] = [
    { id: 'grid', label: 'Grid' },
    { id: 'sections', label: 'Sections' },
    { id: 'chords', label: 'Chords' },
    { id: 'lyrics', label: 'Lyrics' },
  ]

  // ── Mock song ──────────────────────────────────────────────────────────────
  const song = {
    title: 'Dum av dig',
    artist: 'Håkan Hellström',
    key: 'G',
    bpm: 128,
    bars: 96,
    duration: '3:42',
  }

  type Sec = { kind: string; label: string; from: number; to: number }
  const sections: Sec[] = [
    { kind: 'intro', label: 'Intro', from: 1, to: 8 },
    { kind: 'verse', label: 'Verse 1', from: 9, to: 24 },
    { kind: 'preChorus', label: 'Pre-chorus', from: 25, to: 32 },
    { kind: 'chorus', label: 'Chorus', from: 33, to: 48 },
    { kind: 'verse', label: 'Verse 2', from: 49, to: 64 },
    { kind: 'chorus', label: 'Chorus', from: 65, to: 80 },
    { kind: 'bridge', label: 'Bridge', from: 81, to: 88 },
    { kind: 'outro', label: 'Outro', from: 89, to: 96 },
  ]

  // Deterministic fake waveform peaks + section colour bands for the hero.
  const PEAKS = Array.from({ length: 160 }, (_, i) => {
    const s = Math.sin(i * 0.32) * Math.sin(i * 0.11 + 1.3)
    const env = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.045))
    return 0.12 + 0.88 * Math.abs(s) * env
  })
  const bandFor = (i: number) => {
    const barPos = (i / PEAKS.length) * song.bars + 1
    const sec = sections.find((s) => barPos >= s.from && barPos <= s.to)
    return sec ? sectionKindColor(sec.kind) : 'var(--muted-foreground)'
  }

  const chordRow = ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'C', 'G', 'D', 'Em', 'C', 'Am', 'D', 'G', 'G']
  const lyricLines = [
    'Jag blir dum av dig, jag blir less på allt',
    'och jag orkar inte höra samma sång',
    'Men när du ler så glömmer jag',
    'precis allting jag nyss var arg för',
  ]

  const helpFor: Record<TabId, string> = {
    grid: 'Bars and beats detected from the audio. Drag a bar edge to stretch it; ⌘Z undoes. Reset restores the analyzed grid.',
    sections:
      'Select a bar range and tag it. Sections drive locators, cue timing and the live view. Click a row to rename; the colour follows the kind.',
    chords: 'Chords are keyed to beats. The saved key drives display, transposed labels and export. Detection is only a helper.',
    lyrics:
      'Lyrics belong to the current draft. “Save” stores the text; “Fit to song” times each word to the audio (needs BarBro Desktop) and is optional.',
  }
  const labelFor: Record<TabId, string> = { grid: 'Grid', sections: 'Sections', chords: 'Chords', lyrics: 'Lyrics' }
</script>

<svelte:head>
  <title>Edit layout study — BarBro lab</title>
</svelte:head>

<main class="lab">
  <!-- Context banner (debug only) -->
  <div class="context">
    <div>
      <span class="kicker">Layout study</span>
      <p>Same editor, fewer boxes. One hero shadow, inline help, uniform panels across tabs.</p>
    </div>
    <label class="switch">
      <input type="checkbox" bind:checked={showOld} />
      <span>Old headers</span>
    </label>
  </div>

  <div class="frame">
    <!-- ── Song header ───────────────────────────────────────────────── -->
    <header class="song">
      <div class="song-id">
        <h1>{song.title}</h1>
        <div class="meta">
          <span class="artist">{song.artist}</span>
          <span class="dot">·</span>
          <span class="mono">{song.key}</span>
          <span class="mono">{song.bpm} BPM</span>
          <span class="mono">{song.bars} bars</span>
          <span class="mono">{song.duration}</span>
        </div>
      </div>
      <div class="song-actions">
        <span class="saved">Saved</span>
        <button class="btn ghost">Export</button>
        <button class="btn play" aria-label="Play">▶</button>
      </div>
    </header>

    <!-- ── Hero: waveform (the single strong object) ─────────────────── -->
    <section class="hero" aria-label="Waveform">
      <div class="wave">
        {#each PEAKS as p, i (i)}
          <span class="peak" style:height="{Math.round(p * 100)}%" style:background={bandFor(i)}></span>
        {/each}
        <div class="playhead" style:left="34%"></div>
      </div>
      <div class="wave-strip">
        {#each sections as s (s.label + s.from)}
          <span
            class="band"
            style:flex-grow={s.to - s.from + 1}
            style:--c={sectionKindColor(s.kind)}
            title={`${s.label} · bars ${s.from}–${s.to}`}
          >
            <span class="band-label">{s.label}</span>
          </span>
        {/each}
      </div>
    </section>

    <!-- ── Tab bar ───────────────────────────────────────────────────── -->
    <div class="tabs" role="tablist" aria-label="Edit mode">
      {#each TABS as t (t.id)}
        <button
          role="tab"
          aria-selected={tab === t.id}
          class="tab"
          class:active={tab === t.id}
          onclick={() => (tab = t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>

    <!-- ── Panel (uniform skeleton for every tab) ────────────────────── -->
    <section class="panel" aria-label={labelFor[tab]}>
      {#if showOld}
        <!-- OLD: the bordered help-bar box, for contrast -->
        <div class="old-toolbar">
          <div class="old-head">
            <h2>{labelFor[tab]}</h2>
            <span class="old-q" title={helpFor[tab]}>?</span>
            <span class="old-status mono">bars {song.bars} · {song.bpm} BPM</span>
          </div>
        </div>
      {:else}
        <!-- NEW: label + inline help + right-aligned actions, one hairline -->
        <div class="phead">
          <span class="plabel">{labelFor[tab]}</span>
          <button
            class="qmark"
            aria-label="{labelFor[tab]} help"
            onclick={() => (openHelp = openHelp === tab ? null : tab)}
          >?</button>
          <div class="pactions">
            {#if tab === 'sections'}
              <button class="btn ghost sm">Auto-detect</button>
              <button class="btn solid sm">＋ Section</button>
            {:else if tab === 'chords'}
              <button class="btn ghost sm">Suggest</button>
              <button class="btn solid sm">Set key</button>
            {:else if tab === 'grid'}
              <button class="btn ghost sm">Reset</button>
              <button class="btn ghost sm">Re-analyze</button>
            {:else if tab === 'lyrics'}
              <button class="btn ghost sm">Fit to song</button>
              <button class="btn solid sm">Save</button>
            {/if}
          </div>
          {#if openHelp === tab}
            <p class="popover">{helpFor[tab]}</p>
          {/if}
        </div>
      {/if}

      <!-- content -->
      <div class="pbody">
        {#if tab === 'sections'}
          <ul class="sections">
            {#each sections as s (s.label + s.from)}
              <li class="srow" style:--c={sectionKindColor(s.kind)}>
                <span class="skind">{s.kind}</span>
                <span class="srange mono">{s.from}–{s.to}</span>
                <span class="sname">{s.label}</span>
                <span class="sbars mono">{s.to - s.from + 1} bars</span>
                <span class="srow-actions">
                  <button class="icon" aria-label="Rename">✎</button>
                  <button class="icon" aria-label="Delete">✕</button>
                </span>
              </li>
            {/each}
          </ul>
        {:else if tab === 'chords'}
          <div class="chordgrid">
            {#each chordRow as c, i (i)}
              <button class="chip chord" class:accent={i % 8 === 0}>{c}</button>
            {/each}
          </div>
          <div class="keyrow">
            <span class="plabel muted">Key</span>
            {#each ['C', 'G', 'D', 'A', 'E', 'Am', 'Em'] as k (k)}
              <button class="chip" class:on={k === song.key}>{k}</button>
            {/each}
          </div>
        {:else if tab === 'grid'}
          <div class="barstrip">
            {#each Array(24) as _, i (i)}
              <div class="cell" class:down={i % 4 === 0}>
                <span class="barno mono">{i + 1}</span>
                <div class="beats">
                  {#each Array(4) as _b, b (b)}<span class="beat" class:one={b === 0}></span>{/each}
                </div>
              </div>
            {/each}
          </div>
          <div class="keyrow">
            <span class="plabel muted">Meter</span>
            {#each ['4/4', '3/4', '6/8'] as m (m)}<button class="chip" class:on={m === '4/4'}>{m}</button>{/each}
            <span class="sep"></span>
            <span class="plabel muted">Tempo</span>
            <span class="chip flat mono">{song.bpm} BPM</span>
          </div>
        {:else if tab === 'lyrics'}
          <div class="lyrics">
            {#each lyricLines as line, i (i)}
              <p class="lline"><span class="lno mono">{i + 1}</span>{line}</p>
            {/each}
          </div>
          <div class="keyrow">
            <span class="chip flat">Draft: <strong>Sheet import</strong></span>
            <span class="chip flat mono">42 words · timed</span>
          </div>
        {/if}
      </div>
    </section>
  </div>

  <footer class="foot mono">
    debug/edit-layout · mock data · borders on this screen: 1 hero + hairlines · vs /edit today: ~50 <code>border-2</code> boxes
  </footer>
</main>

<style>
  .lab {
    --paper: var(--background);
    --panel: var(--card);
    --ink: var(--foreground);
    --soft: var(--muted-foreground);
    --line: color-mix(in oklch, var(--foreground) 12%, transparent);
    --line-strong: color-mix(in oklch, var(--foreground) 22%, transparent);
    --fill: color-mix(in oklch, var(--foreground) 6%, transparent);
    --fill-hover: color-mix(in oklch, var(--foreground) 10%, transparent);
    --orange: var(--studio-orange);
    min-height: 100dvh;
    background:
      radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--ink) 9%, transparent) 1px, transparent 1.5px),
      var(--paper);
    background-size: 20px 20px;
    color: var(--ink);
    padding: clamp(14px, 3vw, 32px);
  }

  .frame {
    max-width: 940px;
    margin: 0 auto;
    display: grid;
    gap: clamp(14px, 2.4vw, 22px);
  }

  /* Context banner */
  .context {
    max-width: 940px;
    margin: 0 auto clamp(14px, 2.4vw, 22px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .context .kicker {
    font-size: 0.68rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--orange);
  }
  .context p {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--soft);
    max-width: 60ch;
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--soft);
    cursor: pointer;
    white-space: nowrap;
  }
  .switch input {
    accent-color: var(--orange);
    width: 1rem;
    height: 1rem;
  }

  /* Song header */
  .song {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .song h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.9rem, 5vw, 3rem);
    line-height: 0.92;
    letter-spacing: -0.01em;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.4rem;
    font-size: 0.8rem;
    color: var(--soft);
    flex-wrap: wrap;
  }
  .meta .artist {
    font-weight: 700;
    color: var(--ink);
  }
  .meta .dot {
    opacity: 0.5;
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .song-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .saved {
    font-size: 0.68rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--soft);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .saved::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #16a34a;
  }

  /* Buttons */
  .btn {
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius);
    border: 0;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      transform 90ms ease;
  }
  .btn.sm {
    font-size: 0.74rem;
    padding: 0.3rem 0.65rem;
  }
  .btn.ghost {
    background: var(--fill);
    color: var(--ink);
  }
  .btn.ghost:hover {
    background: var(--fill-hover);
  }
  .btn.solid {
    background: var(--ink);
    color: var(--paper);
  }
  .btn.solid:hover {
    background: var(--orange);
    color: #1a1a1a;
  }
  .btn.play {
    background: var(--ink);
    color: var(--paper);
    width: 2.35rem;
    height: 2.35rem;
    padding: 0;
    display: grid;
    place-items: center;
    font-size: 0.8rem;
  }
  .btn.play:hover {
    background: var(--orange);
    color: #1a1a1a;
  }
  .btn:active {
    transform: translateY(1px);
  }

  /* Hero waveform — the ONE hard-shadow object */
  .hero {
    border: 2px solid var(--ink);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 5px 5px 0 var(--brutalist-shadow-color);
    padding: 0.75rem 0.75rem 0.5rem;
    display: grid;
    gap: 0.4rem;
  }
  .wave {
    position: relative;
    height: clamp(90px, 16vw, 130px);
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .peak {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 1px;
    opacity: 0.85;
  }
  .playhead {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    background: var(--orange);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--orange) 25%, transparent);
  }
  .wave-strip {
    display: flex;
    gap: 2px;
    height: 20px;
  }
  .band {
    position: relative;
    display: flex;
    align-items: center;
    padding-left: 0.4rem;
    border-radius: 2px;
    background: color-mix(in oklch, var(--c) 24%, transparent);
    border-left: 3px solid var(--c);
    overflow: hidden;
    min-width: 0;
  }
  .band-label {
    font-size: 0.6rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
    color: var(--ink);
    opacity: 0.75;
  }

  /* Tab bar — segmented, orange active underline, no box */
  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    font: inherit;
    font-weight: 800;
    font-size: 0.9rem;
    background: transparent;
    border: 0;
    color: var(--soft);
    padding: 0.55rem 0.9rem;
    cursor: pointer;
    position: relative;
    white-space: nowrap;
    transition: color 120ms ease;
  }
  .tab:hover {
    color: var(--ink);
  }
  .tab.active {
    color: var(--ink);
  }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 0.5rem;
    right: 0.5rem;
    bottom: -1px;
    height: 3px;
    background: var(--orange);
    border-radius: 3px 3px 0 0;
  }

  /* Panel — no box, no shadow. Structure = hairline + whitespace. */
  .panel {
    min-height: 340px;
  }
  .phead {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.15rem 0 0.7rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 0.9rem;
  }
  .plabel {
    font-size: 0.7rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--soft);
  }
  .plabel.muted {
    color: var(--soft);
    opacity: 0.8;
  }
  .qmark {
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 50%;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--soft);
    font-size: 0.68rem;
    font-weight: 900;
    cursor: pointer;
    display: grid;
    place-items: center;
    line-height: 1;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      border-color 120ms ease;
  }
  .qmark:hover {
    background: var(--orange);
    border-color: var(--orange);
    color: #1a1a1a;
  }
  .pactions {
    margin-left: auto;
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 5;
    margin: 0;
    max-width: 46ch;
    background: var(--ink);
    color: var(--paper);
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.35;
    padding: 0.6rem 0.75rem;
    border-radius: var(--radius);
    box-shadow: 3px 3px 0 var(--brutalist-shadow-color);
  }

  /* Sections list — colour rule + type, one hairline per row, no boxes */
  .sections {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .srow {
    display: grid;
    grid-template-columns: 6.5rem 4.5rem 1fr auto auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.6rem 0.55rem 0.85rem;
    border-left: 3px solid var(--c);
    border-bottom: 1px solid var(--line);
    border-radius: 2px;
    transition: background-color 110ms ease;
  }
  .srow:hover {
    background: color-mix(in oklch, var(--c) 9%, transparent);
  }
  .skind {
    font-size: 0.7rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in oklch, var(--c) 70%, var(--ink));
  }
  .srange {
    font-size: 0.8rem;
    color: var(--soft);
  }
  .sname {
    font-weight: 700;
    font-size: 0.95rem;
  }
  .sbars {
    font-size: 0.72rem;
    color: var(--soft);
  }
  .srow-actions {
    display: inline-flex;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity 110ms ease;
  }
  .srow:hover .srow-actions {
    opacity: 1;
  }
  .icon {
    width: 1.5rem;
    height: 1.5rem;
    border: 0;
    background: transparent;
    color: var(--soft);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.8rem;
  }
  .icon:hover {
    background: var(--fill-hover);
    color: var(--ink);
  }

  /* Chips (chords / keys / meter) — filled, no borders; active inverts */
  .chordgrid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  .chip {
    font: inherit;
    font-weight: 800;
    font-size: 0.85rem;
    background: var(--fill);
    color: var(--ink);
    border: 0;
    border-radius: var(--radius);
    padding: 0.45rem 0.7rem;
    cursor: pointer;
    text-align: center;
    transition:
      background-color 110ms ease,
      color 110ms ease;
  }
  .chip:hover {
    background: var(--fill-hover);
  }
  .chip.chord {
    padding: 0.7rem 0.4rem;
    font-family: var(--font-mono);
    font-weight: 700;
  }
  .chip.accent {
    box-shadow: inset 3px 0 0 var(--orange);
  }
  .chip.on {
    background: var(--ink);
    color: var(--paper);
  }
  .chip.flat {
    background: transparent;
    color: var(--soft);
    padding-left: 0;
    cursor: default;
  }
  .chip.flat strong {
    color: var(--ink);
  }
  .keyrow {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    padding-top: 0.9rem;
    border-top: 1px solid var(--line);
  }
  .sep {
    width: 1px;
    height: 1.1rem;
    background: var(--line);
    margin: 0 0.3rem;
  }

  /* Grid bar strip */
  .barstrip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  .cell {
    background: var(--fill);
    border-radius: var(--radius);
    padding: 0.45rem 0.4rem 0.55rem;
    display: grid;
    gap: 0.4rem;
  }
  .cell.down {
    box-shadow: inset 3px 0 0 var(--orange);
  }
  .barno {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--soft);
  }
  .beats {
    display: flex;
    gap: 3px;
  }
  .beat {
    flex: 1;
    height: 6px;
    border-radius: 2px;
    background: color-mix(in oklch, var(--foreground) 22%, transparent);
  }
  .beat.one {
    background: var(--orange);
  }

  /* Lyrics */
  .lyrics {
    display: grid;
    gap: 0.15rem;
    margin-bottom: 1rem;
  }
  .lline {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    padding: 0.35rem 0.5rem;
    border-radius: var(--radius);
    display: flex;
    gap: 0.75rem;
  }
  .lline:hover {
    background: var(--fill);
  }
  .lno {
    color: var(--soft);
    font-size: 0.72rem;
    width: 1.5rem;
    flex-shrink: 0;
    padding-top: 0.15rem;
  }

  /* OLD toolbar (for contrast) — the bordered help-bar box */
  .old-toolbar {
    border: 1px solid var(--line-strong);
    background: var(--fill);
    border-radius: var(--radius);
    padding: 0.65rem 0.7rem;
    margin-bottom: 1rem;
  }
  .old-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .old-head h2 {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--soft);
  }
  .old-q {
    width: 1.05rem;
    height: 1.05rem;
    border-radius: 50%;
    border: 1px solid var(--line-strong);
    display: grid;
    place-items: center;
    font-size: 0.66rem;
    font-weight: 900;
    color: var(--soft);
    cursor: help;
  }
  .old-status {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--soft);
  }

  /* Footer */
  .foot {
    max-width: 940px;
    margin: clamp(18px, 3vw, 28px) auto 0;
    font-size: 0.72rem;
    color: var(--soft);
  }
  .foot code {
    font-family: var(--font-mono);
    background: var(--fill);
    padding: 0.05rem 0.3rem;
    border-radius: 2px;
  }

  @media (max-width: 640px) {
    .srow {
      grid-template-columns: 5rem 1fr auto;
      row-gap: 0.15rem;
    }
    .srange,
    .sbars {
      display: none;
    }
    .chordgrid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
