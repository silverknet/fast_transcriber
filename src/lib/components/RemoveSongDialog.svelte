<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'

  let {
    open = $bindable(false),
    songTitle,
    onConfirm,
  } = $props<{
    open: boolean
    songTitle: string
    onConfirm: (deleteFiles: boolean) => void
  }>()

  let deleteFiles = $state(false)

  $effect(() => {
    if (open) deleteFiles = false
  })

  function cancel() {
    open = false
  }

  function confirm() {
    const flag = deleteFiles
    open = false
    onConfirm(flag)
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader>
      <DialogTitle>Remove from project</DialogTitle>
      <DialogDescription>
        This removes <span class="font-medium">{songTitle}</span> from the setlist. The song files
        will stay on disk unless you choose to delete them.
      </DialogDescription>
    </DialogHeader>

    <label class="border-foreground/30 mt-2 flex cursor-pointer items-center gap-2 border-2 p-3 text-sm">
      <input type="checkbox" class="size-4" bind:checked={deleteFiles} />
      <span>Also delete this song's files from disk</span>
    </label>

    <DialogFooter class="">
      <Button class="" variant="outline" onclick={cancel}>Cancel</Button>
      <Button class="" onclick={confirm}>{deleteFiles ? 'Remove and delete files' : 'Remove'}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
