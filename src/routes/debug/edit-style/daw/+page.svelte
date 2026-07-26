<script lang="ts">
  /**
   * Edit chrome study (debug / mock) — direction: "Pro-tool density".
   *
   * DAW efficiency (Ableton / Logic side panels): compact, information-dense,
   * rigorously organized. Tight vertical rhythm, small boxy controls, mono
   * tabular numerics wherever a number appears. The edit tabs fold INTO the
   * context bar as a tight, low-profile segmented control. Palette is muted and
   * restrained — orange is reserved for the transport, the active tab, and the
   * playhead only.
   *
   * Hard constraints from the brief:
   *   • the BARBRO navbar stays EXACTLY as it is (untouched);
   *   • the ProjectContextBar keeps its identity (h-8, orange tint, "Back",
   *     divider, 📂 project / song crumb) — the edit tabs live IN it;
   *   • the content surfaces (waveform + grid / chords / sections / lyrics)
   *     are unchanged, switched via the existing `tab` state.
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
  <title>Edit · Pro-tool — BarBro lab</title>
</svelte:head>

<main class="lab">
  <div class="head">
    <span class="kicker">Edit · Pro-tool density</span>
    <p>
      DAW-style restyle — the edit tabs fold into the context bar as a
      <strong>low-profile segmented control</strong>, mono tabular numerics run everywhere numbers
      appear, and orange is held back for the transport, the active tab, and the playhead. Click a
      tab to switch content.
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

      <!-- ═══ CONTEXT BAR — same identity, edit tabs folded in as a segmented control ═══ -->
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
        <!-- tight, low-profile segmented control -->
        <div class="seg" role="tablist" aria-label="Edit mode">
          {#each TABS as t (t.id)}
            <button
              class="seg-btn"
              class:active={tab === t.id}
              role="tab"
              aria-selected={tab === t.id}
              onclick={() => (tab = t.id)}
            >
              {t.label}
            </button>
          {/each}
        </div>
        <span class="ctx-div"></span>
        <button class="ctx-play" aria-label="Play">▶</button>
      </div>

      <!-- ═══ Waveform (section-colour bands) ═══ -->
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
              <span class="band-range num">{s.from}–{s.to}</span>
            </span>
          {/each}
        </div>
      </div>

      <!-- ═══ Slim toolbar strip (mono readout + compact boxy actions) ═══ -->
      <div class="toolbar">
        <span class="tb-tab">{labelOf(tab)}</span>
        <span class="tb-sep"></span>
        <span class="tb-meta num">{song.bars} bars</span>
        <span class="tb-meta num">♩ {song.bpm}</span>
        <span class="tb-meta num">Key {song.key}</span>
        <span class="spacer"></span>
        {#each actionsOf[tab] as a, i (a)}
          <button class="tb-act" class:solid={i === actionsOf[tab].length - 1}>{a}</button>
        {/each}
        <button class="tb-help" aria-label="{labelOf(tab)} help">?</button>
      </div>

      <!-- ═══ Content surface ═══ -->
      <div class="content">
        {#if tab === 'chords'}
          <div class="chordgrid">
            {#each chordRow as c, i (i)}
              <div class="cchip" class:accent={i % 8 === 0}>
                <span class="cbar num">{i + 1}</span>
                <span class="cname num">{c}</span>
              </div>
            {/each}
          </div>
          <div class="keyrow">
            <span class="klabel">Key</span>
            {#each ['C', 'G', 'D', 'A', 'E', 'Am', 'Em'] as k (k)}
              <button class="pill num" class:on={k === song.key}>{k}</button>
            {/each}
          </div>
        {:else if tab === 'grid'}
          <div class="barstrip">
            {#each Array(28) as _, i (i)}
              <div class="cell" class:down={i % 4 === 0}>
                <span class="barno num">{i + 1}</span>
                <div class="beats">{#each Array(4) as _b, b (b)}<span class="beat" class:one={b === 0}></span>{/each}</div>
              </div>
            {/each}
          </div>
          <div class="keyrow">
            <span class="klabel">Meter</span>
            {#each ['4/4', '3/4', '6/8'] as m (m)}<button class="pill num" class:on={m === '4/4'}>{m}</button>{/each}
            <span class="pill num flat">{song.bpm} BPM</span>
          </div>
        {:else if tab === 'sections'}
          <div class="sectbl" role="table" aria-label="Sections">
            <div class="strow sthead" role="row">
              <span role="columnheader">Kind</span>
              <span role="columnheader">Bars</span>
              <span role="columnheader">Label</span>
              <span role="columnheader" class="sr-actions-h"></span>
            </div>
            {#each sections as s (s.label + s.from)}
              <div class="strow" role="row" style:--c={sectionKindColor(s.kind)}>
                <span class="skind" role="cell">{s.kind}</span>
                <span class="srange num" role="cell">{s.from}–{s.to}</span>
                <span class="sname" role="cell">{s.label}</span>
                <span class="sr-actions" role="cell">
                  <button class="icon" aria-label="Rename">✎</button>
                  <button class="icon" aria-label="Delete">✕</button>
                </span>
              </div>
            {/each}
          </div>
        {:else if tab === 'lyrics'}
          <div class="lyrics">
            {#each lyricLines as line, i (i)}
              <p class="lline"><span class="lno num">{String(i + 1).padStart(2, '0')}</span>{line}</p>
            {/each}
          </div>
          <div class="keyrow">
            <span class="pill num flat">Draft <strong>Sheet import</strong></span>
            <span class="pill num flat">{lyricLines.join(' ').trim().split(/\s+/).length} words</span>
            <span class="pill num flat">{lyricLines.length} lines · timed</span>
          </div>
        {/if}
      </div>
    </div>

    <p class="hint num">grey = navbar (untouched) · orange-tint = context bar (tabs folded in) · orange = transport / active tab / playhead only</p>
  </div>
</main>

<style>
  .lab {
    --paper: var(--background);
    --panel: var(--card);
    --ink: var(--foreground);
    --soft: var(--muted-foreground);
    --line: color-mix(in oklch, var(--foreground) 12%, transparent);
    --line-strong: color-mix(in oklch, var(--foreground) 24%, transparent);
    --fill: color-mix(in oklch, var(--foreground) 5%, transparent);
    --fill-hover: color-mix(in oklch, var(--foreground) 10%, transparent);
    --emph: color-mix(in oklch, var(--foreground) 45%, transparent);
    --orange: var(--studio-orange);
    /* exact context-bar surfaces from ProjectContextBar.svelte */
    --ctx-bg: color-mix(in oklch, var(--studio-orange) 5%, var(--card));
    --accent-hover: color-mix(in oklch, var(--studio-orange) 18%, white);
    min-height: 100dvh;
    background: var(--paper);
    color: var(--ink);
    padding: clamp(12px, 2.4vw, 26px);
    font-feature-settings: 'tnum' 1;
  }
  :global(.dark) .lab {
    --ctx-bg: color-mix(in oklch, var(--studio-orange) 8%, var(--card));
    --accent-hover: color-mix(in oklch, var(--foreground) 12%, var(--card));
  }

  .head {
    max-width: 1040px;
    margin: 0 auto clamp(10px, 1.6vw, 16px);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--orange);
  }
  .head p {
    margin: 0.2rem 0 0;
    font-size: 0.86rem;
    font-weight: 500;
    line-height: 1.45;
    color: var(--soft);
    max-width: 78ch;
  }
  .head strong {
    color: var(--ink);
    font-weight: 700;
  }

  .stage {
    max-width: 1040px;
    margin: 0 auto;
  }
  .appframe {
    border: 2px solid var(--ink);
    border-radius: var(--radius);
    background: var(--paper);
    box-shadow: 4px 4px 0 var(--brutalist-shadow-color);
    overflow: hidden;
  }
  .spacer {
    flex: 1;
  }
  /* every number in the UI is mono + tabular */
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1;
  }

  /* ── NAVBAR (untouched mock) ── */
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
    border-radius: var(--radius);
  }
  .menu-btn i {
    font-style: normal;
    opacity: 0.6;
    font-size: 0.7em;
  }
  .menu-btn:hover {
    background: var(--fill);
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
    background: var(--fill);
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

  /* ── CONTEXT BAR — matches ProjectContextBar, tabs folded in ── */
  .ctxbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: 2rem;
    padding: 0 0.6rem;
    background: var(--ctx-bg);
    color: var(--ink);
    font-size: 0.8125rem;
    border-bottom: 1px solid var(--line);
  }
  .ctx-back {
    display: inline-flex;
    align-items: center;
    height: 1.4rem;
    padding: 0 0.45rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .ctx-back:hover {
    background: var(--accent-hover);
  }
  .ctx-div {
    width: 1px;
    height: 1.2rem;
    background: color-mix(in oklch, var(--foreground) 25%, transparent);
    flex-shrink: 0;
  }
  .crumb {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }
  .folder {
    opacity: 0.7;
    font-size: 0.85rem;
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
    font-size: 0.72rem;
    color: var(--soft);
    white-space: nowrap;
  }
  /* low-profile segmented control — one boxed unit, hairline dividers */
  .seg {
    display: inline-flex;
    flex-shrink: 0;
    height: 1.4rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: color-mix(in oklch, var(--foreground) 4%, transparent);
    overflow: hidden;
  }
  .seg-btn {
    height: 100%;
    padding: 0 0.55rem;
    border: 0;
    border-left: 1px solid var(--line);
    background: transparent;
    color: var(--soft);
    font: inherit;
    font-weight: 700;
    font-size: 0.75rem;
    letter-spacing: 0.01em;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color 110ms ease,
      color 110ms ease;
  }
  .seg-btn:first-child {
    border-left: 0;
  }
  .seg-btn:hover {
    background: var(--fill-hover);
    color: var(--ink);
  }
  .seg-btn.active {
    background: var(--orange);
    color: #1a1a1a;
  }
  .ctx-play {
    width: 1.4rem;
    height: 1.4rem;
    border: 0;
    border-radius: var(--radius);
    background: var(--orange);
    color: #1a1a1a;
    display: grid;
    place-items: center;
    font-size: 0.6rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .ctx-play:hover {
    filter: brightness(1.06);
  }

  /* ── Waveform ── */
  .wave-wrap {
    padding: 0.5rem 0.6rem 0.45rem;
    display: grid;
    gap: 0.3rem;
    border-bottom: 1px solid var(--line);
    background: color-mix(in oklch, var(--foreground) 2.5%, var(--paper));
  }
  .wave {
    position: relative;
    height: clamp(58px, 9vw, 84px);
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .peak {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 1px;
    opacity: 0.82;
  }
  .playhead {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--orange);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--orange) 22%, transparent);
  }
  .wave-strip {
    display: flex;
    gap: 2px;
    height: 15px;
  }
  .band {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding-left: 0.3rem;
    border-radius: 2px;
    background: color-mix(in oklch, var(--c) 20%, transparent);
    border-left: 3px solid var(--c);
    overflow: hidden;
    min-width: 0;
  }
  .band-label {
    font-size: 0.54rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    white-space: nowrap;
    color: var(--ink);
    opacity: 0.72;
  }
  .band-range {
    font-size: 0.5rem;
    color: var(--ink);
    opacity: 0.5;
    white-space: nowrap;
  }

  /* ── Slim toolbar strip ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    height: 1.85rem;
    padding: 0 0.6rem;
    border-bottom: 1px solid var(--line);
    background: color-mix(in oklch, var(--foreground) 3.5%, var(--paper));
  }
  .tb-tab {
    font-size: 0.62rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink);
  }
  .tb-sep {
    width: 1px;
    height: 0.9rem;
    background: var(--line-strong);
  }
  .tb-meta {
    font-size: 0.68rem;
    color: var(--soft);
    white-space: nowrap;
  }
  .tb-act {
    font: inherit;
    font-weight: 700;
    font-size: 0.68rem;
    height: 1.4rem;
    padding: 0 0.5rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 110ms ease;
  }
  .tb-act:hover {
    background: var(--fill-hover);
  }
  .tb-act.solid {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .tb-act.solid:hover {
    filter: brightness(1.1);
  }
  .tb-help {
    width: 1.4rem;
    height: 1.4rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: transparent;
    color: var(--soft);
    font-size: 0.66rem;
    font-weight: 900;
    cursor: pointer;
  }
  .tb-help:hover {
    background: var(--fill-hover);
    color: var(--ink);
  }

  /* ── Content ── */
  .content {
    padding: 0.7rem 0.75rem 0.9rem;
  }

  /* chords — dense grid, mono bar index + mono chord */
  .chordgrid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 0.28rem;
    margin-bottom: 0.7rem;
  }
  .cchip {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem;
    padding: 0.34rem 0.45rem;
    background: var(--fill);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .cchip:hover {
    background: var(--fill-hover);
  }
  .cchip.accent {
    border-left: 3px solid var(--emph);
  }
  .cbar {
    font-size: 0.6rem;
    color: var(--soft);
  }
  .cname {
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--ink);
  }

  .keyrow {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    padding-top: 0.65rem;
    border-top: 1px solid var(--line);
  }
  .klabel {
    font-size: 0.62rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--soft);
    margin-right: 0.15rem;
  }
  .pill {
    font-size: 0.72rem;
    font-weight: 700;
    background: var(--fill);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }
  .pill:hover {
    background: var(--fill-hover);
  }
  .pill.on {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .pill.flat {
    background: transparent;
    color: var(--soft);
    border-color: transparent;
    cursor: default;
  }
  .pill.flat strong {
    color: var(--ink);
    font-weight: 800;
  }

  /* grid — thin bar cells */
  .barstrip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
    gap: 0.28rem;
    margin-bottom: 0.7rem;
  }
  .cell {
    background: var(--fill);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.28rem 0.3rem 0.34rem;
    display: grid;
    gap: 0.26rem;
  }
  .cell.down {
    border-left: 3px solid var(--emph);
  }
  .barno {
    font-size: 0.64rem;
    font-weight: 700;
    color: var(--soft);
  }
  .beats {
    display: flex;
    gap: 2px;
  }
  .beat {
    flex: 1;
    height: 5px;
    border-radius: 1px;
    background: color-mix(in oklch, var(--foreground) 20%, transparent);
  }
  .beat.one {
    background: var(--emph);
  }

  /* sections — tight table with mono ranges */
  .sectbl {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .strow {
    display: grid;
    grid-template-columns: 6.5rem 4.5rem 1fr auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.28rem 0.5rem 0.28rem 0.55rem;
    border-bottom: 1px solid var(--line);
    border-left: 3px solid var(--c);
  }
  .strow:last-child {
    border-bottom: 0;
  }
  .strow:hover:not(.sthead) {
    background: color-mix(in oklch, var(--c) 8%, transparent);
  }
  .sthead {
    border-left: 3px solid transparent;
    background: color-mix(in oklch, var(--foreground) 5%, transparent);
  }
  .sthead span {
    font-size: 0.58rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--soft);
  }
  .skind {
    font-size: 0.62rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: color-mix(in oklch, var(--c) 66%, var(--ink));
  }
  .srange {
    font-size: 0.72rem;
    color: var(--soft);
  }
  .sname {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--ink);
  }
  .sr-actions {
    display: inline-flex;
    gap: 0.1rem;
    opacity: 0;
  }
  .strow:hover .sr-actions {
    opacity: 1;
  }
  .icon {
    width: 1.3rem;
    height: 1.3rem;
    border: 0;
    background: transparent;
    color: var(--soft);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.72rem;
  }
  .icon:hover {
    background: var(--fill-hover);
    color: var(--ink);
  }

  /* lyrics — mono line numbers, tight rows */
  .lyrics {
    display: grid;
    gap: 0.05rem;
    margin-bottom: 0.7rem;
  }
  .lline {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 500;
    padding: 0.22rem 0.35rem;
    border-radius: var(--radius);
    display: flex;
    gap: 0.65rem;
    align-items: baseline;
  }
  .lline:hover {
    background: var(--fill);
  }
  .lno {
    color: var(--soft);
    font-size: 0.66rem;
    width: 1.4rem;
    flex-shrink: 0;
  }

  .hint {
    font-size: 0.66rem;
    color: var(--soft);
    margin: 0.6rem 0 0;
  }

  @media (max-width: 820px) {
    .chordgrid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .menugroup,
    .proj,
    .slash {
      display: none;
    }
    .ctxbar {
      gap: 0.4rem;
    }
    .toolbar {
      flex-wrap: wrap;
      height: auto;
      padding: 0.3rem 0.6rem;
      gap: 0.35rem;
    }
    .tb-meta:nth-of-type(2),
    .band-range {
      display: none;
    }
    .strow {
      grid-template-columns: 5.5rem 1fr auto;
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
