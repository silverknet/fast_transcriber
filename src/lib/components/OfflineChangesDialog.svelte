<script lang="ts">
  /**
   * "You edited these offline" — the review that closes the offline loop.
   *
   * Shown when a project opens online and songs edited on the offline desktop
   * build have not reached the cloud. Nothing is sent until you say so: the
   * user asked to be shown first, and a silent background push of a gig's worth
   * of edits is exactly the thing that would need undoing at the worst moment.
   *
   * Each song is Send or Keep on this machine. Keeping is not discarding the
   * edit — the `.smap` on disk is untouched — it means "do not push this one
   * now", and the marker only clears once every song has been decided AND every
   * send succeeded.
   */
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { CircleAlert, CircleCheck, CloudUpload, Loader, WifiOff } from '@lucide/svelte'
  import { offlineChanges } from '$lib/stores/offlineChanges'
  import { reconcileOfflineChanges, type PushOutcome } from '$lib/client/offlineReconcile'
  import { cloudConflict } from '$lib/stores/cloudConflict'
  import { mergeForConflict } from '$lib/songmap/collabMerge'

  /** songId → send. Everything defaults to send; the list is the review. */
  let send = $state<Record<string, boolean>>({})
  let pushing = $state(false)
  let outcomes = $state<PushOutcome[]>([])
  let done = $state(false)

  const prompt = $derived($offlineChanges)
  const open = $derived(prompt !== null)

  // Fresh prompt → fresh choices. This is state syncing into state, which the
  // house rules push back on, but the trigger is genuinely "a new prompt
  // arrived" rather than a value derivable from one.
  $effect(() => {
    const p = $offlineChanges
    if (!p) return
    const next: Record<string, boolean> = {}
    for (const c of p.changes) next[c.songId] = true
    send = next
    outcomes = []
    done = false
    pushing = false
  })

  const sendCount = $derived(Object.values(send).filter(Boolean).length)

  function outcomeFor(songId: string): PushOutcome | undefined {
    return outcomes.find((o) => o.songId === songId)
  }

  async function apply() {
    const p = prompt
    if (!p || pushing) return
    pushing = true
    try {
      const discarded = p.changes.filter((c) => !send[c.songId]).map((c) => c.songId)
      const r = await reconcileOfflineChanges(p.osPath, p.data, p.changes, discarded)
      outcomes = r.outcomes
      done = true

      // A dangerous conflict is not something to settle in a list of songs —
      // hand it to the resolver that exists for it. Only the first: they are
      // resolved one at a time, and re-opening the project surfaces the next.
      const conflict = r.outcomes.find((o) => o.status === 'conflict')
      if (conflict && conflict.status === 'conflict' && p.data.cloud) {
        const change = p.changes.find((c) => c.songId === conflict.songId)
        const entry = p.data.songs.find((s) => s.id === conflict.songId)
        if (change && entry) {
          cloudConflict.set({
            cloudProjectId: p.data.cloud.projectId,
            cloudSongId: entry.cloudSongId ?? entry.id,
            localSongId: entry.id,
            local: change.songMap,
            remote: conflict.remote,
            remoteRevision: conflict.remoteRevision,
            report: mergeForConflict(change.songMap, conflict.remote),
          })
          offlineChanges.set(null)
          return
        }
      }

      if (r.complete) offlineChanges.set(null)
    } finally {
      pushing = false
    }
  }

  function later() {
    // The marker stays on disk, so this comes back next time the project opens.
    offlineChanges.set(null)
  }
</script>

<Dialog {open} onOpenChange={(v) => { if (!v) later() }}>
  <DialogContent class="max-w-lg flex flex-col gap-3 p-4">
    <DialogHeader>
      <DialogTitle class="flex items-center gap-2">
        <WifiOff class="size-4 shrink-0" />
        {prompt?.changes.length ?? 0}
        {(prompt?.changes.length ?? 0) === 1 ? 'song' : 'songs'} changed offline
      </DialogTitle>
      <DialogDescription>
        These were edited on this machine with no internet, so the cloud hasn't seen them yet.
        Nothing is sent until you choose.
      </DialogDescription>
    </DialogHeader>

    {#if prompt}
      <ul class="max-h-[50vh] space-y-1.5 overflow-y-auto">
        {#each prompt.changes as change (change.songId)}
          {@const outcome = outcomeFor(change.songId)}
          <li class="border-foreground/15 flex items-center gap-2 rounded-[var(--radius)] border p-2">
            <div class="grow">
              <p class="text-sm font-bold">{change.title}</p>
              <p class="text-muted-foreground text-[11px]">
                {#if outcome?.status === 'pushed'}
                  Sent to the cloud.
                {:else if outcome?.status === 'conflict'}
                  Someone else changed this song too — needs a closer look.
                {:else if outcome?.status === 'failed'}
                  {outcome.error}
                {:else if change.neverSynced}
                  Never synced — the cloud has no copy of this song yet.
                {:else}
                  Your offline edits are newer than the cloud's copy.
                {/if}
              </p>
            </div>
            {#if outcome?.status === 'pushed'}
              <CircleCheck class="size-4 shrink-0" />
            {:else if outcome}
              <CircleAlert class="size-4 shrink-0" />
            {:else}
              <label class="flex shrink-0 items-center gap-1.5 text-xs font-bold">
                <input type="checkbox" bind:checked={send[change.songId]} />
                Send
              </label>
            {/if}
          </li>
        {/each}
      </ul>

      {#if prompt.unchangedCount > 0}
        <p class="text-muted-foreground text-[11px]">
          {prompt.unchangedCount} other
          {prompt.unchangedCount === 1 ? 'song was' : 'songs were'} opened offline but not changed.
        </p>
      {/if}

      {#if done && outcomes.some((o) => o.status !== 'pushed')}
        <p class="text-[11px] font-bold">
          Some songs didn't go through. They're still safe on this machine — this list comes back
          next time you open the project.
        </p>
      {/if}
    {/if}

    <DialogFooter class="gap-2">
      <Button class="" variant="outline" onclick={later} disabled={pushing}>
        {done ? 'Close' : 'Not now'}
      </Button>
      <Button class="gap-1.5" onclick={() => void apply()} disabled={pushing || sendCount === 0 || done}>
        {#if pushing}
          <Loader class="size-3.5 animate-spin" /> Sending…
        {:else}
          <CloudUpload class="size-3.5" />
          Send {sendCount}
          {sendCount === 1 ? 'song' : 'songs'}
        {/if}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
