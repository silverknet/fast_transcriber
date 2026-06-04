<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { ArrowRight, Music4, Mic2, Sparkles } from '@lucide/svelte'

  // Word repeated enough to fill a tall column and survive 1× duplication
  // (the duplicate is what makes the marquee loop seamlessly — see the
  // style block below). At ~1/3 viewport per "BarBro", a dozen each is
  // enough for a long, never-seamed scroll.
  const WORDS = Array.from({ length: 12 })

  // Banner accent — peach. Edit the hex to recolor; drives `--banner`
  // on the marquee container.
  const BANNER_COLOR = '#ffcec2' // rgb(255, 206, 194)
</script>

<svelte:head>
  <title>BarBro</title>
</svelte:head>

<main class="relative isolate min-h-dvh overflow-clip">
  <!-- Background bar-grid wash -->
  <div
    class="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] dark:opacity-[0.08]"
    aria-hidden="true"
    style="background-image: linear-gradient(to right, currentColor 1px, transparent 1px); background-size: min(8vw, 96px) 100%;"
  ></div>

  <!--
    Three vertical marquee banners. Text is rotated via writing-mode
    (vertical-rl + text-orientation: sideways) so each "BarBro" lies on
    its side — heads-tilted poster vibe. Outer black columns scroll up,
    middle white column scrolls down. Banners sit ~25% in from the left
    edge so content has breathing room on either side.
  -->
  <!--
    `-top-[10%] -bottom-[10%]` extends the banner past the viewport on
    both edges so the 5° rotation doesn't leave triangular gaps at the
    corners. Origin defaults to the banner's center.
  -->
  <div
    class="pointer-events-none absolute -bottom-[10%] -top-[10%] left-[12%] z-0 hidden w-24 rotate-[-3deg] sm:flex md:left-[20%] md:w-28"
    style="--banner: {BANNER_COLOR};"
    aria-hidden="true"
  >
    <!--
      Outer columns: BANNER_COLOR fill, text uses page background color so
      letters read as "cut out" of the block. Middle column: transparent
      bg, BANNER_COLOR text floats over the page.
    -->
    <div class="text-background flex-1 overflow-hidden" style="background-color: var(--banner);">
      <div class="marquee-up flex flex-col items-center font-black italic uppercase leading-none text-[2.25rem] md:text-[3.7rem]">
        {#each WORDS as _, i (i)}<span class="rotate-text">BarBro</span>{/each}
        {#each WORDS as _, i (i)}<span class="rotate-text">BarBro</span>{/each}
      </div>
    </div>
    <div class="flex-1 overflow-hidden">
      <div class="marquee-down flex flex-col items-center font-black italic uppercase leading-none text-[2.25rem] md:text-[3.7rem]" style="color: var(--banner);">
        {#each WORDS as _, i (i)}<span class="rotate-text">BarBro</span>{/each}
        {#each WORDS as _, i (i)}<span class="rotate-text">BarBro</span>{/each}
      </div>
    </div>
    <div class="text-background flex-1 overflow-hidden" style="background-color: var(--banner);">
      <div class="marquee-up flex flex-col items-center font-black italic uppercase leading-none text-[2.25rem] md:text-[3.7rem]">
        {#each WORDS as _, i (i)}<span class="rotate-text">BarBro</span>{/each}
        {#each WORDS as _, i (i)}<span class="rotate-text">BarBro</span>{/each}
      </div>
    </div>
  </div>

  <section
    class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 sm:mx-0 sm:ml-[calc(12%+12rem)] sm:w-[40vw] sm:py-24 md:ml-[calc(20%+14rem)]"
  >
    <div class="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em]">
      <span class="border-foreground border-2 px-2 py-1">BarBro</span>
      <span class="text-muted-foreground">invite-only beta</span>
    </div>

    <div class="space-y-6">
      <h1 class="text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[0.95] tracking-tight">
        Your set in one place.
      </h1>
      <p class="text-muted-foreground max-w-xl text-lg sm:text-xl">
        Like your grandma but also does stem splitting.
      </p>

      <div class="flex flex-wrap items-center gap-3 pt-2">
        <Button class="brutalist-shadow h-11 gap-2 px-5 text-sm" onclick={() => (window.location.href = '/login')}>
          Sign in
          <ArrowRight class="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          class="h-11 px-5 text-sm"
          onclick={() => (window.location.href = '/login?next=/pending')}
        >
          Request invite
        </Button>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2 bg-background">
        <Music4 class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Beats & bars</h2>
        <p class="text-muted-foreground text-xs">Detect, edit, lock everything to the grid.</p>
      </div>
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2 bg-background">
        <Sparkles class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Stems</h2>
        <p class="text-muted-foreground text-xs">Vocals, drums, bass, other. Local Demucs.</p>
      </div>
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2 bg-background">
        <Mic2 class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Cues & click</h2>
        <p class="text-muted-foreground text-xs">Spoken count-ins. Click track. Ableton export.</p>
      </div>
    </div>

    <footer class="border-foreground/20 mt-8 border-t pt-4 text-xs text-muted-foreground">
      Built for live performers.
    </footer>
  </section>
</main>

<style>
  /*
    Marquee loop pattern: render the repeated content TWICE inside the
    scrolling div (40 + 40 = 80 spans). A 50% translate brings the second
    copy to where the first copy started, so frame N looks identical to
    frame 0 — no visible seam.
  */
  @keyframes marquee-up {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(-50%);
    }
  }
  @keyframes marquee-down {
    from {
      transform: translateY(-50%);
    }
    to {
      transform: translateY(0);
    }
  }
  .marquee-up {
    animation: marquee-up 120s linear infinite;
    will-change: transform;
  }
  .marquee-down {
    animation: marquee-down 80s linear infinite;
    will-change: transform;
  }
  /*
    Each "BarBro" lies on its side. `vertical-rl` makes the block flow
    vertically; `sideways` then rotates the glyphs 90° so the word reads
    top-to-bottom in normal letterforms (no head-tilt-to-recognise). The
    sideways keyword is supported in modern Chrome / Safari / Firefox.
  */
  .rotate-text {
    writing-mode: vertical-rl;
    text-orientation: sideways;
    /*
      `inline-block` (not block) is the key to centering: as block, the
      span filled the column width and centering had nothing to do; as
      inline-block, the span sizes to content (1em × text-length in
      screen coords) and the parent flex's `items-center` actually
      positions it in the middle of the column.
    */
    display: inline-block;
    /*
      Antialiasing fixes for the rotated + cut-out text. Subpixel
      rendering on rotated glyphs leaves a fringe of the underlying
      banner color around the letterforms; grayscale smoothing kills it.
      `translateZ(0)` promotes the layer to GPU compositing which
      sharpens the rotation. `text-rendering: geometricPrecision` keeps
      the glyph metrics consistent under transform.
    */
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: geometricPrecision;
    transform: translateZ(0);
    backface-visibility: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .marquee-up,
    .marquee-down {
      animation: none;
      transform: translateY(-25%);
    }
  }
</style>
