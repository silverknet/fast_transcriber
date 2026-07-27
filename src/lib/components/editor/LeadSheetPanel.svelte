<script lang="ts">
  import LeadSheet from '$lib/components/LeadSheet.svelte'
  import EditSectionToolbar from '$lib/components/EditSectionToolbar.svelte'
  import { songMap } from '$lib/stores/songMap'
</script>

<section class="flex min-h-0 w-full flex-1 flex-col" aria-label="Lead sheet">
  <EditSectionToolbar
    title="Lead sheet"
    helpText="The lead sheet is a read-only performance view of the current song map: sections, lyrics, chords, key, and timing all come from the saved editor data."
  />
  <!-- The sheet fills the remaining height and scrolls within itself if long. -->
  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if $songMap}
      <LeadSheet songMap={$songMap} />
    {:else}
      <p class="text-muted-foreground p-4 text-sm">Open a song to view its lead sheet.</p>
    {/if}
  </div>
</section>
