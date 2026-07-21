<script lang="ts">
  /**
   * Dialog shell around `SongDraftsList`. Kept separate so the interactive part
   * stays testable in a real browser (see that file's header).
   */
  import { Layers } from '@lucide/svelte'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import SongDraftsList, { type DraftRow } from './SongDraftsList.svelte'

  let {
    open = $bindable(false),
    songTitle = 'Untitled song',
    rows = [] as DraftRow[],
    message = '',
    onUse,
    onRename,
    onDelete,
    onDuplicate,
    onNewEmpty,
  }: {
    open?: boolean
    songTitle?: string
    rows?: DraftRow[]
    message?: string
    onUse?: (id: string) => void
    onRename?: (id: string, currentName: string) => void
    onDelete?: (id: string, name: string) => void
    onDuplicate?: () => void
    onNewEmpty?: () => void
  } = $props()
</script>

<Dialog {open} onOpenChange={(v: boolean) => (open = v)}>
  <DialogContent class="flex max-w-2xl flex-col gap-3 p-4">
    <DialogHeader>
      <DialogTitle class="flex items-center gap-2">
        <Layers class="size-4" aria-hidden="true" />
        Drafts of “{songTitle}”
      </DialogTitle>
      <DialogDescription>Pick which version of this song you're working on.</DialogDescription>
    </DialogHeader>

    <SongDraftsList
      {rows}
      {message}
      {onUse}
      {onRename}
      {onDelete}
      {onDuplicate}
      {onNewEmpty}
      onDone={() => (open = false)}
    />
  </DialogContent>
</Dialog>
