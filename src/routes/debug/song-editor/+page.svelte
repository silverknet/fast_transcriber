<script lang="ts">
  /** Song Edit design-exploration hub. Debug only. */
  import { meta } from '$lib/debug/songEditorFixture'

  const versions = [
    {
      href: '/debug/song-editor/version-1',
      n: '1',
      name: 'Compact DAW workspace',
      thesis:
        'One continuous window: a slim persistent command bar (identity · transport · save · mode switch) over a fixed waveform SPINE, with a dense flat tool surface below. Minimal chrome, maximal workspace.',
    },
    {
      href: '/debug/song-editor/version-2',
      n: '2',
      name: 'Three-pane inspector IDE',
      thesis:
        'Left mode-rail · centre workspace · right contextual inspector. Secondary controls move into a persistent inspector that changes per mode; predictable placement, dense and professional.',
    },
    {
      href: '/debug/song-editor/version-3',
      n: '3',
      name: 'Persistent waveform, tabs as layers',
      thesis:
        'The tab swap is gone. One always-present shared waveform; Grid / Sections / Chords / Cue / Lyrics become toggleable time-aligned LAYERS you light up in place — the viewport never rebuilds.',
    },
    {
      href: '/debug/song-editor/version-4',
      n: '4',
      name: 'Aligned-lane arrangement',
      thesis:
        'A DAW arrangement: waveform, grid, sections, chords, lyrics, cues and stems as horizontally time-aligned LANES sharing one ruler + zoom. Relationships between everything are readable at a glance.',
    },
    {
      href: '/debug/song-editor/version-5',
      n: '5',
      name: 'Document + pinned timeline',
      thesis:
        'A smart musical DOCUMENT: a pinned transport + minimap over a scrolling lead-sheet chart (chords over lyrics, section headings, bar margins), with an outline for section navigation and modes as focused tools.',
    },
  ]
</script>

<svelte:head>
  <title>Song Edit — design exploration</title>
</svelte:head>

<main class="hub">
  <header>
    <p class="kicker">Design exploration</p>
    <h1>Song Edit — five directions</h1>
    <p class="sub">
      Five structurally different editor models for the Song Edit page, each covering all seven modes and rendering
      the same real song — <strong>{meta.title}</strong> · {meta.artist} · {meta.bpm} BPM · {meta.keyLabel} · {meta.bars} bars.
      Read-only prototypes: the goal is to compare information architecture, density and navigation, not functionality.
      Flip between them with the floating bar.
    </p>
  </header>

  <section aria-label="Versions">
    {#each versions as v (v.href)}
      <a href={v.href}>
        <span class="num">{v.n}</span>
        <strong>{v.name}</strong>
        <em>{v.thesis}</em>
        <span class="go">Open →</span>
      </a>
    {/each}
  </section>

  <p class="foot">
    Full write-up, tradeoffs and the comparison table live in <code>SONG_EDITOR_DESIGN_EXPLORATION.md</code>.
  </p>
</main>

<style>
  .hub {
    min-height: 100%;
    background:
      radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--foreground) 9%, transparent) 1px, transparent 1.5px),
      var(--background);
    background-size: 20px 20px;
    color: var(--foreground);
    padding: clamp(20px, 4vw, 48px) clamp(16px, 4vw, 48px) 80px;
  }
  header {
    max-width: 1000px;
    margin: 0 auto clamp(18px, 3vw, 32px);
  }
  .kicker {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--studio-orange);
  }
  h1 {
    margin: 0.2rem 0 0;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 6vw, 4.2rem);
    line-height: 0.92;
  }
  .sub {
    margin: 0.7rem 0 0;
    max-width: 78ch;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.45;
    color: var(--muted-foreground);
  }
  .sub strong {
    color: var(--foreground);
  }
  section {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
    max-width: 1000px;
    margin: 0 auto;
  }
  a {
    position: relative;
    display: grid;
    gap: 0.5rem;
    align-content: start;
    min-height: 190px;
    padding: 1.15rem 1.15rem 1.3rem;
    border: 2px solid var(--foreground);
    border-radius: var(--radius);
    background: var(--card);
    color: inherit;
    text-decoration: none;
    box-shadow: 5px 5px 0 var(--brutalist-shadow-color);
    transition:
      transform 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease;
  }
  a:hover {
    transform: translate(2px, 2px);
    box-shadow: 2px 2px 0 var(--brutalist-shadow-color);
    background: color-mix(in oklch, var(--studio-orange) 12%, var(--card));
  }
  .num {
    font-family: var(--font-display);
    font-size: 1.1rem;
    width: 1.9rem;
    height: 1.9rem;
    display: grid;
    place-items: center;
    background: var(--foreground);
    color: var(--background);
    border-radius: var(--radius);
  }
  strong {
    font-family: var(--font-display);
    font-size: 1.35rem;
    line-height: 1.02;
  }
  em {
    font-style: normal;
    font-size: 0.88rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--muted-foreground);
  }
  .go {
    margin-top: auto;
    font-size: 0.8rem;
    font-weight: 900;
    color: var(--foreground);
  }
  .foot {
    max-width: 1000px;
    margin: clamp(20px, 3vw, 32px) auto 0;
    font-size: 0.8rem;
    color: var(--muted-foreground);
  }
  .foot code {
    font-family: var(--font-mono);
    background: color-mix(in oklch, var(--foreground) 8%, transparent);
    padding: 0.1rem 0.35rem;
    border-radius: 2px;
  }
</style>
