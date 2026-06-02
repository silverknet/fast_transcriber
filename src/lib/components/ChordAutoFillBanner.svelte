<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { defaultSectionLabel } from '$lib/songmap/sectionEdit'
  import type { ChordAutoFillProposal } from '$lib/chords/autoFill'
  import { Sparkles, SkipForward, Undo2, X } from '@lucide/svelte'

  let {
    proposal,
    index,
    total,
    dismissedCount,
    onAccept,
    onSkip,
    onDismiss,
    onUndoDismiss,
  }: {
    proposal: ChordAutoFillProposal | null
    /** 1-based position of `proposal` within the visible-candidates list. */
    index: number
    /** Number of visible (non-dismissed) candidates. */
    total: number
    /** Dismissed candidates; powers the Undo button. */
    dismissedCount: number
    onAccept: () => void
    onSkip: () => void
    onDismiss: () => void
    onUndoDismiss: () => void
  } = $props()

  const sourceLabel = $derived(
    proposal ? (proposal.sourceSection.label || defaultSectionLabel(proposal.sourceSection.kind)) : '',
  )
  const targetLabel = $derived(
    proposal ? (proposal.targetSection.label || defaultSectionLabel(proposal.targetSection.kind)) : '',
  )
</script>

{#if proposal || dismissedCount > 0}
  <div
    class="border-foreground bg-muted/40 mb-2 flex flex-col gap-2 border-2 px-3 py-2 text-xs sm:text-sm"
    role="status"
    aria-live="polite"
    aria-label="Chord auto-fill suggestion"
  >
    {#if proposal}
      <div class="flex items-center gap-3">
        <Sparkles class="text-foreground/70 size-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="font-semibold">
            Fill <span class="font-bold">{targetLabel}</span> with chords from
            <span class="font-bold">{sourceLabel}</span>
            <span class="text-muted-foreground font-normal">— {proposal.fillCount}
              {proposal.fillCount === 1 ? 'chord' : 'chords'}</span>
            {#if total > 1}
              <span class="text-muted-foreground ml-1 text-[11px] font-normal">
                ({index} of {total})
              </span>
            {/if}
          </div>
          {#if proposal.skippedExistingCount > 0}
            <div class="text-muted-foreground mt-0.5 text-[11px] sm:text-xs">
              ({proposal.skippedExistingCount} beat{proposal.skippedExistingCount === 1 ? '' : 's'}
              already have chords — those are preserved.)
            </div>
          {/if}
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
      <div class="text-muted-foreground flex items-center gap-2 italic">
        <Sparkles class="text-foreground/40 size-4 shrink-0" aria-hidden="true" />
        All {dismissedCount} auto-fill suggestion{dismissedCount === 1 ? '' : 's'} dismissed.
      </div>
    {/if}

    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
      {#if proposal && total > 1}
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
      {#if proposal}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-[11px]"
          onclick={onDismiss}
          title="Dismiss this auto-fill suggestion"
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
