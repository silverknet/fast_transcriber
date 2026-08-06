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
  import { formatTransposeLabel, transposeSongKey } from '$lib/songmap/transposition'
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
    Waves,
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
    onReplaceAudio,
    onExport,
    onTransition,
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
    /** Open the shared project-level audio dialog and attach the selected audio here. */
    onAttachAudio: () => void
    /** Replace the audio of a song that already has it (hard reset of derived data). */
    onReplaceAudio: () => void
    onExport: () => void
    /** Prepare the programmed handoff from this song to its next setlist song. */
    onTransition?: () => void
  }>()

  function formatKey(k: ProjectSongMetadataLite['keyDetail']): string {
    if (!k) return ''
    const acc = k.accidental === 'sharp' ? '♯' : k.accidental === 'flat' ? '♭' : ''
    return `${k.root}${acc} ${k.mode}`
  }

  let title = $derived(metadata?.title ?? entry.folder.replace(/^songs\//, ''))
  let artist = $derived(metadata?.artist ?? '')
  let transposeSemitones = $derived(metadata?.transposeSemitones ?? 0)
  // Show the committed key if set, otherwise the auto-detected one (rendered
  // muted so "detected" reads differently from "confirmed").
  let sourceKey = $derived(metadata?.keyDetail ?? metadata?.detectedKey)
  let displayedKey = $derived(
    sourceKey && transposeSemitones !== 0 ? transposeSongKey(sourceKey, transposeSemitones) : sourceKey,
  )
  let keyText = $derived.by(() => {
    const key = formatKey(displayedKey)
    const tr = transposeSemitones !== 0 ? formatTransposeLabel(transposeSemitones) : ''
    return [key, tr].filter(Boolean).join(' ')
  })
  let keyIsDetected = $derived(!metadata?.keyDetail && !!metadata?.detectedKey)
  let keyTitle = $derived.by(() => {
    if (!sourceKey && transposeSemitones === 0) return undefined
    const detected = keyIsDetected ? 'Detected key' : 'Key'
    const source = formatKey(sourceKey)
    const displayed = formatKey(displayedKey)
    if (transposeSemitones === 0) return keyIsDetected ? `${detected} automatically — open the song to confirm` : undefined
    return `${detected}: ${displayed || 'unknown'} (${formatTransposeLabel(transposeSemitones)}). Original: ${source || 'unknown'}.`
  })
  // Songs with audio but no beat grid yet — surfaced clearly so a blank
  // key/BPM doesn't look broken.
  let notAnalyzed = $derived(!!metadata?.hasAudio && metadata?.analyzed === false)
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
  // Green iff there are actually cues to speak in live mode — not merely that a
  // (possibly stale/click-only) cue WAV exists on disk.
  let hasCueContent = $derived(!!metadata?.hasCueContent)
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
  class="project-song-row border-foreground border-b-2 last:border-b-0 py-1.5 {entry.hidden ? 'opacity-60' : ''}"
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
      <!-- Title stacked ABOVE the artist (not side-by-side): the two read as a
           unit, and long titles/artists each truncate on their own line. -->
      <div class="flex min-w-0 flex-col justify-center leading-tight">
        <span class="truncate font-semibold">{title}</span>
        {#if artist}
          <span class="text-muted-foreground/70 truncate text-xs">{artist}</span>
        {/if}
      </div>
      {#if entry.hidden}
        <span class="border-foreground/40 text-muted-foreground shrink-0 border px-1 text-[9px] font-semibold uppercase tracking-wider">hidden</span>
      {/if}
      {#if notAnalyzed}
        <!-- Has audio but no beat grid yet — make it obvious the blanks aren't a bug. -->
        <span
          class="border-amber-500/60 text-amber-700 dark:text-amber-400 shrink-0 border px-1 text-[9px] font-semibold uppercase tracking-wider"
          title="This song has audio but hasn't been analyzed yet — open it to detect beats, bars and key."
        >Not analyzed</span>
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

    <!-- Key column: committed key, or the auto-detected key rendered muted. -->
    <div
      class="min-w-0 truncate font-mono text-xs {keyIsDetected
        ? 'text-muted-foreground/60 italic'
        : 'text-muted-foreground'}"
      title={keyTitle}
    >
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
        class="studio-light {hasAudio ? 'bg-emerald-500' : 'bg-foreground/20'}"
        aria-label={`audio: ${hasAudio ? 'ready' : 'not added yet'}`}
      ></span>
    </span>

    <!-- Per-stem dots (one per STEM_TRACKS entry, in column order). While a
         stem job is in flight for this song: not-yet-present stems glow amber
         ("in progress") instead of grey ("not generated"); already-present
         stems being re-rendered at higher quality show half green / half
         amber ("ready, upgrading"). -->
    {#each stemPresence as s (s.name)}
      {@const demucs = SLOT_TO_DEMUCS[s.name]}
      {@const stemInProgress = !!demucs && inProgressStems.has(demucs)}
      <span
        class="flex min-w-0 justify-center"
        title={s.present
          ? stemInProgress
            ? `${s.name}: ready — a better version is rendering…`
            : `${s.name}: ready`
          : stemInProgress
            ? `${s.name}: in progress…`
            : `${s.name}: not generated`}
      >
        <span
          class="studio-light {s.present
            ? stemInProgress
              ? 'studio-light-upgrading animate-pulse'
              : 'bg-emerald-500'
            : stemInProgress
              ? 'animate-pulse bg-amber-400'
              : 'bg-foreground/20'}"
          aria-label={`${s.name}: ${
            s.present
              ? stemInProgress
                ? 'ready, better version rendering'
                : 'ready'
              : stemInProgress
                ? 'in progress'
                : 'not generated'
          }`}
        ></span>
      </span>
    {/each}

    <!-- Cue dot -->
    <span
      class="flex min-w-0 justify-center"
      title={hasCueContent ? 'Cues: present' : 'Cues: none'}
    >
      <span
        class="studio-light {hasCueContent ? 'bg-emerald-500' : 'bg-foreground/20'}"
        aria-label={`cue: ${hasCueContent ? 'present' : 'none'}`}
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
        {#if hasAudio}
          <DropdownMenuItem class="" onclick={onReplaceAudio}>
            <Upload class="size-3.5" aria-hidden="true" />
            Replace audio…
          </DropdownMenuItem>
        {/if}
        <DropdownMenuItem class="" onclick={onExport}>
          <Download class="size-3.5" aria-hidden="true" />
          Export…
        </DropdownMenuItem>
        {#if onTransition}
          <DropdownMenuItem class="" onclick={onTransition}>
            <Waves class="size-3.5" aria-hidden="true" />
            Transition to next…
          </DropdownMenuItem>
        {/if}
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

<style>
  .project-song-row {
    background: var(--card);
    transition: background-color 120ms ease;
  }

  .project-song-row:nth-child(even) {
    background: color-mix(in oklch, var(--card) 78%, var(--muted));
  }

  .project-song-row:hover {
    background: color-mix(in oklch, var(--studio-orange) 10%, var(--card));
  }

  .studio-light {
    display: block;
    width: 0.58rem;
    height: 0.58rem;
    flex-shrink: 0;
    border: 1px solid color-mix(in oklch, var(--ink) 70%, transparent);
    border-radius: 2px;
    box-shadow: 1px 1px 0 var(--ink);
  }

  /* "Ready, but a better version is rendering": half green (you can play the
     current stem) / half amber (work in flight). Diagonal split so it reads
     at 0.58rem. Hex over theme vars: these match Tailwind's emerald-500 /
     amber-400 used by the other dot states. */
  .studio-light-upgrading {
    background: linear-gradient(135deg, #10b981 0 50%, #fbbf24 50% 100%);
  }

  :global(.project-song-row [data-slot='button']) {
    box-shadow: none;
  }
</style>
