<script lang="ts">
  const pages = [
    {
      href: '/debug/project-style',
      title: 'Project Style Lab',
      kicker: 'Color identity',
      body: 'Project-page styling directions using the currently loaded project when available.',
    },
    {
      href: '/debug/typography',
      title: 'Typography',
      kicker: 'Type systems',
      body: 'Logo and font experiments for the wider BarBro UI.',
    },
    {
      href: '/debug/chord-bias',
      title: 'Chord Bias',
      kicker: 'Analysis harness',
      body: 'Compare chord suggestion bias settings against placed chords.',
    },
  ]
</script>

<svelte:head>
  <title>Debug - BarBro</title>
</svelte:head>

<main class="debug-home">
  <header>
    <p>Debug</p>
    <h1>BarBro lab</h1>
  </header>

  <section aria-label="Debug pages">
    {#each pages as page (page.href)}
      <a href={page.href}>
        <span>{page.kicker}</span>
        <strong>{page.title}</strong>
        <em>{page.body}</em>
      </a>
    {/each}
  </section>
</main>

<style>
  .debug-home {
    --ink: var(--studio-ink);
    --paper: var(--studio-paper);
    --panel: var(--studio-panel);
    min-height: 100dvh;
    background:
      radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--ink) 13%, transparent) 1px, transparent 1.5px),
      var(--paper);
    background-size: 18px 18px;
    color: var(--ink);
    padding: clamp(18px, 4vw, 48px);
  }

  header {
    display: grid;
    gap: 0.35rem;
    max-width: 960px;
    margin: 0 auto clamp(18px, 4vw, 40px);
  }

  p,
  h1 {
    margin: 0;
  }

  p,
  span {
    font-size: 0.72rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  h1 {
    font-family: var(--font-display);
    font-size: clamp(2.6rem, 8vw, 6rem);
    line-height: 0.92;
  }

  section {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    max-width: 960px;
    margin: 0 auto;
  }

  a {
    display: grid;
    gap: 0.55rem;
    min-height: 170px;
    align-content: start;
    border: 3px solid var(--ink);
    background: var(--panel);
    color: inherit;
    padding: 1rem;
    text-decoration: none;
    box-shadow: 4px 4px 0 var(--ink);
    transition:
      transform 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease;
  }

  a:hover {
    transform: translate(2px, 2px);
    background: var(--studio-orange);
    box-shadow: 2px 2px 0 var(--ink);
  }

  strong {
    font-family: var(--font-display);
    font-size: 1.45rem;
    line-height: 1;
  }

  em {
    max-width: 24ch;
    font-size: 0.9rem;
    font-style: normal;
    font-weight: 700;
    line-height: 1.25;
  }

  @media (max-width: 760px) {
    section {
      grid-template-columns: 1fr;
    }
  }
</style>
