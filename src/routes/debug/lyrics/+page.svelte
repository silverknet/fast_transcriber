<script lang="ts">
  /**
   * Debug lab — lyric-highlight styles that reflect timing CONFIDENCE.
   *
   * Fully reactive: every knob is `$state`, every visual is `$derived` and bound
   * straight into the markup (`style:` / `class:`). No `$effect`, no imperative
   * DOM writes. The rAF loop only advances the clock `t` and steps the single
   * position spring `hx` — both `$state`, so the template re-renders from them.
   */
  import { onMount } from 'svelte'

  type W = { t: number; w: string; aligned: boolean }
  // Sommartider — the recognizer caught the ends, guessed the middle.
  const WORDS: W[] = [
    { t: 0.0, w: 'Jag', aligned: true },
    { t: 0.52, w: 'känner', aligned: true },
    { t: 1.15, w: 'det', aligned: false },
    { t: 1.42, w: 'är', aligned: false },
    { t: 1.78, w: "nå'nting", aligned: false },
    { t: 2.55, w: 'på', aligned: true },
    { t: 2.92, w: 'gång', aligned: true },
  ]
  const END = 3.55
  const NEXT = 'Kom och stanna ute natten lång'
  const CONF_HI = 1
  const CONF_LO = 0.22

  // ── transport ──
  let t = $state(0)
  let playing = $state(true) // autoplay so the halo is always drifting
  let rate = $state(1)
  let showData = $state(false)

  // ── halo tuning knobs — full look & feel control (all live) ──
  // shape
  let roundness = $state(1) // 0 = rectangle · 1 = oval / pill
  let heightEm = $state(1.4) // halo height (em)
  // size
  let basePad = $state(18) // width beyond the word on a HEARD word (px)
  let spread = $state(90) // extra width over GUESSED words (px)
  // feather / blur — independent at each confidence level
  let edgeFeather = $state(0.5) // softness of the halo's OWN edge (gradient falloff)
  let baseBlur = $state(4) // blur on heard words (px)
  let maxBlur = $state(16) // extra blur over guessed words (px)
  // look
  let baseOpacity = $state(0.94) // opacity on heard words
  // motion
  let tauPos = $state(0.11) // drift laziness — position follow (s)
  let tauMorph = $state(0.16) // morph softness — size/opacity/blur (s)

  // ── geometry (measured word rects, in the reference line's space) ──
  type Geo = { lefts: number[]; rights: number[]; centers: number[] }
  let geo = $state<Geo | null>(null)
  let lineB = $state<HTMLElement>()

  // ── position spring (the only stateful per-frame value) ──
  let hx = $state(NaN)

  const conf = (i: number) => (WORDS[i]!.aligned ? CONF_HI : CONF_LO)
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
  const smootherstep = (x: number) => {
    const s = clamp01(x)
    return s * s * s * (s * (s * 6 - 15) + 10)
  }
  const activeIndexAt = (time: number) => {
    let idx = -1
    for (let i = 0; i < WORDS.length; i++) {
      if (WORDS[i]!.t <= time) idx = i
      else break
    }
    return idx
  }

  // Continuous target at a given time — linear-in-time between word centers
  // (the position spring rounds the corners so it never stops at a word).
  function segAt(time: number) {
    const g = geo
    const i = activeIndexAt(time)
    if (i < 0 || !g) return null
    const nextT = i < WORDS.length - 1 ? WORDS[i + 1]!.t : END
    const frac = clamp01((time - WORDS[i]!.t) / (nextT - WORDS[i]!.t))
    const cx = g.centers[i] ?? 0
    const nx = g.centers[i + 1] ?? g.rights[i] ?? cx
    const targetX = lerp(cx, nx, frac)
    const wi = (g.rights[i] ?? 0) - (g.lefts[i] ?? 0)
    const wj = i < WORDS.length - 1 ? (g.rights[i + 1] ?? 0) - (g.lefts[i + 1] ?? 0) : wi
    const baseW = lerp(wi, wj, frac)
    const c2 = i < WORDS.length - 1 ? conf(i + 1) : conf(i)
    const curConf = lerp(conf(i), c2, frac)
    return { i, frac, targetX, baseW, curConf }
  }

  // ── derived visuals (recompute on t / geo / any knob) ──
  const activeIdx = $derived(activeIndexAt(t))
  const seg = $derived(segAt(t))
  const u = $derived(seg ? smootherstep(1 - seg.curConf) : 0) // eased uncertainty
  const haloWidth = $derived(seg ? seg.baseW + basePad + u * spread : 0)
  const haloBlur = $derived(baseBlur + u * maxBlur)
  const haloOpacity = $derived(seg ? baseOpacity * (1 - u * 0.55) : 0)
  const haloX = $derived(Number.isFinite(hx) ? hx : seg ? seg.targetX : 0)
  const haloBg = $derived(
    `radial-gradient(ellipse at center, color-mix(in oklch, var(--studio-orange) 92%, white) 0%,` +
      ` var(--studio-orange) ${lerp(74, 10, clamp01(edgeFeather)).toFixed(0)}%,` +
      ` transparent ${lerp(80, 98, clamp01(edgeFeather)).toFixed(0)}%)`,
  )
  // running-line wipe (variant C)
  const feather = $derived(seg ? lerp(42, 5, seg.curConf) : 5)
  const wipeX = $derived.by(() => {
    const g = geo
    const s = seg
    if (!g || !s) return 0
    const i = s.i
    const nlx = i < WORDS.length - 1 ? g.lefts[i + 1] ?? g.rights[i] ?? 0 : (g.rights[i] ?? 0) + 12
    return WORDS[i]!.aligned
      ? lerp(g.lefts[i] ?? 0, g.rights[i] ?? 0, Math.min(1, s.frac * 1.15))
      : lerp(g.rights[i - 1] ?? g.lefts[i] ?? 0, nlx, s.frac)
  })
  const wipeOpacity = $derived(seg ? lerp(0.95, 0.3, 1 - seg.curConf) : 0)

  // Copyable readout of the current tuning — paste it back to bake as defaults.
  const settingsText = $derived(
    `roundness: ${roundness}, heightEm: ${heightEm}, basePad: ${basePad}, spread: ${spread}, ` +
      `edgeFeather: ${edgeFeather}, baseBlur: ${baseBlur}, maxBlur: ${maxBlur}, ` +
      `baseOpacity: ${baseOpacity}, tauPos: ${tauPos}, tauMorph: ${tauMorph}`,
  )
  let copied = $state(false)
  async function copySettings() {
    try {
      await navigator.clipboard.writeText(settingsText)
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch {
      /* clipboard blocked — the text is selectable in the readout */
    }
  }

  // ── clock + spring loop (writes only to $state) ──
  let rafId = 0
  let lastNow = 0
  function loop(now: number) {
    if (!playing) {
      rafId = 0
      return
    }
    if (!lastNow) lastNow = now
    const dt = Math.min(0.05, (now - lastNow) / 1000) // clamp tab-switch gaps
    lastNow = now
    t += dt * rate
    if (t >= END) {
      t = 0
      hx = NaN // snap the fairy back to the start, don't sweep backward
    }
    const s = segAt(t)
    if (s) {
      const aPos = 1 - Math.exp(-dt / Math.max(0.01, tauPos))
      hx = Number.isFinite(hx) ? hx + (s.targetX - hx) * aPos : s.targetX
    }
    rafId = requestAnimationFrame(loop)
  }
  function ensureLoop() {
    if (playing && !rafId) {
      lastNow = 0
      rafId = requestAnimationFrame(loop)
    }
  }
  function togglePlay() {
    playing = !playing
    ensureLoop()
  }
  function onScrub(e: Event) {
    playing = false
    t = (END * Number((e.target as HTMLInputElement).value)) / 1000
    hx = NaN // snap to the scrubbed position
  }

  function measure() {
    if (!lineB) return
    const spans = [...lineB.querySelectorAll<HTMLElement>('[data-w]')]
    if (!spans.length) return
    const hb = lineB.getBoundingClientRect()
    geo = {
      lefts: spans.map((s) => s.getBoundingClientRect().left - hb.left),
      rights: spans.map((s) => s.getBoundingClientRect().right - hb.left),
      centers: spans.map((s) => {
        const r = s.getBoundingClientRect()
        return (r.left + r.right) / 2 - hb.left
      }),
    }
  }

  onMount(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) playing = false
    measure()
    requestAnimationFrame(measure)
    const tid = setTimeout(measure, 140) // re-measure once fonts settle
    ensureLoop()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(tid)
      window.removeEventListener('resize', onResize)
    }
  })

  const rates = [0.5, 1, 2]
</script>

<svelte:head><title>Lyric confidence styles — BarBro debug</title></svelte:head>

<main class="lab" class:reveal={showData}>
  <header>
    <p class="kicker">Debug · live lyrics</p>
    <h1>Confidence styles</h1>
    <p class="lede">
      The aligner <strong>hears</strong> some words and <strong>guesses</strong> the rest between them. Same line, same
      moment — three ways to let the highlight show how sure it is. Every knob is live.
    </p>
  </header>

  <div class="transport">
    <button class="play" onclick={togglePlay}>{playing ? '❚❚ Pause' : '► Play'}</button>
    <div class="scrub">
      <span class="clock">{t.toFixed(1)}s</span>
      <input type="range" min="0" max="1000" value={Math.round((1000 * t) / END)} oninput={onScrub} aria-label="Scrub" />
    </div>
    <div class="seg">
      {#each rates as r (r)}
        <button class:on={rate === r} onclick={() => (rate = r)}>{r}×</button>
      {/each}
    </div>
    <label class="chk"><input type="checkbox" bind:checked={showData} /> mark guessed</label>
  </div>

  <!-- B: halo (primary) -->
  <section class="panel vB">
    <div class="phead"><h2>Confidence halo</h2><span class="tag on">recommended</span></div>
    <p class="why">A soft light that <strong>drifts</strong> like a firefly — tight &amp; sharp on a heard word, wide &amp; soft across guessed ones. Tune every part of it below.</p>

    <div class="tune">
      <fieldset>
        <legend>shape</legend>
        <label><span>rect ↔ oval <b>{Math.round(roundness * 100)}%</b></span><input type="range" min="0" max="1" step="0.02" bind:value={roundness} /></label>
        <label><span>height <b>{heightEm.toFixed(2)}em</b></span><input type="range" min="0.7" max="2.4" step="0.05" bind:value={heightEm} /></label>
      </fieldset>
      <fieldset>
        <legend>size</legend>
        <label><span>pad (heard) <b>{basePad}px</b></span><input type="range" min="0" max="60" step="1" bind:value={basePad} /></label>
        <label><span>spread (guessed) <b>{spread}px</b></span><input type="range" min="0" max="180" step="2" bind:value={spread} /></label>
      </fieldset>
      <fieldset>
        <legend>feather / blur</legend>
        <label><span>edge feather <b>{Math.round(edgeFeather * 100)}%</b></span><input type="range" min="0" max="1" step="0.02" bind:value={edgeFeather} /></label>
        <label><span>blur (heard) <b>{baseBlur}px</b></span><input type="range" min="0" max="24" step="1" bind:value={baseBlur} /></label>
        <label><span>blur (guessed) <b>{maxBlur}px</b></span><input type="range" min="0" max="40" step="1" bind:value={maxBlur} /></label>
      </fieldset>
      <fieldset>
        <legend>look &amp; motion</legend>
        <label><span>opacity <b>{baseOpacity.toFixed(2)}</b></span><input type="range" min="0.2" max="1" step="0.02" bind:value={baseOpacity} /></label>
        <label><span>drift laziness <b>{tauPos.toFixed(2)}s</b></span><input type="range" min="0.02" max="0.5" step="0.01" bind:value={tauPos} /></label>
        <label><span>morph softness <b>{tauMorph.toFixed(2)}s</b></span><input type="range" min="0.02" max="0.6" step="0.01" bind:value={tauMorph} /></label>
      </fieldset>
    </div>

    <div class="readout">
      <code>{settingsText}</code>
      <button onclick={copySettings}>{copied ? 'Copied ✓' : 'Copy'}</button>
    </div>

    <div class="stage">
      <div class="line" bind:this={lineB}>
        <span
          class="halo"
          style:transform="translate(calc({haloX}px - 50%), -50%)"
          style:width="{haloWidth}px"
          style:height="{heightEm}em"
          style:border-radius="{roundness * 50}%"
          style:opacity={seg ? haloOpacity : 0}
          style:filter="blur({haloBlur.toFixed(1)}px)"
          style:background={haloBg}
          style:transition="width {tauMorph}s ease, opacity {tauMorph}s ease, filter {tauMorph}s ease, height {tauMorph}s ease, border-radius {tauMorph}s ease"
        ></span>
        {#each WORDS as d, k (k)}<span data-w class:guessed={!d.aligned} class:is-past={k < activeIdx}>{d.w}</span>{#if k < WORDS.length - 1}{' '}{/if}{/each}
      </div>
      <div class="next">{NEXT}</div>
    </div>
  </section>

  <!-- C: running line -->
  <section class="panel vC">
    <div class="phead"><h2>Running line</h2><span class="tag">karaoke wipe</span></div>
    <p class="why">A fill sweeps at the sung pace — crisp edge at heard words, feathered across guessed ones. Every word stays readable ahead of the fill.</p>
    <div class="stage">
      <div class="line cline">
        <span class="base">
          {#each WORDS as d, k (k)}<span data-w class:guessed={!d.aligned}>{d.w}</span>{#if k < WORDS.length - 1}{' '}{/if}{/each}
        </span>
        <span class="fill" aria-hidden="true" style:--x="{wipeX}px" style:--feather="{(feather * 0.9).toFixed(1)}px">
          {#each WORDS as d, k (k)}<span>{d.w}</span>{#if k < WORDS.length - 1}{' '}{/if}{/each}
        </span>
        <span class="edge" style:left="{wipeX}px" style:filter="blur({(feather * 0.5).toFixed(1)}px)" style:opacity={wipeOpacity}></span>
      </div>
      <div class="next">{NEXT}</div>
    </div>
  </section>

  <!-- A: today -->
  <section class="panel vA">
    <div class="phead"><h2>Today — solid block</h2><span class="tag">baseline</span></div>
    <p class="why">A hard block jumps word to word — equally certain everywhere, even across the middle it never heard.</p>
    <div class="stage">
      <div class="line">
        {#each WORDS as d, k (k)}<span data-w class:guessed={!d.aligned} class:is-active={k === activeIdx} class:is-past={k < activeIdx}>{d.w}</span>{#if k < WORDS.length - 1}{' '}{/if}{/each}
      </div>
      <div class="next">{NEXT}</div>
    </div>
  </section>

  <!-- timeline -->
  <section class="timeline">
    <div class="phead"><h2>What it's reading</h2><span class="tag">word timing</span></div>
    <div class="track">
      <div class="tk-play" style:left="{(100 * Math.min(t, END)) / END}%"></div>
      {#each WORDS as d, k (k)}
        {@const nextT = k < WORDS.length - 1 ? WORDS[k + 1].t : END}
        <div
          class="tk {d.aligned ? 'anchored' : 'interp'}"
          style="left:{(100 * d.t) / END}%; width:{Math.max(6, (100 * (nextT - d.t)) / END - 1)}%"
        >{d.w}</div>
      {/each}
    </div>
    <div class="legend">
      <span><i class="sw anch"></i> heard — real timing (crisp / quick)</span>
      <span><i class="sw intp"></i> guessed — interpolated (soft / eased)</span>
    </div>
  </section>
</main>

<style>
  .lab {
    --ink: var(--studio-ink);
    --paper: var(--studio-paper);
    --panel: var(--studio-panel);
    min-height: 100dvh;
    background: var(--background); /* the app's standard page background — no bespoke pattern */
    color: var(--ink);
    padding: clamp(18px, 4vw, 48px);
  }
  header {
    max-width: 780px;
    margin: 0 auto clamp(16px, 3vw, 28px);
    display: grid;
    gap: 0.5rem;
  }
  .kicker {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 7vw, 4.4rem);
    line-height: 0.92;
  }
  .lede {
    margin: 0.25rem 0 0;
    max-width: 60ch;
    font-size: 1rem;
    line-height: 1.5;
    color: color-mix(in oklch, var(--ink) 80%, transparent);
  }
  .lede strong {
    color: var(--ink);
    font-weight: 800;
  }

  .transport {
    max-width: 780px;
    margin: 0 auto 1.25rem;
    display: flex;
    gap: 0.8rem;
    align-items: center;
    flex-wrap: wrap;
    border: 3px solid var(--ink);
    background: var(--panel);
    box-shadow: 4px 4px 0 var(--ink);
    padding: 0.7rem 0.9rem;
    position: sticky;
    top: 10px;
    z-index: 6;
  }
  .play {
    font-family: var(--font-display);
    border: 2px solid var(--ink);
    background: var(--studio-orange);
    color: var(--ink);
    font-size: 0.95rem;
    padding: 0.45rem 0.9rem;
    cursor: pointer;
    min-width: 96px;
  }
  .scrub {
    flex: 1 1 180px;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 160px;
  }
  .scrub input {
    flex: 1;
    accent-color: var(--studio-orange);
  }
  .clock {
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    min-width: 44px;
    font-size: 0.85rem;
  }
  .seg {
    display: inline-flex;
    border: 2px solid var(--ink);
  }
  .seg button {
    border: none;
    background: transparent;
    color: var(--ink);
    font-weight: 800;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    font-size: 0.82rem;
  }
  .seg button.on {
    background: var(--ink);
    color: var(--paper);
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }
  .chk input {
    accent-color: var(--studio-orange);
  }
  :focus-visible {
    outline: 2px solid var(--studio-orange);
    outline-offset: 2px;
  }

  .panel,
  .timeline {
    max-width: 780px;
    margin: 0 auto 1rem;
    border: 3px solid var(--ink);
    background: var(--panel);
    box-shadow: 4px 4px 0 var(--ink);
  }
  .phead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1.1rem 0;
  }
  .phead h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.35rem;
    line-height: 1;
  }
  .tag {
    font-size: 0.66rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in oklch, var(--ink) 55%, transparent);
    border: 2px solid currentColor;
    padding: 0.15rem 0.4rem;
    white-space: nowrap;
  }
  .tag.on {
    color: var(--ink);
    background: var(--studio-orange);
    border-color: var(--ink);
  }
  .why {
    margin: 0.4rem 1.1rem 0;
    max-width: 62ch;
    font-size: 0.9rem;
    line-height: 1.45;
    color: color-mix(in oklch, var(--ink) 78%, transparent);
  }
  .why strong {
    color: var(--ink);
    font-weight: 800;
  }

  /* live tuning knobs */
  .tune {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem;
    margin: 0.85rem 1.1rem 0;
  }
  .tune fieldset {
    border: 2px dashed color-mix(in oklch, var(--ink) 28%, transparent);
    background: color-mix(in oklch, var(--studio-orange) 5%, transparent);
    padding: 0.5rem 0.75rem 0.7rem;
    display: grid;
    gap: 0.45rem;
    margin: 0;
  }
  .tune legend {
    font-size: 0.64rem;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: color-mix(in oklch, var(--ink) 60%, transparent);
    padding: 0 0.35rem;
  }
  .tune label {
    display: grid;
    gap: 0.25rem;
  }
  .tune span {
    font-size: 0.7rem;
    font-weight: 700;
    color: color-mix(in oklch, var(--ink) 70%, transparent);
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .tune span b {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .tune input[type='range'] {
    width: 100%;
    accent-color: var(--studio-orange);
  }
  @media (max-width: 620px) {
    .tune {
      grid-template-columns: 1fr;
    }
  }
  .readout {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.7rem 1.1rem 0;
    padding: 0.55rem 0.7rem;
    border: 2px solid var(--ink);
    background: color-mix(in oklch, var(--ink) 5%, transparent);
  }
  .readout code {
    flex: 1;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--ink);
    word-break: break-word;
    user-select: all;
  }
  .readout button {
    border: 2px solid var(--ink);
    background: var(--studio-orange);
    color: var(--ink);
    font-weight: 800;
    font-size: 0.75rem;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
    white-space: nowrap;
  }

  /* ── stage: real playback tokens ── */
  .stage {
    padding: 1.7rem 1.1rem 1.5rem;
  }
  .line {
    position: relative;
    font-weight: 900;
    letter-spacing: -0.01em;
    line-height: 1.3;
    font-size: clamp(1.6rem, 5.2vw, 2.6rem);
    color: var(--foreground);
  }
  .line [data-w] {
    position: relative;
    z-index: 2;
  }
  .next {
    margin-top: 0.5rem;
    font-weight: 800;
    font-size: clamp(0.95rem, 3vw, 1.25rem);
    color: var(--muted-foreground);
    letter-spacing: -0.01em;
  }
  .reveal .line [data-w].guessed {
    text-decoration: underline dotted;
    text-decoration-color: color-mix(in oklch, var(--studio-orange) 70%, var(--muted-foreground));
    text-underline-offset: 6px;
  }

  /* A — today: the exact current treatment (bg-primary block) */
  .vA .line [data-w].is-active {
    background: var(--primary);
    color: var(--primary-foreground);
    border-radius: 6px;
    padding: 0 0.12em;
  }
  .vA .line [data-w].is-past {
    color: var(--muted-foreground);
  }

  /* B — halo (all visual props are set inline / reactive) */
  .vB .line [data-w].is-past {
    color: var(--muted-foreground);
  }
  .vB .halo {
    position: absolute;
    top: 50%;
    left: 0;
    z-index: 1;
    pointer-events: none;
    will-change: transform, width, filter;
  }

  /* C — running line wipe */
  .cline {
    overflow: visible;
  }
  .cline .base [data-w] {
    color: color-mix(in oklch, var(--foreground) 62%, transparent);
  }
  .vC .fill {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    color: var(--studio-orange);
    font-weight: 900;
    letter-spacing: -0.01em;
    -webkit-mask-image: linear-gradient(90deg, #000 calc(var(--x) - var(--feather)), transparent calc(var(--x) + var(--feather)));
    mask-image: linear-gradient(90deg, #000 calc(var(--x) - var(--feather)), transparent calc(var(--x) + var(--feather)));
  }
  .vC .edge {
    position: absolute;
    top: 6%;
    bottom: 6%;
    width: 3px;
    z-index: 4;
    transform: translateX(-50%);
    background: color-mix(in oklch, var(--studio-orange) 92%, white);
    border-radius: 3px;
    pointer-events: none;
  }

  /* timeline */
  .timeline {
    padding-bottom: 1.1rem;
  }
  .track {
    position: relative;
    height: 56px;
    margin: 0.9rem 1.1rem 0;
    border: 2px solid var(--ink);
    background: color-mix(in oklch, var(--ink) 6%, transparent);
    overflow: hidden;
  }
  .tk {
    position: absolute;
    top: 12px;
    height: 30px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 800;
    overflow: hidden;
    padding: 0 3px;
  }
  .tk.anchored {
    background: var(--studio-orange);
    color: var(--ink);
  }
  .tk.interp {
    color: var(--muted-foreground);
    border: 1.5px dashed color-mix(in oklch, var(--muted-foreground) 80%, transparent);
  }
  .tk-play {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--ink);
    z-index: 3;
  }
  .legend {
    display: flex;
    gap: 1.2rem;
    flex-wrap: wrap;
    margin: 0.8rem 1.1rem 0;
    font-size: 0.75rem;
    font-weight: 700;
    color: color-mix(in oklch, var(--ink) 70%, transparent);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .sw {
    width: 22px;
    height: 12px;
    border-radius: 3px;
  }
  .sw.anch {
    background: var(--studio-orange);
  }
  .sw.intp {
    border: 1.5px dashed var(--muted-foreground);
  }
</style>
