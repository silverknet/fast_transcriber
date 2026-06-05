<script lang="ts">
  /**
   * Phase 8 — cloud sync conflict resolver.
   *
   * Listens to `cloudConflict`. When it's non-null, renders a modal
   * listing every disputed field from `mergeForConflict`. The user
   * picks per row (default: theirs / cloud), then clicks Apply.
   *
   * Apply pushes the resolved SongMap back with the cloud's revision
   * as the new clientBaseRevision and writes the result to the local
   * songMap store + project autosave so the disk copy converges too.
   */
  import { get } from 'svelte/store'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { AlertTriangle, Check } from '@lucide/svelte'
  import { cloudConflict } from '$lib/stores/cloudConflict'
  import { project as projectStore } from '$lib/stores/project'
  import { songMap as songMapStore } from '$lib/stores/songMap'
  import {
    applyConflictDecisions,
    type ConflictDecisions,
  } from '$lib/songmap/collabMerge'
  import { pushCloudSong } from '$lib/client/cloudSync'
  import type { ProjectFile } from '$lib/project/types'

  let decisions = $state<ConflictDecisions>(new Map())
  let pushing = $state(false)
  let pushError = $state('')

  // Reset choices whenever a fresh conflict arrives.
  $effect(() => {
    if ($cloudConflict) {
      decisions = new Map()
      pushError = ''
    }
  })

  const open = $derived($cloudConflict !== null)

  function setChoice(path: string, choice: 'mine' | 'theirs') {
    const next = new Map(decisions)
    next.set(path, choice)
    decisions = next
  }

  function describe(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'string') return v.length > 40 ? v.slice(0, 37) + '…' : v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    try {
      const j = JSON.stringify(v)
      return j.length > 60 ? j.slice(0, 57) + '…' : j
    } catch {
      return '[object]'
    }
  }

  function dismiss() {
    cloudConflict.set(null)
    decisions = new Map()
    pushError = ''
  }

  /**
   * "Take theirs" shortcut — apply the cloud state wholesale to local
   * without per-row picking. Updates the in-memory songMap; the
   * autosave will write it to disk and stop the 409 loop.
   */
  function takeTheirs() {
    const c = $cloudConflict
    if (!c) return
    songMapStore.set(c.report.merged)
    // Mark the project as synced at the cloud's revision so the next
    // push uses the right clientBaseRevision.
    const proj = get(projectStore)
    if (proj.data?.cloud && proj.osPath) {
      const next: ProjectFile = {
        ...proj.data,
        cloud: {
          ...proj.data.cloud,
          lastSyncedRevision: c.remoteRevision,
          pendingChanges: 0,
        },
        songs: proj.data.songs.map((s) =>
          s.id === c.localSongId ? { ...s, lastSyncedRevision: c.remoteRevision } : s,
        ),
      }
      projectStore.set({ ...proj, data: next })
    }
    dismiss()
  }

  /**
   * Apply per-row decisions + push. Defaults still "cloud wins" for
   * rows the user didn't touch.
   */
  async function applyAndPush() {
    const c = $cloudConflict
    if (!c) return
    pushing = true
    pushError = ''
    try {
      const resolved = applyConflictDecisions(c.report, decisions)
      const proj = get(projectStore)
      const entry = proj.data?.songs.find((s) => s.id === c.localSongId)
      const sortOrder = proj.data?.songs.findIndex((s) => s.id === c.localSongId) ?? -1
      const r = await pushCloudSong(
        c.cloudProjectId,
        c.cloudSongId,
        resolved,
        sortOrder >= 0 ? sortOrder : 0,
        !!entry?.hidden,
        c.remoteRevision,
      )
      if (!r.ok) {
        if ('conflict' in r && r.conflict) {
          pushError = 'Server moved again. Closing this dialog will re-fire with the new state.'
        } else {
          pushError = ('error' in r ? r.error : 'Push failed') || 'Push failed'
        }
        return
      }
      // Push succeeded — sync local stores at the new revision.
      songMapStore.set(resolved)
      if (proj.data?.cloud && proj.osPath) {
        const next: ProjectFile = {
          ...proj.data,
          cloud: {
            ...proj.data.cloud,
            lastSyncedRevision: r.revision,
            lastPushedAt: new Date().toISOString(),
            pendingChanges: 0,
          },
          songs: proj.data.songs.map((s) =>
            s.id === c.localSongId ? { ...s, lastSyncedRevision: r.revision } : s,
          ),
        }
        projectStore.set({ ...proj, data: next })
      }
      dismiss()
    } finally {
      pushing = false
    }
  }
</script>

<Dialog
  {open}
  onOpenChange={(v: boolean) => { if (!v) dismiss() }}
>
  <DialogContent class="max-w-2xl max-h-[85vh] flex flex-col gap-3 p-4">
    <DialogHeader>
      <DialogTitle class="flex items-center gap-2">
        <AlertTriangle class="text-amber-600 dark:text-amber-400 size-5" aria-hidden="true" />
        Remote changes since your last sync
      </DialogTitle>
      <DialogDescription>
        Someone else updated this song while you were editing. Pick
        which version to keep for each row — the cloud version is
        selected by default.
      </DialogDescription>
    </DialogHeader>

    {#if $cloudConflict}
      {@const c = $cloudConflict}
      {#if c.report.conflicts.length === 0}
        <p class="text-muted-foreground text-sm">
          No field-level conflicts — your edits don't overlap with the
          remote ones. Click <span class="font-semibold">Apply</span>
          to push the merged result.
        </p>
      {:else}
        <ul class="border-foreground/20 divide-foreground/10 max-h-[55vh] overflow-auto divide-y border-2 text-sm">
          {#each c.report.conflicts as conflict (conflict.path)}
            {@const choice = decisions.get(conflict.path) ?? 'theirs'}
            <li class="px-3 py-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 text-xs">
                    <span class="font-semibold uppercase tracking-wider">{conflict.label}</span>
                    {#if conflict.severity === 'dangerous'}
                      <span class="text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                        dangerous
                      </span>
                    {/if}
                  </div>
                  <dl class="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px] font-mono">
                    <dt class="text-muted-foreground">Yours</dt>
                    <dd class="break-all">{describe(conflict.mine)}</dd>
                    <dt class="text-muted-foreground">Theirs</dt>
                    <dd class="break-all">{describe(conflict.theirs)}</dd>
                  </dl>
                </div>
                <div class="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onclick={() => setChoice(conflict.path, 'mine')}
                    class="border-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider {choice === 'mine'
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/30 hover:border-foreground'}"
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    onclick={() => setChoice(conflict.path, 'theirs')}
                    class="border-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider {choice === 'theirs'
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/30 hover:border-foreground'}"
                  >
                    Take theirs
                  </button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      {#if pushError}
        <p class="text-destructive text-xs">{pushError}</p>
      {/if}

      <DialogFooter class="gap-2">
        <Button class="" variant="outline" disabled={pushing} onclick={takeTheirs}>
          Take theirs (all)
        </Button>
        <Button class="gap-2" disabled={pushing} onclick={() => void applyAndPush()}>
          <Check class="size-4" aria-hidden="true" />
          {pushing ? 'Pushing…' : 'Apply'}
        </Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
