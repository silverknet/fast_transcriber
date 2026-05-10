<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import {
    fetchCloudSongAsSmap,
    listCloudProjects,
    type CloudProjectListItem,
  } from '$lib/client/projectsCloud'
  import { importSmapToProject, metadataLiteFromSongMap } from '$lib/project/commit'
  import { readSmapJsonOnly } from '$lib/songmap/persist'

  let { open = $bindable(false) }: { open: boolean } = $props()

  let cloudSongs = $state<CloudProjectListItem[]>([])
  let fetching = $state(false)
  let listError = $state('')
  let copyingId = $state<string | null>(null)
  let copyError = $state('')
  let copiedIds = $state<Set<string>>(new Set())

  $effect(() => {
    if (open) {
      copyError = ''
      copiedIds = new Set()
      void fetchAll()
    }
  })

  async function fetchAll() {
    fetching = true
    listError = ''
    const r = await listCloudProjects()
    fetching = false
    if (!r.ok) {
      listError = r.error ?? 'Failed to list cloud songs'
      cloudSongs = []
      return
    }
    cloudSongs = r.projects ?? []
  }

  async function onCopy(item: CloudProjectListItem) {
    if (copyingId) return
    copyingId = item.id
    copyError = ''
    try {
      const dl = await fetchCloudSongAsSmap(item.id)
      if (!dl.ok) {
        copyError = dl.error
        return
      }
      // Re-derive metadata from the downloaded .smap rather than the cloud
      // list label so the project entry reflects what's actually inside the
      // file. The two should agree, but the .smap is canonical.
      const sp = await readSmapJsonOnly(dl.blob)
      const meta = metadataLiteFromSongMap(sp.songMap)
      await importSmapToProject(dl.blob, meta)
      copiedIds = new Set(copiedIds).add(item.id)
    } catch (e) {
      copyError = e instanceof Error ? e.message : 'Copy failed'
    } finally {
      copyingId = null
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
    if (diffDays === 0) {
      return 'Today · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }
</script>

<Dialog bind:open>
  <DialogContent
    class="flex max-h-[80vh] w-full max-w-lg flex-col gap-4 p-5"
    showCloseButton={true}
  >
    <DialogHeader>
      <DialogTitle>Copy song from cloud</DialogTitle>
      <DialogDescription>
        Each copy becomes a new file inside this project. Edits to the copy do not affect the cloud
        original.
      </DialogDescription>
    </DialogHeader>

    {#if fetching}
      <p class="text-muted-foreground py-6 text-center text-sm">Loading…</p>
    {:else if listError}
      <p class="text-destructive text-sm">{listError}</p>
    {:else if cloudSongs.length === 0}
      <p class="text-muted-foreground py-6 text-center text-sm">No cloud songs found.</p>
    {:else}
      {#if copyError}
        <p class="text-destructive text-sm" role="status">{copyError}</p>
      {/if}
      <ul class="flex flex-col gap-2 overflow-y-auto">
        {#each cloudSongs as item (item.id)}
          {@const busy = copyingId === item.id}
          {@const done = copiedIds.has(item.id)}
          {@const disabled = !item.hasSongMap || busy || (copyingId !== null && copyingId !== item.id)}
          <li
            class="border-foreground/15 bg-muted/30 flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{item.name}</p>
              <p class="text-muted-foreground mt-0.5 text-xs">
                {item.hasSongMap ? formatDate(item.updatedAt) : 'No saved content yet'}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <Button
                class=""
                variant={done ? 'outline' : 'default'}
                size="sm"
                {disabled}
                onclick={() => void onCopy(item)}
              >
                {busy ? 'Copying…' : done ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </DialogContent>
</Dialog>
