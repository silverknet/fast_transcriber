<script lang="ts">
  import { goto } from '$app/navigation'
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import {
    listCloudProjects,
    loadCloudProject,
    deleteCloudProject,
    type CloudProjectListItem,
  } from '$lib/client/projectsCloud'
  import { fetchAutosaveInfo, loadServerAutosave } from '$lib/client/serverAutosave'

  let { open = $bindable(false) }: { open: boolean } = $props()

  let projects = $state<CloudProjectListItem[]>([])
  let autosave = $state<{ updatedAt: string } | null>(null)
  let fetching = $state(false)
  let error = $state('')
  let loadingId = $state<string | null>(null)
  let deletingId = $state<string | null>(null)
  let loadingAutosave = $state(false)

  $effect(() => {
    if (open) void fetchAll()
  })

  async function fetchAll() {
    fetching = true
    error = ''
    autosave = null

    const [projectsResult, autosaveInfo] = await Promise.all([
      listCloudProjects(),
      fetchAutosaveInfo(),
    ])

    fetching = false

    if (!projectsResult.ok) {
      error = projectsResult.error ?? 'Failed to load projects'
    } else {
      projects = projectsResult.projects ?? []
    }

    if (autosaveInfo.hasSongMap && autosaveInfo.updatedAt) {
      autosave = { updatedAt: autosaveInfo.updatedAt }
    }
  }

  async function onLoad(id: string) {
    loadingId = id
    error = ''
    const r = await loadCloudProject(id)
    loadingId = null
    if (!r.ok) {
      error = r.error ?? 'Failed to load project'
      return
    }
    open = false
    await goto('/edit')
  }

  async function onLoadAutosave() {
    loadingAutosave = true
    error = ''
    const r = await loadServerAutosave()
    loadingAutosave = false
    if (!r.ok) {
      error = r.error ?? 'Failed to load autosave'
      return
    }
    open = false
    await goto('/edit')
  }

  async function onDelete(id: string) {
    deletingId = id
    error = ''
    const r = await deleteCloudProject(id)
    deletingId = null
    if (!r.ok) {
      error = r.error ?? 'Failed to delete project'
      return
    }
    projects = projects.filter((p) => p.id !== id)
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86_400_000)
    if (diffDays === 0) {
      return 'Today · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }

  let hasAnything = $derived(autosave !== null || projects.length > 0)
</script>

<Dialog bind:open>
  <DialogContent
    class="flex max-h-[80vh] w-full max-w-lg flex-col gap-4 p-5"
    showCloseButton={true}
  >
    <DialogHeader>
      <DialogTitle>Load from Cloud</DialogTitle>
      <DialogDescription>Choose a saved project to open.</DialogDescription>
    </DialogHeader>

    {#if fetching}
      <p class="text-muted-foreground py-6 text-center text-sm">Loading…</p>
    {:else if error}
      <p class="text-destructive text-sm">{error}</p>
    {:else if !hasAnything}
      <p class="text-muted-foreground py-6 text-center text-sm">
        No cloud projects yet. Use <strong>File → Save to cloud</strong> to save your first project.
      </p>
    {:else}
      <ul class="flex flex-col gap-2 overflow-y-auto">
        {#if autosave}
          <li
            class="border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30 flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate font-medium">Autosave</p>
                <span
                  class="bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                >
                  auto
                </span>
              </div>
              <p class="text-muted-foreground mt-0.5 text-xs">{formatDate(autosave.updatedAt)}</p>
            </div>
            <div class="flex shrink-0 gap-2">
              <Button
                class=""
                variant="default"
                size="sm"
                disabled={loadingAutosave}
                onclick={() => void onLoadAutosave()}
              >
                {loadingAutosave ? 'Loading…' : 'Load'}
              </Button>
            </div>
          </li>
        {/if}

        {#each projects as project (project.id)}
          <li
            class="border-foreground/15 bg-muted/30 flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{project.name}</p>
              <p class="text-muted-foreground mt-0.5 text-xs">{formatDate(project.updatedAt)}</p>
            </div>
            <div class="flex shrink-0 gap-2">
              <Button
                class=""
                variant="default"
                size="sm"
                disabled={loadingId === project.id || deletingId === project.id}
                onclick={() => void onLoad(project.id)}
              >
                {loadingId === project.id ? 'Loading…' : 'Load'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="text-destructive hover:text-destructive"
                disabled={deletingId === project.id || loadingId === project.id}
                onclick={() => void onDelete(project.id)}
              >
                {deletingId === project.id ? '…' : 'Delete'}
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </DialogContent>
</Dialog>
