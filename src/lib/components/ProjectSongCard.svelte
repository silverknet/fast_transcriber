<script lang="ts">
  /**
   * One row in the project view's song list. A thin table-style row aligned to
   * the column headers in `routes/project/+page.svelte`. Status dots replace
   * inline text labels (column header carries the labels). Actions live in a
   * single edit button + a ⋮ overflow menu — drag handle on the left, no more
   * up/down arrows (reordering is drag-and-drop in the parent).
   *
   * Stems open in the project-level `StemsDialog`, not an inline expand panel —
   * keeps the row consistent and lets drag-and-drop work without the expanded
   * section fighting the dnd zone.
   *
   * Layout grid (matches the header):
   *   handle | title/artist | key/bpm | drums | bass | guitar | vocals | fx | cue | edit | ⋮
   */
  import { Button } from '$lib/components/ui/button'
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
  } from '$lib/components/ui/dropdown-menu'
  import { STEM_TRACKS } from '$lib/export/abletonSet'
  import type { ProjectSongEntry } from '$lib/project/types'
  import type { ProjectSongMetadataLite } from '$lib/stores/project'
  import { stemJobs, type StemJobEntry } from '$lib/stores/stemJobs'
  import {
    Download,
    Eye,
    EyeOff,
    GripVertical,
    MoreVertical,
    Pencil,
    Sliders,
    TextCursorInput,
    Trash2,
    Upload,
  } from '@lucide/svelte'

  let {
    entry,
    metadata,
    position,
    onEdit,
    onOpenStems,
    onToggleHidden,
    onRemove,
    onRename,
    onAttachAudio,
    onExport,
  } = $props<{
    entry: ProjectSongEntry
    metadata?: ProjectSongMetadataLite
    /** 1-based position in the (drag-aware) setlist. Updates live during reorder. */
    position: number
    onEdit: () => void
    /** Open the project-level Stems dialog for this song. */
    onOpenStems: () => void
    onToggleHidden: () => void
    onRemove: () => void
    onRename: () => void
    /** Trigger the project-level hidden file input + attach the audio bytes here. */
    onAttachAudio: () => void
    onExport: () => void
  }>()

  function formatKey(k: ProjectSongMetadataLite['keyDetail']): string {
    if (!k) return ''
    const acc = k.accidental === 'sharp' ? '♯' : k.accidental === 'flat' ? '♭' : ''
    return `${k.root}${acc} ${k.mode}`
  }

  let title = $derived(metadata?.title ?? entry.folder.replace(/^songs\//, ''))
  let artist = $derived(metadata?.artist ?? '')
  let keyText = $derived(formatKey(metadata?.keyDetail))
  // BPM column is narrow (~40 px), so we display the rounded integer and put
  // the precise value in `title` for hover — keeps "120" or "92" visible
  // without truncating songs whose detector returned "120.5", "91.73", etc.
  let bpmText = $derived(metadata?.bpm !== undefined ? `${Math.round(metadata.bpm)}` : '')
  let bpmTitle = $derived(
    metadata?.bpm !== undefined ? `${metadata.bpm} BPM` : 'BPM not set',
  )

  /** Per-stem presence dots, in the order of the column header (STEM_TRACKS). */
  let stemPresence = $derived(
    STEM_TRACKS.map((t) => ({ name: t.name, present: !!metadata?.stemRefs?.[t.name] })),
  )
  let hasCueTrack = $derived(!!metadata?.hasCueTrack)
  let hasAudio = $derived(!!metadata?.hasAudio)

  /** Active stem job for this song (queued / running / paused) — drives the row pill. */
  let activeJob = $derived.by<StemJobEntry | null>(() => {
    for (const j of $stemJobs.values()) {
      if (
        j.songId === entry.id &&
        (j.state === 'queued' || j.state === 'running' || j.state === 'paused')
      ) {
        return j
      }
    }
    return null
  })
  let recentTerminalJob = $derived.by<StemJobEntry | null>(() => {
    let best: StemJobEntry | null = null
    for (const j of $stemJobs.values()) {
      if (j.songId !== entry.id) continue
      if (j.state === 'queued' || j.state === 'running') continue
      if (!best || (j.finishedAt ?? '') > (best.finishedAt ?? '')) best = j
    }
    return best
  })

  /**
   * Demucs stem names the active job is currently rendering (e.g. `drums`,
   * `bass`). Used to glow ONLY those stem dots amber — not every empty slot.
   */
  let inProgressStems = $derived<Set<string>>(new Set(activeJob?.stems ?? []))

  /** Map an Ableton stem-track slot to its demucs source stem (FX has none). */
  const SLOT_TO_DEMUCS: Record<string, string | null> = {
    Drums: 'drums',
    Bass: 'bass',
    Guitar: 'other',
    Vocals: 'vocals',
    FX: null,
  }
</script>

<!--
  The outer <li> is wrapped by `svelte-dnd-action` zone in the parent — it
  expects each child to have a stable id (entry.id). Don't change the root
  element type without updating the parent's dndzone call.
-->
<li
  data-song-id={entry.id}
  class="border-foreground border-b-2 last:border-b-0 py-1.5 {entry.hidden ? 'opacity-60' : ''}"
>
  <!-- ── Thin row aligned to the column header ──────────────────────────── -->
  <!--
    Uses the global `.song-row-grid` class (defined in `routes/project/+page.svelte`).
    A real class — not an inline CSS variable — is necessary because
    `svelte-dnd-action` lifts the dragged row out of the dndzone wrapper and
    reparents it under <body>, where any locally-scoped CSS variable would
    silently disappear (= broken column layout mid-drag).
  -->
  <div
    class="song-row-grid h-9 items-center gap-2 px-2 text-sm"
  >
    <!-- Drag handle (the dnd grip target). -->
    <span
      class="text-muted-foreground hover:text-foreground flex h-full min-w-0 cursor-grab items-center justify-center active:cursor-grabbing"
      aria-label="Reorder song"
      title="Drag to reorder"
    >
      <GripVertical class="size-4 shrink-0" aria-hidden="true" />
    </span>

    <!-- Setlist position (1-indexed). Updates live during drag-and-drop
         because the parent passes `index + 1` from the (reactive) dragSongs. -->
    <span
      class="text-muted-foreground flex min-w-0 items-center justify-center font-mono text-xs tabular-nums"
      aria-label={`Position ${position}`}
    >
      {position}
    </span>

    <!-- Title (+ artist + hidden tag). min-w-0 lets the cell shrink so
         the next column doesn't overflow into it. -->
    <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
      <span class="truncate font-semibold">{title}</span>
      {#if artist}
        <span class="text-muted-foreground truncate text-xs">— {artist}</span>
      {/if}
      {#if entry.hidden}
        <span class="border-foreground/40 text-muted-foreground shrink-0 border px-1 text-[9px] font-semibold uppercase tracking-wider">hidden</span>
      {/if}
      {#if !hasAudio}
        <!-- Inline upload affordance for stub songs. Triggers the project-level
             hidden file input via `onAttachAudio`; one click → file picker →
             attach. Hides itself the moment audio lands on disk. -->
        <button
          type="button"
          class="border-foreground/40 hover:border-foreground hover:bg-muted text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          onclick={onAttachAudio}
          title="Upload an audio file for this song"
        >
          <Upload class="size-2.5" aria-hidden="true" />
          Add audio
        </button>
      {/if}
    </div>

    <!-- Key column: musical key text, left-aligned, truncated. -->
    <div class="text-muted-foreground min-w-0 truncate font-mono text-xs">
      {keyText}
    </div>
    <!-- BPM column: rounded integer for column fit; precise value in tooltip. -->
    <div
      class="text-muted-foreground min-w-0 truncate text-right font-mono text-xs tabular-nums"
      title={bpmTitle}
    >
      {bpmText}
    </div>

    <!-- Audio file dot — matches the stem/cue badge pattern; header icon
         carries the column label. -->
    <span
      class="flex min-w-0 justify-center"
      title={hasAudio ? 'Audio file: ready' : 'Audio file: not added yet'}
    >
      <span
        class="size-2 shrink-0 rounded-full {hasAudio ? 'bg-emerald-500' : 'bg-foreground/20'}"
        aria-label={`audio: ${hasAudio ? 'ready' : 'not added yet'}`}
      ></span>
    </span>

    <!-- Per-stem dots (one per STEM_TRACKS entry, in column order). While a
         stem job is in flight for this song, not-yet-present stems glow amber
         ("in progress") instead of grey ("not generated"). -->
    {#each stemPresence as s (s.name)}
      {@const demucs = SLOT_TO_DEMUCS[s.name]}
      {@const stemInProgress = !s.present && !!demucs && inProgressStems.has(demucs)}
      <span
        class="flex min-w-0 justify-center"
        title={s.present
          ? `${s.name}: ready`
          : stemInProgress
            ? `${s.name}: in progress…`
            : `${s.name}: not generated`}
      >
        <span
          class="size-2 shrink-0 rounded-full {s.present
            ? 'bg-emerald-500'
            : stemInProgress
              ? 'animate-pulse bg-amber-400'
              : 'bg-foreground/20'}"
          aria-label={`${s.name}: ${s.present ? 'ready' : stemInProgress ? 'in progress' : 'not generated'}`}
        ></span>
      </span>
    {/each}

    <!-- Cue dot -->
    <span
      class="flex min-w-0 justify-center"
      title={hasCueTrack ? 'Cue track: ready' : 'Cue track: not generated'}
    >
      <span
        class="size-2 shrink-0 rounded-full {hasCueTrack ? 'bg-emerald-500' : 'bg-foreground/20'}"
        aria-label={`cue: ${hasCueTrack ? 'ready' : 'not generated'}`}
      ></span>
    </span>

    <!-- Edit (pen) -->
    <Button
      variant="outline"
      size="icon"
      class="size-7 shrink-0"
      onclick={onEdit}
      title="Edit song"
      aria-label="Edit song"
    >
      <Pencil class="size-3.5" aria-hidden="true" />
    </Button>

    <!-- Overflow menu (⋮): stems / export / hide-show / remove. -->
    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <Button
            variant="outline"
            size="icon"
            class="size-7 shrink-0"
            title="More actions"
            aria-label="More actions"
            {...props}
          >
            <MoreVertical class="size-3.5" aria-hidden="true" />
          </Button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-44">
        <DropdownMenuItem class="" onclick={onRename}>
          <TextCursorInput class="size-3.5" aria-hidden="true" />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem class="" onclick={onOpenStems}>
          <Sliders class="size-3.5" aria-hidden="true" />
          Stems…
        </DropdownMenuItem>
        <DropdownMenuItem class="" onclick={onExport}>
          <Download class="size-3.5" aria-hidden="true" />
          Export…
        </DropdownMenuItem>
        <DropdownMenuItem class="" onclick={onToggleHidden}>
          {#if entry.hidden}
            <Eye class="size-3.5" aria-hidden="true" />
            Show in setlist
          {:else}
            <EyeOff class="size-3.5" aria-hidden="true" />
            Hide from setlist
          {/if}
        </DropdownMenuItem>
        <DropdownMenuSeparator class="" />
        <DropdownMenuItem onclick={onRemove} class="text-destructive">
          <Trash2 class="size-3.5" aria-hidden="true" />
          Remove…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  <!--
    Stem work is intentionally quiet in the list: in-progress stems glow amber
    on their per-stem dots above (background activity). We only drop a row
    below for things that need the user's eye — a failed/cancelled job, or
    auto-stems giving up. Live progress lives in the Stems dialog.
  -->
  {#if !activeJob && recentTerminalJob && recentTerminalJob.state !== 'done'}
    <div
      class="border-destructive/40 text-destructive mx-2 mb-2 flex flex-wrap items-center gap-2 border px-2 py-1 text-xs"
      role="status"
    >
      <span class="font-mono">
        {recentTerminalJob.state === 'cancelled' ? 'Cancelled' : `Error: ${recentTerminalJob.error ?? 'unknown'}`}
      </span>
    </div>
  {/if}
</li>
