<script lang="ts">
  /** Navigation hub for the edit-mode style explorations. Debug only. */
  const variants = [
    {
      href: '/debug/edit-style/current',
      name: 'Current',
      kicker: 'Grounded baseline',
      body: "A faithful copy of today's /edit — real header, 7-tab bar, EditSectionToolbar panels — with ONE interactive waveform above the tabs, shared across all of them (zoom/pan persists when you switch).",
    },
    {
      href: '/debug/edit-style/base',
      name: 'Base',
      kicker: 'Reference',
      body: 'The converged layout — tabs folded into the context bar, in its own styling. The neutral baseline.',
    },
    {
      href: '/debug/edit-style/brutal',
      name: 'Brutalist',
      kicker: 'Confident',
      body: 'Leans into the studio brand — chunky ink tab chips with hard shadows, Arial Black punch, bold framed waveform.',
    },
    {
      href: '/debug/edit-style/editorial',
      name: 'Editorial',
      kicker: 'Calm',
      body: 'Magazine minimalism — whitespace and hairlines only, no fills; orange used surgically as an accent.',
    },
    {
      href: '/debug/edit-style/daw',
      name: 'Pro-tool',
      kicker: 'Dense',
      body: 'DAW efficiency — tight rhythm, mono numerics everywhere, compact segmented tabs, more above the fold.',
    },
    {
      href: '/debug/edit-style/soft',
      name: 'Soft studio',
      kicker: 'Warm',
      body: 'Rounded and friendly — pill tabs, section cards tinted in their kind-colour, soft diffuse shadows.',
    },
  ]
</script>

<svelte:head>
  <title>Edit style lab — BarBro</title>
</svelte:head>

<main class="hub">
  <header>
    <p class="kicker">Edit style lab</p>
    <h1>Pick a direction</h1>
    <p class="sub">
      Each renders directly on the page under the real navbar — same locked structure (navbar untouched, edit tabs
      folded into the context bar, constant content), different visual treatment. Switch anytime from the floating bar.
    </p>
  </header>

  <section aria-label="Style variants">
    {#each variants as v (v.href)}
      <a href={v.href}>
        <span class="v-kicker">{v.kicker}</span>
        <strong>{v.name}</strong>
        <em>{v.body}</em>
        <span class="go">Open →</span>
      </a>
    {/each}
  </section>
</main>

<style>
  .hub {
    min-height: 100%;
    background:
      radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--foreground) 9%, transparent) 1px, transparent 1.5px),
      var(--background);
    background-size: 20px 20px;
    color: var(--foreground);
    padding: clamp(20px, 4vw, 48px);
  }
  header {
    max-width: 960px;
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
    font-size: clamp(2.2rem, 7vw, 4.5rem);
    line-height: 0.92;
  }
  .sub {
    margin: 0.6rem 0 0;
    max-width: 68ch;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.4;
    color: var(--muted-foreground);
  }
  section {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
    max-width: 960px;
    margin: 0 auto;
  }
  a {
    display: grid;
    gap: 0.5rem;
    align-content: start;
    min-height: 170px;
    padding: 1.1rem;
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
  .v-kicker {
    font-size: 0.66rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted-foreground);
  }
  strong {
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1;
  }
  em {
    font-style: normal;
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--muted-foreground);
  }
  .go {
    margin-top: auto;
    font-size: 0.8rem;
    font-weight: 900;
    color: var(--foreground);
  }
</style>
