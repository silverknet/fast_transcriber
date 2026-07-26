<script lang="ts">
  /**
   * Edit chrome study (debug / mock) — "Warm rounded studio" variant.
   *
   * Same hard constraints as the reference edit-shell:
   *   • the BARBRO navbar stays structurally untouched;
   *   • the ProjectContextBar keeps its recognizable identity (orange-tint strip,
   *     "Back to project" button, divider, 📂 project / song crumb) — the edit
   *     tabs live INSIDE it, here as rounded pills in the bar's own vocabulary.
   *
   * DIRECTION: softer + friendlier. Larger corner rounding, gentle warm fills,
   * sections as rounded tinted cards with a filled kind-colour dot, chords as
   * rounded pill buttons, the waveform in a softly-rounded panel, and low
   * diffuse shadows instead of hard brutalist offsets — while keeping the
   * studio-orange energy and Arial Black display type.
   */
  import { sectionKindColor } from '$lib/songmap/sectionColors'

  type Tab = 'grid' | 'chords' | 'sections' | 'lyrics'
  let tab = $state<Tab>('chords')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'grid', label: 'Grid' },
    { id: 'chords', label: 'Chords' },
    { id: 'sections', label: 'Sections' },
    { id: 'lyrics', label: 'Lyrics' },
  ]
  const labelOf = (t: Tab) => TABS.find((x) => x.id === t)!.label

  const song = { title: 'Dum av dig', project: 'Spring tour set', key: 'G', bpm: 128, bars: 96 }

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
  const PEAKS = Array.from({ length: 180 }, (_, i) => {
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
  const actionsOf: Record<Tab, string[]> = {
    grid: ['Reset', 'Re-analyze'],
    chords: ['Suggest', 'Set key'],
    sections: ['Auto-detect', '＋ Section'],
    lyrics: ['Fit to song', 'Save'],
  }
</script>

<svelte:head>
  <title>Edit · Soft studio — BarBro lab</title>
</svelte:head>

<main class="lab">
  <div class="head">
    <span class="kicker">Edit chrome · Soft studio</span>
    <p>
      Warm, rounded take on the same layout — navbar + context-bar identity kept, the edit tabs are
      <strong>rounded pills folded into the context bar</strong>. Soft fills, diffuse shadows, tinted section cards.
    </p>
  </div>

  <div class="stage">
    <div class="appframe">
      <!-- ═══ NAVBAR — untouched (faithful mock of AppMenuBar) ═══ -->
      <div class="menubar" aria-label="Application (unchanged)">
        <span class="brand">BARBRO</span>
        <div class="menugroup">
          <span class="menu-btn">File <i>▾</i></span>
          <span class="menu-btn">Edit <i>▾</i></span>
          <span class="menu-btn">View <i>▾</i></span>
        </div>
        <span class="spacer"></span>
        <div class="chips">
          <span class="chip-sync">Synced</span>
          <span class="chip-mode">◱ Studio</span>
          <span class="icon-btn">☾</span>
          <span class="avatar">M</span>
        </div>
      </div>

      <!-- ═══ CONTEXT BAR — same identity, edit tabs ADDED as soft pills ═══ -->
      <div class="ctxbar" role="navigation" aria-label="Project context">
        <button class="ctx-back">← Back to project</button>
        <span class="ctx-div"></span>
        <div class="crumb">
          <span class="folder" aria-hidden="true">📂</span>
          <span class="proj">{song.project}</span>
          <span class="slash">/</span>
          <span class="songttl">{song.title}</span>
        </div>
        <span class="spacer"></span>
        <!-- tabs as rounded pills in the bar's own warm vocabulary -->
        <div class="ctx-tabs" role="tablist" aria-label="Edit mode">
          {#each TABS as t (t.id)}
            <button class="ctx-tab" class:active={tab === t.id} role="tab" aria-selected={tab === t.id} onclick={() => (tab = t.id)}>
              {t.label}
            </button>
          {/each}
        </div>
        <button class="ctx-play" aria-label="Play">▶</button>
      </div>

      <!-- ═══ Waveform — in a softly-rounded panel ═══ -->
      <div class="wave-wrap">
        <div class="wave-panel">
          <div class="wave">
            {#each PEAKS as p, i (i)}
              <span class="peak" style:height="{Math.round(p * 100)}%" style:background={bandFor(i)}></span>
            {/each}
            <div class="playhead" style:left="34%"></div>
          </div>
          <div class="wave-strip">
            {#each sections as s (s.label + s.from)}
              <span class="band" style:flex-grow={s.to - s.from + 1} style:--c={sectionKindColor(s.kind)}>
                <span class="band-label">{s.label}</span>
              </span>
            {/each}
          </div>
        </div>
      </div>

      <!-- ═══ Content (per-tab actions inline, then the surface) ═══ -->
      <div class="content">
        <div class="phead">
          <span class="tag">{labelOf(tab)}</span>
          <span class="spacer"></span>
          {#each actionsOf[tab] as a, i (a)}
            <button class="mini" class:solid={i === actionsOf[tab].length - 1}>{a}</button>
          {/each}
          <button class="qmark" aria-label="{labelOf(tab)} help">?</button>
        </div>

        {#if tab === 'chords'}
          <div class="chordgrid">
            {#each chordRow as c, i (i)}<button class="chip chord" class:accent={i % 8 === 0}>{c}</button>{/each}
          </div>
          <div class="keyrow">
            <span class="klabel">Key</span>
            {#each ['C', 'G', 'D', 'A', 'E', 'Am', 'Em'] as k (k)}<button class="chip" class:on={k === song.key}>{k}</button>{/each}
          </div>
        {:else if tab === 'grid'}
          <div class="barstrip">
            {#each Array(28) as _, i (i)}
              <div class="cell" class:down={i % 4 === 0}>
                <span class="barno">{i + 1}</span>
                <div class="beats">{#each Array(4) as _b, b (b)}<span class="beat" class:one={b === 0}></span>{/each}</div>
              </div>
            {/each}
          </div>
          <div class="keyrow">
            <span class="klabel">Meter</span>
            {#each ['4/4', '3/4', '6/8'] as m (m)}<button class="chip" class:on={m === '4/4'}>{m}</button>{/each}
            <span class="chip flat">{song.bpm} BPM</span>
          </div>
        {:else if tab === 'sections'}
          <ul class="sections">
            {#each sections as s (s.label + s.from)}
              <li class="srow" style:--c={sectionKindColor(s.kind)}>
                <span class="sdot" aria-hidden="true"></span>
                <span class="skind">{s.kind}</span>
                <span class="srange">{s.from}–{s.to}</span>
                <span class="sname">{s.label}</span>
                <span class="srow-actions"><button class="icon" aria-label="Rename">✎</button><button class="icon" aria-label="Delete">✕</button></span>
              </li>
            {/each}
          </ul>
        {:else if tab === 'lyrics'}
          <div class="lyrics">
            {#each lyricLines as line, i (i)}<p class="lline"><span class="lno">{i + 1}</span>{line}</p>{/each}
          </div>
          <div class="keyrow"><span class="chip flat">Draft: <strong>Sheet import</strong></span><span class="chip flat">42 words · timed</span></div>
        {/if}
      </div>
    </div>

    <p class="hint mono">warm rounded studio · navbar untouched · context bar keeps its identity, tabs added as soft pills</p>
  </div>
</main>

<style>
  .lab {
    --paper: var(--background);
    --panel: var(--card);
    --ink: var(--foreground);
    --soft: var(--muted-foreground);
    --line: color-mix(in oklch, var(--foreground) 10%, transparent);
    --line-strong: color-mix(in oklch, var(--foreground) 18%, transparent);
    --orange: var(--studio-orange);
    /* Warm, gentle fills tinted with a touch of studio-orange */
    --warm: color-mix(in oklch, var(--studio-orange) 7%, var(--card));
    --warm-hover: color-mix(in oklch, var(--studio-orange) 14%, var(--card));
    /* exact context-bar surface from ProjectContextBar.svelte */
    --ctx-bg: color-mix(in oklch, var(--studio-orange) 5%, var(--card));
    --accent-hover: color-mix(in oklch, var(--studio-orange) 18%, white);
    /* Soft, low, diffuse shadows (near-black in both themes) */
    --shadow-soft: 0 8px 26px -10px color-mix(in oklch, var(--studio-ink) 30%, transparent);
    --shadow-card: 0 3px 12px -5px color-mix(in oklch, var(--studio-ink) 22%, transparent);
    /* Rounding scale — deliberately generous */
    --r-lg: 16px;
    --r-md: 12px;
    --r-sm: 9px;
    --r-pill: 999px;
    min-height: 100dvh;
    background:
      radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--ink) 7%, transparent) 1px, transparent 1.5px),
      var(--paper);
    background-size: 22px 22px;
    color: var(--ink);
    padding: clamp(12px, 2.6vw, 28px);
    font-family: var(--font-sans);
  }
  :global(.dark) .lab {
    --ctx-bg: color-mix(in oklch, var(--studio-orange) 8%, var(--card));
    --accent-hover: color-mix(in oklch, var(--foreground) 12%, var(--card));
    --warm: color-mix(in oklch, var(--studio-orange) 10%, var(--card));
    --warm-hover: color-mix(in oklch, var(--studio-orange) 18%, var(--card));
    --shadow-soft: 0 10px 30px -8px color-mix(in oklch, black 55%, transparent);
    --shadow-card: 0 4px 14px -5px color-mix(in oklch, black 45%, transparent);
  }

  .head {
    max-width: 1020px;
    margin: 0 auto clamp(12px, 2vw, 18px);
  }
  .kicker {
    font-size: 0.68rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--orange);
  }
  .head p {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--soft);
    max-width: 74ch;
  }
  .head strong {
    color: var(--ink);
  }

  .stage {
    max-width: 1020px;
    margin: 0 auto;
  }
  /* Soft rounded frame with a low diffuse shadow instead of a hard offset */
  .appframe {
    border: 1px solid var(--line-strong);
    border-radius: var(--r-lg);
    background: var(--paper);
    box-shadow: var(--shadow-soft);
    overflow: hidden;
    min-height: 540px;
  }
  .spacer {
    flex: 1;
  }
  .mono {
    font-family: var(--font-mono);
  }

  /* ── NAVBAR (untouched mock — styling kept as-is) ── */
  .menubar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.2rem 0.75rem;
    min-height: 2.4rem;
    background: var(--card);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.01em;
  }
  .menugroup {
    display: flex;
    gap: 0.1rem;
    margin-left: 0.3rem;
  }
  .menu-btn {
    font-size: 0.8125rem;
    font-weight: 800;
    color: var(--ink);
    padding: 0.28rem 0.55rem;
    border-radius: var(--r-sm);
  }
  .menu-btn i {
    font-style: normal;
    opacity: 0.6;
    font-size: 0.7em;
  }
  .menu-btn:hover {
    background: var(--warm);
  }
  .chips {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .chip-sync,
  .chip-mode {
    font-size: 0.6875rem;
    font-weight: 800;
    color: var(--soft);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--r-pill);
    background: var(--warm);
    white-space: nowrap;
  }
  .chip-sync::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #16a34a;
  }
  .icon-btn {
    width: 1.6rem;
    height: 1.6rem;
    display: grid;
    place-items: center;
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    color: var(--soft);
  }
  .avatar {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    background: var(--ink);
    color: var(--paper);
    display: grid;
    place-items: center;
    font-size: 0.78rem;
    font-weight: 900;
  }

  /* ── CONTEXT BAR — matches ProjectContextBar identity, tabs as soft pills ── */
  .ctxbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    height: 2rem;
    padding: 0 0.75rem;
    background: var(--ctx-bg);
    color: var(--ink);
    font-size: 0.875rem;
    border-bottom: 1px solid var(--line);
  }
  .ctx-back {
    display: inline-flex;
    align-items: center;
    height: 1.55rem;
    padding: 0 0.6rem;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .ctx-back:hover {
    background: var(--accent-hover);
  }
  .ctx-div {
    width: 1px;
    height: 1.25rem;
    background: color-mix(in oklch, var(--foreground) 25%, transparent);
    flex-shrink: 0;
  }
  .crumb {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .folder {
    opacity: 0.7;
    font-size: 0.9rem;
  }
  .proj {
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .slash {
    opacity: 0.5;
  }
  .songttl {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--soft);
    white-space: nowrap;
  }
  /* Rounded pills; active = filled orange pill with ink text */
  .ctx-tabs {
    display: flex;
    gap: 0.2rem;
    flex-shrink: 0;
    padding: 0.12rem;
    border-radius: var(--r-pill);
    background: color-mix(in oklch, var(--studio-ink) 5%, transparent);
  }
  .ctx-tab {
    height: 1.45rem;
    padding: 0 0.7rem;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--soft);
    font: inherit;
    font-weight: 700;
    font-size: 0.8125rem;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color 140ms ease,
      color 140ms ease,
      box-shadow 140ms ease;
  }
  .ctx-tab:hover {
    background: var(--accent-hover);
    color: var(--ink);
  }
  .ctx-tab.active {
    background: var(--orange);
    color: var(--studio-ink);
    box-shadow: 0 2px 8px -2px color-mix(in oklch, var(--orange) 60%, transparent);
  }
  .ctx-play {
    width: 1.55rem;
    height: 1.55rem;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--foreground);
    color: var(--background);
    display: grid;
    place-items: center;
    font-size: 0.66rem;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color 140ms ease,
      transform 140ms ease;
  }
  :global(.dark) .ctx-play {
    background: var(--ink);
    color: var(--studio-paper);
  }
  .ctx-play:hover {
    background: var(--orange);
    color: var(--studio-ink);
    transform: scale(1.06);
  }

  /* ── Waveform in a softly-rounded panel ── */
  .wave-wrap {
    padding: 0.75rem;
    border-bottom: 1px solid var(--line);
  }
  .wave-panel {
    display: grid;
    gap: 0.4rem;
    padding: 0.7rem 0.75rem 0.55rem;
    border-radius: var(--r-md);
    background: var(--warm);
    box-shadow: var(--shadow-card);
  }
  .wave {
    position: relative;
    height: clamp(70px, 12vw, 100px);
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .peak {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 2px;
    opacity: 0.85;
  }
  .playhead {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    border-radius: var(--r-pill);
    background: var(--orange);
    box-shadow: 0 0 0 4px color-mix(in oklch, var(--orange) 22%, transparent);
  }
  .wave-strip {
    display: flex;
    gap: 3px;
    height: 16px;
  }
  .band {
    display: flex;
    align-items: center;
    padding-left: 0.4rem;
    border-radius: var(--r-sm);
    background: color-mix(in oklch, var(--c) 22%, transparent);
    overflow: hidden;
    min-width: 0;
  }
  .band-label {
    font-size: 0.56rem;
    font-weight: 900;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--ink);
    opacity: 0.7;
  }

  /* ── Content ── */
  .content {
    padding: clamp(0.85rem, 2vw, 1.25rem);
  }
  .phead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-bottom: 0.55rem;
    margin-bottom: 0.85rem;
    border-bottom: 1px solid var(--line);
  }
  .tag {
    font-size: 0.66rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--soft);
  }
  .mini {
    font: inherit;
    font-weight: 800;
    font-size: 0.73rem;
    padding: 0.3rem 0.7rem;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--warm);
    color: var(--ink);
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .mini:hover {
    background: var(--warm-hover);
  }
  .mini.solid {
    background: var(--ink);
    color: var(--paper);
  }
  .mini.solid:hover {
    background: var(--orange);
    color: var(--studio-ink);
  }
  .qmark {
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--soft);
    font-size: 0.66rem;
    font-weight: 900;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }
  .qmark:hover {
    background: var(--orange);
    border-color: var(--orange);
    color: var(--studio-ink);
  }

  /* chords / grid / chips — rounded pills */
  .chordgrid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 0.45rem;
    margin-bottom: 1rem;
  }
  .chip {
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    background: var(--warm);
    color: var(--ink);
    border: 0;
    border-radius: var(--r-pill);
    padding: 0.44rem 0.75rem;
    cursor: pointer;
    text-align: center;
    transition:
      background-color 140ms ease,
      box-shadow 140ms ease,
      transform 140ms ease;
  }
  .chip:hover {
    background: var(--warm-hover);
    transform: translateY(-1px);
  }
  .chip.chord {
    padding: 0.7rem 0.4rem;
    font-family: var(--font-mono);
    font-weight: 700;
    box-shadow: var(--shadow-card);
  }
  .chip.chord:hover {
    box-shadow: var(--shadow-soft);
  }
  .chip.accent {
    box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--orange) 55%, transparent), var(--shadow-card);
  }
  .chip.on {
    background: var(--ink);
    color: var(--paper);
  }
  .chip.flat {
    background: transparent;
    color: var(--soft);
    cursor: default;
  }
  .chip.flat:hover {
    transform: none;
    background: transparent;
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
  .klabel {
    font-size: 0.66rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--soft);
  }
  .barstrip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .cell {
    background: var(--warm);
    border-radius: var(--r-md);
    padding: 0.45rem 0.45rem 0.55rem;
    display: grid;
    gap: 0.35rem;
    box-shadow: var(--shadow-card);
  }
  .cell.down {
    box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--orange) 45%, transparent), var(--shadow-card);
  }
  .barno {
    font-family: var(--font-mono);
    font-size: 0.7rem;
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
    border-radius: var(--r-pill);
    background: color-mix(in oklch, var(--foreground) 20%, transparent);
  }
  .beat.one {
    background: var(--orange);
  }

  /* ── Sections as rounded tinted cards ── */
  .sections {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .srow {
    display: grid;
    grid-template-columns: auto 6rem 4rem 1fr auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.7rem 0.6rem 0.8rem;
    border-radius: var(--r-md);
    background: color-mix(in oklch, var(--c) 12%, var(--card));
    box-shadow: var(--shadow-card);
    transition:
      background-color 140ms ease,
      transform 140ms ease,
      box-shadow 140ms ease;
  }
  .srow:hover {
    background: color-mix(in oklch, var(--c) 18%, var(--card));
    transform: translateY(-1px);
    box-shadow: var(--shadow-soft);
  }
  .sdot {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 0 4px color-mix(in oklch, var(--c) 22%, transparent);
    flex-shrink: 0;
  }
  .skind {
    font-size: 0.68rem;
    font-weight: 950;
    text-transform: uppercase;
    color: color-mix(in oklch, var(--c) 55%, var(--ink));
  }
  .srange {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--soft);
  }
  .sname {
    font-weight: 700;
    font-size: 0.92rem;
  }
  .srow-actions {
    display: inline-flex;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity 140ms ease;
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
    border-radius: var(--r-pill);
    cursor: pointer;
    font-size: 0.78rem;
    transition: background-color 140ms ease;
  }
  .icon:hover {
    background: color-mix(in oklch, var(--c) 24%, transparent);
    color: var(--ink);
  }

  /* ── Lyrics ── */
  .lyrics {
    display: grid;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }
  .lline {
    margin: 0;
    font-size: 0.98rem;
    font-weight: 600;
    padding: 0.4rem 0.6rem;
    border-radius: var(--r-md);
    display: flex;
    gap: 0.7rem;
    transition: background-color 140ms ease;
  }
  .lline:hover {
    background: var(--warm);
  }
  .lno {
    font-family: var(--font-mono);
    color: var(--soft);
    font-size: 0.7rem;
    width: 1.3rem;
    flex-shrink: 0;
    padding-top: 0.1rem;
  }

  .hint {
    font-size: 0.72rem;
    color: var(--soft);
    margin: 0.7rem 0 0;
  }

  @media (max-width: 780px) {
    .chordgrid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .menugroup,
    .proj,
    .slash {
      display: none;
    }
    .ctxbar {
      gap: 0.5rem;
    }
    .srow {
      grid-template-columns: auto 5rem 1fr auto;
    }
    .srange {
      display: none;
    }
  }/* ── Debug: render directly on the page. Hide the mock navbar + un-box the
     frame so this design goes full-bleed UNDER the real AppMenuBar (which the
     app layout already renders on /debug routes). ── */
  .menubar { display: none !important; }
  .head, .hint { display: none !important; }
  .lab { background: var(--background) !important; min-height: 0 !important; padding: 0 !important; }
  .stage { max-width: none !important; margin: 0 !important; }
  .appframe {
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: visible !important;
    min-height: 0 !important;
    background: transparent !important;
  }
</style>
