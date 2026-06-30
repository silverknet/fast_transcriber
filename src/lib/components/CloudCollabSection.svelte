<script lang="ts">
  /**
   * Cloud sync status strip for the project page.
   *
   * Slimmed down from the previous all-in-one panel: members + invite UI
   * moved into `ShareProjectDialog.svelte` (opened by the header "Share"
   * button). What stays here is the always-visible status:
   *   - sync rev number + pending count
   *   - manual "Pull now" button (still useful when offline → online)
   *   - "Merged remote changes" banner when a 409 was auto-resolved
   *
   * Realtime: when cloud sync is enabled we subscribe to postgres_changes
   * on this project's cloud_songs / cloud_projects / cloud_project_members
   * rows. Any remote change triggers a debounced `pullCloudChanges()` —
   * Bob's screen reflects Alice's saves within ~1s, no manual Pull needed.
   */
  import { Button } from '$lib/components/ui/button'
  import { Cloud, RefreshCw, Sparkles } from '@lucide/svelte'
  import { project } from '$lib/stores/project'
  import { pullCloudChanges } from '$lib/client/cloudSync'
  import { subscribeToCloudProject, type Unsubscribe } from '$lib/client/cloudRealtime'
  import { cloudConflict } from '$lib/stores/cloudConflict'

  const proj = $derived($project.data)
  const cloud = $derived(proj?.cloud ?? null)

  let busy = $state(false)
  let errorMsg = $state('')

  // ── Realtime auto-pull ────────────────────────────────────────────
  // Resubscribe whenever the project id changes (e.g. user opens a
  // different project). The callback fires `pullCloudChanges()` directly
  // — the helper itself dedupes against pending conflicts and stamps
  // `lastSyncedRevision` on success.
  let lastAutoPullAt = $state<Date | null>(null)
  $effect(() => {
    const id = cloud?.projectId
    if (!id) return
    let unsub: Unsubscribe | null = subscribeToCloudProject(id, () => {
      void pullCloudChanges().then(() => {
        lastAutoPullAt = new Date()
      })
    })
    return () => {
      unsub?.()
      unsub = null
    }
  })

  async function onPull() {
    if (!cloud) return
    busy = true
    errorMsg = ''
    const r = await pullCloudChanges()
    busy = false
    if (!r.ok) errorMsg = r.error
    else lastAutoPullAt = new Date()
  }

  function fmtTime(d: Date | null): string {
    if (!d) return ''
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  // ── Conflict banner ───────────────────────────────────────────────
  // Autosave runs `mergeForConflict` on 409 and stashes the merged
  // SongMap + conflicts list in `cloudConflict`. Surface the result so
  // the user knows something happened — no interactive merge UI in v1,
  // the field-level merge is write-through.
  const conflict = $derived($cloudConflict)
  let logOpen = $state(false)
  function dismissConflict() {
    cloudConflict.set(null)
    logOpen = false
  }
</script>

{#if proj && cloud}
  <section class="border-foreground/40 flex flex-wrap items-center gap-3 border-2 px-3 py-2 text-xs">
    <Cloud class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
    <span class="font-mono">
      Cloud · rev {cloud.lastSyncedRevision}
      {#if cloud.pendingChanges && cloud.pendingChanges > 0}
        · <span class="text-amber-600 dark:text-amber-400">{cloud.pendingChanges} pending</span>
      {/if}
    </span>
    {#if lastAutoPullAt}
      <span class="text-muted-foreground text-[10px]">synced {fmtTime(lastAutoPullAt)}</span>
    {/if}
    <Button
      variant="outline"
      size="sm"
      class="ml-auto h-7 gap-1"
      onclick={() => void onPull()}
      disabled={busy}
      title="Pull remote changes now (realtime auto-pull is on by default)"
    >
      <RefreshCw class="size-3 {busy ? 'animate-spin' : ''}" aria-hidden="true" />
      Pull
    </Button>
  </section>

  {#if errorMsg}
    <p class="text-destructive text-xs" role="status">{errorMsg}</p>
  {/if}

  {#if conflict}
    <div class="border-amber-500/60 bg-amber-500/10 space-y-2 border-2 px-3 py-2 text-xs">
      <div class="flex items-center gap-2">
        <Sparkles class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="font-semibold">
          Merged remote changes from collaborator
          {#if conflict.report.conflicts.length > 0}
            ({conflict.report.conflicts.length} field{conflict.report.conflicts.length === 1 ? '' : 's'} auto-resolved)
          {/if}
        </span>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground ml-auto text-[11px] underline-offset-2 hover:underline"
          onclick={() => (logOpen = !logOpen)}
        >
          {logOpen ? 'Hide log' : 'Open log'}
        </button>
        <button
          type="button"
          class="text-muted-foreground hover:text-destructive text-[11px]"
          onclick={dismissConflict}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {#if logOpen}
        <ul class="border-foreground/20 divide-foreground/10 max-h-40 divide-y overflow-auto border bg-background/50 text-[11px]">
          {#each conflict.report.conflicts as c (c.path)}
            <li class="px-2 py-1 font-mono">{c.path}</li>
          {:else}
            <li class="text-muted-foreground px-2 py-1 italic">No field-level conflicts.</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
{/if}
