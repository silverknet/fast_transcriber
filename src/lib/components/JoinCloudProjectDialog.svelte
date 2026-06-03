<script lang="ts">
  /**
   * Join a cloud project on this machine. Opens with a preselected
   * cloud project meta (passed as `cloudProject`); the user picks a
   * parent folder on disk and clicks Join. The dialog handles the
   * download + materialize flow via `joinCloudProject`, then navigates
   * to `/project`.
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

  $effect(() => {
    if (open) {
      parentPath = null
      busy = false
      error = ''
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
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader class="">
      <DialogTitle>Join shared project</DialogTitle>
    </DialogHeader>

    <div class="space-y-4">
      {#if cloudProject}
        <div class="border-foreground/20 border-2 px-3 py-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project</p>
          <p class="truncate font-mono text-sm">{cloudProject.name}</p>
          <p class="text-muted-foreground font-mono text-[11px]">rev {cloudProject.revision}</p>
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
            A subfolder will be created here. Audio files don't sync — you'll see "missing audio"
            for each song until you relink or import an audio pack.
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
    </div>
  </DialogContent>
</Dialog>
