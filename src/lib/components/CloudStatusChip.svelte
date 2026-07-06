<script lang="ts">
  /**
   * Compact cloud status for the project header row. Replaces the old
   * "Cloud · rev N + Pull" panel — sync is fully automatic now, so there's no
   * manual pull button and no revision number to think about.
   *
   *   - Not cloud-linked → a "Sync to cloud" button (opens Share to enable).
   *   - Linked → a chip showing Synced / Syncing… / Pending + member count.
   *     Clicking opens the Share dialog (members + invites).
   *
   * Also hosts the realtime auto-pull subscription (moved here from the old
   * panel) so remote changes land within ~1s with no user action.
   */
  import { Cloud, Loader2, Users, Check } from '@lucide/svelte'
  import { project } from '$lib/stores/project'
  import { projectMembers } from '$lib/stores/projectRole'
  import { pullCloudChanges } from '$lib/client/cloudSync'
  import { subscribeToCloudProject, type Unsubscribe } from '$lib/client/cloudRealtime'

  let { onManage }: { onManage?: () => void } = $props()

  const cloud = $derived($project.data?.cloud ?? null)
  const pending = $derived(cloud?.pendingChanges ?? 0)
  let pulling = $state(false)

  // Realtime auto-pull: resubscribe when the cloud project changes. Any remote
  // change → debounced pull inside the helper. No manual Pull button needed.
  $effect(() => {
    const id = cloud?.projectId
    if (!id) return
    let unsub: Unsubscribe | null = subscribeToCloudProject(id, () => {
      pulling = true
      void pullCloudChanges().finally(() => (pulling = false))
    })
    return () => {
      unsub?.()
      unsub = null
    }
  })

  const memberCount = $derived($projectMembers.length)
  const status = $derived(pulling ? 'syncing' : pending > 0 ? 'pending' : 'synced')
</script>

{#if !cloud}
  <button
    type="button"
    class="border-foreground/40 hover:border-foreground hover:bg-muted inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-2.5 text-xs font-semibold"
    onclick={() => onManage?.()}
    title="Enable cloud sync to share this project"
  >
    <Cloud class="size-3.5" aria-hidden="true" />
    Sync to cloud
  </button>
{:else}
  <button
    type="button"
    class="border-foreground/40 hover:border-foreground hover:bg-muted inline-flex h-8 shrink-0 items-center gap-2 border-2 px-2.5 text-xs"
    onclick={() => onManage?.()}
    title="Manage sharing — members and invites"
  >
    {#if status === 'syncing'}
      <Loader2 class="text-muted-foreground size-3.5 animate-spin" aria-hidden="true" />
      <span class="font-semibold">Syncing…</span>
    {:else if status === 'pending'}
      <Cloud class="text-amber-600 dark:text-amber-400 size-3.5" aria-hidden="true" />
      <span class="font-semibold">Saving…</span>
    {:else}
      <Check class="text-emerald-600 dark:text-emerald-400 size-3.5" aria-hidden="true" />
      <span class="font-semibold">Synced</span>
    {/if}
    <span class="bg-foreground/15 h-3.5 w-px" aria-hidden="true"></span>
    <span class="text-muted-foreground inline-flex items-center gap-1">
      <Users class="size-3.5" aria-hidden="true" />
      {memberCount || 1}
    </span>
  </button>
{/if}
