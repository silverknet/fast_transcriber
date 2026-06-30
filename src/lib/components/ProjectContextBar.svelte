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
    class="bg-foreground text-background flex h-11 items-center gap-3 px-3 text-sm"
    role="navigation"
    aria-label="Project context"
  >
    <!--
      Plain anchor-style button: no border, no shadow, no shape baggage from
      the brutalist `<Button>` component. Every child is centered by the bar's
      `items-center`, so the icon + label sit on the bar's optical midline by
      default — no per-element translate tweaks.
    -->
    <button
      type="button"
      class="text-background hover:bg-background/10 -my-1 inline-flex shrink-0 items-center gap-1.5 px-2 py-1 text-sm font-semibold transition-colors"
      onclick={() => void backToProject()}
      aria-label="Back to project {projectName}"
    >
      <ArrowLeft class="size-4 shrink-0" aria-hidden="true" />
      <span>Back to project</span>
    </button>

    <!-- Vertical divider — inset top/bottom so it doesn't touch the bar edges. -->
    <span
      class="bg-background/30 h-5 w-px shrink-0"
      aria-hidden="true"
    ></span>

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
