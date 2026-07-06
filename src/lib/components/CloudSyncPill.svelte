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
  import { onMount } from 'svelte'
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

  // Returning a cleanup fn from onMount is the Svelte idiom — calling
  // onDestroy inside onMount silently leaks because the destroy hook
  // must be registered during component init, not after first render.
  onMount(() => {
    syncOnline()
    const on = () => { online = true }
    const off = () => { online = false }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
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
      class="cloud-sync-pill"
      title="Browser reports offline — edits stay local until you're back online."
    >
      <CloudOff class="size-3.5" aria-hidden="true" />
      Offline
    </span>
  {:else if display.kind === 'pending'}
    <button
      type="button"
      onclick={manualRetry}
      class="cloud-sync-pill is-pending"
      title="{display.count} edit{display.count === 1 ? '' : 's'} waiting to sync. Click to retry now."
    >
      <RefreshCw class="size-3.5" aria-hidden="true" />
      {display.count} pending
    </button>
  {:else}
    <span
      class="cloud-sync-pill is-synced"
      title="All edits pushed to the cloud."
    >
      <CloudCheck class="size-3.5" aria-hidden="true" />
      Synced
    </span>
  {/if}
{/if}

<style>
  .cloud-sync-pill {
    display: inline-flex;
    height: 2rem;
    flex-shrink: 0;
    align-items: center;
    gap: 0.35rem;
    border: 2px solid color-mix(in oklch, var(--foreground) 42%, transparent);
    background: transparent;
    padding: 0 0.5rem;
    color: var(--foreground);
    font-size: 0.6875rem;
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
  }

  button.cloud-sync-pill {
    cursor: pointer;
  }

  button.cloud-sync-pill:hover {
    border-color: var(--foreground);
    background: color-mix(in oklch, var(--studio-orange) 16%, var(--card));
  }

  .cloud-sync-pill.is-pending {
    border-color: var(--foreground);
    box-shadow: inset 0 -3px 0 var(--studio-orange);
  }

  .cloud-sync-pill.is-synced {
    border-color: color-mix(in oklch, #047857 72%, var(--foreground));
    background: color-mix(in oklch, #6ee7b7 22%, var(--card));
  }
</style>
