<script lang="ts">
  /**
   * `/welcome` — public landing page for signed-out visitors.
   *
   * BarBro is invite-only right now, so this page does two things:
   *   1. Pitches what BarBro does (so someone deciding whether to ask
   *      for an invite can tell if it's for them).
   *   2. Offers two entry points: sign in (existing users) or sign in to
   *      submit an invite request (everyone else — the same /login
   *      route handles both; the access gate routes them to /pending
   *      after sign-in if they're new).
   *
   * Visual language: brutalist black borders, big typography, no
   * gradients/glass. Matches the rest of the app.
   */
  import { Button } from '$lib/components/ui/button'
  import { ArrowRight, Music4, Mic2, Sparkles } from '@lucide/svelte'
</script>

<svelte:head>
  <title>BarBro · Bar-first songs, beats, and cues</title>
  <meta
    name="description"
    content="BarBro is the setlist tool that turns your live show into a tight, click-tracked, cued performance. Invite-only beta."
  />
</svelte:head>

<main class="relative isolate min-h-dvh overflow-x-hidden">
  <!-- Decorative bar grid pattern in the background -->
  <div
    class="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] dark:opacity-[0.08]"
    aria-hidden="true"
    style="background-image: linear-gradient(to right, currentColor 1px, transparent 1px); background-size: min(8vw, 96px) 100%;"
  ></div>

  <section class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 sm:py-24">
    <!-- Brand row -->
    <div class="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em]">
      <span class="border-foreground border-2 px-2 py-1">BarBro</span>
      <span class="text-muted-foreground">invite-only beta</span>
    </div>

    <!-- Hero -->
    <div class="space-y-6">
      <h1 class="text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[0.95] tracking-tight">
        Bar-first songs,
        <br />
        beats, and cues.
      </h1>
      <p class="text-muted-foreground max-w-xl text-lg sm:text-xl">
        BarBro turns your setlist into a tight, click-tracked, cued performance — chords,
        sections, stems, and spoken count-ins, all locked to the bar.
      </p>

      <div class="flex flex-wrap items-center gap-3 pt-2">
        <Button class="brutalist-shadow h-11 gap-2 px-5 text-sm" onclick={() => (window.location.href = '/login')}>
          Sign in
          <ArrowRight class="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          class="h-11 gap-2 px-5 text-sm"
          onclick={() => (window.location.href = '/login?next=/pending')}
        >
          Request an invite
        </Button>
      </div>
      <p class="text-muted-foreground text-xs">
        Already invited? <a href="/login" class="text-foreground underline">Sign in</a>. New here?
        Sign in once and we'll queue your request for review.
      </p>
    </div>

    <!-- Feature trio -->
    <div class="grid gap-4 sm:grid-cols-3">
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2">
        <Music4 class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Beats & bars</h2>
        <p class="text-muted-foreground text-xs leading-relaxed">
          Detect downbeats with a single click, edit the grid by hand, and lock chords,
          sections, and cues to musical time.
        </p>
      </div>
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2">
        <Sparkles class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Stems</h2>
        <p class="text-muted-foreground text-xs leading-relaxed">
          Split any song into vocals, drums, bass, and other with Demucs running locally.
          Multiple quality tiers, no upload.
        </p>
      </div>
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2">
        <Mic2 class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Cues & click</h2>
        <p class="text-muted-foreground text-xs leading-relaxed">
          Spoken count-ins, section announcements, and a click track — rendered fresh on every
          export. Ableton-set output too.
        </p>
      </div>
    </div>

    <!-- Footnote -->
    <footer class="border-foreground/20 mt-8 border-t pt-4 text-xs text-muted-foreground">
      Built for live performers. Audio stays on your machine — only collaborative metadata
      ever leaves the device.
    </footer>
  </section>
</main>
