<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { ArrowRight, Music4, Mic2, Sparkles } from '@lucide/svelte'
</script>

<svelte:head>
  <title>BarBro</title>
</svelte:head>

<main class="relative isolate min-h-dvh overflow-x-hidden">
  <div
    class="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] dark:opacity-[0.08]"
    aria-hidden="true"
    style="background-image: linear-gradient(to right, currentColor 1px, transparent 1px); background-size: min(8vw, 96px) 100%;"
  ></div>

  <section class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 sm:py-24">
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

    <div class="grid gap-4 sm:grid-cols-3">
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2">
        <Music4 class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Beats & bars</h2>
        <p class="text-muted-foreground text-xs">Detect, edit, lock everything to the grid.</p>
      </div>
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2">
        <Sparkles class="size-5" aria-hidden="true" />
        <h2 class="text-sm font-bold uppercase tracking-wider">Stems</h2>
        <p class="text-muted-foreground text-xs">Vocals, drums, bass, other. Local Demucs.</p>
      </div>
      <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2">
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
