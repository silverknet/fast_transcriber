<script lang="ts">
  /**
   * The rig indicator — one small icon in the navbar.
   *
   * Green ONLY when the desk itself has confirmed all four things: it is there,
   * it is hearing this computer, the click and cues are proven off the house,
   * and somebody's in-ears are actually set up.
   *
   * The whole value of this is that it never guesses. "Not checked yet" is amber
   * and says so; only something actively wrong is red. If unknown were allowed
   * to look like ready, the light would get trusted at load-in and the first
   * proof it was wrong would be a click track in the PA.
   *
   * Hidden entirely until a desk is in the picture — a permanent grey icon on
   * every screen for people who own no mixer is noise.
   */
  import { Radio } from '@lucide/svelte'
  import { goto } from '$app/navigation'
  import { rigStatus } from '$lib/stores/rigStatus'
  import { rigHealth } from '$lib/hardware/rigHealth'

  const health = $derived(rigHealth($rigStatus))
  /** Nothing to say until a desk has answered at least once. */
  const show = $derived($rigStatus.deskIdentified)

  const tone = $derived(
    health.ready ? 'is-ready' : health.broken ? 'is-broken' : 'is-unproven',
  )
</script>

{#if show}
  <button
    type="button"
    class="chrome-button rig-chip {tone}"
    onclick={() => goto('/rig')}
    title={health.summary}
    aria-label={health.summary}
  >
    <Radio class="size-3.5" aria-hidden="true" />
    Rig
    <span class="dot" aria-hidden="true"></span>
  </button>
{/if}

<style>
  .rig-chip {
    gap: 0.35rem;
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    flex: 0 0 auto;
    /* Colour is the glance; the tooltip is the detail. Shape stays constant so
       the button does not shift as the state changes. */
    background: currentColor;
  }
  .rig-chip.is-ready {
    color: #1f8a4c;
  }
  .rig-chip.is-broken {
    color: #b3261e;
  }
  .rig-chip.is-unproven {
    color: #b87503;
  }
  @media (prefers-color-scheme: dark) {
    .rig-chip.is-ready {
      color: #4ade80;
    }
    .rig-chip.is-broken {
      color: #ff8a7a;
    }
    .rig-chip.is-unproven {
      color: #f0b429;
    }
  }
</style>
