<script lang="ts">
  /**
   * One karaoke lyric line whose highlight reflects timing CONFIDENCE.
   *
   * A soft "halo" drifts to the sung position: tight & sharp on words timed from
   * real recognition, wide & soft across words whose timing was only
   * interpolated (so a guessed word never looks as certain as a heard one).
   *
   * Fully reactive — every visual is `$derived` and bound into the markup.
   * Word geometry is measured through a `use:` action (re-runs on line change /
   * resize); the drift + morph are CSS transitions. No `$effect`, no rAF, no
   * imperative style writes. Drop-in replacement for the old inline karaoke line.
   */
  import {
    HALO_TUNING,
    activeWordIndexAt,
    lyricSegmentAt,
    smootherstep,
    clamp01,
    type HaloTuning,
    type TimedWord,
  } from '$lib/audio/lyricsPlayback'

  type Word = TimedWord & { text: string }

  let {
    words,
    songTime,
    tuning = HALO_TUNING,
  }: { words: Word[]; songTime: number; tuning?: HaloTuning } = $props()

  type Geo = { lefts: number[]; rights: number[]; centers: number[] }
  let geo = $state<Geo | null>(null)

  /** Measure each word's box in the line's own coordinate space. Re-runs on
   *  mount, on resize, and whenever `words` (the line) changes via `update`. */
  function measure(node: HTMLElement, _words: Word[]) {
    const run = () => {
      const spans = [...node.querySelectorAll<HTMLElement>('[data-w]')]
      if (spans.length === 0) {
        geo = null
        return
      }
      const hb = node.getBoundingClientRect()
      geo = {
        lefts: spans.map((s) => s.getBoundingClientRect().left - hb.left),
        rights: spans.map((s) => s.getBoundingClientRect().right - hb.left),
        centers: spans.map((s) => {
          const r = s.getBoundingClientRect()
          return (r.left + r.right) / 2 - hb.left
        }),
      }
    }
    run()
    requestAnimationFrame(run) // after fonts/layout settle
    const ro = new ResizeObserver(run)
    ro.observe(node)
    return {
      update() {
        requestAnimationFrame(run)
      },
      destroy() {
        ro.disconnect()
      },
    }
  }

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f

  // Word COLOUR keeps the read-ahead lead (anticipatory reading is good), but the
  // HALO tracks the actually-sung word so it moves WITH the singer instead of
  // running ~0.18s ahead — that lead is what made it feel rushed. Undo MixerView's
  // LYRIC_LEAD_SEC for the halo only.
  const HALO_LEAD_COMP = 0.26
  const activeIdx = $derived(activeWordIndexAt(words, songTime))
  const seg = $derived(lyricSegmentAt(words, songTime - HALO_LEAD_COMP))
  const u = $derived(seg ? smootherstep(1 - seg.confidence) : 0) // eased uncertainty

  const haloX = $derived.by(() => {
    const g = geo
    if (!g || !seg) return 0
    // Anchor the halo's bright core at the word's LEFT edge (its first letter),
    // not its centre — otherwise the first letter sits in the faded gradient edge
    // and never lights up. 0 = left edge, 1 = centre.
    const WORD_ANCHOR = 0.08
    const at = (idx: number) =>
      lerp(g.lefts[idx] ?? g.centers[idx] ?? 0, g.centers[idx] ?? 0, WORD_ANCHOR)
    const cx = at(seg.i)
    const nx = g.centers[seg.i + 1] != null ? at(seg.i + 1) : (g.rights[seg.i] ?? cx)
    // Smooth glide with the singing (no dwell/lurch — the halo already tracks the
    // sung word now that the lead is undone above).
    return lerp(cx, nx, seg.frac)
  })
  const haloWidth = $derived.by(() => {
    const g = geo
    if (!g || !seg) return 0
    const i = seg.i
    const wi = (g.rights[i] ?? 0) - (g.lefts[i] ?? 0)
    const wj = i < words.length - 1 ? (g.rights[i + 1] ?? 0) - (g.lefts[i + 1] ?? 0) : wi
    const baseW = lerp(wi, wj, seg.frac)
    return baseW + tuning.basePad + u * tuning.spread
  })
  const haloBlur = $derived(tuning.baseBlur + u * tuning.maxBlur)
  const haloOpacity = $derived(seg ? tuning.baseOpacity * (1 - u * 0.55) : 0)
  const haloBg = $derived(
    `radial-gradient(ellipse at center, color-mix(in oklch, var(--studio-orange) 92%, white) 0%,` +
      ` var(--studio-orange) ${lerp(74, 10, clamp01(tuning.edgeFeather)).toFixed(0)}%,` +
      ` transparent ${lerp(80, 98, clamp01(tuning.edgeFeather)).toFixed(0)}%)`,
  )
</script>

<span class="lcl" use:measure={words}>
  <!-- Remount the halo per line: a fresh element renders at the new line's start
       WITHOUT a `left` transition, so it never crawls back across the old line. -->
  {#key words}
    <span
      class="halo"
      aria-hidden="true"
    style:left="{haloX}px"
    style:width="{haloWidth}px"
    style:height="{tuning.heightEm}em"
    style:border-radius="{tuning.roundness * 50}%"
    style:opacity={haloOpacity}
    style:filter="blur({haloBlur.toFixed(1)}px)"
    style:background={haloBg}
    style:transition="left {tuning.tauPos}s ease-out, width {tuning.tauMorph}s ease, opacity {tuning.tauMorph}s ease, filter {tuning.tauMorph}s ease, height {tuning.tauMorph}s ease, border-radius {tuning.tauMorph}s ease"
    ></span>
  {/key}
  {#each words as w, k (k)}<span
      data-w
      class="w"
      class:past={k < activeIdx}
      class:upcoming={activeIdx >= 0 && k > activeIdx}>{w.text}</span
    >{#if k < words.length - 1}{' '}{/if}{/each}
</span>

<style>
  .lcl {
    position: relative;
    display: inline-block;
    max-width: 100%;
  }
  .halo {
    position: absolute;
    top: 50%;
    left: 0;
    z-index: 0;
    transform: translate(-50%, -50%);
    pointer-events: none;
    will-change: left, width, filter;
  }
  .w {
    position: relative;
    z-index: 2;
    transition: color 0.14s linear;
  }
  /* Sung words dim; the word being sung and upcoming words stay full. */
  .w.past {
    color: var(--muted-foreground);
  }
  @media (prefers-reduced-motion: reduce) {
    .halo {
      transition: opacity 0.1s linear !important;
    }
  }
</style>
