<script lang="ts">
  /**
   * "Add song" dialog — owns the title input + the two-way branch:
   *
   *   1. **Add empty** — commits a title-only stub `.smap` into the active
   *      project and stays here. Audio + analysis happen later when the
   *      user opens the song in the editor.
   *   2. **Open in editor** — primes the editor's SongMap with the title
   *      then navigates to `/?project=1`, which auto-restores the title
   *      from the store and runs the normal upload + analyze flow.
   *
   * Both paths use the same title field, so the user only types it once.
   */
  import { goto } from '$app/navigation'
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { createEmptySongInProject } from '$lib/project/commit'
  import { createEmptySongMap } from '$lib/songmap/factory'
  import { setSongMap } from '$lib/stores/songMap'

  let {
    open = $bindable(false),
    onCreated,
  } = $props<{
    open?: boolean
    /** Fires after a successful "Add empty" commit. */
    onCreated?: () => void
  }>()

  let title = $state('')
  let busy = $state(false)
  let error = $state('')
  let titleInput = $state<HTMLInputElement | undefined>()

  $effect(() => {
    if (open) {
      title = ''
      error = ''
      busy = false
      queueMicrotask(() => {
        titleInput?.focus()
      })
    }
  })

  function cancel() {
    if (busy) return
    open = false
  }

  async function addEmpty() {
    const t = title.trim()
    if (!t) {
      error = 'Give the song a title first.'
      return
    }
    busy = true
    error = ''
    try {
      await createEmptySongInProject(t)
      onCreated?.()
      open = false
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not add song.'
    } finally {
      busy = false
    }
  }

  async function openInEditor() {
    const t = title.trim()
    if (!t) {
      error = 'Give the song a title first.'
      return
    }
    // Prime the editor's SongMap store so `/?project=1` picks up the
    // title without us having to thread it through a URL param.
    const map = createEmptySongMap()
    map.metadata = { ...map.metadata, title: t }
    setSongMap(map)
    open = false
    await goto('/?project=1')
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader class="">
      <DialogTitle>Add song</DialogTitle>
    </DialogHeader>

    <form
      class="flex flex-col gap-4"
      onsubmit={(e) => {
        e.preventDefault()
        void openInEditor()
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

      <div class="space-y-2">
        <p class="text-muted-foreground text-[11px]">
          Open in editor to upload audio and analyze right away, or add an
          empty placeholder and fill it in later.
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button type="button" class="" variant="outline" onclick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            class=""
            variant="outline"
            onclick={() => void addEmpty()}
            disabled={busy || !title.trim()}
          >
            {busy ? 'Adding…' : 'Add empty'}
          </Button>
          <Button class="" type="submit" disabled={busy || !title.trim()}>
            Open in editor
          </Button>
        </div>
      </div>
    </form>
  </DialogContent>
</Dialog>
