<script lang="ts">
  /**
   * Big warning shown when a non-owner (editor) tries to change a shared
   * project's audio. Audio is an owner-only capability: the grid, chords and
   * sections everyone shares are built from the OWNER's exact recording, so a
   * different upload would misalign or lose them. The correct way for a
   * collaborator to get playable audio is the owner's audio package.
   */
  import { Button } from '$lib/components/ui/button'
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
  import { AlertTriangle, Download } from '@lucide/svelte'

  let {
    open = $bindable(false),
    onImportPackage,
  }: { open?: boolean; onImportPackage?: () => void } = $props()
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader class="">
      <DialogTitle class="flex items-center gap-2">
        <AlertTriangle class="text-amber-600 dark:text-amber-400 size-5" aria-hidden="true" />
        Only the owner can change the audio
      </DialogTitle>
    </DialogHeader>
    <div class="border-amber-500/60 bg-amber-500/10 space-y-2 border-2 p-3 text-sm">
      <p class="font-semibold">Changing this song's audio here would break the shared grid and chords.</p>
      <p class="text-muted-foreground">
        The bars, beats, chords and sections everyone in this project shares are built from the
        <strong>owner's</strong> recording. Uploading different audio would misalign them — and can lose the chords.
      </p>
      <p class="text-muted-foreground">
        You can still edit chords and sections. To play this song on your machine, get the project's
        audio from the owner: <strong>Share → Import audio package</strong>.
      </p>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <Button class="" variant="outline" onclick={() => (open = false)}>Close</Button>
      {#if onImportPackage}
        <Button
          class="gap-1"
          onclick={() => {
            open = false
            onImportPackage?.()
          }}
        >
          <Download class="size-4" aria-hidden="true" />
          Import audio package…
        </Button>
      {/if}
    </div>
  </DialogContent>
</Dialog>
