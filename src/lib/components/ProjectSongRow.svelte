<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import type { ProjectSongEntry } from '$lib/project/types'
  import type { ProjectSongMetadataLite } from '$lib/stores/project'
  import { ChevronDown, ChevronUp, Eye, EyeOff, Pencil, Trash2 } from '@lucide/svelte'

  let {
    entry,
    metadata,
    canMoveUp,
    canMoveDown,
    onMoveUp,
    onMoveDown,
    onEdit,
    onToggleHidden,
    onRemove,
  } = $props<{
    entry: ProjectSongEntry
    metadata?: ProjectSongMetadataLite
    canMoveUp: boolean
    canMoveDown: boolean
    onMoveUp: () => void
    onMoveDown: () => void
    onEdit: () => void
    onToggleHidden: () => void
    onRemove: () => void
  }>()

  function formatKey(k: ProjectSongMetadataLite['keyDetail']): string {
    if (!k) return ''
    const acc = k.accidental === 'sharp' ? '♯' : k.accidental === 'flat' ? '♭' : ''
    return `${k.root}${acc} ${k.mode}`
  }

  let title = $derived(metadata?.title ?? entry.folder.replace(/^songs\//, ''))
  let artist = $derived(metadata?.artist ?? '')
  let keyText = $derived(formatKey(metadata?.keyDetail))
  let bpmText = $derived(metadata?.bpm !== undefined ? `${metadata.bpm} BPM` : '')
</script>

<li
  class="border-foreground brutalist-shadow-sm bg-background flex flex-col gap-2 border-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 {entry.hidden ? 'opacity-60' : ''}"
>
  <div class="min-w-0 flex-1">
    <div class="flex items-baseline gap-2">
      <span class="truncate text-base font-semibold">{title}</span>
      {#if artist}
        <span class="text-muted-foreground shrink-0 truncate text-sm">— {artist}</span>
      {/if}
      {#if entry.hidden}
        <span class="border-foreground/40 text-muted-foreground ml-1 shrink-0 border px-1.5 text-[10px] font-semibold uppercase tracking-wider">hidden</span>
      {/if}
    </div>
    <div class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs">
      {#if keyText}<span>{keyText}</span>{/if}
      {#if keyText && bpmText}<span aria-hidden="true">·</span>{/if}
      {#if bpmText}<span>{bpmText}</span>{/if}
      {#if !keyText && !bpmText}
        <span class="opacity-60">No key / bpm yet</span>
      {/if}
    </div>
  </div>

  <div class="flex shrink-0 flex-wrap items-center gap-1">
    <div class="flex items-center gap-0.5" role="group" aria-label="Setlist position">
      <Button
        variant="outline"
        size="sm"
        class="h-8 px-2"
        disabled={!canMoveUp}
        onclick={onMoveUp}
        aria-label="Move up in setlist"
        title="Move up in setlist"
      >
        <ChevronUp class="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="h-8 px-2"
        disabled={!canMoveDown}
        onclick={onMoveDown}
        aria-label="Move down in setlist"
        title="Move down in setlist"
      >
        <ChevronDown class="size-3.5" aria-hidden="true" />
      </Button>
    </div>
    <Button variant="outline" size="sm" class="h-8 gap-1 px-2" onclick={onEdit}>
      <Pencil class="size-3.5" aria-hidden="true" />
      Edit
    </Button>
    <Button variant="outline" size="sm" class="h-8 gap-1 px-2" onclick={onToggleHidden}>
      {#if entry.hidden}
        <Eye class="size-3.5" aria-hidden="true" />
        Show
      {:else}
        <EyeOff class="size-3.5" aria-hidden="true" />
        Hide
      {/if}
    </Button>
    <Button variant="outline" size="sm" class="h-8 gap-1 px-2" onclick={onRemove}>
      <Trash2 class="size-3.5" aria-hidden="true" />
      Remove
    </Button>
  </div>
</li>
