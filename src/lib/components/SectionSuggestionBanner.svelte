<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { defaultSectionLabel } from '$lib/songmap/sectionEdit'
  import type { SectionSuggestion } from '$lib/sections/predictNext'
  import { Sparkles, SkipForward, Undo2, X } from '@lucide/svelte'

  let {
    suggestion,
    index,
    total,
    dismissedCount,
    onAccept,
    onSkip,
    onDismiss,
    onUndoDismiss,
  }: {
    suggestion: SectionSuggestion | null
    /** 1-based position of `suggestion` within the active candidate list. */
    index: number
    /** Number of visible (non-dismissed) candidates. */
    total: number
    /** Number of candidates currently dismissed; powers the Undo button. */
    dismissedCount: number
    onAccept: () => void
    onSkip: () => void
    onDismiss: () => void
    onUndoDismiss: () => void
  } = $props()

  const label = $derived(suggestion ? defaultSectionLabel(suggestion.kind) : '')
</script>

{#if suggestion || dismissedCount > 0}
  <div
    class="border-foreground bg-muted/40 mb-2 flex flex-col gap-2 border-2 px-3 py-2 text-xs sm:text-sm"
    role="status"
    aria-live="polite"
    aria-label="Suggested next section"
  >
    {#if suggestion}
      <div class="flex items-center gap-3">
        <Sparkles class="text-foreground/70 size-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="font-semibold">
            Suggested next: <span class="font-bold">{label}, {suggestion.bars} bars</span>
            {#if total > 1}
              <span class="text-muted-foreground ml-1 text-[11px] font-normal">
                ({index} of {total})
              </span>
            {/if}
          </div>
          <div class="text-muted-foreground mt-0.5 text-[11px] sm:text-xs">{suggestion.reason}</div>
        </div>
        <Button
          type="button"
          variant="default"
          size="sm"
          class="h-8 shrink-0 text-xs font-bold"
          onclick={onAccept}
        >
          Accept
        </Button>
      </div>
    {:else}
      <!-- All candidates dismissed but Undo is still available. -->
      <div class="text-muted-foreground flex items-center gap-2 italic">
        <Sparkles class="text-foreground/40 size-4 shrink-0" aria-hidden="true" />
        All {dismissedCount} suggestion{dismissedCount === 1 ? '' : 's'} dismissed.
      </div>
    {/if}

    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
      {#if suggestion && total > 1}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-[11px]"
          onclick={onSkip}
          title="Skip — show next candidate (doesn't dismiss)"
        >
          <SkipForward class="size-3.5" aria-hidden="true" />
          Skip
        </Button>
      {/if}
      {#if suggestion}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-[11px]"
          onclick={onDismiss}
          title="Dismiss this suggestion"
        >
          <X class="size-3.5" aria-hidden="true" />
          Dismiss
        </Button>
      {/if}
      {#if dismissedCount > 0}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-[11px]"
          onclick={onUndoDismiss}
          title="Bring back the most recently dismissed suggestion"
        >
          <Undo2 class="size-3.5" aria-hidden="true" />
          Undo dismiss ({dismissedCount})
        </Button>
      {/if}
    </div>
  </div>
{/if}
