<script lang="ts">
  /**
   * Edit chrome study (debug / mock) — direction: "Editorial calm".
   *
   * Magazine minimalism. Generous whitespace + a refined type hierarchy do the
   * structuring; almost no fills, almost no boxes. Separators are thin 1px
   * hairlines only. Orange appears surgically — a 2px active-tab underline, a
   * small dot, the playhead — never as a fill.
   *
   * Hard constraints (unchanged from the shell study):
   *   • the BARBRO navbar stays structurally + visually untouched;
   *   • the context bar keeps its identity (orange-tint strip, Back, divider,
   *     📂 crumb) but the edit tabs are folded INTO it as understated underline
   *     text, with a compact ▶ at the far right;
   *   • the content surfaces (waveform + four tab bodies) are constant.
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
  <title>Edit · Editorial — BarBro lab</title>
</svelte:head>

<main class="lab">
  <div class="head">
    <span class="kicker">Editorial calm</span>
    <p>
      Magazine minimalism — whitespace and type do the structuring. Hairlines only, <strong>no fills</strong>; orange
      appears surgically as an underline, a dot, the playhead. Click a tab to switch content.
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

      <!-- ═══ CONTEXT BAR — same identity, edit tabs folded in as underline text ═══ -->
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
        <!-- tabs, understated underline text drawn from the bar's own vocabulary -->
        <div class="ctx-tabs" role="tablist" aria-label="Edit mode">
          {#each TABS as t (t.id)}
            <button class="ctx-tab" class:active={tab === t.id} role="tab" aria-selected={tab === t.id} onclick={() => (tab = t.id)}>
              {t.label}
            </button>
          {/each}
        </div>
        <span class="ctx-div"></span>
        <button class="ctx-play" aria-label="Play">▶</button>
      </div>

      <!-- ═══ Waveform ═══ -->
      <div class="wave-wrap">
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

    <p class="hint mono">editorial calm · hairlines only · orange used surgically (underline · dot · playhead)</p>
  </div>
</main>

<style>
  .lab {
    --paper: var(--background);
    --panel: var(--card);
    --ink: var(--foreground);
    --soft: var(--muted-foreground);
    /* the whole language: thin hairlines, nothing heavier */
    --hair: color-mix(in oklch, var(--foreground) 11%, transparent);
    --hair-soft: color-mix(in oklch, var(--foreground) 7%, transparent);
    --orange: var(--studio-orange);
    /* exact context-bar surfaces from ProjectContextBar.svelte */
    --ctx-bg: color-mix(in oklch, var(--studio-orange) 5%, var(--card));
    --accent-hover: color-mix(in oklch, var(--studio-orange) 18%, white);
    min-height: 100dvh;
    background: var(--paper);
    color: var(--ink);
    padding: clamp(16px, 4vw, 44px);
  }
  :global(.dark) .lab {
    --ctx-bg: color-mix(in oklch, var(--studio-orange) 8%, var(--card));
    --accent-hover: color-mix(in oklch, var(--foreground) 12%, var(--card));
  }

  .head {
    max-width: 940px;
    margin: 0 auto clamp(18px, 3vw, 34px);
  }
  .kicker {
    font-size: 0.66rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--orange);
  }
  .head p {
    margin: 0.5rem 0 0;
    font-size: 0.98rem;
    font-weight: 500;
    line-height: 1.6;
    color: var(--soft);
    max-width: 66ch;
  }
  .head strong {
    color: var(--ink);
    font-weight: 700;
  }

  .stage {
    max-width: 940px;
    margin: 0 auto;
  }
  /* the "page": a light hairline frame, no heavy border, no brutalist shadow */
  .appframe {
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 1px 2px color-mix(in oklch, var(--foreground) 5%, transparent);
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
    border-bottom: 1px solid var(--hair);
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
    border-radius: var(--radius);
  }
  .menu-btn i {
    font-style: normal;
    opacity: 0.6;
    font-size: 0.7em;
  }
  .menu-btn:hover {
    background: var(--hair-soft);
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
    border-radius: 999px;
    background: var(--hair-soft);
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
    border-radius: var(--radius);
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

  /* ── CONTEXT BAR — identity preserved, tabs = understated underline text ── */
  .ctxbar {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    height: 2rem;
    padding: 0 0.75rem;
    background: var(--ctx-bg);
    color: var(--ink);
    font-size: 0.875rem;
    border-bottom: 1px solid var(--hair);
  }
  .ctx-back {
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding: 0 0.4rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: color 120ms ease;
  }
  .ctx-back:hover {
    color: var(--orange);
  }
  .ctx-div {
    width: 1px;
    height: 1.1rem;
    background: color-mix(in oklch, var(--foreground) 18%, transparent);
    flex-shrink: 0;
  }
  .crumb {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .folder {
    opacity: 0.65;
    font-size: 0.9rem;
  }
  .proj {
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .slash {
    opacity: 0.4;
  }
  .songttl {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--soft);
    white-space: nowrap;
  }
  /* tabs: full-height underline text; active gets a 2px orange rule */
  .ctx-tabs {
    display: flex;
    gap: 0.9rem;
    flex-shrink: 0;
    align-self: stretch;
  }
  .ctx-tab {
    display: inline-flex;
    align-items: center;
    padding: 0 0.05rem;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--soft);
    font: inherit;
    font-weight: 600;
    font-size: 0.8125rem;
    cursor: pointer;
    white-space: nowrap;
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }
  .ctx-tab:hover {
    color: var(--ink);
  }
  .ctx-tab.active {
    color: var(--ink);
    border-bottom-color: var(--orange);
  }
  /* compact play — quiet glyph, no fill */
  .ctx-play {
    width: 1.5rem;
    height: 1.5rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--soft);
    display: grid;
    place-items: center;
    font-size: 0.62rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 120ms ease;
  }
  .ctx-play:hover {
    color: var(--orange);
  }

  /* ── Waveform — light: thin bars, no frame ── */
  .wave-wrap {
    padding: clamp(1rem, 2.4vw, 1.6rem) clamp(1rem, 2.4vw, 1.6rem) 1rem;
    display: grid;
    gap: 0.7rem;
    border-bottom: 1px solid var(--hair);
  }
  .wave {
    position: relative;
    height: clamp(64px, 11vw, 92px);
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .peak {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 0;
    opacity: 0.5;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--orange);
  }
  .wave-strip {
    display: flex;
    gap: 1.25rem;
    height: 1.4rem;
  }
  .band {
    display: flex;
    align-items: flex-start;
    padding-top: 0.35rem;
    border-top: 2px solid var(--c);
    overflow: hidden;
    min-width: 0;
  }
  .band-label {
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    white-space: nowrap;
    color: var(--soft);
  }

  /* ── Content ── */
  .content {
    padding: clamp(1.4rem, 3.4vw, 2.4rem);
  }
  .phead {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    padding-bottom: 0.85rem;
    margin-bottom: 1.6rem;
    border-bottom: 1px solid var(--hair);
  }
  .tag {
    font-size: 0.64rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--soft);
  }
  /* actions: quiet text, hairline underline on hover — never filled */
  .mini {
    font: inherit;
    font-weight: 600;
    font-size: 0.8rem;
    padding: 0 0.05rem;
    border: 0;
    border-bottom: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--soft);
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }
  .mini:hover {
    color: var(--ink);
    border-bottom-color: var(--hair);
  }
  .mini.solid {
    color: var(--ink);
    font-weight: 700;
  }
  .mini.solid:hover {
    border-bottom-color: var(--orange);
  }
  .qmark {
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 50%;
    border: 1px solid var(--hair);
    background: transparent;
    color: var(--soft);
    font-size: 0.66rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }
  .qmark:hover {
    border-color: var(--orange);
    color: var(--orange);
  }

  /* ── Chords: quiet text with lots of air ── */
  .chordgrid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 1.4rem 1rem;
    margin-bottom: 2rem;
  }
  .chip {
    font: inherit;
    font-weight: 600;
    font-size: 0.9rem;
    background: transparent;
    color: var(--ink);
    border: 0;
    border-radius: 0;
    padding: 0 0.1rem;
    cursor: pointer;
    text-align: center;
    transition: color 120ms ease;
  }
  .chip:hover {
    color: var(--orange);
  }
  .chip.chord {
    position: relative;
    padding: 0.7rem 0.1rem 0.2rem;
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 1.02rem;
    color: var(--ink);
  }
  .chip.chord:hover {
    color: var(--orange);
  }
  /* the sanctioned orange dot — marks each 8-bar downbeat chord */
  .chip.accent::before {
    content: '';
    position: absolute;
    top: 0.12rem;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--orange);
  }
  .chip.on {
    color: var(--ink);
    font-weight: 700;
    border-bottom: 2px solid var(--orange);
  }
  .chip.flat {
    color: var(--soft);
    font-weight: 500;
    cursor: default;
  }
  .chip.flat:hover {
    color: var(--soft);
  }
  .chip.flat strong {
    color: var(--ink);
    font-weight: 700;
  }
  .keyrow {
    display: flex;
    align-items: center;
    gap: 1.1rem;
    flex-wrap: wrap;
    padding-top: 1.3rem;
    border-top: 1px solid var(--hair);
  }
  .klabel {
    font-size: 0.64rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--soft);
  }

  /* ── Grid: airy bar strip, marks not boxes ── */
  .barstrip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
    gap: 1.1rem 0.9rem;
    margin-bottom: 2rem;
  }
  .cell {
    background: transparent;
    padding: 0.5rem 0.1rem 0;
    display: grid;
    gap: 0.45rem;
    border-top: 1px solid var(--hair);
  }
  .barno {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--soft);
  }
  .cell.down {
    border-top-color: color-mix(in oklch, var(--orange) 55%, transparent);
  }
  .cell.down .barno {
    color: var(--orange);
    font-weight: 700;
  }
  .beats {
    display: flex;
    gap: 3px;
  }
  .beat {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: color-mix(in oklch, var(--foreground) 14%, transparent);
  }
  .beat.one {
    background: color-mix(in oklch, var(--foreground) 40%, transparent);
  }

  /* ── Sections: an airy typographic list ── */
  .sections {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .srow {
    position: relative;
    display: grid;
    grid-template-columns: 7rem 3.5rem 1fr auto;
    align-items: baseline;
    gap: 1.1rem;
    padding: 0.95rem 0.25rem 0.95rem 1.1rem;
    border-bottom: 1px solid var(--hair);
    line-height: 1.5;
  }
  /* slim colour tick */
  .srow::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 1.05rem;
    border-radius: 2px;
    background: var(--c);
  }
  .skind {
    font-size: 0.64rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--soft);
  }
  .srange {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--soft);
  }
  .sname {
    font-weight: 600;
    font-size: 1.02rem;
    letter-spacing: -0.01em;
  }
  .srow-actions {
    display: inline-flex;
    gap: 0.35rem;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .srow:hover .srow-actions {
    opacity: 1;
  }
  .icon {
    width: 1.4rem;
    height: 1.4rem;
    border: 0;
    background: transparent;
    color: var(--soft);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.78rem;
    transition: color 120ms ease;
  }
  .icon:hover {
    color: var(--orange);
  }

  /* ── Lyrics: quiet, well-set lines ── */
  .lyrics {
    display: grid;
    gap: 0.65rem;
    margin-bottom: 2rem;
  }
  .lline {
    margin: 0;
    font-size: 1.12rem;
    font-weight: 500;
    line-height: 1.65;
    padding: 0;
    display: flex;
    gap: 1.1rem;
    color: var(--ink);
  }
  .lno {
    font-family: var(--font-mono);
    color: var(--soft);
    font-size: 0.72rem;
    width: 1.3rem;
    flex-shrink: 0;
    padding-top: 0.35rem;
  }

  .hint {
    font-size: 0.72rem;
    color: var(--soft);
    margin: 1.1rem 0 0;
    letter-spacing: 0.02em;
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
      gap: 0.6rem;
    }
    .ctx-tabs {
      gap: 0.7rem;
    }
    .srow {
      grid-template-columns: 6rem 1fr auto;
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
