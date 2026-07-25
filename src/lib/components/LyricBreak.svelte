<script lang="ts">
  /**
   * Live "instrumental break" display — a calm countdown to the next sung line,
   * shown IN PLACE of the karaoke lyrics during a long gap (detection in
   * `$lib/audio/lyricBreak.ts`). Read-only, presentational.
   *
   * Kept deliberately COMPACT so it fits inside the lyrics area's reserved height
   * and swapping to/from it never shifts the surrounding layout.
   */
  let {
    untilSec,
    progress,
    nextText = '',
  }: { untilSec: number; progress: number; nextText?: string } = $props()

  const secs = $derived(Math.max(0, Math.ceil(untilSec)))
</script>

<div
  class="flex flex-col items-center justify-center gap-1.5 text-center"
  aria-label="Instrumental break — next line coming"
  aria-live="polite"
>
  <div class="flex items-baseline gap-2 leading-none">
    <span class="text-muted-foreground/70 text-[10px] font-black uppercase tracking-[0.3em]">Break</span>
    <span class="text-foreground/85 text-4xl font-black leading-none tabular-nums">{secs}</span>
  </div>
  <div class="bg-muted h-1 w-32 max-w-[60vw] overflow-hidden rounded-full">
    <div
      class="bg-primary h-full transition-[width] duration-200 ease-linear"
      style="width: {Math.round(progress * 100)}%"
    ></div>
  </div>
  {#if nextText}
    <div class="text-muted-foreground/70 max-w-full truncate text-sm">
      Next: <span class="text-foreground/80 font-bold">{nextText}</span>
    </div>
  {/if}
</div>
