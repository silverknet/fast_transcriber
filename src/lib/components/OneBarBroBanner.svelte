<script lang="ts">
  /**
   * "BarBro is open in the offline app" — the visible half of the interlock.
   *
   * The invisible half (`editingLock.ts`) stops this browser writing
   * `song.smap` while the offline app has the same folder open. That prevents
   * the data loss, but on its own it produces something worse than a crash: an
   * app that looks like it is working and quietly saves nothing.
   *
   * So this is deliberately not dismissible and not subtle. It names the state,
   * says what it is protecting, and gives the one action that clears it.
   */
  import { TriangleAlert } from '@lucide/svelte'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project } from '$lib/stores/project'
  import { offlineBuild } from '$lib/stores/offlineBuild'
  import { editingLock } from '$lib/client/editingLock'

  const lock = $derived(
    editingLock({
      offlineAppOpen: $desktopCompanionStatus.offlineAppOpen,
      isOfflineApp: $offlineBuild,
      hasLocalProject: $project.osPath !== null,
    }),
  )
</script>

{#if lock.paused}
  <div
    class="border-foreground bg-background flex items-start gap-2.5 border-b-2 px-3 py-2"
    role="status"
    aria-live="polite"
  >
    <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div class="min-w-0">
      <p class="text-xs font-bold">{lock.title}</p>
      <p class="text-muted-foreground text-[11px]">{lock.detail}</p>
    </div>
  </div>
{/if}
