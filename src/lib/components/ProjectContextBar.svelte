<script lang="ts">
  /**
   * Persistent context bar under the AppMenuBar showing which project is
   * currently loaded + a one-click way back to the project view. Visible
   * only when a project is open and we aren't already on `/project`.
   *
   * Replaces the smaller chip that used to live inside the menubar — the
   * full bar is impossible to miss and gives the back action top-level
   * priority instead of burying it in a dropdown.
   */
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { Button } from '$lib/components/ui/button'
  import { project as projectStore } from '$lib/stores/project'
  import { songMap } from '$lib/stores/songMap'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import FolderOpen from '@lucide/svelte/icons/folder-open'

  let isInProjectMode = $derived($projectStore.data !== null)
  let onProjectRoute = $derived($page.route?.id === '/project')
  let visible = $derived(isInProjectMode && !onProjectRoute)

  let projectName = $derived($projectStore.data?.name?.trim() || 'project')
  /** When on /edit, show the song title for extra context. */
  let songTitle = $derived.by(() => {
    const id = $page.route?.id
    if (id !== '/edit' && id !== '/set') return null
    return $songMap?.metadata.title?.trim() || null
  })

  async function backToProject() {
    await goto('/project')
  }
</script>

{#if visible}
  <div
    class="border-foreground bg-foreground text-background fixed top-12 right-0 left-0 z-40 flex flex-wrap items-center gap-3 border-b-2 px-3 py-1.5 text-sm"
    role="navigation"
    aria-label="Project context"
  >
    <Button
      variant="secondary"
      size="sm"
      class="h-8 shrink-0 gap-1.5 px-2.5"
      onclick={() => void backToProject()}
      aria-label="Back to project {projectName}"
    >
      <ArrowLeft class="size-4" aria-hidden="true" />
      Back to project
    </Button>

    <div class="flex min-w-0 flex-1 items-center gap-2">
      <FolderOpen class="size-4 shrink-0 opacity-70" aria-hidden="true" />
      <span class="truncate font-semibold tracking-tight">{projectName}</span>
      {#if songTitle}
        <span class="opacity-50" aria-hidden="true">/</span>
        <span class="text-background/80 truncate font-mono text-xs">{songTitle}</span>
      {/if}
    </div>
  </div>
{/if}
