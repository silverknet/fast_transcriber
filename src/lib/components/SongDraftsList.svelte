<script lang="ts">
  /**
   * The interactive body of the draft switcher: a radio list plus the
   * create/duplicate actions. Deliberately free of `bits-ui` so it can be
   * driven in a real browser — the Dialog shell around it cannot be, because
   * bits-ui ships unbundled `.svelte` files the browser optimizer can't load
   * (see the `optimizeDeps.exclude` note in vite.config.js).
   *
   * Presentational: reports intent, never touches the songMap store.
   */
  import { Pencil, Trash2 } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'

  export type DraftRow = {
    id: string
    name: string
    active: boolean
    /** e.g. "12 chords · 4 sections · lyrics" */
    counts: string
    /** e.g. "2 days ago"; empty when unknown. */
    age?: string
    /** Explicit created date, e.g. "Jul 23, 2026"; empty when unknown. */
    created?: string
    /** Full timestamp for the hover tooltip. */
    createdTitle?: string
  }

  let {
    rows = [] as DraftRow[],
    message = '',
    onUse,
    onRename,
    onDelete,
    onDuplicate,
    onNewEmpty,
    onDone,
  }: {
    rows?: DraftRow[]
    message?: string
    onUse?: (id: string) => void
    onRename?: (id: string, currentName: string) => void
    onDelete?: (id: string, name: string) => void
    onDuplicate?: () => void
    onNewEmpty?: () => void
    onDone?: () => void
  } = $props()
</script>

  <!-- Rename/delete sit outside the <label> for clarity. (Nesting them inside
       would also work — the HTML spec excludes interactive descendants from
       label activation, and the browser test confirms a nested button does not
       select the row — but keeping them out makes the click targets obvious.) -->
  <div
    class="flex max-h-64 flex-col gap-1 overflow-auto"
    role="radiogroup"
    aria-label="Song drafts"
  >
    {#each rows as row (row.id)}
      <div
        data-testid="draft-row"
        class="flex flex-wrap items-center gap-2 border-2 px-2 py-1.5 text-xs {row.active
          ? 'border-foreground bg-muted'
          : 'border-foreground/50'}"
      >
        <!-- Name on its OWN line (full width, hover for the rest); the counts and
             created date sit beneath it, so a long draft name is no longer
             squeezed down to its first few letters by the metadata beside it. -->
        <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="song-draft"
            class="accent-foreground mt-0.5 size-3.5 shrink-0"
            value={row.id}
            checked={row.active}
            aria-label={row.name}
            onchange={() => onUse?.(row.id)}
          />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="truncate font-bold" title={row.name}>{row.name}</span>
              {#if row.active}
                <span
                  class="bg-foreground text-background inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-black uppercase leading-none tracking-wide"
                  title="This draft is live — it's what plays and what the editor shows"
                >
                  ● Live
                </span>
              {/if}
            </span>
            <span class="text-muted-foreground truncate leading-tight" title={row.createdTitle}>
              {row.counts}{row.created ? ` · created ${row.created}` : row.age ? ` · ${row.age}` : ''}
            </span>
          </span>
        </label>
        <Button
          variant="outline"
          size="sm"
          class="h-6 shrink-0 border-2 px-1.5"
          onclick={() => onRename?.(row.id, row.name)}
          aria-label={`Rename draft ${row.name}`}
          title={`Rename “${row.name}”…`}
        >
          <Pencil class="size-3" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="text-destructive hover:bg-destructive hover:text-background h-6 shrink-0 border-2 px-1.5 disabled:opacity-30"
          disabled={row.active}
          onclick={() => onDelete?.(row.id, row.name)}
          aria-label={`Delete draft ${row.name}`}
          title={row.active
            ? 'Switch to another draft before deleting this one'
            : `Delete “${row.name}”…`}
        >
          <Trash2 class="size-3" aria-hidden="true" />
        </Button>
      </div>
    {/each}
  </div>
  {#if message}
    <p class="text-muted-foreground text-xs" role="status">{message}</p>
  {/if}

  <div class="flex flex-wrap justify-end gap-2">
    <Button variant="outline" class="border-2 text-xs font-bold" onclick={() => onNewEmpty?.()}>
      New empty draft
    </Button>
    <Button variant="outline" class="border-2 text-xs font-bold" onclick={() => onDuplicate?.()}>
      Duplicate this draft
    </Button>
    <Button class="border-2 text-xs font-bold" onclick={() => onDone?.()}>Done</Button>
  </div>
