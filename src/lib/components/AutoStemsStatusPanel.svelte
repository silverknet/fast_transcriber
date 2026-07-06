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
  import { RefreshCw, RotateCcw, Loader2, AlertTriangle, Clock } from '@lucide/svelte'

  let busy = $state(false)

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
</script>

{#if rows.length > 0}
  <section class="auto-stems-panel">
    <header class="auto-stems-head flex items-center gap-2 px-3 py-2">
      <h2 class="text-xs font-bold uppercase tracking-wider">Auto-split</h2>
      <span class="text-muted-foreground text-[11px]">{rows.length} in progress / needs attention</span>
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
          Restart auto-split
        </Button>
      </div>
    </header>
    <ul class="divide-foreground/10 divide-y text-sm">
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
  </section>
{/if}

<style>
  .auto-stems-panel {
    border: 2px solid var(--foreground);
    background: var(--card);
    box-shadow: 4px 4px 0 var(--foreground);
  }

  .auto-stems-head {
    border-bottom: 2px solid var(--foreground);
    background: color-mix(in oklch, var(--muted) 72%, var(--card));
  }
</style>
