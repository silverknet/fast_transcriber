<script lang="ts">
  /**
   * Phase 7 — cloud sync status indicator.
   *
   * One small pill in the header showing the current state of the
   * active project's cloud sync:
   *  - "Offline"   — browser reports navigator.onLine === false
   *  - "N pending" — at least one debounced cloud push failed or is
   *                  queued; user is online, so it'll flush soon
   *  - "Synced"    — pendingChanges === 0, online
   *  - "—"         — no cloud project linked (hidden by default)
   *
   * Subscribes to `online` / `offline` window events directly so the
   * pill flips immediately on connectivity change. The autosave
   * already retries on `online`; we don't have to do anything else.
   */
  import { browser } from '$app/environment'
  import { onDestroy, onMount } from 'svelte'
  import { project } from '$lib/stores/project'
  import { requestCloudPush } from '$lib/client/projectAutosave'
  import { CloudCheck, CloudOff, RefreshCw } from '@lucide/svelte'

  const cloud = $derived($project.data?.cloud ?? null)
  const pending = $derived(cloud?.pendingChanges ?? 0)

  let online = $state(true)

  function syncOnline() {
    if (!browser) return
    online = navigator.onLine
  }

  onMount(() => {
    syncOnline()
    const on = () => { online = true }
    const off = () => { online = false }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    onDestroy(() => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    })
  })

  function manualRetry() {
    requestCloudPush()
  }

  type Display =
    | { kind: 'hidden' }
    | { kind: 'offline' }
    | { kind: 'pending'; count: number }
    | { kind: 'synced' }

  const display = $derived<Display>(
    !cloud
      ? { kind: 'hidden' }
      : !online
        ? { kind: 'offline' }
        : pending > 0
          ? { kind: 'pending', count: pending }
          : { kind: 'synced' },
  )
</script>

{#if display.kind !== 'hidden'}
  {#if display.kind === 'offline'}
    <span
      class="border-foreground/30 text-muted-foreground inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold uppercase tracking-wider"
      title="Browser reports offline — edits stay local until you're back online."
    >
      <CloudOff class="size-3.5" aria-hidden="true" />
      Offline
    </span>
  {:else if display.kind === 'pending'}
    <button
      type="button"
      onclick={manualRetry}
      class="border-foreground text-foreground hover:bg-foreground/5 inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold uppercase tracking-wider"
      title="{display.count} edit{display.count === 1 ? '' : 's'} waiting to sync. Click to retry now."
    >
      <RefreshCw class="size-3.5" aria-hidden="true" />
      {display.count} pending
    </button>
  {:else}
    <span
      class="border-emerald-700/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-300 inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold uppercase tracking-wider"
      title="All edits pushed to the cloud."
    >
      <CloudCheck class="size-3.5" aria-hidden="true" />
      Synced
    </span>
  {/if}
{/if}
