<script lang="ts">
  /**
   * Auto-split status panel — shows what the background stem daemon is doing
   * (queued / splitting / blocked / gave-up, with the reason) and offers force
   * controls: per-song Retry, project-wide Restart, and a manual Refresh.
   * Only renders rows that need attention; hidden entirely when nothing does.
   */
  import { Button } from '$lib/components/ui/button'
  import { project } from '$lib/stores/project'
  import {
    autoStemsStatuses,
    refreshAutoStemsStatuses,
    retryAutoStemsSong,
    restartAutoStems,
    type AutoStemStatus,
  } from '$lib/client/autoStemsStatus'
  import { RefreshCw, RotateCcw, Loader2, AlertTriangle, Clock, Scissors } from '@lucide/svelte'

  let busy = $state(false)
  let open = $state(false)
  let root = $state<HTMLDivElement | null>(null)

  // Rows worth showing: anything that isn't a silent "ready". Sorted so
  // problems (failed/abandoned) surface first, then in-flight, then blocked.
  const PHASE_ORDER: Record<string, number> = {
    abandoned: 0,
    failed: 1,
    running: 2,
    queued: 3,
    blocked: 4,
  }
  const rows = $derived.by(() => {
    const out: AutoStemStatus[] = []
    for (const s of $autoStemsStatuses.values()) {
      if (s.phase && s.phase !== 'ready') out.push(s)
    }
    return out.sort((a, b) => (PHASE_ORDER[a.phase ?? ''] ?? 9) - (PHASE_ORDER[b.phase ?? ''] ?? 9))
  })
  const issueCount = $derived(
    rows.filter((r) => r.phase === 'abandoned' || r.phase === 'failed').length,
  )
  const workingCount = $derived(
    rows.filter((r) => r.phase === 'running' || r.phase === 'queued').length,
  )
  const statusText = $derived(
    issueCount > 0
      ? `${issueCount} needs attention`
      : workingCount > 0
        ? `${workingCount} working`
        : `${rows.length} waiting`,
  )

  function titleFor(folder: string | undefined): string {
    if (!folder) return 'Song'
    return $project.metadataByFolder[folder]?.title || folder.replace(/^songs\//, '')
  }

  async function onRetry(folder: string | undefined) {
    const osPath = $project.osPath
    if (!osPath || !folder) return
    busy = true
    await retryAutoStemsSong(osPath, folder)
    await refreshAutoStemsStatuses()
    busy = false
  }

  async function onRestart() {
    const osPath = $project.osPath
    if (!osPath) return
    busy = true
    await restartAutoStems(osPath)
    await refreshAutoStemsStatuses()
    busy = false
  }

  function onWindowClick(event: MouseEvent) {
    if (!open || !root) return
    const target = event.target
    if (target instanceof Node && !root.contains(target)) open = false
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open = false
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

{#if rows.length > 0}
  <div bind:this={root} class="auto-stems-root">
    <button
      type="button"
      class="auto-stems-chip border-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center border-2 text-xs font-semibold"
      class:needs-attention={issueCount > 0}
      class:is-working={issueCount === 0 && workingCount > 0}
      onclick={() => (open = !open)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={`Auto-split status: ${statusText}`}
      title={`Auto-split: ${statusText}`}
    >
      {#if issueCount > 0}
        <AlertTriangle class="size-4" aria-hidden="true" />
      {:else if workingCount > 0}
        <Loader2 class="size-4 animate-spin" aria-hidden="true" />
      {:else}
        <Scissors class="size-4" aria-hidden="true" />
      {/if}
      <span class="auto-stems-count">{rows.length}</span>
    </button>

    {#if open}
      <div
        class="auto-stems-popover"
        role="dialog"
        aria-modal="false"
        aria-label="Auto-split status"
        tabindex="-1"
      >
        <header class="auto-stems-head flex items-center gap-2 px-3 py-2">
          <div class="min-w-0">
            <h2 class="text-xs font-bold uppercase tracking-wider">Auto-split</h2>
            <p class="text-muted-foreground truncate text-[11px]">{statusText}</p>
          </div>
          <div class="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-xs"
              disabled={busy}
              onclick={() => void refreshAutoStemsStatuses()}
              title="Re-read the sidecar's current stem status"
            >
              <RefreshCw class="size-3" aria-hidden="true" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-xs"
              disabled={busy}
              onclick={() => void onRestart()}
              title="Clear all attempt limits and re-scan every song"
            >
              <RotateCcw class="size-3" aria-hidden="true" />
              Restart
            </Button>
          </div>
        </header>
        <ul class="auto-stems-list divide-foreground/10 divide-y text-sm">
          {#each rows as r (r.key)}
            <li class="flex items-center gap-3 px-3 py-2">
              <span class="shrink-0">
                {#if r.phase === 'running'}
                  <Loader2 class="text-amber-500 size-4 animate-spin" aria-hidden="true" />
                {:else if r.phase === 'queued'}
                  <Clock class="text-muted-foreground size-4" aria-hidden="true" />
                {:else if r.phase === 'abandoned' || r.phase === 'failed'}
                  <AlertTriangle class="text-amber-600 dark:text-amber-400 size-4" aria-hidden="true" />
                {:else}
                  <Clock class="text-muted-foreground size-4" aria-hidden="true" />
                {/if}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{titleFor(r.folder)}</p>
                <p class="text-muted-foreground truncate text-[11px]">
                  {#if r.phase === 'running'}Splitting stems…
                  {:else if r.phase === 'queued'}Queued for splitting…
                  {:else}{r.reason ?? r.phase}{/if}
                </p>
              </div>
              {#if r.phase === 'abandoned' || r.phase === 'failed'}
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 shrink-0 gap-1 text-xs"
                  disabled={busy}
                  onclick={() => void onRetry(r.folder)}
                >
                  <RotateCcw class="size-3" aria-hidden="true" />
                  Retry
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .auto-stems-root {
    position: relative;
    z-index: 30;
  }

  .auto-stems-chip {
    position: relative;
    background: var(--card);
    color: var(--foreground);
  }

  .auto-stems-chip:hover {
    background: color-mix(in oklch, var(--foreground) 7%, var(--card));
  }

  .auto-stems-chip.is-working {
    background: color-mix(in oklch, var(--foreground) 10%, var(--card));
  }

  .auto-stems-chip.needs-attention {
    background: var(--studio-orange);
    color: var(--studio-ink);
  }

  .auto-stems-chip.needs-attention:hover {
    background: color-mix(in oklch, var(--studio-orange) 86%, var(--foreground));
  }

  :global(.dark) .auto-stems-chip:hover {
    background: color-mix(in oklch, var(--foreground) 14%, var(--card));
  }

  :global(.dark) .auto-stems-chip.is-working {
    background: color-mix(in oklch, var(--foreground) 18%, var(--card));
  }

  .auto-stems-count {
    display: inline-grid;
    position: absolute;
    right: -0.45rem;
    top: -0.45rem;
    min-width: 1.05rem;
    height: 1.05rem;
    place-items: center;
    border: 2px solid var(--ink);
    border-radius: calc(var(--radius) * 0.5);
    background: var(--foreground);
    color: var(--background);
    font-size: 0.58rem;
    font-weight: 900;
    line-height: 1;
  }

  .auto-stems-popover {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    width: min(32rem, calc(100vw - 2rem));
    border: 2px solid var(--ink);
    border-radius: var(--radius);
    background: var(--card);
    overflow: hidden;
    box-shadow: 4px 4px 0 var(--ink);
  }

  .auto-stems-head {
    border-bottom: 2px solid var(--ink);
    background: color-mix(in oklch, var(--muted) 72%, var(--card));
  }

  .auto-stems-list {
    max-height: min(20rem, 55vh);
    overflow: auto;
  }

  @media (max-width: 640px) {
    .auto-stems-popover {
      position: fixed;
      top: 4.25rem;
      right: 1rem;
      left: 1rem;
      width: auto;
    }
  }
</style>
