<script lang="ts">
  /**
   * Rename a song in the active project. Edits `metadata.title` inside the
   * song's `.smap` via `renameSongInProject`. The folder slug stays as-is
   * so stem refs / cloud links / audio paths don't break.
   */
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { renameSongInProject } from '$lib/project/commit'

  let {
    open = $bindable(false),
    songId,
    currentTitle,
  } = $props<{
    open?: boolean
    songId: string | null
    currentTitle: string
  }>()

  let title = $state('')
  let busy = $state(false)
  let error = $state('')
  let titleInput = $state<HTMLInputElement | undefined>()

  $effect(() => {
    if (open) {
      title = currentTitle
      error = ''
      busy = false
      queueMicrotask(() => {
        titleInput?.focus()
        titleInput?.select()
      })
    }
  })

  function cancel() {
    if (busy) return
    open = false
  }

  async function save() {
    if (!songId) {
      open = false
      return
    }
    const t = title.trim()
    if (!t) {
      error = 'Title can’t be empty.'
      return
    }
    if (t === currentTitle.trim()) {
      open = false
      return
    }
    busy = true
    error = ''
    try {
      await renameSongInProject(songId, t)
      open = false
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not rename song.'
    } finally {
      busy = false
    }
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader class="">
      <DialogTitle>Rename song</DialogTitle>
    </DialogHeader>
    <form
      class="flex flex-col gap-4"
      onsubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label class="flex flex-col gap-1.5 text-xs">
        <span class="text-muted-foreground uppercase tracking-wider">Title</span>
        <input
          type="text"
          bind:value={title}
          bind:this={titleInput}
          placeholder="Untitled"
          class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"
        />
      </label>

      {#if error}
        <p class="text-destructive text-xs" role="status">{error}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" class="" variant="outline" onclick={cancel} disabled={busy}>
          Cancel
        </Button>
        <Button class="" type="submit" disabled={busy || !title.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  </DialogContent>
</Dialog>
