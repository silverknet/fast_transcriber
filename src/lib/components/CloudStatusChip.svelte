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
  // Wrapped in try/catch: subscribeToCloudProject constructs the Supabase
  // client synchronously and can throw if env isn't configured — that must NOT
  // blank the whole box (this was why the chip could vanish on a cloud project).
  $effect(() => {
    const id = cloud?.projectId
    if (!id) return
    let unsub: Unsubscribe | null = null
    try {
      unsub = subscribeToCloudProject(id, () => {
        pulling = true
        void pullCloudChanges().finally(() => (pulling = false))
      })
    } catch (e) {
      console.warn('[CloudStatusChip] realtime unavailable:', e)
    }
    return () => {
      unsub?.()
      unsub = null
    }
  })

  const memberCount = $derived($projectMembers.length)
  const status = $derived(pulling ? 'syncing' : pending > 0 ? 'pending' : 'synced')
</script>

<!--
  The ONE boxed element in the header row: a solid bordered card so cloud
  status reads distinctly from the raw (borderless) action buttons next to it.
-->
{#if !cloud}
  <button
    type="button"
    class="border-foreground bg-muted/40 hover:bg-muted inline-flex h-9 shrink-0 items-center gap-2 border-2 px-3 text-xs font-semibold"
    onclick={() => onManage?.()}
    title="Enable cloud sync to share this project with others"
  >
    <Cloud class="text-muted-foreground size-4" aria-hidden="true" />
    <span class="flex flex-col items-start leading-tight">
      <span>Not synced</span>
      <span class="text-muted-foreground text-[10px] font-normal">Sync to cloud →</span>
    </span>
  </button>
{:else}
  <button
    type="button"
    class="border-foreground bg-muted/40 hover:bg-muted inline-flex h-9 shrink-0 items-center gap-2.5 border-2 px-3 text-xs"
    onclick={() => onManage?.()}
    title="Manage sharing — members and invites"
  >
    {#if status === 'syncing'}
      <Loader2 class="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
      <span class="font-semibold">Syncing…</span>
    {:else if status === 'pending'}
      <Cloud class="text-amber-600 dark:text-amber-400 size-4" aria-hidden="true" />
      <span class="font-semibold">Saving…</span>
    {:else}
      <Check class="text-emerald-600 dark:text-emerald-400 size-4" aria-hidden="true" />
      <span class="font-semibold">Synced</span>
    {/if}
    <span class="bg-foreground/20 h-4 w-px" aria-hidden="true"></span>
    <span class="text-muted-foreground inline-flex items-center gap-1" title={`${memberCount || 1} member${(memberCount || 1) === 1 ? '' : 's'}`}>
      <Users class="size-3.5" aria-hidden="true" />
      {memberCount || 1}
    </span>
  </button>
{/if}
