<script lang="ts">
  /**
   * Self-contained "New project" dialog used by the File menu and the
   * `/project` empty-state landing. Owns its own name/folder/error state
   * so callers only need a bindable `open` flag plus an optional
   * `onCreated` callback. The dialog handles navigating to `/project`
   * itself when the create succeeds.
   *
   * Native picker is triggered from a button INSIDE the dialog, never
   * from a dropdown's click — the latter chains a synchronous dropdown
   * close with an async picker call and gets suppressed in some browsers
   * (Safari especially). Open dialog first, then picker.
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
  import { createProjectOnDisk } from '$lib/project/commit'

  let {
    open = $bindable(false),
    onCreated,
  } = $props<{
    open?: boolean
    /** Fires after a successful create, before the navigation to /project. */
    onCreated?: () => void
  }>()

  let name = $state('Untitled Project')
  let parentPath = $state<string | null>(null)
  let busy = $state(false)
  let error = $state('')
  let nameInput = $state<HTMLInputElement | undefined>()

  // Reset state every time the dialog opens; focus + select the name
  // field so the user can type immediately.
  $effect(() => {
    if (open) {
      name = 'Untitled Project'
      parentPath = null
      error = ''
      busy = false
      // Defer one tick so the input is mounted before we focus.
      queueMicrotask(() => {
        nameInput?.focus()
        nameInput?.select()
      })
    }
  })

  async function pickFolder() {
    error = ''
    const pick = await pickFolderViaDesktop({
      title: 'Pick the folder that will contain the new project',
    })
    if (!pick.ok) {
      if ('cancelled' in pick) return
      error = pick.error ?? 'Could not open picker'
      return
    }
    parentPath = pick.path
  }

  async function create() {
    error = ''
    if (!parentPath) {
      error = 'Choose a folder first.'
      return
    }
    busy = true
    try {
      await createProjectOnDisk(parentPath, name.trim() || 'Untitled Project')
      open = false
      onCreated?.()
      await goto('/project')
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create project'
    } finally {
      busy = false
    }
  }

  function cancel() {
    if (busy) return
    open = false
    parentPath = null
    error = ''
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader class="">
      <DialogTitle>New project</DialogTitle>
    </DialogHeader>
    <form
      class="flex flex-col gap-4"
      onsubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <label class="flex flex-col gap-1.5 text-xs">
        <span class="text-muted-foreground uppercase tracking-wider">Name</span>
        <input
          type="text"
          bind:value={name}
          bind:this={nameInput}
          placeholder="Untitled Project"
          class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"
        />
      </label>

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
            A subfolder for the project will be created here.
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
        <Button class="" type="submit" disabled={busy || !name.trim() || !parentPath}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  </DialogContent>
</Dialog>
