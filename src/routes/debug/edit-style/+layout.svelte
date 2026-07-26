<script lang="ts">
  /**
   * Wraps every edit-style exploration with the floating variant switcher, so
   * you can flip between them while the real AppMenuBar shows above. Debug only.
   */
  import DebugEditStyleNav from '$lib/components/DebugEditStyleNav.svelte'
  let { children } = $props()
</script>

{@render children()}
<DebugEditStyleNav />
