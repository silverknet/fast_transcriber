<script lang="ts">
  /**
   * Typography exploration sandbox.
   *
   * Three candidate font systems with a unique BARBRO logo treatment for
   * each. Display headings (the big "Edit" / "Welcome"-style) stay on the
   * existing Arial Black `--font-sans` — these systems are about everything
   * else (body, UI, mono, captions).
   *
   * The winner ships by overwriting `--font-sans` (or adding paired
   * `--font-display` + `--font-body`) in `src/app.css`.
   */
</script>

<main class="mx-auto max-w-5xl px-6 py-12 space-y-16">
  <header class="space-y-2 border-b-2 border-foreground pb-6">
    <p class="text-xs uppercase tracking-[0.2em] text-muted-foreground">debug · typography</p>
    <h1 class="text-4xl font-black tracking-tight">Type sandbox</h1>
    <p class="text-sm text-muted-foreground max-w-xl">
      Three candidate font systems for body / UI / mono. Big display
      headings stay on the current Arial Black; these are alternatives for
      the surrounding text. Each system gets its own BARBRO logo to show
      personality.
    </p>
  </header>

  <!-- ── System 1: Brutalist Editorial ─────────────────────────────── -->
  <section class="space-y-6">
    <div class="flex items-baseline justify-between gap-4 border-b border-foreground/20 pb-2">
      <p class="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">System 01</p>
      <p class="text-xs font-mono text-muted-foreground">
        Bricolage Grotesque · IBM Plex Mono
      </p>
    </div>

    <!-- Logo 1: letterpress slab with offset cyan shadow + grainy fill -->
    <div class="flex items-center justify-center py-10">
      <div class="logo-brutal relative">
        <span class="logo-brutal-shadow" aria-hidden="true">BARBRO</span>
        <span class="logo-brutal-main">BARBRO</span>
        <span class="logo-brutal-stamp" aria-hidden="true">®</span>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2 font-brutal">
      <article class="space-y-3">
        <h2 class="text-2xl font-bold tracking-tight">Bar-first songmaps for the live set</h2>
        <p class="text-base leading-relaxed text-foreground/80">
          The grid editor lays out every beat, every section, every chord on the
          same canvas — what you hear in BarBro is exactly what plays in Ableton
          when you fire the scene.
        </p>
        <p class="text-sm text-foreground/60">
          Smaller paragraph. Good for descriptions, helper text, settings panels.
          The wider Bricolage letterforms feel friendly without being cute.
        </p>
        <p class="font-mono text-xs text-muted-foreground">
          IBM Plex Mono · bar 41 · beat 3 · trim 1.245s
        </p>
      </article>

      <article class="space-y-2">
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">UI label</p>
        <p class="text-xs uppercase tracking-wider font-semibold">Drums · Bass · Guitar · Vocals · FX</p>
        <p class="text-sm">Body sample 14px — the workhorse weight.</p>
        <p class="text-base">Body sample 16px — comfortable read.</p>
        <p class="text-lg font-medium">Heading sample 18px medium.</p>
        <p class="text-xl font-semibold">Heading sample 20px semibold.</p>
      </article>
    </div>
  </section>

  <!-- ── System 2: Swiss / Modern ──────────────────────────────────── -->
  <section class="space-y-6">
    <div class="flex items-baseline justify-between gap-4 border-b border-foreground/20 pb-2">
      <p class="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">System 02</p>
      <p class="text-xs font-mono text-muted-foreground">Inter · JetBrains Mono</p>
    </div>

    <!-- Logo 2: gradient flowing through tight tracking + underline marker -->
    <div class="flex items-center justify-center py-10">
      <div class="logo-swiss">
        <span class="logo-swiss-letters">BARBRO</span>
        <span class="logo-swiss-marker" aria-hidden="true"></span>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2 font-swiss">
      <article class="space-y-3">
        <h2 class="text-2xl font-semibold tracking-tight">Bar-first songmaps for the live set</h2>
        <p class="text-base leading-relaxed text-foreground/80">
          The grid editor lays out every beat, every section, every chord on the
          same canvas — what you hear in BarBro is exactly what plays in Ableton
          when you fire the scene.
        </p>
        <p class="text-sm text-foreground/60">
          Smaller paragraph. Good for descriptions, helper text, settings panels.
          Inter is the safest, most-tested UI font; subtle, gets out of the way.
        </p>
        <p class="font-mono text-xs text-muted-foreground tabular-nums">
          JetBrains Mono · bar 41 · beat 3 · trim 1.245s
        </p>
      </article>

      <article class="space-y-2">
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">UI label</p>
        <p class="text-xs uppercase tracking-wider font-semibold">Drums · Bass · Guitar · Vocals · FX</p>
        <p class="text-sm">Body sample 14px — the workhorse weight.</p>
        <p class="text-base">Body sample 16px — comfortable read.</p>
        <p class="text-lg font-medium">Heading sample 18px medium.</p>
        <p class="text-xl font-semibold">Heading sample 20px semibold.</p>
      </article>
    </div>
  </section>

  <!-- ── System 3: Geometric Display ───────────────────────────────── -->
  <section class="space-y-6">
    <div class="flex items-baseline justify-between gap-4 border-b border-foreground/20 pb-2">
      <p class="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">System 03</p>
      <p class="text-xs font-mono text-muted-foreground">Space Grotesk · Geist Mono</p>
    </div>

    <!-- Logo 3: BAR · BRO with vertical offset between the two words. -->
    <div class="flex items-center justify-center py-10">
      <div class="logo-geo">
        <span class="logo-geo-bar">BAR</span>
        <span class="logo-geo-bro">BRO</span>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2 font-geo">
      <article class="space-y-3">
        <h2 class="text-2xl font-bold tracking-tight">Bar-first songmaps for the live set</h2>
        <p class="text-base leading-relaxed text-foreground/80">
          The grid editor lays out every beat, every section, every chord on the
          same canvas — what you hear in BarBro is exactly what plays in Ableton
          when you fire the scene.
        </p>
        <p class="text-sm text-foreground/60">
          Smaller paragraph. Good for descriptions, helper text, settings panels.
          Space Grotesk's geometric quirks give the chrome more character.
        </p>
        <p class="font-mono text-xs text-muted-foreground tabular-nums">
          Geist Mono · bar 41 · beat 3 · trim 1.245s
        </p>
      </article>

      <article class="space-y-2">
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">UI label</p>
        <p class="text-xs uppercase tracking-wider font-semibold">Drums · Bass · Guitar · Vocals · FX</p>
        <p class="text-sm">Body sample 14px — the workhorse weight.</p>
        <p class="text-base">Body sample 16px — comfortable read.</p>
        <p class="text-lg font-medium">Heading sample 18px medium.</p>
        <p class="text-xl font-semibold">Heading sample 20px semibold.</p>
      </article>
    </div>
  </section>

  <!-- ── System 4: Tabloid Punk ────────────────────────────────────── -->
  <section class="space-y-6">
    <div class="flex items-baseline justify-between gap-4 border-b border-foreground/20 pb-2">
      <p class="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">System 04</p>
      <p class="text-xs font-mono text-muted-foreground">Archivo Black · DM Mono</p>
    </div>

    <!-- Logo 4: hot-pink riso slab, slammed-together kerning, mis-registered overlay -->
    <div class="flex items-center justify-center py-12">
      <div class="logo-tabloid">
        <span class="logo-tabloid-back" aria-hidden="true">BARBRO</span>
        <span class="logo-tabloid-main">BARBRO</span>
        <span class="logo-tabloid-tag">EST. AGAIN</span>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2 font-tabloid">
      <article class="space-y-3">
        <h2 class="text-2xl font-black uppercase italic tracking-tight">Bar-first songmaps for the live set.</h2>
        <p class="text-base leading-relaxed text-foreground/80">
          The grid editor lays out every beat, every section, every chord on the
          same canvas — what you hear in BarBro is exactly what plays in Ableton
          when you fire the scene.
        </p>
        <p class="text-sm text-foreground/60">
          Smaller paragraph. Body text in this system stays brutalist but
          readable. Archivo Black headlines hit hard.
        </p>
        <p class="font-mono text-xs text-muted-foreground tabular-nums">
          DM MONO · BAR 41 · BEAT 3 · TRIM 1.245s
        </p>
      </article>

      <article class="space-y-2">
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">UI label</p>
        <p class="text-xs uppercase tracking-wider font-bold">Drums · Bass · Guitar · Vocals · FX</p>
        <p class="text-sm">Body sample 14px — the workhorse weight.</p>
        <p class="text-base">Body sample 16px — comfortable read.</p>
        <p class="text-lg font-bold italic">HEADING SAMPLE 18PX BOLD ITALIC.</p>
        <p class="text-xl font-bold uppercase">Heading sample 20px uppercase.</p>
      </article>
    </div>
  </section>

  <!-- ── System 5: Concrete Riot ───────────────────────────────────── -->
  <section class="space-y-6">
    <div class="flex items-baseline justify-between gap-4 border-b border-foreground/20 pb-2">
      <p class="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">System 05</p>
      <p class="text-xs font-mono text-muted-foreground">Big Shoulders Display · Spline Sans Mono</p>
    </div>

    <!-- Logo 5: industrial stencil, hard horizontal cut, repeating concrete bars -->
    <div class="flex items-center justify-center py-12">
      <div class="logo-concrete">
        <div class="logo-concrete-bars" aria-hidden="true"></div>
        <span class="logo-concrete-text">BARBRO</span>
        <div class="logo-concrete-stripe" aria-hidden="true">
          <span>SETLIST</span><span>·</span><span>SYSTEM</span><span>·</span><span>VOL.&nbsp;01</span>
        </div>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2 font-concrete">
      <article class="space-y-3">
        <h2 class="text-2xl font-black uppercase tracking-tight">Bar-first songmaps for the live set</h2>
        <p class="text-base leading-relaxed text-foreground/80">
          The grid editor lays out every beat, every section, every chord on the
          same canvas — what you hear in BarBro is exactly what plays in Ableton
          when you fire the scene.
        </p>
        <p class="text-sm text-foreground/60">
          Smaller paragraph. Big Shoulders condensed runs feel like signage —
          good for headers, labels, and any compact block that needs presence.
        </p>
        <p class="font-mono text-xs text-muted-foreground tabular-nums">
          Spline Sans Mono · bar 41 · beat 3 · trim 1.245s
        </p>
      </article>

      <article class="space-y-2">
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">UI label</p>
        <p class="text-xs uppercase tracking-wider font-black">Drums · Bass · Guitar · Vocals · FX</p>
        <p class="text-sm">Body sample 14px — the workhorse weight.</p>
        <p class="text-base">Body sample 16px — comfortable read.</p>
        <p class="text-lg font-bold uppercase">Heading sample 18px uppercase.</p>
        <p class="text-xl font-black uppercase">Heading sample 20px black.</p>
      </article>
    </div>
  </section>

  <!-- ── System 6: Xerox'd Zine ────────────────────────────────────── -->
  <section class="space-y-6">
    <div class="flex items-baseline justify-between gap-4 border-b border-foreground/20 pb-2">
      <p class="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">System 06</p>
      <p class="text-xs font-mono text-muted-foreground">Anton · Major Mono Display · VT323</p>
    </div>

    <!-- Logo 6: triple-photocopy, mis-registered RGB ghost, jittered glitch -->
    <div class="flex items-center justify-center py-12">
      <div class="logo-zine">
        <span class="logo-zine-r" aria-hidden="true">BARBRO</span>
        <span class="logo-zine-g" aria-hidden="true">BARBRO</span>
        <span class="logo-zine-b" aria-hidden="true">BARBRO</span>
        <span class="logo-zine-main">BARBRO</span>
        <span class="logo-zine-corner">→ ISSUE_07</span>
      </div>
    </div>

    <div class="grid gap-6 md:grid-cols-2 font-zine">
      <article class="space-y-3">
        <h2 class="text-2xl font-normal uppercase tracking-tight">BAR-FIRST SONGMAPS FOR THE LIVE SET</h2>
        <p class="text-base leading-relaxed text-foreground/80">
          The grid editor lays out every beat, every section, every chord on the
          same canvas — what you hear in BarBro is exactly what plays in Ableton
          when you fire the scene.
        </p>
        <p class="text-sm text-foreground/60">
          Smaller paragraph. The Anton/Major Mono pairing reads like a
          photocopied zine masthead — heavy commitment to a vibe.
        </p>
        <p class="font-mono text-xs text-muted-foreground tabular-nums">
          VT323 · BAR 41 · BEAT 3 · TRIM 1.245s
        </p>
      </article>

      <article class="space-y-2">
        <p class="text-[10px] uppercase tracking-widest text-muted-foreground">UI label</p>
        <p class="text-xs uppercase tracking-wider font-normal">DRUMS · BASS · GUITAR · VOCALS · FX</p>
        <p class="text-sm">Body sample 14px — the workhorse weight.</p>
        <p class="text-base">Body sample 16px — comfortable read.</p>
        <p class="text-lg uppercase">HEADING SAMPLE 18PX.</p>
        <p class="text-xl uppercase">HEADING SAMPLE 20PX.</p>
      </article>
    </div>
  </section>

  <footer class="border-t-2 border-foreground pt-6">
    <p class="text-xs text-muted-foreground">
      Pick one → ship by overwriting <code class="font-mono bg-muted px-1">--font-sans</code> /
      <code class="font-mono bg-muted px-1">--font-mono</code> in
      <code class="font-mono bg-muted px-1">src/app.css</code>.
    </p>
  </footer>
</main>

<style>
  /* ── Font stacks per system ─────────────────────────────────────── */
  .font-brutal {
    font-family: 'Bricolage Grotesque', 'Helvetica Neue', system-ui, sans-serif;
  }
  .font-brutal :global(.font-mono) {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
  }
  .font-swiss {
    font-family: 'Inter', 'Helvetica Neue', system-ui, sans-serif;
    font-feature-settings: 'cv11', 'ss01', 'ss03';
  }
  .font-swiss :global(.font-mono) {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .font-geo {
    font-family: 'Space Grotesk', 'Helvetica Neue', system-ui, sans-serif;
  }
  .font-geo :global(.font-mono) {
    font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
  }
  .font-tabloid {
    font-family: 'Archivo Black', 'Helvetica Neue', system-ui, sans-serif;
  }
  .font-tabloid :global(.font-mono) {
    font-family: 'DM Mono', ui-monospace, monospace;
  }
  .font-concrete {
    font-family: 'Big Shoulders Display', 'Impact', 'Helvetica Neue', system-ui, sans-serif;
    /* Big Shoulders is condensed and dense — bump line-height for readability. */
    line-height: 1.35;
  }
  .font-concrete :global(.font-mono) {
    font-family: 'Spline Sans Mono', ui-monospace, monospace;
  }
  .font-zine {
    font-family: 'Anton', 'Impact', sans-serif;
    letter-spacing: 0.01em;
  }
  .font-zine :global(.font-mono) {
    font-family: 'VT323', 'Major Mono Display', ui-monospace, monospace;
    font-size: 1.1em;
  }

  /* ── Logo 1: Brutalist letterpress ──────────────────────────────── */
  .logo-brutal {
    position: relative;
    font-family: 'Arial Black', 'Helvetica Neue', sans-serif;
    font-size: clamp(3.5rem, 9vw, 6rem);
    font-weight: 900;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .logo-brutal-main {
    position: relative;
    display: inline-block;
    color: var(--foreground);
    /* Subtle paper-grain via overlapping radial gradients (no images). */
    background-image:
      radial-gradient(circle at 20% 30%, var(--foreground) 0, var(--foreground) 60%, transparent 61%),
      radial-gradient(circle at 70% 60%, var(--foreground) 0, var(--foreground) 70%, transparent 71%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-stroke: 1px var(--foreground);
    filter: contrast(1.15);
  }
  .logo-brutal-shadow {
    position: absolute;
    inset: 0;
    color: oklch(0.72 0.18 195); /* cyan accent */
    transform: translate(8px, 8px);
    z-index: -1;
    user-select: none;
  }
  .logo-brutal-stamp {
    position: absolute;
    top: -0.4em;
    right: -1em;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.18em;
    letter-spacing: 0.2em;
    color: var(--foreground);
    transform: rotate(8deg);
    border: 1.5px solid var(--foreground);
    padding: 0.2em 0.5em;
  }

  /* ── Logo 2: Swiss gradient + marker ────────────────────────────── */
  .logo-swiss {
    position: relative;
    padding-bottom: 0.4em;
  }
  .logo-swiss-letters {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: clamp(3.5rem, 9vw, 6rem);
    font-weight: 700;
    letter-spacing: -0.08em;
    line-height: 1;
    background: linear-gradient(
      105deg,
      oklch(0.2 0.01 80) 0%,
      oklch(0.45 0.18 30) 50%,
      oklch(0.65 0.22 60) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    background-size: 200% 100%;
    animation: logo-swiss-sweep 8s ease-in-out infinite;
  }
  .logo-swiss-marker {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 0.18em;
    width: 2.2em;
    background: oklch(0.65 0.22 60);
    transform-origin: left;
    animation: logo-swiss-marker-slide 8s ease-in-out infinite;
  }
  @keyframes logo-swiss-sweep {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  @keyframes logo-swiss-marker-slide {
    0%, 100% { transform: scaleX(1); }
    50% { transform: scaleX(2.3); }
  }

  /* ── Logo 3: Geometric — BAR · BRO with vertical offset ─────────── */
  .logo-geo {
    display: inline-flex;
    align-items: baseline;
    /* Negative gap pulls the words right up against each other so the
       offset reads as deliberate, not a typo. */
    gap: 0.04em;
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-weight: 700;
    font-size: clamp(3.5rem, 9vw, 6rem);
    line-height: 0.9;
    letter-spacing: -0.05em;
    color: var(--foreground);
  }
  .logo-geo-bar,
  .logo-geo-bro {
    display: inline-block;
  }
  .logo-geo-bar {
    /* Sits a touch low. */
    transform: translateY(0.12em);
  }
  .logo-geo-bro {
    /* Sits a touch high. Color tuned to harmonize with the welcome
       banner's peach (#ffcec2) — runs from that peach into a deeper
       coral so the word reads from a distance. */
    transform: translateY(-0.12em);
    background: linear-gradient(135deg, #ffcec2, #f08a76);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    /* Soft peach halo, same hue family. */
    text-shadow:
      0 0 14px rgb(255 168 144 / 0.35),
      0 0 36px rgb(255 168 144 / 0.18);
  }

  /* ── Logo 4: Tabloid Punk (hot-pink riso, mis-registered) ───────── */
  .logo-tabloid {
    position: relative;
    font-family: 'Archivo Black', sans-serif;
    font-size: clamp(4rem, 11vw, 7rem);
    line-height: 1;
    letter-spacing: -0.06em;
    transform: skew(-6deg);
    padding: 0.1em 0.2em;
  }
  .logo-tabloid-main {
    position: relative;
    z-index: 2;
    color: var(--foreground);
    background-color: oklch(0.96 0.005 80);
    padding: 0 0.05em;
    /* Tight inside-text shadow makes the letters look pressure-printed. */
    text-shadow: 1px 1px 0 oklch(0.7 0.25 350 / 0.4);
  }
  .logo-tabloid-back {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    color: oklch(0.7 0.27 350); /* hot pink */
    transform: translate(10px, 10px);
    user-select: none;
    mix-blend-mode: multiply;
  }
  .logo-tabloid-tag {
    position: absolute;
    bottom: -0.35em;
    right: 0.4em;
    z-index: 3;
    font-family: 'DM Mono', monospace;
    font-size: 0.13em;
    font-weight: 500;
    letter-spacing: 0.2em;
    color: var(--background);
    background: var(--foreground);
    padding: 0.3em 0.6em;
    transform: skew(6deg) rotate(-3deg);
  }

  /* ── Logo 5: Concrete Riot (stencil + concrete bars) ────────────── */
  .logo-concrete {
    position: relative;
    padding: 1.2em 0.6em 1em;
    background: var(--foreground);
    overflow: hidden;
  }
  .logo-concrete-text {
    position: relative;
    z-index: 2;
    display: block;
    font-family: 'Big Shoulders Display', sans-serif;
    font-weight: 900;
    font-size: clamp(4.5rem, 12vw, 8rem);
    letter-spacing: 0.08em;
    line-height: 0.9;
    color: var(--background);
    /* Stencil cut: thin horizontal slits across the letters. */
    background-image: linear-gradient(
      to bottom,
      transparent 0,
      transparent 36%,
      var(--foreground) 36%,
      var(--foreground) 40%,
      transparent 40%,
      transparent 60%,
      var(--foreground) 60%,
      var(--foreground) 64%,
      transparent 64%
    );
    -webkit-background-clip: text;
    background-clip: text;
  }
  .logo-concrete-bars {
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 14px,
      oklch(0.3 0.005 80 / 0.4) 14px 16px
    );
    pointer-events: none;
  }
  .logo-concrete-stripe {
    position: relative;
    z-index: 2;
    margin-top: 0.6em;
    display: flex;
    align-items: center;
    gap: 0.6em;
    font-family: 'Spline Sans Mono', monospace;
    font-size: 0.85rem;
    letter-spacing: 0.25em;
    color: var(--background);
    border-top: 1px solid oklch(0.95 0.005 80 / 0.4);
    padding-top: 0.5em;
  }

  /* ── Logo 6: Xerox'd Zine (RGB ghost, glitched) ─────────────────── */
  .logo-zine {
    position: relative;
    display: inline-block;
    font-family: 'Anton', 'Impact', sans-serif;
    font-size: clamp(4.5rem, 12vw, 8rem);
    letter-spacing: 0.04em;
    line-height: 1;
    color: var(--foreground);
    /* Subtle paper texture via banded gradient. */
    padding: 0.1em 0.4em 0.2em;
  }
  .logo-zine-main {
    position: relative;
    z-index: 4;
    /* Smudgy double-print look. */
    text-shadow:
      0 1px 0 var(--foreground),
      1px 0 0 var(--foreground),
      -1px 1px 0 oklch(0.45 0.005 80);
    animation: logo-zine-jitter 9s steps(2, end) infinite;
  }
  .logo-zine-r,
  .logo-zine-g,
  .logo-zine-b {
    position: absolute;
    top: 0.1em;
    left: 0.4em;
    pointer-events: none;
    user-select: none;
  }
  .logo-zine-r {
    z-index: 1;
    color: oklch(0.65 0.27 25); /* red */
    transform: translate(-3px, -2px);
    mix-blend-mode: multiply;
    opacity: 0.85;
  }
  .logo-zine-g {
    z-index: 2;
    color: oklch(0.7 0.24 145); /* green */
    transform: translate(3px, 1px);
    mix-blend-mode: multiply;
    opacity: 0.85;
  }
  .logo-zine-b {
    z-index: 3;
    color: oklch(0.6 0.24 250); /* blue */
    transform: translate(0, 3px);
    mix-blend-mode: multiply;
    opacity: 0.85;
  }
  .logo-zine-corner {
    position: absolute;
    bottom: -0.1em;
    right: 0;
    z-index: 5;
    font-family: 'Major Mono Display', monospace;
    font-size: 0.12em;
    letter-spacing: 0.15em;
    color: var(--foreground);
    border: 1.5px dashed var(--foreground);
    padding: 0.3em 0.6em;
    background: var(--background);
  }
  @keyframes logo-zine-jitter {
    0%, 93%, 100% { transform: translate(0, 0); }
    94% { transform: translate(-1px, 1px); }
    96% { transform: translate(2px, -1px); }
    98% { transform: translate(-1px, -1px); }
  }
</style>
