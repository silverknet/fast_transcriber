<script lang="ts">
  /**
   * Visual cheat-sheet for driving live mode with the Akai APC Key 25 Mk2.
   * A labelled, schematic layout of the controls that matter live — mirrors the
   * physical device so a performer can map hands to pads at a glance. Purely
   * presentational; the real mapping lives in `liveMidiMap.ts`.
   */
  let { compact = false } = $props<{ compact?: boolean }>()

  const scenes = [
    { n: 1, label: 'Prev song' },
    { n: 2, label: 'Next song' },
    { n: 3, label: 'Loop section' },
    { n: 4, label: '—' },
    { n: 5, label: '—' },
  ]
  // Fixed canonical stem order — same button every song (see liveMidiMap.ts).
  const STEM_LABELS = ['Drums', 'Bass', 'Vocals', 'Other', 'Guitar', 'FX', 'Click', 'Cue']
  const CUSTOM_LABELS = ['Custom 1', 'Custom 2']
</script>

<div class="flex flex-col gap-3 {compact ? 'text-[11px]' : 'text-xs'}">
  <div class="flex gap-2">
    <!-- Pad grid: 30 sections + 10 live slots; track buttons mirror slots 1-8. -->
    <div class="flex flex-1 flex-col gap-2">
      <div class="grid grid-cols-8 gap-1">
        {#each Array(24) as _, i (i)}
          <div class="bg-foreground/15 aspect-square rounded-[3px]" title="Section pad · tap to jump"></div>
        {/each}
        {#each CUSTOM_LABELS as label, i (label)}
          <div
            class="border-foreground/40 bg-foreground text-background flex aspect-square items-center justify-center rounded-[3px] border p-0.5 text-center text-[8px] font-black leading-none"
            title={`Row 4 pad ${i + 1} → ${label}`}
          >
            {label}
          </div>
        {/each}
        {#each Array(6) as _, i (i)}
          <div class="bg-foreground/15 aspect-square rounded-[3px]" title="Section pad · tap to jump"></div>
        {/each}
      </div>
      <p class="text-muted-foreground text-center text-[10px]">30 section pads · Custom 1/2 start row 4</p>
      <div class="grid grid-cols-8 gap-1">
        {#each STEM_LABELS as label, i (label)}
          <div
            class="border-foreground/40 bg-foreground text-background flex aspect-square items-center justify-center rounded-[3px] border p-0.5 text-center text-[8px] font-black leading-none"
            title={`Pad ${i + 1} → ${label}`}
          >
            {label}
          </div>
        {/each}
      </div>
      <p class="text-muted-foreground text-center text-[10px]">Bottom pad row · slots 1–8 (fixed order)</p>
      <div class="grid grid-cols-8 gap-1">
        {#each STEM_LABELS as label, i (label)}
          <div
            class="border-foreground/40 flex aspect-[2/1] items-center justify-center rounded-[3px] border p-0.5 text-center text-[8px] font-black leading-none"
            title={`Track button ${i + 1} → ${label} (mirrors the pad)`}
          >
            {label}
          </div>
        {/each}
      </div>
      <p class="text-muted-foreground text-center text-[10px]">Track buttons · same stems (mirror) · lit = on</p>
    </div>

    <!-- Scene launch column -->
    <div class="flex w-28 flex-col gap-1">
      {#each scenes as sc (sc.n)}
        <div
          class="flex items-center gap-1.5 rounded-[3px] border px-1.5 py-1 {sc.label === '—'
            ? 'border-foreground/15 text-muted-foreground'
            : 'border-foreground/40'}"
        >
          <span class="bg-foreground/70 inline-block size-2 rounded-full"></span>
          <span class="truncate font-bold">{sc.label}</span>
        </div>
      {/each}
    </div>
  </div>

  <!-- Transport row -->
  <div class="grid grid-cols-3 gap-2">
    <div class="border-foreground/40 flex flex-col items-center rounded-[4px] border px-2 py-1.5">
      <span class="font-black uppercase">Play</span>
      <span class="text-muted-foreground">Play / pause</span>
    </div>
    <div class="border-foreground/40 flex flex-col items-center rounded-[4px] border px-2 py-1.5">
      <span class="font-black uppercase">Stop&nbsp;All</span>
      <span class="text-muted-foreground">Stop</span>
    </div>
    <div class="border-foreground/40 flex flex-col items-center rounded-[4px] border px-2 py-1.5">
      <span class="font-black uppercase">Record</span>
      <span class="text-muted-foreground">Replay section once</span>
    </div>
  </div>

  <!-- LED legend -->
  <div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
    <span class="flex items-center gap-1"><span class="inline-block size-2 rounded-full bg-green-500"></span> lit = active / on</span>
    <span class="flex items-center gap-1"><span class="inline-block size-2 animate-pulse rounded-full bg-amber-500"></span> blinking = armed (replay) / looping</span>
    <span class="flex items-center gap-1"><span class="bg-foreground/20 inline-block size-2 rounded-full"></span> dark = off / unavailable</span>
  </div>
</div>
