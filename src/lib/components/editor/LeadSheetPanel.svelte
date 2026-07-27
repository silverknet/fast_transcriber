<script lang="ts">
  import LeadSheet from '$lib/components/LeadSheet.svelte'
  import EditSectionToolbar from '$lib/components/EditSectionToolbar.svelte'
  import { songMap } from '$lib/stores/songMap'
</script>

<section class="w-full" aria-label="Lead sheet">
  <EditSectionToolbar
    title="Lead sheet"
    helpText="The lead sheet is a read-only performance view of the current song map: sections, lyrics, chords, key, and timing all come from the saved editor data."
  />
  {#if $songMap}
    <LeadSheet songMap={$songMap} />
  {:else}
    <p class="text-muted-foreground p-4 text-sm">Open a song to view its lead sheet.</p>
  {/if}
</section>
