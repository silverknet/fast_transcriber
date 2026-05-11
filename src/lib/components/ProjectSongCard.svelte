<script lang="ts">
  /**
   * One row in the project view's song list. Collapsed = compact summary
   * (title, artist, key/bpm, stem status badges, action buttons). Expanded
   * = mounts `SongSetPanel` underneath for stem generation, slot binding,
   * and .als export.
   */
  import { Button } from '$lib/components/ui/button'
  import { STEM_TRACKS } from '$lib/export/abletonSet'
  import SongSetPanel from '$lib/components/SongSetPanel.svelte'
  import type { ProjectSongEntry } from '$lib/project/types'
  import type { ProjectSongMetadataLite } from '$lib/stores/project'
  import { stemJobs, type StemJobEntry } from '$lib/stores/stemJobs'
  import {
    ChevronDown,
    ChevronUp,
    Eye,
    EyeOff,
    Pencil,
    Trash2,
  } from '@lucide/svelte'

  let {
    entry,
    metadata,
    canMoveUp,
    canMoveDown,
    isExpanded,
    projectFolderHandle,
    onToggleExpand,
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
    isExpanded: boolean
    projectFolderHandle: FileSystemDirectoryHandle | null
    onToggleExpand: () => void
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

  /** Stem-status badges from the cached stemRefs (no global-store dependency). */
  type StemStatus = { name: string; present: boolean }
  let stemBadges = $derived<StemStatus[]>(
    STEM_TRACKS.map((t) => ({ name: t.name, present: !!metadata?.stemRefs?.[t.name] })),
  )
  let stemsReadyCount = $derived(stemBadges.filter((b) => b.present).length)

  /** Active stem job for this song (queued / running) — drives the status pill. */
  let activeJob = $derived.by<StemJobEntry | null>(() => {
    for (const j of $stemJobs.values()) {
      if (j.songId === entry.id && (j.state === 'queued' || j.state === 'running')) return j
    }
    return null
  })
  /** Most-recent terminal job (done/error/cancelled) — shown briefly until next start. */
  let recentTerminalJob = $derived.by<StemJobEntry | null>(() => {
    let best: StemJobEntry | null = null
    for (const j of $stemJobs.values()) {
      if (j.songId !== entry.id) continue
      if (j.state === 'queued' || j.state === 'running') continue
      if (!best || (j.finishedAt ?? '') > (best.finishedAt ?? '')) best = j
    }
    return best
  })
</script>

<li
  class="border-foreground brutalist-shadow-sm bg-background border-2 {entry.hidden ? 'opacity-60' : ''}"
>
  <!-- ── Collapsed row ────────────────────────────────────────────────── -->
  <div class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
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

      <!-- Stem status badges -->
      <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {#each stemBadges as b (b.name)}
          <span
            class="inline-flex items-center gap-1 font-mono"
            title={b.present ? `${b.name}: ready` : `${b.name}: not generated`}
          >
            <span
              class="size-1.5 shrink-0 rounded-full {b.present
                ? 'bg-emerald-500'
                : 'bg-foreground/20'}"
              aria-hidden="true"
            ></span>
            <span class:text-muted-foreground={!b.present}>{b.name}</span>
          </span>
        {/each}
        <span class="text-muted-foreground ml-auto shrink-0">
          {stemsReadyCount}/{stemBadges.length} stems
        </span>
      </div>

      <!-- Active / recent stem-job pill (visible whether expanded or collapsed) -->
      {#if activeJob}
        <div
          class="border-foreground/40 mt-2 flex flex-wrap items-center gap-2 border px-2 py-1 text-xs"
          role="status"
        >
          <span
            class="size-1.5 shrink-0 rounded-full {activeJob.state === 'running'
              ? 'animate-pulse bg-amber-500'
              : 'bg-foreground/40'}"
            aria-hidden="true"
          ></span>
          <span class="font-mono">
            {activeJob.state === 'queued' ? 'Queued' : activeJob.label || 'Running'}
          </span>
          {#if activeJob.state === 'running'}
            <span class="text-muted-foreground font-mono tabular-nums">
              {activeJob.overallPct}% overall · {activeJob.currentPct}% pass
            </span>
          {/if}
        </div>
      {:else if recentTerminalJob && recentTerminalJob.state !== 'done'}
        <div
          class="border-destructive/40 text-destructive mt-2 flex flex-wrap items-center gap-2 border px-2 py-1 text-xs"
          role="status"
        >
          <span class="font-mono">
            {recentTerminalJob.state === 'cancelled' ? 'Cancelled' : `Error: ${recentTerminalJob.error ?? 'unknown'}`}
          </span>
        </div>
      {/if}
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
      <Button
        variant={isExpanded ? 'default' : 'outline'}
        size="sm"
        class="h-8 gap-1 px-2"
        onclick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Collapse song panel' : 'Expand song panel'}
        title={isExpanded ? 'Collapse' : 'Expand to manage stems and export'}
      >
        {#if isExpanded}
          <ChevronUp class="size-3.5" aria-hidden="true" />
        {:else}
          <ChevronDown class="size-3.5" aria-hidden="true" />
        {/if}
        <span class="hidden sm:inline">Set</span>
      </Button>
    </div>
  </div>

  <!-- ── Expanded panel ─────────────────────────────────────────────── -->
  {#if isExpanded && projectFolderHandle}
    <SongSetPanel {entry} {projectFolderHandle} />
  {/if}
</li>
