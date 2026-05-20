<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { defaultSectionLabel } from '$lib/songmap/sectionEdit'
  import type { SectionSuggestion } from '$lib/sections/predictNext'
  import { Sparkles } from '@lucide/svelte'

  let {
    suggestion,
    onAccept,
  }: {
    suggestion: SectionSuggestion | null
    onAccept: () => void
  } = $props()

  const label = $derived(suggestion ? defaultSectionLabel(suggestion.kind) : '')
</script>

{#if suggestion}
  <div
    class="border-foreground bg-muted/40 mb-2 flex items-center gap-3 border-2 px-3 py-2 text-xs sm:text-sm"
    role="status"
    aria-live="polite"
    aria-label="Suggested next section"
  >
    <Sparkles class="text-foreground/70 size-4 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <div class="font-semibold">
        Suggested next: <span class="font-bold">{label}, {suggestion.bars} bars</span>
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
{/if}
