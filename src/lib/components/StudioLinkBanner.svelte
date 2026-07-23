<script lang="ts">
  /**
   * The ONE degraded state that can arise between the two modes: a local-folder
   * (Studio) project is open, but the sidecar has dropped — so the app is now in
   * Collab mode with local files it can't reach. Rather than a silent break, this
   * banner names the state and offers the exits: start Studio again, or (if the
   * project is cloud-linked) open the cloud copy = true Collab.
   *
   * See docs/domains/desktop-vs-browser.md — "Exactly two modes".
   */
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project } from '$lib/stores/project'
  import { openCloudProjectInBrowser } from '$lib/client/browserCloudProject'
  import { goto } from '$app/navigation'

  // Only after a real probe (avoid a first-frame / poll-gap flash), and only when
  // a LOCAL project is open while the sidecar is unreachable.
  let show = $derived(
    $desktopCompanionStatus.lastCheckedAt !== null &&
      !$desktopCompanionStatus.reachable &&
      $project.osPath !== null,
  )
  let cloudProjectId = $derived($project.data?.cloud?.projectId ?? null)
  let switching = $state(false)
  let err = $state('')

  async function openCloudCopy() {
    if (!cloudProjectId) return
    switching = true
    err = ''
    try {
      const r = await openCloudProjectInBrowser(cloudProjectId)
      if (!r.ok) {
        err = r.error
        return
      }
      await goto('/project')
    } finally {
      switching = false
    }
  }
</script>

{#if show}
  <div
    class="border-amber-500/60 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 px-4 py-2 text-sm"
    role="status"
  >
    <span>
      <strong>Studio disconnected.</strong> Local files — analysis, stems, HD audio — aren't
      available while the desktop app is off. Start <strong>BarBro Studio</strong> and it
      reconnects automatically.
    </span>
    {#if cloudProjectId}
      <button
        type="button"
        class="border-foreground bg-background hover:bg-foreground hover:text-background rounded-[var(--radius)] border-2 px-2 py-0.5 text-xs font-bold transition-colors disabled:opacity-50"
        onclick={() => void openCloudCopy()}
        disabled={switching}
      >
        {switching ? 'Opening…' : 'Open the cloud copy (Collab)'}
      </button>
    {/if}
    {#if err}
      <span class="text-destructive text-xs">{err}</span>
    {/if}
  </div>
{/if}
