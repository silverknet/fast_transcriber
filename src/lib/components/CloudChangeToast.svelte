<script lang="ts">
  /**
   * Shows when a collaborator's change lands. Mounted once in the root layout,
   * so it appears on every route — remote changes arrive regardless of which
   * page you are on.
   *
   * Coalescing lives in the store, not here: a burst of arrivals folds into the
   * single notice already on screen rather than stacking popups.
   */
  import { Cloud, X } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { cloudToast, dismissCloudToast, toastMessage } from '$lib/stores/cloudToast'

  const message = $derived($cloudToast ? toastMessage($cloudToast) : '')
</script>

{#if $cloudToast}
  <div
    class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    role="status"
    aria-live="polite"
  >
    <div
      class="border-foreground bg-background brutalist-shadow pointer-events-auto flex max-w-lg items-start gap-3 border-2 px-3 py-2"
    >
      <Cloud class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div class="min-w-0 flex-1 text-xs">
        <span class="font-bold">{message}</span>
        {#if $cloudToast.arrivals > 1}
          <span class="text-muted-foreground"> · {$cloudToast.arrivals} updates</span>
        {/if}
      </div>
      <Button
        variant="outline"
        size="icon-xs"
        class="shrink-0 border-2"
        onclick={dismissCloudToast}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  </div>
{/if}
