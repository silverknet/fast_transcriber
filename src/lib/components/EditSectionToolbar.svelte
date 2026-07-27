<script lang="ts">
  import type { Snippet } from 'svelte'
  import HelpHint from '$lib/components/HelpHint.svelte'

  let {
    title,
    helpText,
    statusText,
    compact = false,
    primaryVisible = true,
    secondaryVisible = true,
    primary,
    secondary,
    actions,
    children,
  } = $props<{
    title: string
    helpText?: string
    statusText?: string
    compact?: boolean
    primaryVisible?: boolean
    secondaryVisible?: boolean
    primary?: Snippet
    secondary?: Snippet
    actions?: Snippet
    children?: Snippet
  }>()
</script>

<div
  class="edit-section-toolbar border-foreground/10 mb-3 border-b px-0.5 {compact
    ? 'pb-1.5'
    : 'pb-2 sm:mb-3'}"
>
  <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    <div class="flex min-w-0 items-center gap-1.5">
      <h2 class="text-muted-foreground truncate text-xs font-black uppercase tracking-wide">{title}</h2>
      {#if helpText}
        <HelpHint label={`${title} help`} text={helpText} />
      {/if}
      {#if statusText}
        <span class="text-muted-foreground font-mono text-[11px] tabular-nums">{statusText}</span>
      {/if}
    </div>

    {#if actions}
      <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>

  {#if primary && primaryVisible}
    <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      {@render primary()}
    </div>
  {/if}

  {#if secondary && secondaryVisible}
    <div class="border-foreground/15 mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-2 text-xs">
      {@render secondary()}
    </div>
  {/if}

  {#if children}
    <div class="mt-2">
      {@render children()}
    </div>
  {/if}
</div>
