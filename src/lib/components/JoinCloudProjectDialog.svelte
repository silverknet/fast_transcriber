<script lang="ts">
  /**
   * Join a cloud project on this machine. Opens with a preselected
   * cloud project meta (passed as `cloudProject`); the user picks a
   * parent folder on disk and clicks Join. The dialog handles the
   * download + materialize flow via `joinCloudProject`, then navigates
   * to `/project` — UNLESS one or more songs couldn't be materialized
   * (malformed cloud data), in which case it stops on a warning screen
   * with an explicit "Continue" instead of silently dropping them.
   *
   * Identical UX rhythm to `NewProjectDialog`: dialog opens first, native
   * picker is triggered from a button inside, errors land inline.
   */
  import { goto } from '$app/navigation'
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { pickFolderViaDesktop } from '$lib/client/desktopBridge'
  import { joinCloudProject, type CloudProjectMeta } from '$lib/client/cloudSync'

  let {
    open = $bindable(false),
    cloudProject,
    onJoined,
  } = $props<{
    open?: boolean
    /** The target. Required when open=true; ignored otherwise. */
    cloudProject: CloudProjectMeta | null
    onJoined?: () => void
  }>()

  let parentPath = $state<string | null>(null)
  let busy = $state(false)
  let error = $state('')
  /** Set once the project has materialized locally; > 0 means some
   * song(s) couldn't be added (malformed cloud data) — surfaced instead
   * of silently dropped, with a manual "Continue" instead of auto-nav so
   * the user actually sees it. */
  let joinedWithSkips = $state<number | null>(null)

  $effect(() => {
    if (open) {
      parentPath = null
      busy = false
      error = ''
      joinedWithSkips = null
    }
  })

  async function pickFolder() {
    error = ''
    const pick = await pickFolderViaDesktop({
      title: 'Pick the folder that will contain the joined project',
    })
    if (!pick.ok) {
      if ('cancelled' in pick) return
      error = pick.error ?? 'Could not open picker'
      return
    }
    parentPath = pick.path
  }

  async function join() {
    error = ''
    if (!cloudProject) {
      error = 'No project selected.'
      return
    }
    if (!parentPath) {
      error = 'Choose a folder first.'
      return
    }
    busy = true
    try {
      const r = await joinCloudProject(cloudProject.id, parentPath)
      if (!r.ok) {
        error = r.error
        return
      }
      if (r.skippedSongs) {
        // Non-fatal: everything else came through. Stop and show it
        // instead of auto-navigating past it — the user should know to
        // ask the project owner about the missing song(s).
        joinedWithSkips = r.skippedSongs
        onJoined?.()
        return
      }
      open = false
      onJoined?.()
      await goto('/project')
    } catch (e) {
      error = e instanceof Error ? e.message : 'Join failed'
    } finally {
      busy = false
    }
  }

  function cancel() {
    if (busy) return
    open = false
  }

  async function continueAfterSkips() {
    open = false
    await goto('/project')
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader class="">
      <DialogTitle>Join shared project</DialogTitle>
    </DialogHeader>

    <div class="space-y-4">
      {#if joinedWithSkips !== null}
        <p class="text-sm">
          Joined, but {joinedWithSkips} {joinedWithSkips === 1 ? 'song' : 'songs'} couldn't be added
          — the data for {joinedWithSkips === 1 ? "it" : "them"} looked corrupted. Ask the project
          owner to check {joinedWithSkips === 1 ? 'that song' : 'those songs'} and re-share.
        </p>
        <div class="flex justify-end gap-2">
          <Button class="" type="button" onclick={() => void continueAfterSkips()}>
            Continue to project
          </Button>
        </div>
      {:else}
      {#if cloudProject}
        <div class="border-foreground/20 border-2 px-3 py-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project</p>
          <p class="truncate font-mono text-sm">{cloudProject.name}</p>
          <p class="text-muted-foreground text-[11px]">Shared project</p>
        </div>
      {/if}

      <div class="flex flex-col gap-1.5 text-xs">
        <span class="text-muted-foreground uppercase tracking-wider">Folder</span>
        <div class="flex items-center gap-2">
          <Button
            type="button"
            class=""
            variant="outline"
            size="sm"
            onclick={() => void pickFolder()}
            disabled={busy}
          >
            {parentPath ? 'Change…' : 'Choose folder…'}
          </Button>
          {#if parentPath}
            <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]" title={parentPath}>
              {parentPath}
            </span>
          {/if}
        </div>
        {#if parentPath}
          <span class="text-muted-foreground text-[11px]">
            BarBro will create a project folder here. Audio files are not included;
            relink or import them after joining.
          </span>
        {/if}
      </div>

      {#if error}
        <p class="text-destructive text-xs" role="status">{error}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" class="" variant="outline" onclick={cancel} disabled={busy}>
          Cancel
        </Button>
        <Button class="" type="button" onclick={() => void join()} disabled={busy || !parentPath || !cloudProject}>
          {busy ? 'Joining…' : 'Join'}
        </Button>
      </div>
      {/if}
    </div>
  </DialogContent>
</Dialog>
