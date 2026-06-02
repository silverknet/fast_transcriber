<script lang="ts">
  /**
   * Pre-export preview for the project-level Ableton setlist .als.
   *
   * Minimal: one row per song, an OK/blocker badge, and a single
   * Export button. The click track always renders fresh during export
   * (no per-song toggle needed); cue tracks are deferred.
   */
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import type { SetlistPreflightStatus } from '$lib/export/setlist'

  let {
    open = $bindable(false),
    preflight,
    status,
    message,
    onConfirm,
    onClose,
  }: {
    open?: boolean
    preflight: SetlistPreflightStatus | null
    status: 'idle' | 'preflight' | 'generating' | 'done' | 'error'
    message: string
    onConfirm: () => void
    onClose: () => void
  } = $props()

  const generating = $derived(status === 'generating')
  const done = $derived(status === 'done')
  const error = $derived(status === 'error')

  const readyCount = $derived(preflight ? preflight.songs.filter((s) => !s.blocker).length : 0)
  const totalCount = $derived(preflight?.songs.length ?? 0)
</script>

<Dialog bind:open onOpenChange={(v) => { if (!v) onClose() }}>
  <DialogContent class="max-w-xl">
    <DialogHeader>
      <DialogTitle>Export setlist .als</DialogTitle>
      <DialogDescription>
        One Ableton Live 12 set with five stem rows and a click row, one scene per
        song. Click WAVs are re-rendered on every export to stay in sync with the
        current SongMap.
      </DialogDescription>
    </DialogHeader>

    {#if preflight}
      <div class="max-h-[50vh] overflow-y-auto border-foreground/20 border-2">
        <ul class="divide-y divide-foreground/10 text-xs font-mono">
          {#each preflight.songs as song (song.songId)}
            <li class="flex items-center gap-3 px-3 py-1.5">
              <span class="text-foreground/90 min-w-0 flex-1 truncate">{song.title}</span>
              <span class="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                {song.stemCount}/5 stems
              </span>
              {#if song.blocker}
                <span class="text-destructive shrink-0 text-[11px]" title={song.blocker}>
                  {song.blocker}
                </span>
              {:else}
                <span class="text-emerald-600 dark:text-emerald-400 shrink-0 text-[11px]">
                  Ready
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>

      <p class="text-muted-foreground text-xs">
        {readyCount} of {totalCount} song{totalCount === 1 ? '' : 's'} ready.
        {#if !preflight.ok}Fix the blockers above before exporting.{/if}
      </p>
    {/if}

    {#if message}
      <p
        class="text-xs {error
          ? 'text-destructive'
          : done
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground'}"
        role="status"
      >
        {message}
      </p>
    {/if}

    <DialogFooter class="">
      <Button class="" variant="outline" disabled={generating} onclick={onClose}>
        {done ? 'Close' : 'Cancel'}
      </Button>
      {#if !done}
        <Button
          class=""
          disabled={!preflight?.ok || generating}
          onclick={onConfirm}
        >
          {generating ? 'Generating…' : 'Export .als'}
        </Button>
      {/if}
    </DialogFooter>
  </DialogContent>
</Dialog>
