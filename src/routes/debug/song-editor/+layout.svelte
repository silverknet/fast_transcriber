<script lang="ts">
  /**
   * Wraps the Song Edit design-exploration versions with the floating version
   * switcher, so you can flip between them under the real navbar. Debug only.
   */
  import DebugSongEditorNav from '$lib/components/DebugSongEditorNav.svelte'
  let { children } = $props()
</script>

{@render children()}
<DebugSongEditorNav />
